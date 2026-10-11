const USER_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const DEVICE_NAME_MAX_LENGTH = 64
const ENROLLMENT_LIFETIME_MS = 10 * 60 * 1000
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAXIMUM = 5

export type DevicePlatform = 'windows'

export type EnrollmentRecord = {
  id: string
  deviceCodeHash: string
  userCodeHash: string
  sourceIpHash: string
  deviceName: string
  platform: DevicePlatform
  createdAt: number
  expiresAt: number
  approvedAt: number | null
  consumedAt: number | null
  deviceId: string | null
  userId: string | null
}

export type DeviceRecord = {
  id: string
  userId: string
  name: string
  platform: DevicePlatform
  tokenHash: string
  createdAt: number
  lastSeenAt: number | null
  revokedAt: number | null
}

export interface DeviceRepository {
  countRecentEnrollments(sourceIpHash: string, since: number): Promise<number>
  createEnrollment(record: EnrollmentRecord): Promise<void>
  findEnrollmentByUserCode(userCodeHash: string): Promise<EnrollmentRecord | null>
  findEnrollmentByDeviceCode(deviceCodeHash: string): Promise<EnrollmentRecord | null>
  approveEnrollment(id: string, userId: string, approvedAt: number): Promise<boolean>
  consumeEnrollment(record: EnrollmentRecord, device: DeviceRecord, consumedAt: number): Promise<boolean>
  findDeviceByTokenHash(tokenHash: string): Promise<DeviceRecord | null>
  findOwnedDevice(userId: string, deviceId: string): Promise<DeviceRecord | null>
  listDevices(userId: string): Promise<DeviceRecord[]>
  revokeDevice(userId: string, deviceId: string, revokedAt: number): Promise<boolean>
  pruneEnrollments(before: number): Promise<void>
}

export type RandomBytes = (length: number) => Uint8Array

function secureRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function createUserCode(randomBytes: RandomBytes): string {
  const bytes = randomBytes(8)
  const characters = Array.from(
    bytes,
    (byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length],
  )
  return `${characters.slice(0, 4).join('')}-${characters.slice(4).join('')}`
}

async function hashSecret(
  purpose: string,
  serverSecret: string,
  value: string,
): Promise<string> {
  const input = new TextEncoder().encode(`${purpose}:${serverSecret}:${value}`)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return base64Url(new Uint8Array(digest))
}

