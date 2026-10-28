export type LoginItemContext = {
  appPath: string
  execPath: string
  isPackaged: boolean
}

export function loginItemTarget(context: LoginItemContext): {
  path: string
  args: string[]
} {
  return {
    path: context.execPath,
    args: context.isPackaged ? ['--hidden'] : [context.appPath, '--hidden'],
  }
}

export function shouldStartHidden(commandLine: readonly string[]): boolean {
  return commandLine.includes('--hidden')
}
