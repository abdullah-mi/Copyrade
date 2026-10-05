import { betterAuth } from 'better-auth'

export type AuthEnvironment = {
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  DB: D1Database
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

const REQUIRED_VALUES = [
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
] as const

function isLocalOrigin(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  )
}

export function validateAuthEnvironment(env: AuthEnvironment): void {
  for (const key of REQUIRED_VALUES) {
    const value = env[key]
    if (!value?.trim() || value.startsWith('replace-with-')) {
      throw new Error(`Missing authentication configuration: ${key}`)
    }
  }

  if (env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters')
  }

  const baseUrl = new URL(env.BETTER_AUTH_URL)
  if (baseUrl.origin !== env.BETTER_AUTH_URL || baseUrl.pathname !== '/') {
    throw new Error('BETTER_AUTH_URL must be an origin without a path')
  }
  if (baseUrl.protocol !== 'https:' && !isLocalOrigin(baseUrl)) {
    throw new Error('BETTER_AUTH_URL must use HTTPS outside local development')
  }
}

export function createAuth(env: AuthEnvironment) {
  validateAuthEnvironment(env)

  return betterAuth({
    database: env.DB,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        requireEmailVerification: true,
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        requireEmailVerification: true,
      },
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        updateUserInfoOnLink: false,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
    },
    advanced: {
      database: {
        generateId: 'uuid',
      },
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip'],
      },
    },
  })
}
