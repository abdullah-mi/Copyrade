export type SignalingRole = 'desktop' | 'mobile' | 'presence' | 'observer'

export type SignalingTicketClaims = {
  accountId: string
  role: SignalingRole
  deviceId: string | null
  issuedAt: number
  expiresAt: number
  nonce: string
}

const TICKET_PREFIX = 'cpy.signal.'
const TICKET_LIFETIME_MS = 60_000

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function isClaims(value: unknown): value is SignalingTicketClaims {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const claims = value as Partial<SignalingTicketClaims>
  return (
    typeof claims.accountId === 'string' &&
    claims.accountId.length > 0 &&
    ['desktop', 'mobile', 'presence', 'observer'].includes(claims.role ?? '') &&
    (claims.role === 'observer'
      ? claims.deviceId === null
      : typeof claims.deviceId === 'string' && /^[0-9a-f-]{36}$/i.test(claims.deviceId)) &&
    typeof claims.issuedAt === 'number' &&
    typeof claims.expiresAt === 'number' &&
    typeof claims.nonce === 'string' &&
    claims.nonce.length >= 16
  )
}

export async function createSignalingTicket(
  input: Pick<SignalingTicketClaims, 'accountId' | 'role' | 'deviceId'>,
  secret: string,
  now = Date.now(),
): Promise<{ ticket: string; expiresAt: number }> {
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(16)))
  const claims: SignalingTicketClaims = {
    ...input,
    issuedAt: now,
    expiresAt: now + TICKET_LIFETIME_MS,
    nonce,
  }
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(claims)))
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(payload),
  )
  return {
    ticket: `${TICKET_PREFIX}${payload}.${base64Url(new Uint8Array(signature))}`,
    expiresAt: claims.expiresAt,
  }
}

export async function verifySignalingTicket(
  ticket: string,
  secret: string,
  now = Date.now(),
): Promise<SignalingTicketClaims | null> {
  if (!ticket.startsWith(TICKET_PREFIX) || ticket.length > 2048) return null
  const parts = ticket.slice(TICKET_PREFIX.length).split('.')
  if (parts.length !== 2) return null
  try {
    const [payload, encodedSignature] = parts
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      decodeBase64Url(encodedSignature),
      new TextEncoder().encode(payload),
    )
    if (!valid) return null
    const claims: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)))
    if (!isClaims(claims)) return null
    if (claims.issuedAt > now + 5_000 || claims.expiresAt <= now) return null
    if (claims.expiresAt - claims.issuedAt !== TICKET_LIFETIME_MS) return null
    return claims
  } catch {
    return null
  }
}
