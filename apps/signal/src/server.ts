import { WebSocketServer } from 'ws'
import { Rooms, type Role } from './rooms.js'

export function createSignalServer(port: number): WebSocketServer {
  const rooms = new Rooms()
  const server = new WebSocketServer({
    host: '127.0.0.1',
    port,
    path: '/signal',
    maxPayload: 16_384,
    perMessageDeflate: false,
  })

  server.on('connection', (socket, request) => {
  if (request.url !== '/signal') {
    socket.close(1008, 'Invalid path')
    return
  }
  let joined: { code: string; role: Role } | null = null
  const joinTimeout = setTimeout(() => socket.close(1008, 'Join timeout'), 5000)
  socket.on('message', (data, binary) => {
    if (binary) {
      socket.close(1008, 'Invalid signaling message')
      return
    }
    const raw = data.toString()
    if (!joined) {
      let value: unknown
      try {
        value = JSON.parse(raw) as unknown
      } catch {
        socket.close(1008, 'Invalid join')
        return
      }
      if (
        typeof value !== 'object' || value === null || Array.isArray(value) ||
        !('type' in value) || value.type !== 'join' ||
        !('code' in value) || typeof value.code !== 'string' ||
        !('role' in value) || (value.role !== 'desktop' && value.role !== 'mobile') ||
        Object.keys(value).length !== 3 ||
        !rooms.join(value.code, value.role, socket)
      ) {
        socket.close(1008, 'Invalid or occupied session')
        return
      }
      joined = { code: value.code, role: value.role }
      clearTimeout(joinTimeout)
    } else if (!rooms.forward(joined.code, joined.role, socket, raw)) {
      socket.close(1008, 'Invalid signaling message')
    }
  })
  socket.on('close', () => {
    clearTimeout(joinTimeout)
    if (joined) rooms.leave(joined.code, joined.role, socket)
  })
  })

  return server
}
