# Copyrade artwork

- `Copyrade Logo.svg`: transparent wordmark for documentation and light backgrounds.
- `Copyrade Icon Coloured.svg`: square artwork for large previews.
- `Copyrade Tray Icon Coloured.svg`: transparent mark for small application icons.
- `Copyrade Mark.png`: raster source used to generate the Windows icon.

Other exports stay local. Run `scripts/generate-windows-icons.ps1` from PowerShell
after changing the mark to regenerate the Windows assets.

The desktop app uses `apps/desktop/assets/copyrade.ico` for its window and
`apps/desktop/assets/copyrade-tray.png` for the notification area. The web app
uses the mark-only SVG as `apps/mobile/public/favicon.svg`.
