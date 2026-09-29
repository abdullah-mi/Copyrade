import {
  createTextTransferMessage,
  decodeProtocolMessage,
  encodeProtocolMessage,
  type ErrorMessage,
  type ProtocolErrorCode,
  type ProtocolMessage,
} from '@copyrade/protocol'

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
  handlers: IncomingTransferHandlers,
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
