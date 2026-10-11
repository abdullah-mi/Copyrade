import type { AuthEnvironment } from './auth-config.js'
import { createAuth } from './auth-config.js'
import { DeviceEnrollmentService } from './device-enrollment.js'
import { D1DeviceRepository } from './device-repository.js'

export type DeviceApiEnvironment = AuthEnvironment & {
  DEVICE_CREDENTIAL_SECRET: string
}

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) return null
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > 4096) return null
  try {
    const text = await request.text()
    if (text.length > 4096) return null
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function hasTrustedOrigin(request: Request, expectedOrigin: string): boolean {
  return request.headers.get('origin') === expectedOrigin
}

async function getUserId(request: Request, env: AuthEnvironment): Promise<string | null> {
  const session = await createAuth(env).api.getSession({ headers: request.headers })
  return session?.user.id ?? null
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse({ error }, status)
}

export async function routeDeviceApiRequest(
  request: Request,
  env: DeviceApiEnvironment,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (
    !url.pathname.startsWith('/api/device-enrollments') &&
    !url.pathname.startsWith('/api/devices') &&
    url.pathname !== '/api/device-session'
  ) {
    return null
  }

  const origin = new URL(env.BETTER_AUTH_URL).origin
  if (!env.DEVICE_CREDENTIAL_SECRET || env.DEVICE_CREDENTIAL_SECRET.length < 32) {
    return errorResponse('SERVICE_UNAVAILABLE', 503)
  }
  const service = new DeviceEnrollmentService(
    new D1DeviceRepository(env.DB),
    env.DEVICE_CREDENTIAL_SECRET,
  )

  if (url.pathname === '/api/device-enrollments' && request.method === 'POST') {
    const body = await readJson(request)
    if (!body) return errorResponse('INVALID_REQUEST', 400)
    const result = await service.start({
      deviceName: body.deviceName,
      platform: body.platform,
      sourceIp: request.headers.get('cf-connecting-ip') ?? 'local-development',
      verificationOrigin: origin,
    })
    if (!result.ok) {
      return errorResponse(result.error, result.error === 'RATE_LIMITED' ? 429 : 400)
    }
    return jsonResponse(result, 201)
  }

  if (url.pathname === '/api/device-enrollments/token' && request.method === 'POST') {
    const body = await readJson(request)
    if (!body) return errorResponse('INVALID_REQUEST', 400)
    const result = await service.exchange(body.deviceCode)
    if (!result.ok) {
      return errorResponse(
        result.error,
        result.error === 'AUTHORIZATION_PENDING' ? 202 : 400,
      )
    }
    return jsonResponse(result)
  }

  if (url.pathname === '/api/device-session' && request.method === 'GET') {
    const authorization = request.headers.get('authorization') ?? ''
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : null
    const device = await service.authenticateDevice(token)
    if (!device) return errorResponse('INVALID_DEVICE_CREDENTIAL', 401)
    return jsonResponse({
      device: {
        id: device.id,
        name: device.name,
        platform: device.platform,
        createdAt: device.createdAt,
      },
    })
  }

  const userId = await getUserId(request, env)
  if (!userId) return errorResponse('UNAUTHORIZED', 401)

  if (url.pathname === '/api/device-enrollments' && request.method === 'GET') {
    const result = await service.inspect(url.searchParams.get('code') ?? '')
    return result.ok ? jsonResponse(result) : errorResponse(result.error, 404)
  }

  if (url.pathname === '/api/device-enrollments/approve' && request.method === 'POST') {
    if (!hasTrustedOrigin(request, origin)) return errorResponse('INVALID_ORIGIN', 403)
    const body = await readJson(request)
    if (!body || typeof body.userCode !== 'string') {
      return errorResponse('INVALID_REQUEST', 400)
    }
    const result = await service.approve(body.userCode, userId)
    if (!result.ok) {
      return errorResponse(
        result.error,
        result.error === 'ALREADY_APPROVED' ? 409 : 404,
      )
    }
    return jsonResponse(result)
  }

  if (url.pathname === '/api/devices' && request.method === 'GET') {
    return jsonResponse({ devices: await service.list(userId) })
  }

  const deviceMatch = url.pathname.match(/^\/api\/devices\/([0-9a-f-]{36})$/i)
  if (deviceMatch && request.method === 'DELETE') {
    if (!hasTrustedOrigin(request, origin)) return errorResponse('INVALID_ORIGIN', 403)
    const revoked = await service.revoke(userId, deviceMatch[1])
    return revoked ? new Response(null, { status: 204 }) : errorResponse('NOT_FOUND', 404)
  }

  return errorResponse('METHOD_NOT_ALLOWED', 405)
}
