type ClipboardWriteResult =
  | { ok: true; byteLength: number }
  | {
      ok: false
      error: {
        code:
          | 'EMPTY_TEXT'
          | 'INVALID_PAYLOAD'
          | 'PAYLOAD_TOO_LARGE'
          | 'UNTRUSTED_SENDER'
          | 'WRITE_FAILED'
        message: string
      }
    }

interface CopyradeDesktopApi {
  clipboard: {
    writeText(text: string): Promise<ClipboardWriteResult>
  }
}

declare global {
  interface Window {
    copyrade: CopyradeDesktopApi
  }
}

export {}
