export type Role = 'desktop' | 'mobile'
export type Peer = { send(message: string): void; close(): void }
type Room = Partial<Record<Role, Peer>>

const CODE = /^[0-9a-f]{32}$/
const SIGNAL = new Set(['offer', 'answer', 'candidate'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSignal(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string' ||
    !SIGNAL.has(value.type) || !isRecord(value.data) ||
    Object.keys(value).some((key) => key !== 'type' && key !== 'data')) return false
  const data = value.data
  if (value.type === 'candidate') {
    return typeof data.candidate === 'string' && data.candidate.length <= 4096 &&
      (data.sdpMid === null || typeof data.sdpMid === 'string') &&
      (data.sdpMLineIndex === null ||
        (typeof data.sdpMLineIndex === 'number' && Number.isSafeInteger(data.sdpMLineIndex))) &&
      (data.usernameFragment == null || typeof data.usernameFragment === 'string') &&
      Object.keys(data).every((key) =>
        ['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment'].includes(key))
  }
  return data.type === value.type && typeof data.sdp === 'string' &&
    data.sdp.length > 0 && data.sdp.length <= 12_000 &&
    Object.keys(data).every((key) => key === 'type' || key === 'sdp')
}

export class Rooms {
  private readonly rooms = new Map<string, Room>()

  join(code: string, role: Role, peer: Peer): boolean {
    if (!CODE.test(code)) return false
    const room = this.rooms.get(code) ?? {}
    if (room[role]) return false
    room[role] = peer
    this.rooms.set(code, room)
    peer.send(JSON.stringify({ type: 'joined', role }))
    if (room.desktop && room.mobile) {
      room.desktop.send(JSON.stringify({ type: 'ready' }))
      room.mobile.send(JSON.stringify({ type: 'ready' }))
    }
    return true
  }

  forward(code: string, role: Role, peer: Peer, raw: string): boolean {
    const room = this.rooms.get(code)
    if (!room || room[role] !== peer || raw.length > 16_384) return false
    let value: unknown
    try {
      value = JSON.parse(raw) as unknown
    } catch {
      return false
    }
    if (!isSignal(value)) return false
    const recipient = role === 'desktop' ? room.mobile : room.desktop
    if (!recipient) return false
    recipient.send(raw)
    return true
  }

  leave(code: string, role: Role, peer: Peer): void {
    const room = this.rooms.get(code)
    if (!room || room[role] !== peer) return
    delete room[role]
    const other = role === 'desktop' ? room.mobile : room.desktop
    other?.send(JSON.stringify({ type: 'left' }))
    if (!room.desktop && !room.mobile) this.rooms.delete(code)
  }
}
