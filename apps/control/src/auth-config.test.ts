import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type AuthEnvironment,
  validateAuthEnvironment,
} from './auth-config.js'

function environment(
  overrides: Partial<AuthEnvironment> = {},
): AuthEnvironment {
  return {
    BETTER_AUTH_SECRET: 'a-secure-development-secret-with-32-characters',
    BETTER_AUTH_URL: 'https://copyrade.example',
    DB: {} as D1Database,
    GITHUB_CLIENT_ID: 'github-client',
    GITHUB_CLIENT_SECRET: 'github-secret',
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    ...overrides,
  }
}

describe('authentication configuration', () => {
  it('accepts HTTPS and loopback development origins', () => {
    assert.doesNotThrow(() => validateAuthEnvironment(environment()))
    assert.doesNotThrow(() =>
      validateAuthEnvironment(
        environment({ BETTER_AUTH_URL: 'http://127.0.0.1:5173' }),
      ),
    )
  })

  it('rejects missing secrets and placeholder values', () => {
    assert.throws(
      () => validateAuthEnvironment(environment({ GOOGLE_CLIENT_SECRET: '' })),
      /GOOGLE_CLIENT_SECRET/,
    )
    assert.throws(
      () =>
        validateAuthEnvironment(
          environment({ GITHUB_CLIENT_ID: 'replace-with-client-id' }),
        ),
      /GITHUB_CLIENT_ID/,
    )
  })

  it('rejects weak secrets and unsafe public origins', () => {
    assert.throws(
      () =>
        validateAuthEnvironment(environment({ BETTER_AUTH_SECRET: 'short' })),
      /at least 32 characters/,
    )
    assert.throws(
      () =>
        validateAuthEnvironment(
          environment({ BETTER_AUTH_URL: 'http://copyrade.example' }),
        ),
      /must use HTTPS/,
    )
    assert.throws(
      () =>
        validateAuthEnvironment(
          environment({ BETTER_AUTH_URL: 'https://copyrade.example/auth' }),
        ),
      /without a path/,
    )
  })
})
