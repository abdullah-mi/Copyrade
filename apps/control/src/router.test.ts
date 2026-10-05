import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isAuthApiRequest, routeApiRequest } from './router.js'

describe('control-plane routing', () => {
  it('returns a non-cacheable health response', async () => {
    const response = routeApiRequest(
      new Request('https://copyrade.example/api/health'),
    )

    assert.ok(response)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { status: 'ok' })
  })

  it('rejects unsupported methods and unknown API routes', async () => {
    const methodResponse = routeApiRequest(
      new Request('https://copyrade.example/api/health', { method: 'POST' }),
    )
    const missingResponse = routeApiRequest(
      new Request('https://copyrade.example/api/missing'),
    )

    assert.equal(methodResponse?.status, 405)
    assert.equal(missingResponse?.status, 404)
  })

  it('leaves static routes to the asset binding', () => {
    assert.equal(
      routeApiRequest(new Request('https://copyrade.example/dashboard')),
      null,
    )
  })

  it('recognizes only the Better Auth route namespace', () => {
    assert.equal(
      isAuthApiRequest(new Request('https://copyrade.example/api/auth/session')),
      true,
    )
    assert.equal(
      isAuthApiRequest(new Request('https://copyrade.example/api/auth')),
      true,
    )
    assert.equal(
      isAuthApiRequest(
        new Request('https://copyrade.example/api/authentication'),
      ),
      false,
    )
  })
})
