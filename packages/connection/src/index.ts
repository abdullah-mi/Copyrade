export type Role = 'desktop' | 'mobile'
export type ConnectionState = 'disconnected' | 'signaling' | 'connecting' | 'connected' | 'failed'
type Signal = { type: 'offer' | 'answer' | 'candidate'; data: RTCSessionDescriptionInit | RTCIceCandidateInit }

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]
const MOBILE_CONNECTION_TIMEOUT_MS = 15_000
const textEncoder = new TextEncoder()

export class DevelopmentConnection {
  private socket: WebSocket | null = null
  private peer: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private pendingCandidates: RTCIceCandidateInit[] = []
  private listeners = new Set<(state: ConnectionState) => void>()
  private messageListeners = new Set<(message: unknown) => void>()
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null
  state: ConnectionState = 'disconnected'
  error: string | null = null

  subscribe(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => { this.listeners.delete(listener) }
  }

  subscribeMessages(listener: (message: unknown) => void): () => void {
    this.messageListeners.add(listener)
    return () => { this.messageListeners.delete(listener) }
  }

  private update(state: ConnectionState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }

  private clearConnectionTimeout(): void {
    if (this.connectionTimeout !== null) clearTimeout(this.connectionTimeout)
    this.connectionTimeout = null
  }

  private closeResources(): void {
    this.clearConnectionTimeout()
    const socket = this.socket
    const channel = this.channel
    const peer = this.peer
    this.socket = null
    this.channel = null
    this.peer = null
    this.pendingCandidates = []
    if (socket) {
      socket.onclose = null
      socket.close()
    }
    if (channel) {
      channel.onclose = null
      channel.close()
    }
    peer?.close()
  }

  private fail(message: string): void {
    this.closeResources()
    this.error = message
    this.update('failed')
  }

  private send(signal: Signal): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(signal))
    }
  }

  private attachChannel(channel: RTCDataChannel): void {
    this.channel = channel
    channel.onopen = () => {
      if (this.channel === channel) {
        this.clearConnectionTimeout()
        this.update('connected')
      }
    }
    channel.onclose = () => {
      if (this.channel === channel && this.state !== 'failed') this.update('disconnected')
    }
    channel.onerror = () => {
      if (this.channel === channel) this.fail('The peer connection failed.')
    }
    channel.onmessage = (event) => {
      if (this.channel !== channel) return
      for (const listener of this.messageListeners) listener(event.data)
    }
  }

  sendData(message: string): void {
    if (this.channel?.readyState !== 'open') {
      throw new Error('The peer connection is not ready.')
    }
    const maximum = this.peer?.sctp?.maxMessageSize
    if (maximum && Number.isFinite(maximum) && textEncoder.encode(message).byteLength > maximum) {
      throw new RangeError('The message exceeds this connection\'s negotiated size limit.')
    }
    this.channel.send(message)
  }

  async connect(role: Role, code: string, url: string): Promise<void> {
    if (!/^[0-9a-f]{32}$/.test(code)) throw new Error('Enter a 32-character session code.')
    if (!url.startsWith('wss://') && !url.startsWith('ws://127.0.0.1:')) {
      throw new Error('Signaling requires WSS or local loopback.')
    }
    this.closeResources()
    this.error = null
    this.update('signaling')
    const socket = new WebSocket(url)
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.socket = socket
    this.peer = peer
    if (role === 'mobile') {
      this.connectionTimeout = setTimeout(() => {
        if (this.peer === peer && this.state !== 'connected') {
          this.fail('No desktop matched that code before the connection timed out.')
        }
      }, MOBILE_CONNECTION_TIMEOUT_MS)
    }
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) this.send({ type: 'candidate', data: candidate.toJSON() })
    }
    peer.onconnectionstatechange = () => {
      if (this.peer !== peer) return
      if (peer.connectionState === 'failed') this.fail('The peer connection failed.')
      if (peer.connectionState === 'disconnected' && this.state !== 'failed') {
        this.update('disconnected')
      }
    }
    peer.ondatachannel = ({ channel }) => this.attachChannel(channel)
    socket.onopen = () => socket.send(JSON.stringify({ type: 'join', code, role }))
    socket.onclose = (event) => {
      if (this.socket === socket) {
        if (event.code === 1000) this.disconnect()
        else this.fail('The signaling connection closed unexpectedly.')
      }
    }
    socket.onerror = () => this.fail('The signaling connection failed.')
    socket.onmessage = (event) => {
      void this.handleMessage(event.data, role, peer).catch(() => {
        this.fail('Connection negotiation failed.')
      })
    }
  }

  private async handleMessage(raw: unknown, role: Role, peer: RTCPeerConnection): Promise<void> {
    if (this.peer !== peer || typeof raw !== 'string' || raw.length > 16_384) return
    const message: unknown = JSON.parse(raw)
    if (typeof message !== 'object' || message === null || !('type' in message)) return
    if (message.type === 'left') {
      this.disconnect()
      return
    }
    if (message.type === 'ready') {
      this.update('connecting')
      if (role === 'mobile') {
        this.attachChannel(peer.createDataChannel('copyrade-diagnostic'))
        await peer.setLocalDescription(await peer.createOffer())
        this.send({ type: 'offer', data: peer.localDescription!.toJSON() })
      }
      return
    }
    if (!('data' in message) || typeof message.data !== 'object' || message.data === null) return
    if (message.type === 'offer' && role === 'desktop') {
      await peer.setRemoteDescription(message.data as RTCSessionDescriptionInit)
      await peer.setLocalDescription(await peer.createAnswer())
      this.send({ type: 'answer', data: peer.localDescription!.toJSON() })
    } else if (message.type === 'answer' && role === 'mobile') {
      await peer.setRemoteDescription(message.data as RTCSessionDescriptionInit)
    } else if (message.type === 'candidate') {
      const candidate = message.data as RTCIceCandidateInit
      if (peer.remoteDescription) await peer.addIceCandidate(candidate)
      else this.pendingCandidates.push(candidate)
    }
    if (peer.remoteDescription) {
      for (const candidate of this.pendingCandidates.splice(0)) {
        await peer.addIceCandidate(candidate)
      }
    }
  }

  disconnect(): void {
    this.closeResources()
    this.error = null
    this.update('disconnected')
  }
}
