import {
  IMAGE_CHUNK_BYTES,
  MAX_IMAGE_BYTES,
  PROTOCOL_VERSION,
  createImageTransferStartMessage,
  createTextTransferMessage,
  decodeProtocolMessage,
  encodeProtocolMessage,
  type ErrorMessage,
  type ImageMimeType,
  type ProtocolErrorCode,
  type ProtocolMessage,
} from '@copyrade/protocol'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function encodeBase64(bytes: Uint8Array): string {
  let result = ''
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]!
    const second = bytes[offset + 1]
    const third = bytes[offset + 2]
    result += BASE64_ALPHABET[first >> 2]
    result += BASE64_ALPHABET[((first & 3) << 4) | ((second ?? 0) >> 4)]
    result += second === undefined ? '=' : BASE64_ALPHABET[((second & 15) << 2) | ((third ?? 0) >> 6)]
    result += third === undefined ? '=' : BASE64_ALPHABET[third & 63]
  }
  return result
}

function decodeBase64(value: string): Uint8Array | null {
  if (value.length % 4 !== 0) return null
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const result = new Uint8Array((value.length / 4) * 3 - padding)
  let output = 0
  for (let offset = 0; offset < value.length; offset += 4) {
    const values = [...value.slice(offset, offset + 4)].map((character) =>
      character === '=' ? 0 : BASE64_ALPHABET.indexOf(character),
    )
    if (values.some((item) => item < 0)) return null
    const combined = (values[0]! << 18) | (values[1]! << 12) | (values[2]! << 6) | values[3]!
    if (output < result.length) result[output++] = combined >> 16
    if (output < result.length) result[output++] = (combined >> 8) & 255
    if (output < result.length) result[output++] = combined & 255
  }
  return result
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export type TransferFailureReason =
  | 'acknowledgement_size_mismatch'
  | 'connection_closed'
  | 'invalid_response'
  | 'remote_error'
  | 'timeout'

export type OutgoingTransferResult =
  | {
      ok: true
      transferId: string
      byteLength: number
    }
  | {
      ok: false
      transferId: string
      reason: TransferFailureReason
      remoteMessage?: string
    }

export type TransferClock = {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

type PendingTransfer = {
  transferId: string
  byteLength: number
  timeout: unknown
}

const defaultClock: TransferClock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class TextTransferSender {
  private pending: PendingTransfer | null = null

  constructor(
    private readonly send: (message: string) => void,
    private readonly onResult: (result: OutgoingTransferResult) => void,
    private readonly options: {
      createId?: () => string
      timeoutMs?: number
      clock?: TransferClock
    } = {},
  ) {}

  sendText(text: string): { transferId: string; byteLength: number } {
    if (this.pending) throw new Error('A clipboard transfer is already in progress.')

    const transfer = createTextTransferMessage(
      this.options.createId?.() ?? crypto.randomUUID(),
      text,
    )
    const byteLength = transfer.payload.representations[0].byteLength
    const clock = this.options.clock ?? defaultClock
    const pending: PendingTransfer = {
      transferId: transfer.transferId,
      byteLength,
      timeout: clock.setTimeout(
        () => this.failIfPending(transfer.transferId, 'timeout'),
        this.options.timeoutMs ?? 10_000,
      ),
    }
    this.pending = pending

    try {
      this.send(encodeProtocolMessage(transfer))
    } catch (error) {
      clock.clearTimeout(pending.timeout)
      this.pending = null
      throw error
    }

    return { transferId: transfer.transferId, byteLength }
  }

  handleMessage(raw: unknown): boolean {
    const pending = this.pending
    if (!pending) return false

    const decoded = decodeProtocolMessage(raw)
    if (!decoded.ok) {
      this.finish({
        ok: false,
        transferId: pending.transferId,
        reason: 'invalid_response',
      })
      return true
    }

    const message = decoded.message
    if (message.kind === 'CLIPBOARD_ACK') {
      if (message.transferId !== pending.transferId) return false
      if (message.byteLength !== pending.byteLength) {
        this.finish({
          ok: false,
          transferId: pending.transferId,
          reason: 'acknowledgement_size_mismatch',
        })
      } else {
        this.finish({
          ok: true,
          transferId: pending.transferId,
          byteLength: message.byteLength,
        })
      }
      return true
    }

    if (
      message.kind === 'ERROR' &&
      (message.transferId === undefined || message.transferId === pending.transferId)
    ) {
      this.finish({
        ok: false,
        transferId: pending.transferId,
        reason: 'remote_error',
        remoteMessage: message.message,
      })
      return true
    }

    return false
  }

  connectionClosed(): void {
    this.failIfPending(this.pending?.transferId, 'connection_closed')
  }

  dispose(): void {
    const pending = this.pending
    if (!pending) return
    ;(this.options.clock ?? defaultClock).clearTimeout(pending.timeout)
    this.pending = null
  }

  private failIfPending(
    transferId: string | undefined,
    reason: TransferFailureReason,
  ): void {
    if (!this.pending || this.pending.transferId !== transferId) return
    this.finish({ ok: false, transferId: this.pending.transferId, reason })
  }

  private finish(result: OutgoingTransferResult): void {
    const pending = this.pending
    if (!pending) return
    ;(this.options.clock ?? defaultClock).clearTimeout(pending.timeout)
    this.pending = null
    this.onResult(result)
  }
}

export class ImageTransferSender {
  private pending: PendingTransfer | null = null

  constructor(
    private readonly send: (message: string) => Promise<void>,
    private readonly onResult: (result: OutgoingTransferResult) => void,
    private readonly options: {
      createId?: () => string
      timeoutMs?: number
      clock?: TransferClock
    } = {},
  ) {}

  async sendImage(mimeType: ImageMimeType, bytes: Uint8Array): Promise<{ transferId: string; byteLength: number }> {
    if (this.pending) throw new Error('An image transfer is already in progress.')
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new RangeError('Clipboard images must contain 1 byte to 16 MiB.')
    }
    const transferId = this.options.createId?.() ?? crypto.randomUUID()
    const start = createImageTransferStartMessage(
      transferId,
      mimeType,
      bytes.byteLength,
      await sha256(bytes),
    )
    const clock = this.options.clock ?? defaultClock
    const pending: PendingTransfer = {
      transferId,
      byteLength: bytes.byteLength,
      timeout: clock.setTimeout(
        () => this.failIfPending(transferId, 'timeout'),
        this.options.timeoutMs ?? 30_000,
      ),
    }
    this.pending = pending

    try {
      await this.send(encodeProtocolMessage(start))
      for (let index = 0; index < start.chunkCount; index += 1) {
        const chunk = bytes.subarray(index * IMAGE_CHUNK_BYTES, (index + 1) * IMAGE_CHUNK_BYTES)
        await this.send(encodeProtocolMessage({
          protocolVersion: PROTOCOL_VERSION,
          kind: 'IMAGE_TRANSFER_CHUNK',
          transferId,
          index,
          data: encodeBase64(chunk),
        }))
      }
      await this.send(encodeProtocolMessage({
        protocolVersion: PROTOCOL_VERSION,
        kind: 'IMAGE_TRANSFER_END',
        transferId,
      }))
      return { transferId, byteLength: bytes.byteLength }
    } catch (error) {
      clock.clearTimeout(pending.timeout)
      this.pending = null
      throw error
    }
  }

  handleMessage(raw: unknown): boolean {
    const pending = this.pending
    if (!pending) return false
    const decoded = decodeProtocolMessage(raw)
    if (!decoded.ok) {
      this.finish({ ok: false, transferId: pending.transferId, reason: 'invalid_response' })
      return true
    }
    const message = decoded.message
    if (message.kind === 'CLIPBOARD_ACK' && message.transferId === pending.transferId) {
      this.finish(message.byteLength === pending.byteLength
        ? { ok: true, transferId: pending.transferId, byteLength: message.byteLength }
        : { ok: false, transferId: pending.transferId, reason: 'acknowledgement_size_mismatch' })
      return true
    }
    if (message.kind === 'ERROR' && (message.transferId === undefined || message.transferId === pending.transferId)) {
      this.finish({
        ok: false,
        transferId: pending.transferId,
        reason: 'remote_error',
        remoteMessage: message.message,
      })
      return true
    }
    return false
  }

  connectionClosed(): void {
    this.failIfPending(this.pending?.transferId, 'connection_closed')
  }

  dispose(): void {
    if (!this.pending) return
    ;(this.options.clock ?? defaultClock).clearTimeout(this.pending.timeout)
    this.pending = null
  }

  private failIfPending(transferId: string | undefined, reason: TransferFailureReason): void {
    if (!this.pending || this.pending.transferId !== transferId) return
    this.finish({ ok: false, transferId: this.pending.transferId, reason })
  }

  private finish(result: OutgoingTransferResult): void {
    if (!this.pending) return
    ;(this.options.clock ?? defaultClock).clearTimeout(this.pending.timeout)
    this.pending = null
    this.onResult(result)
  }
}

export type ClipboardWriteResult =
  | { ok: true; byteLength: number }
  | { ok: false; error: { code: string; message: string } }

export type IncomingTransferResult =
  | { ok: true; transferId: string; byteLength: number }
  | {
      ok: false
      reason: 'invalid_message' | 'clipboard_write_failed' | 'response_failed'
      message: string
    }

type IncomingTransferHandlers = {
  writeText(text: string): Promise<ClipboardWriteResult>
  send(message: string): void
  onWriteStart?(): void
}

function sendMessage(
  message: ProtocolMessage,
  send: (serialized: string) => void,
): boolean {
  try {
    send(encodeProtocolMessage(message))
    return true
  } catch {
    return false
  }
}

function sendError(
  handlers: { send(message: string): void },
  code: ProtocolErrorCode,
  message: string,
  transferId?: string,
): boolean {
  const error: ErrorMessage = {
    protocolVersion: 1,
    kind: 'ERROR',
    transferId,
    code,
    message,
  }
  return sendMessage(error, handlers.send)
}

export async function handleIncomingTextTransfer(
  raw: unknown,
  handlers: IncomingTransferHandlers,
): Promise<IncomingTransferResult> {
  const decoded = decodeProtocolMessage(raw)
  if (!decoded.ok || decoded.message.kind !== 'CLIPBOARD_TRANSFER') {
    const message = 'Windows rejected an invalid transfer message.'
    sendError(handlers, 'INVALID_MESSAGE', message)
    return { ok: false, reason: 'invalid_message', message }
  }

  const transfer = decoded.message
  const representation = transfer.payload.representations[0]
  handlers.onWriteStart?.()

  let result: ClipboardWriteResult
  try {
    result = await handlers.writeText(representation.text)
  } catch {
    const message = 'Windows could not update its clipboard.'
    sendError(handlers, 'CLIPBOARD_WRITE_FAILED', message, transfer.transferId)
    return { ok: false, reason: 'clipboard_write_failed', message }
  }

  if (!result.ok) {
    const code: ProtocolErrorCode = result.error.code === 'PAYLOAD_TOO_LARGE'
      ? 'PAYLOAD_TOO_LARGE'
      : 'CLIPBOARD_WRITE_FAILED'
    sendError(
      handlers,
      code,
      'Windows could not update its clipboard.',
      transfer.transferId,
    )
    return {
      ok: false,
      reason: 'clipboard_write_failed',
      message: result.error.message,
    }
  }

  if (result.byteLength !== representation.byteLength) {
    const message = 'Windows reported an unexpected clipboard size.'
    sendError(handlers, 'CLIPBOARD_WRITE_FAILED', message, transfer.transferId)
    return { ok: false, reason: 'clipboard_write_failed', message }
  }

  const sent = sendMessage(
    {
      protocolVersion: 1,
      kind: 'CLIPBOARD_ACK',
      transferId: transfer.transferId,
      byteLength: result.byteLength,
    },
    handlers.send,
  )
  if (!sent) {
    return {
      ok: false,
      reason: 'response_failed',
      message: 'Windows updated the clipboard, but confirmation could not be sent.',
    }
  }

  return {
    ok: true,
    transferId: transfer.transferId,
    byteLength: result.byteLength,
  }
}

type IncomingImageHandlers = {
  writeImage(mimeType: ImageMimeType, bytes: Uint8Array): Promise<ClipboardWriteResult>
  send(message: string): void
  onWriteStart?(): void
  onWriteComplete?(): void
}

type IncomingImage = {
  transferId: string
  mimeType: ImageMimeType
  byteLength: number
  chunkCount: number
  sha256: string
  chunks: Uint8Array[]
  receivedBytes: number
  timeout: unknown
}

export class ImageTransferReceiver {
  private incoming: IncomingImage | null = null

  constructor(
    private readonly handlers: IncomingImageHandlers,
    private readonly options: { timeoutMs?: number; clock?: TransferClock } = {},
  ) {}

  async handleMessage(raw: unknown): Promise<boolean> {
    const decoded = decodeProtocolMessage(raw)
    if (!decoded.ok) return false
    const message = decoded.message

    if (message.kind === 'IMAGE_TRANSFER_START') {
      this.clear()
      const clock = this.options.clock ?? defaultClock
      this.incoming = {
        transferId: message.transferId,
        mimeType: message.mimeType,
        byteLength: message.byteLength,
        chunkCount: message.chunkCount,
        sha256: message.sha256,
        chunks: [],
        receivedBytes: 0,
        timeout: clock.setTimeout(() => {
          if (this.incoming?.transferId === message.transferId) this.clear()
        }, this.options.timeoutMs ?? 30_000),
      }
      return true
    }

    const incoming = this.incoming
    if (!incoming || message.transferId !== incoming.transferId) return false

    if (message.kind === 'IMAGE_TRANSFER_CHUNK') {
      const bytes = decodeBase64(message.data)
      const expectedLength = Math.min(
        IMAGE_CHUNK_BYTES,
        incoming.byteLength - message.index * IMAGE_CHUNK_BYTES,
      )
      if (
        !bytes ||
        message.index !== incoming.chunks.length ||
        message.index >= incoming.chunkCount ||
        bytes.byteLength !== expectedLength ||
        incoming.receivedBytes + bytes.byteLength > incoming.byteLength
      ) {
        this.reject('Windows rejected an invalid image transfer.', incoming.transferId)
        return true
      }
      incoming.chunks.push(bytes)
      incoming.receivedBytes += bytes.byteLength
      return true
    }

    if (message.kind !== 'IMAGE_TRANSFER_END') return false
    if (incoming.chunks.length !== incoming.chunkCount || incoming.receivedBytes !== incoming.byteLength) {
      this.reject('The image transfer was incomplete.', incoming.transferId)
      return true
    }

    const bytes = new Uint8Array(incoming.byteLength)
    let offset = 0
    for (const chunk of incoming.chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const digest = await sha256(bytes)
    if (digest !== incoming.sha256) {
      this.reject('The image failed its integrity check.', incoming.transferId)
      return true
    }

    this.handlers.onWriteStart?.()
    const result = await this.handlers.writeImage(incoming.mimeType, bytes).catch(() => null)
    if (!result?.ok || result.byteLength !== incoming.byteLength) {
      this.reject('Windows could not update its clipboard.', incoming.transferId, 'CLIPBOARD_WRITE_FAILED')
      return true
    }
    const transferId = incoming.transferId
    const byteLength = incoming.byteLength
    this.clear()
    sendMessage({ protocolVersion: PROTOCOL_VERSION, kind: 'CLIPBOARD_ACK', transferId, byteLength }, this.handlers.send)
    this.handlers.onWriteComplete?.()
    return true
  }

  connectionClosed(): void {
    this.clear()
  }

  dispose(): void {
    this.clear()
  }

  private reject(message: string, transferId: string, code: ProtocolErrorCode = 'TRANSFER_FAILED'): void {
    this.clear()
    sendError(this.handlers, code, message, transferId)
  }

  private clear(): void {
    if (this.incoming) (this.options.clock ?? defaultClock).clearTimeout(this.incoming.timeout)
    this.incoming = null
  }
}
