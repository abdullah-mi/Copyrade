import { createAuth, type AuthEnvironment } from './auth-config.js'
import { AccountCoordinator } from './account-coordinator.js'
import { routeDeviceApiRequest, type DeviceApiEnvironment } from './device-api.js'
import { isAuthApiRequest, routeApiRequest } from './router.js'
import { issueSignalingTicket, type SignalingEnvironment } from './signaling-api.js'
import { verifySignalingTicket } from './signaling-ticket.js'

export type Env = AuthEnvironment & DeviceApiEnvironment & SignalingEnvironment & {
  ACCOUNT_COORDINATOR: DurableObjectNamespace
  ASSETS: Fetcher
}

export { AccountCoordinator }

async function upgradeSignaling(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method not allowed.', { status: 405 })
  if (!env.SIGNALING_TICKET_SECRET || env.SIGNALING_TICKET_SECRET.length < 32) {
    return new Response('Signaling is unavailable.', { status: 503 })
  }
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('WebSocket upgrade required.', { status: 426 })
  }
  const protocols = (request.headers.get('sec-websocket-protocol') ?? '')
    .split(',')
    .map((value) => value.trim())
  if (!protocols.includes('copyrade-v1')) {
    return new Response('Unsupported signaling protocol.', { status: 400 })
  }
  const ticket = protocols.find((value) => value.startsWith('cpy.signal.'))
  if (!ticket) return new Response('Signaling authorization required.', { status: 401 })
  const claims = await verifySignalingTicket(ticket, env.SIGNALING_TICKET_SECRET)
  if (!claims) return new Response('Invalid signaling authorization.', { status: 401 })

  return env.ACCOUNT_COORDINATOR.getByName(claims.accountId).fetch(request)
}

export default {
  async fetch(request, env): Promise<Response> {
    if (isAuthApiRequest(request)) {
      return createAuth(env).handler(request)
    }

    const pathname = new URL(request.url).pathname
    if (pathname === '/api/signal-ticket') {
      return issueSignalingTicket(request, env)
    }
    if (pathname === '/api/signal') {
      return upgradeSignaling(request, env)
    }

    const deviceResponse = await routeDeviceApiRequest(request, env)
    if (deviceResponse) return deviceResponse

    const apiResponse = routeApiRequest(request)
    if (apiResponse) return apiResponse
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
