CREATE TABLE "deviceEnrollment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deviceCodeHash" TEXT NOT NULL UNIQUE,
  "userCodeHash" TEXT NOT NULL UNIQUE,
  "sourceIpHash" TEXT NOT NULL,
  "deviceName" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "approvedAt" INTEGER,
  "consumedAt" INTEGER,
  "deviceId" TEXT,
  "userId" TEXT,
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX "deviceEnrollment_sourceIp_createdAt_idx"
  ON "deviceEnrollment" ("sourceIpHash", "createdAt");

CREATE INDEX "deviceEnrollment_expiresAt_idx"
  ON "deviceEnrollment" ("expiresAt");

CREATE TABLE "device" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "createdAt" INTEGER NOT NULL,
  "lastSeenAt" INTEGER,
  "revokedAt" INTEGER,
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX "device_userId_revokedAt_idx"
  ON "device" ("userId", "revokedAt");
