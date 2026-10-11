import { verifySignalingTicket } from './signaling-ticket.js'

type ConnectionRole = 'desktop' | 'mobile'

type AccountCoordinatorEnvironment = {
  SIGNALING_TICKET_SECRET: string
}

type ConnectionAttachment = {
  role: ConnectionRole
  deviceId: string
}

const SIGNAL_TYPES = new Set(['offer', 'answer', 'candidate'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isValidSignal(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    !SIGNAL_TYPES.has(value.type) ||
    !isRecord(value.data) ||
    Object.keys(value).some((key) => key !== 'type' && key !== 'data')
  ) {
    return false
  }
  const data = value.data
  if (value.type === 'candidate') {
    return (
      typeof data.candidate === 'string' &&
      data.candidate.length <= 4096 &&
      (data.sdpMid === null || typeof data.sdpMid === 'string') &&
      (data.sdpMLineIndex === null ||
        (typeof data.sdpMLineIndex === 'number' && Number.isSafeInteger(data.sdpMLineIndex))) &&
      (data.usernameFragment == null || typeof data.usernameFragment === 'string') &&
      Object.keys(data).every((key) =>
        ['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment'].includes(key),
      )
    )
  }
  return (
    data.type === value.type &&
    typeof data.sdp === 'string' &&
    data.sdp.length > 0 &&
    data.sdp.length <= 12_000 &&
    Object.keys(data).every((key) => key === 'type' || key === 'sdp')
  )
}

function attachment(socket: WebSocket): ConnectionAttachment | null {
  try {
    const value: unknown = socket.deserializeAttachment()
    if (!isRecord(value)) return null
    if (value.role !== 'desktop' && value.role !== 'mobile') return null
    if (typeof value.deviceId !== 'string') return null
    return { role: value.role, deviceId: value.deviceId }
  } catch {
    return null
  }
}

export class AccountCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: AccountCoordinatorEnvironment,
  ) {}

  private sockets(): WebSocket[] {
    return this.state.getWebSockets()
  }

  private peerFor(socket: WebSocket): WebSocket | null {
    const own = attachment(socket)
    if (!own) return null
    return this.sockets().find((candidate) => {
      if (candidate === socket) return false
      const peer = attachment(candidate)
      return peer?.deviceId === own.deviceId && peer.role !== own.role
    }) ?? null
  }

  private safelySend(socket: WebSocket, message: string): void {
    try {
      socket.send(message)
    } catch {
      socket.close(1011, 'Signaling delivery failed')
    }
  }

  private notifyReady(socket: WebSocket): void {
    const peer = this.peerFor(socket)
    if (!peer) return
    this.safelySend(socket, JSON.stringify({ type: 'ready' }))
    this.safelySend(peer, JSON.stringify({ type: 'ready' }))
  }

  private consumeTicket(nonce: string, expiresAt: number): boolean {
    try {
      this.state.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS usedTicket (nonce TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL)',
      )
      this.state.storage.sql.exec('DELETE FROM usedTicket WHERE expiresAt <= ?', Date.now())
      this.state.storage.sql.exec(
        'INSERT INTO usedTicket (nonce, expiresAt) VALUES (?, ?)',
        nonce,
        expiresAt,
      )
      return true
    } catch {
      return false
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/revoke' && request.method === 'POST') {
      const deviceId = request.headers.get('x-copyrade-device-id')
      if (!deviceId) return new Response(null, { status: 400 })
      for (const socket of this.sockets()) {
        if (attachment(socket)?.deviceId === deviceId) {
          socket.close(4003, 'Device revoked')
        }
      }
      return new Response(null, { status: 204 })
    }

    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required.', { status: 426 })
    }
    if (!this.env.SIGNALING_TICKET_SECRET || this.env.SIGNALING_TICKET_SECRET.length < 32) {
      return new Response('Signaling is unavailable.', { status: 503 })
    }
    const protocols = (request.headers.get('sec-websocket-protocol') ?? '')
      .split(',')
      .map((value) => value.trim())
    if (!protocols.includes('copyrade-v1')) {
      return new Response('Unsupported signaling protocol.', { status: 400 })
    }
    const ticket = protocols.find((value) => value.startsWith('cpy.signal.'))
    const claims = ticket
      ? await verifySignalingTicket(ticket, this.env.SIGNALING_TICKET_SECRET)
      : null
    if (
      !claims ||
      !this.consumeTicket(claims.nonce, claims.expiresAt)
    ) {
      return new Response('Invalid signaling authorization.', { status: 401 })
    }
    const { role, deviceId } = claims

    for (const socket of this.sockets()) {
      const existing = attachment(socket)
      if (existing?.role === role && existing.deviceId === deviceId) {
        socket.close(4001, 'Connection replaced')
      }
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.serializeAttachment({ role, deviceId } satisfies ConnectionAttachment)
    this.state.acceptWebSocket(server)
    this.safelySend(server, JSON.stringify({ type: 'joined', role }))
    this.notifyReady(server)

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'sec-websocket-protocol': 'copyrade-v1' },
    })
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string' || message.length > 16_384) {
      socket.close(1008, 'Invalid signaling message')
      return
    }
    let value: unknown
    try {
      value = JSON.parse(message)
    } catch {
      socket.close(1008, 'Invalid signaling message')
      return
    }
    if (!isValidSignal(value)) {
      socket.close(1008, 'Invalid signaling message')
      return
    }
    const peer = this.peerFor(socket)
    if (!peer) {
      socket.close(1008, 'No authorized peer')
      return
    }
    this.safelySend(peer, message)
  }

  webSocketClose(socket: WebSocket): void {
    const peer = this.peerFor(socket)
    if (peer) this.safelySend(peer, JSON.stringify({ type: 'left' }))
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, 'Signaling connection failed')
  }
}
