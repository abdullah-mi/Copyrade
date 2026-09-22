# Copyrade Mobile Diagnostic

This React and TypeScript application validates user-initiated clipboard text
reading in the browsers targeted by Copyrade's sender experience.

## Run locally

Install the repository dependencies from the Copyrade root, then start the
mobile workspace:

```powershell
npm ci
npm run build --workspace @copyrade/connection
npm run dev --workspace @copyrade/mobile
```

Run these commands from the repository root. The shared connection package
must be built after a fresh install because the app imports its generated files.

Open the address printed by Vite and select **Read clipboard** after copying
harmless test text.

## Verified behavior

- Clipboard text remains in page memory and is not logged or persisted.
- Clipboard access is rejected outside HTTPS or localhost.
- The interface reports unsupported, denied, empty, successful, and failed reads.
- Real-device testing confirmed text reads in iPhone Safari over HTTPS.

Safari requires the user to choose its native **Paste** action before a website
can read clipboard content copied from another application. The web client
cannot persist clipboard-read permission or bypass this platform control.

This is a development capability diagnostic, not the finished Copyrade sender.
