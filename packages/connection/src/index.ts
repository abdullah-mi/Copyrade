export type Role = 'desktop' | 'mobile'
export type ConnectionState = 'disconnected' | 'signaling' | 'connecting' | 'connected' | 'failed'
type Signal = { type: 'offer' | 'answer' | 'candidate'; data: RTCSessionDescriptionInit | RTCIceCandidateInit }

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]

export class DevelopmentConnection {
  private socket: WebSocket | null = null
  private peer: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private pendingCandidates: RTCIceCandidateInit[] = []
  private listeners = new Set<(state: ConnectionState) => void>()
  state: ConnectionState = 'disconnected'

  subscribe(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => { this.listeners.delete(listener) }
  }

  private update(state: ConnectionState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }

  private send(signal: Signal): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(signal))
    }
  }

  private attachChannel(channel: RTCDataChannel): void {
    this.channel = channel
    channel.onopen = () => {
      if (this.channel === channel) this.update('connected')
    }
    channel.onclose = () => {
      if (this.channel === channel && this.state !== 'failed') this.update('disconnected')
    }
    channel.onerror = () => {
      if (this.channel === channel) this.update('failed')
    }
  }

  async connect(role: Role, code: string, url: string): Promise<void> {
    if (!/^[0-9a-f]{32}$/.test(code)) throw new Error('Enter a 32-character session code.')
    if (!url.startsWith('wss://') && !url.startsWith('ws://127.0.0.1:')) {
      throw new Error('Signaling requires WSS or local loopback.')
    }
    this.disconnect()
    this.update('signaling')
    const socket = new WebSocket(url)
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.socket = socket
    this.peer = peer
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) this.send({ type: 'candidate', data: candidate.toJSON() })
    }
    peer.onconnectionstatechange = () => {
      if (this.peer !== peer) return
      if (peer.connectionState === 'failed') this.update('failed')
      if (peer.connectionState === 'disconnected' && this.state !== 'failed') {
        this.update('disconnected')
      }
    }
    peer.ondatachannel = ({ channel }) => this.attachChannel(channel)
    socket.onopen = () => socket.send(JSON.stringify({ type: 'join', code, role }))
    socket.onclose = (event) => {
      if (this.socket === socket) {
        this.disconnect()
        this.update(event.code === 1000 ? 'disconnected' : 'failed')
      }
    }
    socket.onerror = () => this.update('failed')
    socket.onmessage = (event) => {
      void this.handleMessage(event.data, role, peer).catch(() => this.update('failed'))
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
    const socket = this.socket
    this.socket = null
    socket?.close()
    this.channel?.close()
    this.channel = null
    this.peer?.close()
    this.peer = null
    this.pendingCandidates = []
    this.update('disconnected')
  }
}
