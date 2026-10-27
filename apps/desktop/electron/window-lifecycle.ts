export type WindowCloseContext = {
  isQuitting: boolean
  platform: NodeJS.Platform
  trayAvailable: boolean
}

export function shouldHideWindowOnClose(context: WindowCloseContext): boolean {
  return context.platform === 'win32' && context.trayAvailable && !context.isQuitting
}
