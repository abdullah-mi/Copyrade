import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_SERIALIZED_MESSAGE_BYTES,
  createTextTransferMessage,
  decodeProtocolMessage,
  encodeProtocolMessage,
  parseProtocolMessage,
} from './index.js'

const transferId = '123e4567-e89b-12d3-a456-426614174000'

describe('Copyrade protocol', () => {
  it('round-trips a UTF-8 text transfer', () => {
    const message = createTextTransferMessage(transferId, 'Copyrade 📋')
    const result = decodeProtocolMessage(encodeProtocolMessage(message))

    assert.deepEqual(result, { ok: true, message })
    assert.equal(message.payload.representations[0].byteLength, 13)
  })

  it('accepts a matching clipboard acknowledgement', () => {
    const result = parseProtocolMessage({
      protocolVersion: 1,
      kind: 'CLIPBOARD_ACK',
      transferId,
      byteLength: 13,
    })

    assert.equal(result.ok, true)
  })

  it('accepts a bounded error without requiring a transfer ID', () => {
    const result = parseProtocolMessage({
      protocolVersion: 1,
      kind: 'ERROR',
      code: 'INVALID_MESSAGE',
      message: 'The peer rejected the message.',
    })

    assert.equal(result.ok, true)
  })

  it('rejects malformed JSON without echoing its contents', () => {
    const result = decodeProtocolMessage('{private clipboard text')

    assert.deepEqual(result, {
      ok: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Protocol message is not valid JSON.',
      },
    })
  })

  it('rejects a text representation with a false byte length', () => {
    const message = createTextTransferMessage(transferId, 'hello')
    message.payload.representations[0].byteLength = 4

    const result = parseProtocolMessage(message)
    assert.equal(result.ok, false)
  })

  it('rejects unknown fields and unsupported protocol versions', () => {
    const message = createTextTransferMessage(transferId, 'hello')

    assert.equal(
      parseProtocolMessage({ ...message, unexpected: true }).ok,
      false,
    )
    assert.equal(
      parseProtocolMessage({ ...message, protocolVersion: 2 }).ok,
      false,
    )
  })

  it('rejects serialized messages above the transport bound', () => {
    const result = decodeProtocolMessage(
      'a'.repeat(MAX_SERIALIZED_MESSAGE_BYTES + 1),
    )

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.code, 'MESSAGE_TOO_LARGE')
    }
  })

  it('rejects invalid sender-side transfer inputs', () => {
    assert.throws(
      () => createTextTransferMessage('short-id', 'hello'),
      TypeError,
    )
    assert.throws(() => createTextTransferMessage(transferId, ''), RangeError)
  })
})
