# Contributing to Copyrade

Copyrade welcomes focused bug reports, documentation improvements, tests, and
implementation contributions that fit the current roadmap.

## Before starting

- Read the [developer setup guide](docs/getting-started.md).
- Search [existing issues](https://github.com/abdullah-mi/Copyrade/issues)
  before opening a duplicate.
- For a substantial feature or architecture change, open an issue first so its
  scope and privacy implications can be discussed.
- Never include real clipboard contents, account identifiers, device codes,
  tokens, OAuth credentials, SDP, or ICE candidates in issues, tests, or logs.

## Development workflow

1. Fork the repository and create a focused branch from `main`, such as
   `feat/image-transfer` or `fix/reconnect-timeout`.
2. Install dependencies with `npm ci`.
3. Build shared packages with `npm run build:shared` before running an
   individual application.
4. Keep the change focused and add or update tests and documentation. Small,
   frequent pull requests are preferred over large changes that mix several
   features or refactors.
5. Run the full validation suite:

   ```bash
   npm run check
   ```

6. Open a pull request describing the behavior changed, validation performed,
   and any remaining limitations.

Keep commits reviewable and do not commit generated build output, local secrets,
development databases, transferred content, or account data.

Unless explicitly stated otherwise, contributions submitted for inclusion in
Copyrade are licensed under the project's [Apache License 2.0](LICENSE).

## Bug reports

A useful report includes:

- expected and observed behavior;
- reproducible steps using synthetic content;
- phone, browser, Windows, and Electron versions;
- relevant network conditions;
- sanitized error messages and state transitions.

Do not publish sensitive security details or credentials. If a report cannot be
safely described without them, contact the maintainer through the GitHub profile
before sharing further information.
