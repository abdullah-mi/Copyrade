import { app } from 'electron'
import { spawn } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'

export function handleSquirrelEvent(command: string | undefined): boolean {
  if (process.platform !== 'win32') return false

  const action = command === '--squirrel-install' || command === '--squirrel-updated'
    ? '--createShortcut'
    : command === '--squirrel-uninstall'
      ? '--removeShortcut'
      : null

  if (command === '--squirrel-obsolete') {
    app.quit()
    return true
  }
  if (!action) return false

  const updateExe = resolve(dirname(process.execPath), '..', 'Update.exe')
  const child = spawn(updateExe, [`${action}=${basename(process.execPath)}`], {
    windowsHide: true,
  })
  child.once('error', () => app.quit())
  child.once('close', () => app.quit())
  return true
}
