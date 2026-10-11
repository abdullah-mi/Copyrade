import type {
  DeviceRecord,
  DeviceRepository,
  EnrollmentRecord,
} from './device-enrollment.js'

type EnrollmentRow = Omit<EnrollmentRecord, 'platform'> & { platform: 'windows' }
type DeviceRow = Omit<DeviceRecord, 'platform'> & { platform: 'windows' }

export class D1DeviceRepository implements DeviceRepository {
  constructor(private readonly database: D1Database) {}

  async countRecentEnrollments(sourceIpHash: string, since: number): Promise<number> {
    const row = await this.database
      .prepare(
        'SELECT COUNT(*) AS count FROM deviceEnrollment WHERE sourceIpHash = ? AND createdAt >= ?',
      )
      .bind(sourceIpHash, since)
      .first<{ count: number }>()
    return row?.count ?? 0
  }

  async createEnrollment(record: EnrollmentRecord): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO deviceEnrollment
          (id, deviceCodeHash, userCodeHash, sourceIpHash, deviceName, platform,
           createdAt, expiresAt, approvedAt, consumedAt, deviceId, userId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id,
        record.deviceCodeHash,
        record.userCodeHash,
        record.sourceIpHash,
        record.deviceName,
        record.platform,
        record.createdAt,
        record.expiresAt,
        record.approvedAt,
        record.consumedAt,
        record.deviceId,
        record.userId,
      )
      .run()
  }

  findEnrollmentByUserCode(userCodeHash: string): Promise<EnrollmentRecord | null> {
    return this.database
      .prepare('SELECT * FROM deviceEnrollment WHERE userCodeHash = ?')
      .bind(userCodeHash)
      .first<EnrollmentRow>()
  }

  findEnrollmentByDeviceCode(deviceCodeHash: string): Promise<EnrollmentRecord | null> {
    return this.database
      .prepare('SELECT * FROM deviceEnrollment WHERE deviceCodeHash = ?')
      .bind(deviceCodeHash)
      .first<EnrollmentRow>()
  }

  async approveEnrollment(
    id: string,
    userId: string,
    approvedAt: number,
  ): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE deviceEnrollment
         SET userId = ?, approvedAt = ?
         WHERE id = ? AND approvedAt IS NULL AND consumedAt IS NULL AND expiresAt > ?`,
      )
      .bind(userId, approvedAt, id, approvedAt)
      .run()
    return result.meta.changes === 1
  }

  async consumeEnrollment(
    record: EnrollmentRecord,
    device: DeviceRecord,
    consumedAt: number,
  ): Promise<boolean> {
    const [consumeResult, deviceResult] = await this.database.batch([
      this.database
        .prepare(
          `UPDATE deviceEnrollment
           SET consumedAt = ?, deviceId = ?
           WHERE id = ? AND userId = ? AND approvedAt IS NOT NULL
             AND consumedAt IS NULL AND expiresAt > ?`,
        )
        .bind(consumedAt, device.id, record.id, device.userId, consumedAt),
      this.database
        .prepare(
          `INSERT INTO device
            (id, userId, name, platform, tokenHash, createdAt, lastSeenAt, revokedAt)
           SELECT ?, userId, deviceName, platform, ?, ?, NULL, NULL
           FROM deviceEnrollment
           WHERE id = ? AND consumedAt = ? AND deviceId = ?`,
        )
        .bind(device.id, device.tokenHash, device.createdAt, record.id, consumedAt, device.id),
    ])
    return consumeResult.meta.changes === 1 && deviceResult.meta.changes === 1
  }

  findDeviceByTokenHash(tokenHash: string): Promise<DeviceRecord | null> {
    return this.database
      .prepare('SELECT * FROM device WHERE tokenHash = ? AND revokedAt IS NULL')
      .bind(tokenHash)
      .first<DeviceRow>()
  }

  async listDevices(userId: string): Promise<DeviceRecord[]> {
    const result = await this.database
      .prepare(
        `SELECT * FROM device
         WHERE userId = ? AND revokedAt IS NULL
         ORDER BY createdAt DESC`,
      )
      .bind(userId)
      .all<DeviceRow>()
    return result.results
  }

  async revokeDevice(
    userId: string,
    deviceId: string,
    revokedAt: number,
  ): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE device SET revokedAt = ?
         WHERE id = ? AND userId = ? AND revokedAt IS NULL`,
      )
      .bind(revokedAt, deviceId, userId)
      .run()
    return result.meta.changes === 1
  }

  async pruneEnrollments(before: number): Promise<void> {
    await this.database
      .prepare('DELETE FROM deviceEnrollment WHERE expiresAt < ?')
      .bind(before)
      .run()
  }
}
