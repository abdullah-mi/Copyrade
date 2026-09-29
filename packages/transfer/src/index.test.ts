import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createTextTransferMessage,
  decodeProtocolMessage,
  encodeProtocolMessage,
} from '@copyrade/protocol'
import {
  TextTransferSender,
  handleIncomingTextTransfer,
  type OutgoingTransferResult,
  type TransferClock,
} from './index.js'

const transferId = '123e4567-e89b-12d3-a456-426614174000'

function createClock() {
  const callbacks = new Map<number, () => void>()
  let nextHandle = 1
  const clock: TransferClock = {
    setTimeout(callback) {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    },
    clearTimeout(handle) {
      callbacks.delete(handle as number)
    },
  }
  return {
    clock,
    runAll() {
      for (const callback of [...callbacks.values()]) callback()
    },
    pendingCount() {
      return callbacks.size
    },
  }
}

describe('TextTransferSender', () => {
  it('completes only after a matching acknowledgement with the expected size', () => {
    const results: OutgoingTransferResult[] = []
    const sent: string[] = []
    const fakeClock = createClock()
    const sender = new TextTransferSender(
      (message) => sent.push(message),
      (result) => results.push(result),
      { createId: () => transferId, clock: fakeClock.clock },
    )

    const pending = sender.sendText('Copyrade')
    assert.equal(pending.byteLength, 8)
    assert.equal(sent.length, 1)
    assert.equal(results.length, 0)

    assert.equal(sender.handleMessage(encodeProtocolMessage({
      protocolVersion: 1,
      kind: 'CLIPBOARD_ACK',
      transferId: '00000000-0000-4000-8000-000000000000',
      byteLength: 8,
    })), false)
    assert.equal(results.length, 0)

    assert.equal(sender.handleMessage(encodeProtocolMessage({
      protocolVersion: 1,
      kind: 'CLIPBOARD_ACK',
      transferId,
      byteLength: 8,
    })), true)
    assert.deepEqual(results, [{ ok: true, transferId, byteLength: 8 }])
    assert.equal(fakeClock.pendingCount(), 0)
  })

  it('reports mismatched sizes, remote errors, timeouts, and disconnects', () => {
    const cases: Array<{
      trigger(sender: TextTransferSender, clock: ReturnType<typeof createClock>): void
      reason: string
    }> = [
      {
        trigger: (sender) => {
          sender.handleMessage(encodeProtocolMessage({
            protocolVersion: 1,
            kind: 'CLIPBOARD_ACK',
            transferId,
            byteLength: 7,
          }))
        },
        reason: 'acknowledgement_size_mismatch',
      },
      {
        trigger: (sender) => {
          sender.handleMessage(encodeProtocolMessage({
            protocolVersion: 1,
            kind: 'ERROR',
            transferId,
            code: 'CLIPBOARD_WRITE_FAILED',
            message: 'Synthetic failure.',
          }))
        },
        reason: 'remote_error',
      },
      { trigger: (_sender, clock) => clock.runAll(), reason: 'timeout' },
      { trigger: (sender) => sender.connectionClosed(), reason: 'connection_closed' },
    ]

    for (const testCase of cases) {
      const results: OutgoingTransferResult[] = []
      const fakeClock = createClock()
      const sender = new TextTransferSender(
        () => {},
        (result) => results.push(result),
        { createId: () => transferId, clock: fakeClock.clock },
      )
      sender.sendText('Copyrade')
      testCase.trigger(sender, fakeClock)
      assert.equal(results.length, 1)
      assert.equal(results[0]?.ok, false)
      if (!results[0]?.ok) assert.equal(results[0]?.reason, testCase.reason)
      assert.equal(fakeClock.pendingCount(), 0)
    }
  })

  it('cleans up after a send failure so a later transfer can start', () => {
    let shouldFail = true
    const sender = new TextTransferSender(
      () => {
        if (shouldFail) throw new Error('Synthetic send failure')
      },
      () => {},
      { createId: () => transferId, clock: createClock().clock },
    )

    assert.throws(() => sender.sendText('first'), /Synthetic send failure/)
    shouldFail = false
    assert.doesNotThrow(() => sender.sendText('second'))
    sender.dispose()
  })
})

describe('handleIncomingTextTransfer', () => {
  it('sends an acknowledgement only after the clipboard write succeeds', async () => {
    const events: string[] = []
    const transfer = createTextTransferMessage(transferId, 'Copyrade')
    const result = await handleIncomingTextTransfer(
      encodeProtocolMessage(transfer),
      {
        onWriteStart: () => events.push('write-start'),
        writeText: async (text) => {
          events.push(`write:${text}`)
          return { ok: true, byteLength: 8 }
        },
        send: (raw) => {
          const decoded = decodeProtocolMessage(raw)
          assert.equal(decoded.ok, true)
          events.push('ack')
        },
      },
    )

    assert.deepEqual(events, ['write-start', 'write:Copyrade', 'ack'])
    assert.deepEqual(result, { ok: true, transferId, byteLength: 8 })
  })

  it('reports clipboard failures without sending an acknowledgement', async () => {
    const sent: string[] = []
    const transfer = createTextTransferMessage(transferId, 'Copyrade')
    const result = await handleIncomingTextTransfer(
      encodeProtocolMessage(transfer),
      {
        writeText: async () => ({
          ok: false,
          error: { code: 'WRITE_FAILED', message: 'Synthetic write failure.' },
        }),
        send: (raw) => sent.push(raw),
      },
    )

    assert.equal(result.ok, false)
    assert.equal(sent.length, 1)
    const response = decodeProtocolMessage(sent[0])
    assert.equal(response.ok, true)
    if (response.ok) assert.equal(response.message.kind, 'ERROR')
  })

  it('rejects invalid input before requesting a clipboard write', async () => {
    let writes = 0
    const sent: string[] = []
    const result = await handleIncomingTextTransfer('not JSON', {
      writeText: async () => {
        writes += 1
        return { ok: true, byteLength: 1 }
      },
      send: (raw) => sent.push(raw),
    })

    assert.equal(result.ok, false)
    assert.equal(writes, 0)
    assert.equal(sent.length, 1)
  })
})
