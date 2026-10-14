# Copyrade mobile web client

This React/Vite app is Copyrade's phone-facing sender and browser account UI. In
the hosted staging flow it provides Google/GitHub sign-in, device enrollment
approval, registered-device status, authenticated WebRTC connection requests,
and text delivery to Windows.

## Current clipboard behavior

- A user-initiated **Paste** action distinguishes text, URLs, and decodable
  image representations.
- Clipboard text sends automatically after a connection is established. Manual
  edits send after a short idle delay or when the field loses focus.
- The sender reports success only after the Windows native clipboard write ACK.
- Images up to 16 MiB can be inspected in memory for type, dimensions, and size,
  with an explicit image-picker fallback. Image delivery is not implemented.
- Clipboard contents and acquired image bytes are not logged or persisted.

iPhone Safari may show its native Paste callout and may expose Photos content as
a transcoded JPEG even when the original asset used another format.

## Run locally

From the repository root:

```powershell
npm ci
npm run build:shared
npm run dev --workspace @copyrade/mobile
```

Localhost can exercise UI and clipboard acquisition. Phone access requires
HTTPS, and a complete connection also requires either the authenticated control
plane or the development signaling process. See the
[developer guide](../../docs/getting-started.md).
