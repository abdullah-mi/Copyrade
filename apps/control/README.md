# Copyrade Control Plane

This Cloudflare Worker will serve the mobile React build and provide Copyrade's
authenticated control plane. Its intended responsibilities are account sessions,
registered devices, revocation, presence, and WebRTC signaling.

Clipboard payloads must not pass through this service. They remain on the WebRTC
DataChannel between the mobile client and Windows receiver.

## Local foundation

From the repository root:

```powershell
npm run build --workspace @copyrade/mobile
npm run dev --workspace @copyrade/control
```

The checked-in Wrangler configuration points to the staging D1 database. Local
development uses Wrangler's separate local D1 storage, so it will not modify
the remote staging database unless a command explicitly includes `--remote`.
Authentication uses Better Auth with Google and GitHub providers. Local
authentication requires a private `.dev.vars` copied from `.dev.vars.example`.
The production values are configured with Wrangler secrets and are never stored
in this repository.

Before starting local authentication for the first time, create the local D1
schema:

```powershell
npm run db:migrate:local --workspace @copyrade/control
```

## Staging deployment

From the repository root, validate the upload without changing Cloudflare:

```powershell
npm run build --workspace @copyrade/mobile
npx wrangler deploy --dry-run --config apps/control/wrangler.jsonc
```

After reviewing the dry-run output, deploy the Worker and mobile assets:

```powershell
npm run deploy --workspace @copyrade/control
```

Authentication deployments require this order:

1. Review and apply the committed D1 migrations with
   `npm run db:migrate:remote --workspace @copyrade/control`.
2. Configure `BETTER_AUTH_SECRET`, Google credentials, and GitHub credentials
   with `wrangler secret put`.
3. Deploy only after the migrations and secrets succeed.

Google's callback URL is
`https://copyrade-staging.abdullahijaz-m.workers.dev/api/auth/callback/google`.
GitHub's callback URL is
`https://copyrade-staging.abdullahijaz-m.workers.dev/api/auth/callback/github`.

OAuth tokens are encrypted before D1 storage. Rate limits are stored in D1 so
they remain effective across Worker isolates. Automatic account linking requires
the same verified email; providers are deliberately not placed on Better Auth's
verification-bypassing trusted-provider list.

Browser sessions use Better Auth's server-side D1 session records and secure,
HTTP-only session cookie. The session has a seven-day rolling lifetime and is
refreshed after one day of activity; signing out revokes it immediately.

The first deployment also creates the `AccountCoordinator` Durable Object class.
The class currently rejects requests because authenticated signaling will be
implemented only after account and device authorization.

Do not place OAuth secrets, session secrets, tokens, clipboard contents, SDP, ICE
candidates, or device authorization codes in source control or logs.
