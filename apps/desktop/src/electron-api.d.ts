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
  device: {
    getStatus(): Promise<DeviceEnrollmentStatus>
    startEnrollment(deviceName: string): Promise<DeviceEnrollmentResult>
    pollEnrollment(): Promise<DeviceEnrollmentResult>
    getSignalingTicket(): Promise<SignalingTicketResult>
  }
}

type EnrolledDevice = {
  id: string
  name: string
  platform: 'windows'
  createdAt: number
}

type DeviceEnrollmentResult =
  | {
      ok: true
      state: 'authorization_pending'
      userCode: string
      expiresAt: number
      intervalSeconds: number
    }
  | {
      ok: true
      state: 'enrolled'
      device: EnrolledDevice
    }
  | { ok: false; error: string }

type DeviceEnrollmentStatus =
  | { enrolled: false; suggestedName: string; message?: string; error?: string }
  | {
      enrolled: true
      suggestedName: string
      device: EnrolledDevice
      warning?: string
    }

type SignalingTicketResult =
  | { ok: true; ticket: string; signalingUrl: string; expiresAt: number }
  | { ok: false; error: string }

declare global {
  interface Window {
    copyrade: CopyradeDesktopApi
  }
}

export {}
