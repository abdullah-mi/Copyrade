export const MAX_TEXT_BYTES = 1024 * 1024

export type ClipboardWriteErrorCode =
  | 'EMPTY_TEXT'
  | 'INVALID_PAYLOAD'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNTRUSTED_SENDER'
  | 'WRITE_FAILED'

type ClipboardWriteFailure = {
  ok: false
  error: {
    code: ClipboardWriteErrorCode
    message: string
  }
}

export type ClipboardWriteResult =
  | { ok: true; byteLength: number }
  | ClipboardWriteFailure

type ValidClipboardText = {
  ok: true
  text: string
  byteLength: number
}

export function clipboardWriteFailure(
  code: ClipboardWriteErrorCode,
  message: string,
): ClipboardWriteFailure {
  return { ok: false, error: { code, message } }
}

export function validateClipboardText(
  payload: unknown,
): ValidClipboardText | ClipboardWriteFailure {
  if (typeof payload !== 'string') {
    return clipboardWriteFailure(
      'INVALID_PAYLOAD',
      'Clipboard text must be a string.',
    )
  }

  const byteLength = Buffer.byteLength(payload, 'utf8')

  if (byteLength === 0) {
    return clipboardWriteFailure(
      'EMPTY_TEXT',
      'Enter text before writing to the clipboard.',
    )
  }

  if (byteLength > MAX_TEXT_BYTES) {
    return clipboardWriteFailure(
      'PAYLOAD_TOO_LARGE',
      'Clipboard text must be no larger than 1 MiB.',
    )
  }

  return { ok: true, text: payload, byteLength }
}
