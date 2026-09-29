import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { DevelopmentConnection } from './index.js'

const code = '0123456789abcdef0123456789abcdef'

class FakeDataChannel {
  readyState: RTCDataChannelState = 'connecting'
  closed = false
  sent: string[] = []
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

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
}

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []

  readyState = 0
  closed = false
  sent: string[] = []
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(message: string): void {
    this.sent.push(message)
  }

  close(): void {
    this.closed = true
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
    assert.equal(peer.closed, true)
  })
})
