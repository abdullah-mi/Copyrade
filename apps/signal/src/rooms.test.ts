import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Rooms, type Peer } from './rooms.js'

const code = '0123456789abcdef0123456789abcdef'
function peer() {
  const messages: string[] = []
  const value: Peer = { send: (message) => messages.push(message), close: () => {} }
  return { value, messages }
}

test('pairs one desktop and mobile and relays signaling only to its peer', () => {
  const rooms = new Rooms()
  const desktop = peer()
  const mobile = peer()
  assert.equal(rooms.join(code, 'desktop', desktop.value), true)
  assert.equal(rooms.join(code, 'mobile', mobile.value), true)
  assert.equal(rooms.join(code, 'mobile', peer().value), false)
  assert.equal(rooms.forward(code, 'mobile', mobile.value, JSON.stringify({ type: 'offer', data: { type: 'offer', sdp: 'synthetic' } })), true)
  assert.equal(JSON.parse(desktop.messages.at(-1) ?? '{}').type, 'offer')
  assert.equal(rooms.forward(code, 'desktop', peer().value, '{}'), false)
})

test('rejects malformed and oversized signaling and removes empty rooms', () => {
  const rooms = new Rooms()
  const desktop = peer()
  assert.equal(rooms.join('bad-code', 'desktop', desktop.value), false)
  rooms.join(code, 'desktop', desktop.value)
  assert.equal(rooms.forward(code, 'desktop', desktop.value, 'secret clipboard content'), false)
  assert.equal(rooms.forward(code, 'desktop', desktop.value, JSON.stringify({ type: 'offer', data: { text: 'not signaling' } })), false)
  assert.equal(rooms.forward(code, 'desktop', desktop.value, 'x'.repeat(16_385)), false)
  rooms.leave(code, 'desktop', desktop.value)
  assert.equal(rooms.join(code, 'desktop', peer().value), true)
})

test('relays candidates with a null username fragment', () => {
  const rooms = new Rooms()
  const desktop = peer()
  const mobile = peer()
  rooms.join(code, 'desktop', desktop.value)
  rooms.join(code, 'mobile', mobile.value)
  const candidate = JSON.stringify({
    type: 'candidate',
    data: { candidate: 'candidate:1 1 udp 1 192.0.2.1 1234 typ host', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: null },
  })
  assert.equal(rooms.forward(code, 'mobile', mobile.value, candidate), true)
  assert.equal(desktop.messages.at(-1), candidate)
})
