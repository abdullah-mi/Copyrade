import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createSignalingTicket, verifySignalingTicket } from './signaling-ticket.js'

const secret = 'a-separate-signaling-secret-with-at-least-32-characters'

describe('signaling tickets', () => {
  it('round-trips authenticated account, role, and device claims', async () => {
    const issued = await createSignalingTicket(
      {
        accountId: 'user-1',
        role: 'desktop',
        deviceId: '00000000-0000-4000-8000-000000000001',
      },
      secret,
      1_000_000,
    )
    const claims = await verifySignalingTicket(issued.ticket, secret, 1_000_001)
    assert.equal(claims?.accountId, 'user-1')
    assert.equal(claims?.role, 'desktop')
    assert.equal(claims?.deviceId, '00000000-0000-4000-8000-000000000001')
  })

  it('rejects tampered and expired tickets', async () => {
    const issued = await createSignalingTicket(
      {
        accountId: 'user-1',
        role: 'mobile',
        deviceId: '00000000-0000-4000-8000-000000000001',
      },
      secret,
      1_000_000,
    )
    assert.equal(
      await verifySignalingTicket(`${issued.ticket}x`, secret, 1_000_001),
      null,
    )
    assert.equal(await verifySignalingTicket(issued.ticket, secret, issued.expiresAt), null)
  })
})
