import { verifySignalingTicket } from './signaling-ticket.js'

type ConnectionRole = 'desktop' | 'mobile'

type AccountCoordinatorEnvironment = {
  SIGNALING_TICKET_SECRET: string
}

type SignalAttachment = {
  kind: 'signal'
  role: ConnectionRole
  deviceId: string
}

type PresenceAttachment = {
  kind: 'presence'
  deviceId: string
}

type ObserverAttachment = {
  kind: 'observer'
}

type ConnectionAttachment = SignalAttachment | PresenceAttachment | ObserverAttachment

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

export function shouldNotifyPeerOnClose(code: number): boolean {
  return code !== 4001
}

function attachment(socket: WebSocket): ConnectionAttachment | null {
  try {
    const value: unknown = socket.deserializeAttachment()
    if (!isRecord(value)) return null
    if (value.kind === 'observer') return { kind: 'observer' }
    if (typeof value.deviceId !== 'string') return null
    if (value.kind === 'presence') return { kind: 'presence', deviceId: value.deviceId }
    if (
      value.kind === 'signal' &&
      (value.role === 'desktop' || value.role === 'mobile')
    ) {
      return { kind: 'signal', role: value.role, deviceId: value.deviceId }
    }
    return null
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
    if (!own || own.kind !== 'signal') return null
    return this.sockets().find((candidate) => {
      if (candidate === socket) return false
      const peer = attachment(candidate)
      return peer?.kind === 'signal' && peer.deviceId === own.deviceId && peer.role !== own.role
    }) ?? null
  }

  private presenceFor(deviceId: string): WebSocket | null {
    return this.sockets().find((socket) => {
      const value = attachment(socket)
      return value?.kind === 'presence' && value.deviceId === deviceId
    }) ?? null
  }

  private onlineDeviceIds(): string[] {
    return [...new Set(
      this.sockets()
        .map(attachment)
        .filter((value): value is PresenceAttachment => value?.kind === 'presence')
        .map((value) => value.deviceId),
    )]
  }

  private notifyObservers(): void {
    const message = JSON.stringify({ type: 'presence', deviceIds: this.onlineDeviceIds() })
    for (const socket of this.sockets()) {
      if (attachment(socket)?.kind === 'observer') this.safelySend(socket, message)
    }
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
        const value = attachment(socket)
        if (value && value.kind !== 'observer' && value.deviceId === deviceId) {
          socket.close(4003, 'Device revoked')
        }
      }
      return new Response(null, { status: 204 })
    }

    if (url.pathname === '/online-devices' && request.method === 'GET') {
      return Response.json({ deviceIds: this.onlineDeviceIds() })
    }

    if (url.pathname === '/connection-request' && request.method === 'POST') {
      const deviceId = request.headers.get('x-copyrade-device-id')
      if (!deviceId) return new Response(null, { status: 400 })
      const presence = this.presenceFor(deviceId)
      if (!presence) return new Response(null, { status: 409 })
      this.safelySend(presence, JSON.stringify({ type: 'connect' }))
      return new Response(null, { status: 202 })
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
    const expectedProtocol = url.pathname === '/api/presence'
      ? 'copyrade-presence-v1'
      : 'copyrade-v1'
    if (!protocols.includes(expectedProtocol)) {
      return new Response('Unsupported protocol.', { status: 400 })
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

    if (url.pathname === '/api/presence') {
      if ((role !== 'presence' && role !== 'observer') || !protocols.includes('copyrade-presence-v1')) {
        return new Response('Invalid presence authorization.', { status: 401 })
      }
      if (role === 'observer') {
        const pair = new WebSocketPair()
        const [client, server] = Object.values(pair)
        server.serializeAttachment({ kind: 'observer' } satisfies ObserverAttachment)
        this.state.acceptWebSocket(server)
        this.safelySend(server, JSON.stringify({ type: 'presence', deviceIds: this.onlineDeviceIds() }))
        return new Response(null, {
          status: 101,
          webSocket: client,
          headers: { 'sec-websocket-protocol': 'copyrade-presence-v1' },
        })
      }
      if (!deviceId) return new Response('Invalid presence authorization.', { status: 401 })
      for (const socket of this.sockets()) {
        const existing = attachment(socket)
        if (existing?.kind === 'presence' && existing.deviceId === deviceId) {
          socket.close(4001, 'Presence replaced')
        }
      }
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      server.serializeAttachment({ kind: 'presence', deviceId } satisfies PresenceAttachment)
      this.state.acceptWebSocket(server)
      this.safelySend(server, JSON.stringify({ type: 'ready' }))
      this.notifyObservers()
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { 'sec-websocket-protocol': 'copyrade-presence-v1' },
      })
    }

    if (role === 'presence' || role === 'observer' || !deviceId) {
      return new Response('Invalid signaling authorization.', { status: 401 })
    }

    for (const socket of this.sockets()) {
      const existing = attachment(socket)
      if (existing?.kind === 'signal' && existing.role === role && existing.deviceId === deviceId) {
        socket.close(4001, 'Connection replaced')
      }
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.serializeAttachment({ kind: 'signal', role, deviceId } satisfies SignalAttachment)
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
    if (attachment(socket)?.kind === 'presence') {
      socket.close(1008, 'Presence sockets do not accept messages')
      return
    }
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

  webSocketClose(socket: WebSocket, code: number): void {
    const own = attachment(socket)
    if (!shouldNotifyPeerOnClose(code)) return
    const peer = this.peerFor(socket)
    if (peer) this.safelySend(peer, JSON.stringify({ type: 'left' }))
    if (own?.kind === 'presence') this.notifyObservers()
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, 'Signaling connection failed')
  }
}
