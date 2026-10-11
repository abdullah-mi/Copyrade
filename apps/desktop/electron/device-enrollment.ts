import { app, safeStorage, shell } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

const DEFAULT_CONTROL_ORIGIN = 'https://copyrade-staging.abdullahijaz-m.workers.dev'
const CREDENTIAL_FILE = 'device-credential.enc'

type PendingEnrollment = {
  deviceCode: string
  userCode: string
  expiresAt: number
  intervalSeconds: number
}

type StoredCredential = {
  version: 1
  controlOrigin: string
  token: string
  device: {
    id: string
    name: string
    platform: 'windows'
    createdAt: number
  }
}

export type DeviceEnrollmentResult =
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
      device: StoredCredential['device']
    }
  | {
      ok: false
      error: string
    }

export type DeviceEnrollmentStatus =
  | {
      enrolled: false
      suggestedName: string
      message?: string
    }
  | {
      enrolled: true
      suggestedName: string
      device: StoredCredential['device']
      warning?: string
    }
  | {
      enrolled: false
      suggestedName: string
      error: string
    }

function normalizeControlOrigin(value: string): string {
  const url = new URL(value)
  const isLoopback =
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  if (url.pathname !== '/' || (url.protocol !== 'https:' && !isLoopback)) {
    throw new Error('The Copyrade control URL must be HTTPS or a loopback development URL.')
  }
  return url.origin
}

function normalizeDeviceName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.length >= 1 && normalized.length <= 64 ? normalized : null
}

function isStoredCredential(value: unknown): value is StoredCredential {
  if (!value || typeof value !== 'object') return false
  const credential = value as Partial<StoredCredential>
  return (
    credential.version === 1 &&
    typeof credential.controlOrigin === 'string' &&
    typeof credential.token === 'string' &&
    credential.token.startsWith('cpy_device_') &&
    !!credential.device &&
    typeof credential.device.id === 'string' &&
    typeof credential.device.name === 'string' &&
    credential.device.platform === 'windows' &&
    typeof credential.device.createdAt === 'number'
  )
}

async function readResponseBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('The control service returned an invalid response.')
  }
  return body as Record<string, unknown>
}

export class DeviceEnrollmentManager {
  private readonly controlOrigin: string
  private pending: PendingEnrollment | null = null

  constructor() {
    this.controlOrigin = normalizeControlOrigin(
      process.env.COPYRADE_CONTROL_URL ?? DEFAULT_CONTROL_ORIGIN,
    )
  }

  private credentialPath(): string {
    return join(app.getPath('userData'), CREDENTIAL_FILE)
  }

  private async saveCredential(credential: StoredCredential): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Windows credential protection is not available.')
    }

    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(credential))
    const path = this.credentialPath()
    const temporaryPath = `${path}.tmp`
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(temporaryPath, encrypted.toString('base64'), {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rm(path, { force: true })
    await rename(temporaryPath, path)
  }

  private async loadCredential(): Promise<StoredCredential | null> {
    let encoded: string
    try {
      encoded = await readFile(this.credentialPath(), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }

    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Windows credential protection is not available.')
    }
    const decrypted = await safeStorage.decryptStringAsync(
      Buffer.from(encoded, 'base64'),
    )
    const value: unknown = JSON.parse(decrypted.result)
    if (!isStoredCredential(value)) {
      throw new Error('The saved device credential is invalid.')
    }
    if (decrypted.shouldReEncrypt) await this.saveCredential(value)
    return value
  }

  async status(): Promise<DeviceEnrollmentStatus> {
    const suggestedName = hostname().slice(0, 64) || 'Windows PC'
    try {
      const credential = await this.loadCredential()
      if (!credential) return { enrolled: false, suggestedName }

      try {
        const response = await fetch(`${credential.controlOrigin}/api/device-session`, {
          headers: { authorization: `Bearer ${credential.token}` },
        })
        if (response.status === 401) {
          await rm(this.credentialPath(), { force: true })
          this.pending = null
          return {
            enrolled: false,
            suggestedName,
            message: 'This device was removed from the Copyrade account.',
          }
        }
        if (!response.ok) throw new Error('Credential validation failed')
        return { enrolled: true, suggestedName, device: credential.device }
      } catch {
        return {
          enrolled: true,
          suggestedName,
          device: credential.device,
          warning: 'Copyrade could not verify this registration right now.',
        }
      }
    } catch {
      return {
        enrolled: false,
        suggestedName,
        error: 'The saved device credential could not be read.',
      }
    }
  }

  async start(deviceNameValue: unknown): Promise<DeviceEnrollmentResult> {
    const deviceName = normalizeDeviceName(deviceNameValue)
    if (!deviceName) {
      return { ok: false, error: 'Enter a device name between 1 and 64 characters.' }
    }

    try {
      const response = await fetch(`${this.controlOrigin}/api/device-enrollments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceName, platform: 'windows' }),
      })
      const body = await readResponseBody(response)
      if (!response.ok) {
        return {
          ok: false,
          error:
            body.error === 'RATE_LIMITED'
              ? 'Too many enrollment attempts. Wait ten minutes and try again.'
              : 'Device enrollment could not be started.',
        }
      }

      if (
        typeof body.deviceCode !== 'string' ||
        typeof body.userCode !== 'string' ||
        typeof body.expiresAt !== 'number' ||
        typeof body.intervalSeconds !== 'number' ||
        typeof body.verificationUriComplete !== 'string'
      ) {
        throw new Error('Invalid enrollment response')
      }

      const verificationUrl = new URL(body.verificationUriComplete)
      if (verificationUrl.origin !== this.controlOrigin || verificationUrl.pathname !== '/app') {
        throw new Error('Invalid verification URL')
      }

      this.pending = {
        deviceCode: body.deviceCode,
        userCode: body.userCode,
        expiresAt: body.expiresAt,
        intervalSeconds: body.intervalSeconds,
      }
      await shell.openExternal(verificationUrl.toString())

      return {
        ok: true,
        state: 'authorization_pending',
        userCode: this.pending.userCode,
        expiresAt: this.pending.expiresAt,
        intervalSeconds: this.pending.intervalSeconds,
      }
    } catch {
      this.pending = null
      return { ok: false, error: 'The enrollment service could not be reached.' }
    }
  }

  async poll(): Promise<DeviceEnrollmentResult> {
    if (!this.pending) return { ok: false, error: 'No enrollment is in progress.' }
    if (this.pending.expiresAt <= Date.now()) {
      this.pending = null
      return { ok: false, error: 'The enrollment code expired. Start again.' }
    }

    try {
      const response = await fetch(`${this.controlOrigin}/api/device-enrollments/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceCode: this.pending.deviceCode }),
      })
      const body = await readResponseBody(response)
      if (response.status === 202 && body.error === 'AUTHORIZATION_PENDING') {
        return {
          ok: true,
          state: 'authorization_pending',
          userCode: this.pending.userCode,
          expiresAt: this.pending.expiresAt,
          intervalSeconds: this.pending.intervalSeconds,
        }
      }
      if (!response.ok || typeof body.token !== 'string' || !body.device) {
        this.pending = null
        return { ok: false, error: 'Device enrollment was not completed.' }
      }

      const credential: StoredCredential = {
        version: 1,
        controlOrigin: this.controlOrigin,
        token: body.token,
        device: body.device as StoredCredential['device'],
      }
      if (!isStoredCredential(credential)) throw new Error('Invalid credential')
      await this.saveCredential(credential)
      this.pending = null
      return { ok: true, state: 'enrolled', device: credential.device }
    } catch {
      return { ok: false, error: 'The enrollment service could not be reached.' }
    }
  }
}
