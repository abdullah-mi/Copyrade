<p align="center">
  <img src="apps/mobile/public/favicon.svg" width="88" alt="Copyrade icon">
</p>

<h1 align="center">Copyrade</h1>
<p align="center">Your clipboard comrade.</p>

<p align="center">
  <a href="https://copyrade-staging.abdullahijaz-m.workers.dev"><img alt="Open the web app" src="https://img.shields.io/badge/Open-web%20app-2EA44F"></a>
  <a href="docs/getting-started.md"><img alt="Windows source build" src="https://img.shields.io/badge/Windows-source%20build-0078D4"></a>
  <a href="LICENSE"><img alt="Apache 2.0 license" src="https://img.shields.io/badge/License-Apache%202.0-555555"></a>
</p>

<p align="center">TypeScript · React · Electron · WebRTC · Cloudflare</p>

Copyrade sends text, links, and images from your phone's browser to the clipboard on your Windows PC. Open the [web app](https://copyrade-staging.abdullahijaz-m.workers.dev), connect to a PC registered to your account, and paste with `Ctrl+V`.

Copyrade is in early development. The web app is available now; the Windows installer is still undergoing testing. To try the receiver, build it from source using the steps below.

## Get started

You need Windows, [Node.js 24 or later (includes npm)](https://nodejs.org/en/download), [Git](https://git-scm.com/downloads), and a Google or GitHub account.

```powershell
git clone https://github.com/abdullah-mi/Copyrade.git
cd Copyrade
npm ci
npm run build:shared
npm start --workspace @copyrade/desktop
```

In the desktop app, choose **Register this PC**. Sign in through the browser and approve the device. Then open the [web app](https://copyrade-staging.abdullahijaz-m.workers.dev) on your phone, choose your PC, and connect. [Full setup and troubleshooting](docs/getting-started.md).

## Features

| Feature | Availability |
| --- | --- |
| Send text, links, and JPEG or PNG images to the Windows clipboard | Available |
| See registered PCs and whether they are online | Available |
| Reconnect and receive confirmation after a clipboard write | Available |
| Run the Windows receiver in the tray and launch it at sign-in | Available |
| Connect automatically when one PC is available | Planned |
| Share from an iPhone Shortcut or a dedicated mobile app | Planned |
| Sign in with email and password or pair without an account | Planned |
| Use a local-only mode or an encrypted relay on restrictive networks | Planned |

Image formats depend on what the phone's browser provides: iPhone Photos can supply a JPEG representation even when the original was PNG or HEIF. See [compatibility](docs/compatibility.md) for tested setups and known limitations, or [report a problem](https://github.com/abdullah-mi/Copyrade/issues/new).

## Privacy and connections

Copyrade uses Cloudflare for accounts, device approval, presence, and connection setup. Clipboard content travels between your devices over an encrypted WebRTC DataChannel; Copyrade's backend does not store it or maintain clipboard history. The receiver acknowledges delivery after Windows updates its clipboard.

Connections can fail on restrictive networks because TURN relay fallback has not been added yet. Read more about the [architecture](docs/architecture.md) and [security boundaries](docs/security.md).

## Roadmap

| Milestone | Status | Scope |
| --- | --- | --- |
| Accounts, approved devices, and text transfer | Complete | Google/GitHub sign-in, device presence, authenticated signaling, and text delivery |
| [Image transfer](https://github.com/abdullah-mi/Copyrade/milestone/2) | In progress | JPEG/PNG delivery works; finish cancellation and wider testing |
| [Windows alpha](https://github.com/abdullah-mi/Copyrade/milestone/3) | In progress | Finish installer testing, signing, and distribution |
| Faster sharing and connection | Planned | Automatic connection and an iPhone Shortcut |
| More account and network options | Planned | Email/password, account-less pairing, local-only mode, and encrypted relay fallback |
| Original files and mobile app | Planned | Preserve original file formats and build a dedicated mobile client |

For implementation details, see the [protocol](docs/protocol.md), [architecture decisions](docs/decisions), and [developer setup](docs/getting-started.md).

## Contributing

Bug reports, documentation improvements, and focused pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright © 2026 Abdullah Ijaz. Licensed under [Apache 2.0](LICENSE); see [NOTICE](NOTICE) for attribution.