export function normalizeUserCode(value: string): string | null {
  const compact = value.trim().toUpperCase().replaceAll('-', '')
  if (compact.length !== 8) return null
  if ([...compact].some((character) => !USER_CODE_ALPHABET.includes(character))) {
    return null
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`
}

export function normalizeDeviceName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length < 1 || normalized.length > DEVICE_NAME_MAX_LENGTH) {
    return null
  }
  return normalized
}

export class DeviceEnrollmentService {
  constructor(
    private readonly repository: DeviceRepository,
    private readonly serverSecret: string,
    private readonly now: () => number = Date.now,
    private readonly randomBytes: RandomBytes = secureRandomBytes,
  ) {}

  async start(input: {
    deviceName: unknown
    platform: unknown
    sourceIp: string
    verificationOrigin: string
  }) {
    const deviceName = normalizeDeviceName(input.deviceName)
    if (!deviceName || input.platform !== 'windows') {
      return { ok: false as const, error: 'INVALID_DEVICE' as const }
    }

    const timestamp = this.now()
    const sourceIpHash = await hashSecret('source-ip', this.serverSecret, input.sourceIp)
    await this.repository.pruneEnrollments(timestamp - 24 * 60 * 60 * 1000)
    const recentCount = await this.repository.countRecentEnrollments(
      sourceIpHash,
      timestamp - RATE_LIMIT_WINDOW_MS,
    )
    if (recentCount >= RATE_LIMIT_MAXIMUM) {
      return { ok: false as const, error: 'RATE_LIMITED' as const }
    }

    const userCode = createUserCode(this.randomBytes)
    const deviceCode = `cpy_enroll_${base64Url(this.randomBytes(32))}`
    const expiresAt = timestamp + ENROLLMENT_LIFETIME_MS
    const record: EnrollmentRecord = {
      id: crypto.randomUUID(),
      deviceCodeHash: await hashSecret('device-code', this.serverSecret, deviceCode),
      userCodeHash: await hashSecret('user-code', this.serverSecret, userCode),
      sourceIpHash,
      deviceName,
      platform: 'windows',
      createdAt: timestamp,
      expiresAt,
      approvedAt: null,
      consumedAt: null,
      deviceId: null,
      userId: null,
    }

    await this.repository.createEnrollment(record)

    return {
      ok: true as const,
      deviceCode,
      userCode,
      expiresAt,
      intervalSeconds: 3,
      verificationUriComplete: `${input.verificationOrigin}/app?enroll=${encodeURIComponent(userCode)}`,
    }
  }

  async inspect(userCodeValue: string) {
    const userCode = normalizeUserCode(userCodeValue)
    if (!userCode) return { ok: false as const, error: 'INVALID_CODE' as const }

    const record = await this.repository.findEnrollmentByUserCode(
      await hashSecret('user-code', this.serverSecret, userCode),
    )
    if (!record || record.expiresAt <= this.now() || record.consumedAt !== null) {
      return { ok: false as const, error: 'INVALID_CODE' as const }
    }

    return {
      ok: true as const,
      enrollment: {
        userCode,
        deviceName: record.deviceName,
        platform: record.platform,
        expiresAt: record.expiresAt,
        approved: record.approvedAt !== null,
      },
    }
  }

  async approve(userCodeValue: string, userId: string) {
    const userCode = normalizeUserCode(userCodeValue)
    if (!userCode) return { ok: false as const, error: 'INVALID_CODE' as const }

    const record = await this.repository.findEnrollmentByUserCode(
      await hashSecret('user-code', this.serverSecret, userCode),
    )
    const timestamp = this.now()
    if (!record || record.expiresAt <= timestamp || record.consumedAt !== null) {
      return { ok: false as const, error: 'INVALID_CODE' as const }
    }
    if (record.approvedAt !== null) {
      return { ok: false as const, error: 'ALREADY_APPROVED' as const }
    }

    const approved = await this.repository.approveEnrollment(record.id, userId, timestamp)
    if (!approved) return { ok: false as const, error: 'ALREADY_APPROVED' as const }

    return {
      ok: true as const,
      deviceName: record.deviceName,
    }
  }

  async exchange(deviceCode: unknown) {
    if (typeof deviceCode !== 'string' || !deviceCode.startsWith('cpy_enroll_')) {
      return { ok: false as const, error: 'INVALID_GRANT' as const }
    }

    const record = await this.repository.findEnrollmentByDeviceCode(
      await hashSecret('device-code', this.serverSecret, deviceCode),
    )
    const timestamp = this.now()
    if (!record || record.expiresAt <= timestamp || record.consumedAt !== null) {
      return { ok: false as const, error: 'INVALID_GRANT' as const }
    }
    if (!record.userId || record.approvedAt === null) {
      return { ok: false as const, error: 'AUTHORIZATION_PENDING' as const }
    }

    const token = `cpy_device_${base64Url(this.randomBytes(32))}`
    const device: DeviceRecord = {
      id: crypto.randomUUID(),
      userId: record.userId,
      name: record.deviceName,
      platform: record.platform,
      tokenHash: await hashSecret('device-token', this.serverSecret, token),
      createdAt: timestamp,
      lastSeenAt: null,
      revokedAt: null,
    }
    const consumed = await this.repository.consumeEnrollment(record, device, timestamp)
    if (!consumed) return { ok: false as const, error: 'INVALID_GRANT' as const }

    return {
      ok: true as const,
      token,
      device: {
        id: device.id,
        name: device.name,
        platform: device.platform,
        createdAt: device.createdAt,
      },
    }
  }

  async list(userId: string) {
    const devices = await this.repository.listDevices(userId)
    return devices.map(({ id, name, platform, createdAt, lastSeenAt }) => ({
      id,
      name,
      platform,
      createdAt,
      lastSeenAt,
    }))
  }

  async authenticateDevice(token: unknown) {
    if (typeof token !== 'string' || !token.startsWith('cpy_device_')) {
      return null
    }
    return this.repository.findDeviceByTokenHash(
      await hashSecret('device-token', this.serverSecret, token),
    )
  }

  findOwnedDevice(userId: string, deviceId: string) {
    return this.repository.findOwnedDevice(userId, deviceId)
  }

  revoke(userId: string, deviceId: string) {
    return this.repository.revokeDevice(userId, deviceId, this.now())
  }
}
