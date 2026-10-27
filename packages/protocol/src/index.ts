export const PROTOCOL_VERSION = 1 as const
export const TEXT_MIME_TYPE = 'text/plain' as const
export const MAX_TEXT_BYTES = 1024 * 1024
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024
export const IMAGE_CHUNK_BYTES = 48 * 1024
export const MAX_SERIALIZED_MESSAGE_BYTES = MAX_TEXT_BYTES + 4096
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg'] as const
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number]

const TRANSFER_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
const textEncoder = new TextEncoder()

export type ClipboardTransferMessage = {
  protocolVersion: typeof PROTOCOL_VERSION
  kind: 'CLIPBOARD_TRANSFER'
  transferId: string
  payload: {
    representations: [
      {
        mimeType: typeof TEXT_MIME_TYPE
        byteLength: number
        text: string
      },
    ]
  }
}

export type ClipboardAckMessage = {
  protocolVersion: typeof PROTOCOL_VERSION
  kind: 'CLIPBOARD_ACK'
  transferId: string
  byteLength: number
}

export type ImageTransferStartMessage = {
  protocolVersion: typeof PROTOCOL_VERSION
  kind: 'IMAGE_TRANSFER_START'
  transferId: string
  mimeType: ImageMimeType
  byteLength: number
  chunkCount: number
  sha256: string
}

export type ImageTransferChunkMessage = {
  protocolVersion: typeof PROTOCOL_VERSION
  kind: 'IMAGE_TRANSFER_CHUNK'
  transferId: string
  index: number
  data: string
}

export type ImageTransferEndMessage = {
  protocolVersion: typeof PROTOCOL_VERSION
  kind: 'IMAGE_TRANSFER_END'
  transferId: string
}

export type ProtocolErrorCode =
  | 'INVALID_MESSAGE'
  | 'PAYLOAD_TOO_LARGE'
  | 'CLIPBOARD_WRITE_FAILED'
  | 'TRANSFER_FAILED'

export type ErrorMessage = {
  protocolVersion: typeof PROTOCOL_VERSION
  kind: 'ERROR'
  transferId?: string
  code: ProtocolErrorCode
  message: string
}

export type ProtocolMessage =
  | ClipboardTransferMessage
  | ClipboardAckMessage
  | ImageTransferStartMessage
  | ImageTransferChunkMessage
  | ImageTransferEndMessage
  | ErrorMessage

export type ProtocolDecodeErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_MESSAGE'
  | 'MESSAGE_TOO_LARGE'

export type ProtocolDecodeResult =
  | { ok: true; message: ProtocolMessage }
  | {
      ok: false
      error: {
        code: ProtocolDecodeErrorCode
        message: string
      }
    }

function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key))
}

function isTransferId(value: unknown): value is string {
  return typeof value === 'string' && TRANSFER_ID_PATTERN.test(value)
}

function isValidByteLength(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_TEXT_BYTES
  )
}

function isValidImageByteLength(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_IMAGE_BYTES
}

function isImageMimeType(value: unknown): value is ImageMimeType {
  return typeof value === 'string' && IMAGE_MIME_TYPES.includes(value as ImageMimeType)
}

function parseImageTransferStart(value: Record<string, unknown>): ProtocolDecodeResult {
  if (
    !hasOnlyKeys(value, ['protocolVersion', 'kind', 'transferId', 'mimeType', 'byteLength', 'chunkCount', 'sha256']) ||
    !isTransferId(value.transferId) ||
    !isImageMimeType(value.mimeType) ||
    !isValidImageByteLength(value.byteLength) ||
    typeof value.chunkCount !== 'number' ||
    !Number.isSafeInteger(value.chunkCount) ||
    value.chunkCount !== Math.ceil(value.byteLength / IMAGE_CHUNK_BYTES) ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  ) {
    return decodeFailure('INVALID_MESSAGE', 'Invalid image transfer start.')
  }
  return { ok: true, message: value as ImageTransferStartMessage }
}

function parseImageTransferChunk(value: Record<string, unknown>): ProtocolDecodeResult {
  if (
    !hasOnlyKeys(value, ['protocolVersion', 'kind', 'transferId', 'index', 'data']) ||
    !isTransferId(value.transferId) ||
    typeof value.index !== 'number' ||
    !Number.isSafeInteger(value.index) ||
    value.index < 0 ||
    typeof value.data !== 'string' ||
    value.data.length === 0 ||
    value.data.length > Math.ceil(IMAGE_CHUNK_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)
  ) {
    return decodeFailure('INVALID_MESSAGE', 'Invalid image transfer chunk.')
  }
  return { ok: true, message: value as ImageTransferChunkMessage }
}

function parseImageTransferEnd(value: Record<string, unknown>): ProtocolDecodeResult {
  if (
    !hasOnlyKeys(value, ['protocolVersion', 'kind', 'transferId']) ||
    !isTransferId(value.transferId)
  ) {
    return decodeFailure('INVALID_MESSAGE', 'Invalid image transfer end.')
  }
  return { ok: true, message: value as ImageTransferEndMessage }
}

function decodeFailure(
  code: ProtocolDecodeErrorCode,
  message: string,
): ProtocolDecodeResult {
  return { ok: false, error: { code, message } }
}

