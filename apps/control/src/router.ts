const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  })
}

export function isAuthApiRequest(request: Request): boolean {
  const pathname = new URL(request.url).pathname
  return pathname === '/api/auth' || pathname.startsWith('/api/auth/')
}

export function routeApiRequest(request: Request): Response | null {
  const url = new URL(request.url)

  if (url.pathname === '/api/health') {
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405)
    }

    return jsonResponse({ status: 'ok' })
  }

  if (url.pathname.startsWith('/api/')) {
    return jsonResponse({ error: 'NOT_FOUND' }, 404)
  }

  return null
}
