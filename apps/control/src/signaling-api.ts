import { createAuth, type AuthEnvironment } from './auth-config.js'
import { DeviceEnrollmentService } from './device-enrollment.js'
import { D1DeviceRepository } from './device-repository.js'
import { createSignalingTicket } from './signaling-ticket.js'

export type SignalingEnvironment = AuthEnvironment & {
  ACCOUNT_COORDINATOR: DurableObjectNamespace
  DEVICE_CREDENTIAL_SECRET: string
  SIGNALING_TICKET_SECRET: string
}

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

async function requestBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(length) && length > 4096) return null
  try {
    const text = await request.text()
    if (text.length > 4096) return null
    const body: unknown = JSON.parse(text)
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export async function issueSignalingTicket(
  request: Request,
  env: SignalingEnvironment,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  if (!env.SIGNALING_TICKET_SECRET || env.SIGNALING_TICKET_SECRET.length < 32) {
    return json({ error: 'SERVICE_UNAVAILABLE' }, 503)
  }
  if (!env.DEVICE_CREDENTIAL_SECRET || env.DEVICE_CREDENTIAL_SECRET.length < 32) {
    return json({ error: 'SERVICE_UNAVAILABLE' }, 503)
  }

  const devices = new DeviceEnrollmentService(
    new D1DeviceRepository(env.DB),
    env.DEVICE_CREDENTIAL_SECRET,
  )
  const authorization = request.headers.get('authorization') ?? ''
  if (authorization.startsWith('Bearer ')) {
    const device = await devices.authenticateDevice(authorization.slice(7))
    if (!device) return json({ error: 'INVALID_DEVICE_CREDENTIAL' }, 401)
    return json(
      await createSignalingTicket(
        { accountId: device.userId, role: 'desktop', deviceId: device.id },
        env.SIGNALING_TICKET_SECRET,
      ),
    )
  }

  const origin = new URL(env.BETTER_AUTH_URL).origin
  if (request.headers.get('origin') !== origin) {
    return json({ error: 'INVALID_ORIGIN' }, 403)
  }
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }
  const session = await createAuth(env).api.getSession({ headers: request.headers })
  if (!session) return json({ error: 'UNAUTHORIZED' }, 401)
  const body = await requestBody(request)
  if (!body || typeof body.deviceId !== 'string') {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }
  const device = await devices.findOwnedDevice(session.user.id, body.deviceId)
  if (!device) return json({ error: 'DEVICE_NOT_FOUND' }, 404)

  return json(
    await createSignalingTicket(
      { accountId: session.user.id, role: 'mobile', deviceId: device.id },
      env.SIGNALING_TICKET_SECRET,
    ),
  )
}

export async function issuePresenceTicket(
  request: Request,
  env: SignalingEnvironment,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  if (!env.SIGNALING_TICKET_SECRET || env.SIGNALING_TICKET_SECRET.length < 32) {
    return json({ error: 'SERVICE_UNAVAILABLE' }, 503)
  }
  if (!env.DEVICE_CREDENTIAL_SECRET || env.DEVICE_CREDENTIAL_SECRET.length < 32) {
    return json({ error: 'SERVICE_UNAVAILABLE' }, 503)
  }

  const authorization = request.headers.get('authorization') ?? ''
  if (authorization.startsWith('Bearer ')) {
    const devices = new DeviceEnrollmentService(
      new D1DeviceRepository(env.DB),
      env.DEVICE_CREDENTIAL_SECRET,
    )
    const device = await devices.authenticateDevice(authorization.slice(7))
    if (!device) return json({ error: 'INVALID_DEVICE_CREDENTIAL' }, 401)
    return json(
      await createSignalingTicket(
        { accountId: device.userId, role: 'presence', deviceId: device.id },
        env.SIGNALING_TICKET_SECRET,
      ),
    )
  }

  const origin = new URL(env.BETTER_AUTH_URL).origin
  if (request.headers.get('origin') !== origin) return json({ error: 'INVALID_ORIGIN' }, 403)
  const session = await createAuth(env).api.getSession({ headers: request.headers })
  if (!session) return json({ error: 'UNAUTHORIZED' }, 401)
  return json(
    await createSignalingTicket(
      { accountId: session.user.id, role: 'observer', deviceId: null },
      env.SIGNALING_TICKET_SECRET,
    ),
  )
}

export async function requestDeviceConnection(
  request: Request,
  env: SignalingEnvironment,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  if (!env.SIGNALING_TICKET_SECRET || env.SIGNALING_TICKET_SECRET.length < 32) {
    return json({ error: 'SERVICE_UNAVAILABLE' }, 503)
  }
  if (!env.DEVICE_CREDENTIAL_SECRET || env.DEVICE_CREDENTIAL_SECRET.length < 32) {
    return json({ error: 'SERVICE_UNAVAILABLE' }, 503)
  }
  const origin = new URL(env.BETTER_AUTH_URL).origin
  if (request.headers.get('origin') !== origin) return json({ error: 'INVALID_ORIGIN' }, 403)
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }
  const session = await createAuth(env).api.getSession({ headers: request.headers })
  if (!session) return json({ error: 'UNAUTHORIZED' }, 401)
  const body = await requestBody(request)
  if (!body || typeof body.deviceId !== 'string') {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }
  const devices = new DeviceEnrollmentService(
    new D1DeviceRepository(env.DB),
    env.DEVICE_CREDENTIAL_SECRET,
  )
  const device = await devices.findOwnedDevice(session.user.id, body.deviceId)
  if (!device) return json({ error: 'DEVICE_NOT_FOUND' }, 404)

  const coordinator = env.ACCOUNT_COORDINATOR.getByName(session.user.id)
  const presenceResponse = await coordinator.fetch(
    new Request('https://account-coordinator/connection-request', {
      method: 'POST',
      headers: { 'x-copyrade-device-id': device.id },
    }),
  )
  if (presenceResponse.status === 409) return json({ error: 'DEVICE_OFFLINE' }, 409)
  if (!presenceResponse.ok) return json({ error: 'SERVICE_UNAVAILABLE' }, 503)

  return json(
    await createSignalingTicket(
      { accountId: session.user.id, role: 'mobile', deviceId: device.id },
      env.SIGNALING_TICKET_SECRET,
    ),
  )
}