function parseClipboardTransfer(
  value: Record<string, unknown>,
): ProtocolDecodeResult {
  if (
    !hasOnlyKeys(value, [
      'protocolVersion',
      'kind',
      'transferId',
      'payload',
    ]) ||
    !isTransferId(value.transferId) ||
    !isRecord(value.payload) ||
    !hasOnlyKeys(value.payload, ['representations']) ||
    !Array.isArray(value.payload.representations) ||
    value.payload.representations.length !== 1
  ) {
    return decodeFailure('INVALID_MESSAGE', 'Invalid clipboard transfer.')
  }

  const representation: unknown = value.payload.representations[0]
  if (
    !isRecord(representation) ||
    !hasOnlyKeys(representation, ['mimeType', 'byteLength', 'text']) ||
    representation.mimeType !== TEXT_MIME_TYPE ||
    !isValidByteLength(representation.byteLength) ||
    typeof representation.text !== 'string' ||
    utf8ByteLength(representation.text) !== representation.byteLength
  ) {
    return decodeFailure(
      'INVALID_MESSAGE',
      'Invalid text clipboard representation.',
    )
  }

  return {
    ok: true,
    message: value as ClipboardTransferMessage,
  }
}

function parseClipboardAck(value: Record<string, unknown>): ProtocolDecodeResult {
  if (
    !hasOnlyKeys(value, [
      'protocolVersion',
      'kind',
      'transferId',
      'byteLength',
    ]) ||
    !isTransferId(value.transferId) ||
    !isValidByteLength(value.byteLength)
  ) {
    return decodeFailure('INVALID_MESSAGE', 'Invalid clipboard acknowledgement.')
  }

  return { ok: true, message: value as ClipboardAckMessage }
}

function parseError(value: Record<string, unknown>): ProtocolDecodeResult {
  const validCodes: readonly ProtocolErrorCode[] = [
    'INVALID_MESSAGE',
    'PAYLOAD_TOO_LARGE',
    'CLIPBOARD_WRITE_FAILED',
    'TRANSFER_FAILED',
  ]

  if (
    !hasOnlyKeys(value, [
      'protocolVersion',
      'kind',
      'transferId',
      'code',
      'message',
    ]) ||
    (value.transferId !== undefined && !isTransferId(value.transferId)) ||
    typeof value.code !== 'string' ||
    !validCodes.includes(value.code as ProtocolErrorCode) ||
    typeof value.message !== 'string' ||
    value.message.length === 0 ||
    value.message.length > 256
  ) {
    return decodeFailure('INVALID_MESSAGE', 'Invalid protocol error message.')
  }

  return { ok: true, message: value as ErrorMessage }
}

export function parseProtocolMessage(value: unknown): ProtocolDecodeResult {
  if (
    !isRecord(value) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    typeof value.kind !== 'string'
  ) {
    return decodeFailure('INVALID_MESSAGE', 'Unsupported protocol message.')
  }

  switch (value.kind) {
    case 'CLIPBOARD_TRANSFER':
      return parseClipboardTransfer(value)
    case 'CLIPBOARD_ACK':
      return parseClipboardAck(value)
    case 'IMAGE_TRANSFER_START':
      return parseImageTransferStart(value)
    case 'IMAGE_TRANSFER_CHUNK':
      return parseImageTransferChunk(value)
    case 'IMAGE_TRANSFER_END':
      return parseImageTransferEnd(value)
    case 'ERROR':
      return parseError(value)
    default:
      return decodeFailure('INVALID_MESSAGE', 'Unsupported message kind.')
  }
}

export function createImageTransferStartMessage(
  transferId: string,
  mimeType: ImageMimeType,
  byteLength: number,
  sha256: string,
): ImageTransferStartMessage {
  const value = {
    protocolVersion: PROTOCOL_VERSION,
    kind: 'IMAGE_TRANSFER_START',
    transferId,
    mimeType,
    byteLength,
    chunkCount: Math.ceil(byteLength / IMAGE_CHUNK_BYTES),
    sha256,
  } as const
  const parsed = parseProtocolMessage(value)
  if (!parsed.ok || parsed.message.kind !== 'IMAGE_TRANSFER_START') {
    throw new RangeError('Image transfer metadata is invalid.')
  }
  return parsed.message
}

export function decodeProtocolMessage(serialized: unknown): ProtocolDecodeResult {
  if (typeof serialized !== 'string') {
    return decodeFailure('INVALID_MESSAGE', 'Protocol data must be text.')
  }

  if (utf8ByteLength(serialized) > MAX_SERIALIZED_MESSAGE_BYTES) {
    return decodeFailure('MESSAGE_TOO_LARGE', 'Protocol message is too large.')
  }

  try {
    return parseProtocolMessage(JSON.parse(serialized) as unknown)
  } catch {
    return decodeFailure('INVALID_JSON', 'Protocol message is not valid JSON.')
  }
}

export function encodeProtocolMessage(message: ProtocolMessage): string {
  return JSON.stringify(message)
}

export function createTextTransferMessage(
  transferId: string,
  text: string,
): ClipboardTransferMessage {
  if (!isTransferId(transferId)) {
    throw new TypeError('Transfer ID must contain 16 to 128 safe characters.')
  }

  const byteLength = utf8ByteLength(text)
  if (byteLength === 0 || byteLength > MAX_TEXT_BYTES) {
    throw new RangeError('Clipboard text must contain 1 byte to 1 MiB.')
  }

  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: 'CLIPBOARD_TRANSFER',
    transferId,
    payload: {
      representations: [{ mimeType: TEXT_MIME_TYPE, byteLength, text }],
    },
  }
}
