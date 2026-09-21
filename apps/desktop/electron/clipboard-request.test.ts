import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_TEXT_BYTES, validateClipboardText } from './clipboard-request.js'

describe('validateClipboardText', () => {
  it('accepts text and reports its UTF-8 byte length', () => {
    assert.deepEqual(validateClipboardText('Copyrade 📋'), {
      ok: true,
      text: 'Copyrade 📋',
      byteLength: 13,
    })
  })

  it('rejects non-string payloads', () => {
    const result = validateClipboardText({ text: 'not trusted' })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.code, 'INVALID_PAYLOAD')
    }
  })

  it('rejects empty text', () => {
    const result = validateClipboardText('')

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.code, 'EMPTY_TEXT')
    }
  })

  it('accepts exactly 1 MiB and rejects the next byte', () => {
    assert.equal(validateClipboardText('a'.repeat(MAX_TEXT_BYTES)).ok, true)

    const oversized = validateClipboardText('a'.repeat(MAX_TEXT_BYTES + 1))
    assert.equal(oversized.ok, false)
    if (!oversized.ok) {
      assert.equal(oversized.error.code, 'PAYLOAD_TOO_LARGE')
    }
  })
})
