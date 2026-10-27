import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { DevelopmentConnection } from './index.js'

const code = '0123456789abcdef0123456789abcdef'

class FakeDataChannel {
  readyState: RTCDataChannelState = 'connecting'
  bufferedAmount = 0
  bufferedAmountLowThreshold = 0
  closed = false
  sent: string[] = []
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  private listeners = new Map<string, Set<() => void>>()

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set<() => void>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(message: string): void {
    this.sent.push(message)
  }

  close(): void {
    this.closed = true
    this.readyState = 'closed'
  }

  open(): void {
    this.readyState = 'open'
    this.onopen?.({} as Event)
  }

  emitClose(): void {
    this.readyState = 'closed'
    this.onclose?.({} as Event)
  }

  drain(): void {
    this.bufferedAmount = 0
    for (const listener of [...(this.listeners.get('bufferedamountlow') ?? [])]) listener()
  }
}

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []

  readyState = 0
  closed = false
  closeCode: number | undefined
  closeReason: string | undefined
  sent: string[] = []
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    FakeWebSocket.instances.push(this)
  }

  send(message: string): void {
    this.sent.push(message)
  }

  close(code?: number, reason?: string): void {
    this.closed = true
    this.closeCode = code
    this.closeReason = reason
    this.readyState = 3
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({} as Event)
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = []

  connectionState: RTCPeerConnectionState = 'new'
  localDescription: RTCSessionDescription | null = null
  remoteDescription: RTCSessionDescription | null = null
  sctp: RTCSctpTransport | null = null
  closed = false
  createdChannel: FakeDataChannel | null = null
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null
  onconnectionstatechange: ((event: Event) => void) | null = null
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null

  constructor() {
    FakePeerConnection.instances.push(this)
  }

  createDataChannel(): RTCDataChannel {
    this.createdChannel = new FakeDataChannel()
    return this.createdChannel as unknown as RTCDataChannel
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'synthetic offer' }
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'synthetic answer' }
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = {
      type: description.type,
      sdp: description.sdp ?? '',
      toJSON: () => description,
    }
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = {
      type: description.type,
      sdp: description.sdp ?? '',
      toJSON: () => description,
    }
  }

  async addIceCandidate(): Promise<void> {}

  close(): void {
    this.closed = true
    this.connectionState = 'closed'
  }
}

const originalWebSocket = globalThis.WebSocket
const originalPeerConnection = globalThis.RTCPeerConnection

beforeEach(() => {
  FakeWebSocket.instances = []
  FakePeerConnection.instances = []
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeWebSocket,
  })
  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    configurable: true,
    value: FakePeerConnection,
  })
})

afterEach(() => {
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: originalWebSocket,
  })
  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    configurable: true,
    value: originalPeerConnection,
  })
})

describe('DevelopmentConnection lifecycle', () => {
  it('closes the prior attempt and ignores its already-queued events', async () => {
    const connection = new DevelopmentConnection()
    await connection.connect('desktop', code, 'ws://127.0.0.1:8787/signal')
    const firstSocket = FakeWebSocket.instances[0]
    const firstPeer = FakePeerConnection.instances[0]
    assert.ok(firstSocket)
    assert.ok(firstPeer)
    const staleError = firstSocket.onerror
    const staleDataChannel = firstPeer.ondatachannel

    await connection.connect('desktop', code, 'ws://127.0.0.1:8787/signal')
    assert.equal(firstSocket.closed, true)
    assert.equal(firstSocket.closeCode, 4001)
    assert.equal(firstSocket.closeReason, 'Connection replaced')
    assert.equal(firstPeer.closed, true)
    assert.equal(connection.state, 'signaling')

    staleError?.({} as Event)
    const staleChannel = new FakeDataChannel()
    staleDataChannel?.({ channel: staleChannel as unknown as RTCDataChannel } as RTCDataChannelEvent)
    assert.equal(connection.state, 'signaling')
    assert.equal(staleChannel.closed, true)
  })

  it('cleans up signaling and peer resources when the active channel closes', async () => {
    const connection = new DevelopmentConnection()
    await connection.connect('desktop', code, 'ws://127.0.0.1:8787/signal')
    const socket = FakeWebSocket.instances[0]
    const peer = FakePeerConnection.instances[0]
    assert.ok(socket)
    assert.ok(peer)
    const channel = new FakeDataChannel()

    peer.ondatachannel?.({ channel: channel as unknown as RTCDataChannel } as RTCDataChannelEvent)
    channel.open()
    assert.equal(connection.state, 'connected')

    channel.emitClose()
    assert.equal(connection.state, 'disconnected')
    assert.equal(socket.closed, true)
    assert.equal(socket.closeCode, 1000)
    assert.equal(peer.closed, true)
  })

  it('uses a short-lived ticket as a WebSocket subprotocol without a join message', async () => {
    const connection = new DevelopmentConnection()
    const ticket = `cpy.signal.${'a'.repeat(32)}.${'b'.repeat(43)}`
    await connection.connectAuthenticated(
      'desktop',
      ticket,
      'wss://copyrade.example/api/signal',
    )
    const socket = FakeWebSocket.instances[0]
    assert.deepEqual(socket.protocols, ['copyrade-v1', ticket])
    socket.open()
    assert.deepEqual(socket.sent, [])
  })

  it('waits for the DataChannel buffer to drain before sending another chunk', async () => {
    const connection = new DevelopmentConnection()
    await connection.connect('desktop', code, 'ws://127.0.0.1:8787/signal')
    const peer = FakePeerConnection.instances[0]
    assert.ok(peer)
    const channel = new FakeDataChannel()
    peer.ondatachannel?.({ channel: channel as unknown as RTCDataChannel } as RTCDataChannelEvent)
    channel.open()
    channel.bufferedAmount = 300 * 1024

    const sending = connection.sendDataWithBackpressure('next chunk')
    assert.deepEqual(channel.sent, [])
    channel.drain()
    await sending
    assert.deepEqual(channel.sent, ['next chunk'])
  })
})
