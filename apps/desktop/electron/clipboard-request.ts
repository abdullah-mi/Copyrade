export const MAX_TEXT_BYTES = 1024 * 1024
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024
export type ClipboardImageMimeType = 'image/png' | 'image/jpeg'

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

type ValidClipboardImage = {
  ok: true
  mimeType: ClipboardImageMimeType
  bytes: Uint8Array
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

export function validateClipboardImage(
  mimeType: unknown,
  payload: unknown,
): ValidClipboardImage | ClipboardWriteFailure {
  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') {
    return clipboardWriteFailure('INVALID_PAYLOAD', 'Clipboard image type is not supported.')
  }
  if (!(payload instanceof Uint8Array)) {
    return clipboardWriteFailure('INVALID_PAYLOAD', 'Clipboard image bytes are invalid.')
  }
  if (payload.byteLength === 0) {
    return clipboardWriteFailure('INVALID_PAYLOAD', 'Clipboard image is empty.')
  }
  if (payload.byteLength > MAX_IMAGE_BYTES) {
    return clipboardWriteFailure('PAYLOAD_TOO_LARGE', 'Clipboard images must be no larger than 16 MiB.')
  }
  const isPng = payload.byteLength >= 8 && [137, 80, 78, 71, 13, 10, 26, 10]
    .every((value, index) => payload[index] === value)
  const isJpeg = payload.byteLength >= 4 && payload[0] === 255 && payload[1] === 216
    && payload[payload.byteLength - 2] === 255 && payload[payload.byteLength - 1] === 217
  if ((mimeType === 'image/png' && !isPng) || (mimeType === 'image/jpeg' && !isJpeg)) {
    return clipboardWriteFailure('INVALID_PAYLOAD', 'Clipboard image bytes do not match their type.')
  }
  return { ok: true, mimeType, bytes: payload, byteLength: payload.byteLength }
}
