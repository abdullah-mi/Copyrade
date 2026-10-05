# ADR 0002: Account identity and linking

- Status: Accepted
- Date: 2026-09-29

## Decision

Use one immutable internal user ID with multiple linked login accounts. Begin
with Google and GitHub OAuth and preserve a path to verified email/password.
Automatically link providers only when both assert the exact same verified
email address.

## Rationale

Users should not get duplicate Copyrade accounts simply because they choose a
different sign-in button. Treating an unverified email or username as identity,
however, creates an account-takeover path.

## Consequences

Providers that do not expose a verified email require explicit linking while
signed in. Copyrade will not infer equivalence between aliases, and users must
retain at least one usable login method.
