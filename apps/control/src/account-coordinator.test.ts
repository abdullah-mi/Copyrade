import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isValidSignal, shouldNotifyPeerOnClose } from './account-coordinator.js'

describe('authenticated signaling validation', () => {
  it('accepts bounded SDP and browser candidates', () => {
    assert.equal(
      isValidSignal({ type: 'offer', data: { type: 'offer', sdp: 'synthetic' } }),
      true,
    )
    assert.equal(
      isValidSignal({
        type: 'candidate',
        data: {
          candidate: 'candidate:1 1 udp 1 192.0.2.1 1234 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        },
      }),
      true,
    )
  })

  it('rejects payloads, extra fields, and oversized SDP', () => {
    assert.equal(isValidSignal({ type: 'offer', data: { text: 'clipboard' } }), false)
    assert.equal(
      isValidSignal({
        type: 'answer',
        data: { type: 'answer', sdp: 'synthetic' },
        accountId: 'leak',
      }),
      false,
    )
    assert.equal(
      isValidSignal({ type: 'offer', data: { type: 'offer', sdp: 'x'.repeat(12_001) } }),
      false,
    )
  })
})

describe('signaling socket replacement', () => {
  it('does not disconnect the new peer when a stale socket is replaced', () => {
    assert.equal(shouldNotifyPeerOnClose(4001), false)
    assert.equal(shouldNotifyPeerOnClose(1000), true)
    assert.equal(shouldNotifyPeerOnClose(1011), true)
  })
})
