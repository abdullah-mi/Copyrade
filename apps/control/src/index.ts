import { createAuth, type AuthEnvironment } from './auth-config.js'
import { isAuthApiRequest, routeApiRequest } from './router.js'

export type Env = AuthEnvironment & {
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
  fetch(request, env): Promise<Response> {
    if (isAuthApiRequest(request)) {
      return createAuth(env).handler(request)
    }

    const apiResponse = routeApiRequest(request)
    if (apiResponse) return Promise.resolve(apiResponse)
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
