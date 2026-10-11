import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DeviceEnrollmentService,
  normalizeDeviceName,
  normalizeUserCode,
} from './device-enrollment.js'
import type {
  DeviceRecord,
  DeviceRepository,
  EnrollmentRecord,
} from './device-enrollment.js'

class MemoryDeviceRepository implements DeviceRepository {
  enrollments: EnrollmentRecord[] = []
  devices: DeviceRecord[] = []

  async countRecentEnrollments(sourceIpHash: string, since: number) {
    return this.enrollments.filter(
      (record) => record.sourceIpHash === sourceIpHash && record.createdAt >= since,
    ).length
  }

  async createEnrollment(record: EnrollmentRecord) {
    this.enrollments.push(record)
  }

  async findEnrollmentByUserCode(userCodeHash: string) {
    return this.enrollments.find((record) => record.userCodeHash === userCodeHash) ?? null
  }

  async findEnrollmentByDeviceCode(deviceCodeHash: string) {
    return this.enrollments.find((record) => record.deviceCodeHash === deviceCodeHash) ?? null
  }

  async approveEnrollment(id: string, userId: string, approvedAt: number) {
    const record = this.enrollments.find(
      (candidate) => candidate.id === id && candidate.approvedAt === null,
    )
    if (!record) return false
    record.userId = userId
    record.approvedAt = approvedAt
    return true
  }

  async consumeEnrollment(
    record: EnrollmentRecord,
    device: DeviceRecord,
    consumedAt: number,
  ) {
    if (record.consumedAt !== null) return false
    record.consumedAt = consumedAt
    record.deviceId = device.id
    this.devices.push(device)
    return true
  }

  async listDevices(userId: string) {
    return this.devices.filter(
      (device) => device.userId === userId && device.revokedAt === null,
    )
  }

  async findDeviceByTokenHash(tokenHash: string) {
    return this.devices.find(
      (device) => device.tokenHash === tokenHash && device.revokedAt === null,
    ) ?? null
  }

  async revokeDevice(userId: string, deviceId: string, revokedAt: number) {
    const device = this.devices.find(
      (candidate) =>
        candidate.userId === userId &&
        candidate.id === deviceId &&
        candidate.revokedAt === null,
    )
    if (!device) return false
    device.revokedAt = revokedAt
    return true
  }

  async pruneEnrollments(before: number) {
    this.enrollments = this.enrollments.filter((record) => record.expiresAt >= before)
  }
}

function deterministicBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => index)
}

describe('device enrollment', () => {
  it('normalizes device names and human-entered codes', () => {
    assert.equal(normalizeDeviceName('  Home   PC  '), 'Home PC')
    assert.equal(normalizeDeviceName(''), null)
    assert.equal(normalizeUserCode('2345-6789'), '2345-6789')
    assert.equal(normalizeUserCode('23456789'), '2345-6789')
    assert.equal(normalizeUserCode('OOOO-OOOO'), null)
  })

  it('requires browser approval before issuing a one-time device token', async () => {
    const repository = new MemoryDeviceRepository()
    const service = new DeviceEnrollmentService(
      repository,
      'a-test-secret-that-is-longer-than-thirty-two-characters',
      () => 1_000_000,
      deterministicBytes,
    )

    const started = await service.start({
      deviceName: 'Home PC',
      platform: 'windows',
      sourceIp: '192.0.2.1',
      verificationOrigin: 'https://copyrade.example',
    })
    assert.equal(started.ok, true)
    if (!started.ok) return

    assert.equal((await service.exchange(started.deviceCode)).error, 'AUTHORIZATION_PENDING')
    assert.equal((await service.approve(started.userCode, 'user-1')).ok, true)

    const exchanged = await service.exchange(started.deviceCode)
    assert.equal(exchanged.ok, true)
    if (!exchanged.ok) return
    assert.match(exchanged.token, /^cpy_device_/)
    assert.equal(exchanged.device.name, 'Home PC')
    assert.equal(
      (await service.authenticateDevice(exchanged.token))?.id,
      exchanged.device.id,
    )
    assert.equal((await service.exchange(started.deviceCode)).error, 'INVALID_GRANT')

    const devices = await service.list('user-1')
    assert.equal(devices.length, 1)
    assert.equal(await service.revoke('user-1', devices[0].id), true)
    assert.deepEqual(await service.list('user-1'), [])
    assert.equal(await service.authenticateDevice(exchanged.token), null)
  })

  it('expires enrollment codes and rate-limits repeated starts by source', async () => {
    const repository = new MemoryDeviceRepository()
    let timestamp = 1_000_000
    const service = new DeviceEnrollmentService(
      repository,
      'a-test-secret-that-is-longer-than-thirty-two-characters',
      () => timestamp,
      deterministicBytes,
    )

    let firstCode = ''
    for (let index = 0; index < 5; index += 1) {
      const result = await service.start({
        deviceName: `PC ${index}`,
        platform: 'windows',
        sourceIp: '192.0.2.1',
        verificationOrigin: 'https://copyrade.example',
      })
      assert.equal(result.ok, true)
      if (result.ok && index === 0) firstCode = result.userCode
    }

    const limited = await service.start({
      deviceName: 'One too many',
      platform: 'windows',
      sourceIp: '192.0.2.1',
      verificationOrigin: 'https://copyrade.example',
    })
    assert.deepEqual(limited, { ok: false, error: 'RATE_LIMITED' })

    timestamp += 10 * 60 * 1000 + 1
    assert.equal((await service.inspect(firstCode)).error, 'INVALID_CODE')
  })
})
