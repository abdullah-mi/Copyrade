import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import WebSocket from 'ws'
import { createSignalServer } from './server.js'

test('relays an offer between paired WebSocket clients', async () => {
  const server = createSignalServer(0)
  const sockets: WebSocket[] = []
  try {
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const url = `ws://127.0.0.1:${address.port}/signal`
    const code = '0123456789abcdef0123456789abcdef'
    const desktop = new WebSocket(url)
    sockets.push(desktop)
    await once(desktop, 'open')
    const desktopJoined = once(desktop, 'message')
    desktop.send(JSON.stringify({ type: 'join', code, role: 'desktop' }))
    await desktopJoined

    const mobile = new WebSocket(url)
    sockets.push(mobile)
    await once(mobile, 'open')
    const mobileJoined = once(mobile, 'message')
    const desktopReady = once(desktop, 'message')
    mobile.send(JSON.stringify({ type: 'join', code, role: 'mobile' }))
    await mobileJoined
    await desktopReady

    const offer = once(desktop, 'message')
    mobile.send(JSON.stringify({
      type: 'offer',
      data: { type: 'offer', sdp: 'synthetic SDP' },
    }))
    const [raw] = await offer
    assert.equal(JSON.parse(raw.toString()).data.sdp, 'synthetic SDP')
  } finally {
    for (const socket of sockets) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
