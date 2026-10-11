import { createAuth, type AuthEnvironment } from './auth-config.js'
import { routeDeviceApiRequest, type DeviceApiEnvironment } from './device-api.js'
import { isAuthApiRequest, routeApiRequest } from './router.js'

export type Env = AuthEnvironment & DeviceApiEnvironment & {
  ACCOUNT_COORDINATOR: DurableObjectNamespace
  ASSETS: Fetcher
}

export class AccountCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  fetch(): Response {
    void this.state
    void this.env
    return new Response('Authenticated signaling is not implemented.', {
      status: 501,
    })
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    if (isAuthApiRequest(request)) {
      return createAuth(env).handler(request)
    }

    const deviceResponse = await routeDeviceApiRequest(request, env)
    if (deviceResponse) return deviceResponse

    const apiResponse = routeApiRequest(request)
    if (apiResponse) return apiResponse
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
