import { app, BrowserWindow, clipboard, ipcMain } from 'electron'
import type { IpcMainInvokeEvent, WebFrameMain } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  clipboardWriteFailure,
  validateClipboardText,
} from './clipboard-request.js'
import type { ClipboardWriteResult } from './clipboard-request.js'
import { DeviceEnrollmentManager } from './device-enrollment.js'

const CLIPBOARD_WRITE_CHANNEL = 'clipboard:write-text'
const DEVICE_STATUS_CHANNEL = 'device:status'
const DEVICE_ENROLL_START_CHANNEL = 'device:enroll-start'
const DEVICE_ENROLL_POLL_CHANNEL = 'device:enroll-poll'

let mainWindow: BrowserWindow | null = null
const deviceEnrollment = new DeviceEnrollmentManager()

function rendererEntryPath(): string {
  return join(__dirname, '..', 'dist', 'index.html')
}

function isTrustedSender(frame: WebFrameMain | null): boolean {
  if (!frame || !mainWindow) {
    return false
  }

  const expectedUrl = pathToFileURL(rendererEntryPath()).toString()
  return frame === mainWindow.webContents.mainFrame && frame.url === expectedUrl
}

async function writeClipboardText(
  event: IpcMainInvokeEvent,
  payload: unknown,
): Promise<ClipboardWriteResult> {
  if (!isTrustedSender(event.senderFrame)) {
    return clipboardWriteFailure(
      'UNTRUSTED_SENDER',
      'The clipboard request was not trusted.',
    )
  }

  const validation = validateClipboardText(payload)
  if (!validation.ok) {
    return validation
  }

  try {
    await clipboard.writeText(validation.text)
    return { ok: true, byteLength: validation.byteLength }
  } catch {
    return clipboardWriteFailure(
      'WRITE_FAILED',
      'Windows rejected the clipboard write.',
    )
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 680,
    minWidth: 520,
    minHeight: 560,
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== pathToFileURL(rendererEntryPath()).toString()) {
      event.preventDefault()
    }
  })

  void mainWindow.loadFile(rendererEntryPath())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle(CLIPBOARD_WRITE_CHANNEL, writeClipboardText)
ipcMain.handle(DEVICE_STATUS_CHANNEL, (event) => {
  if (!isTrustedSender(event.senderFrame)) {
    return { enrolled: false, suggestedName: '', error: 'The device request was not trusted.' }
  }
  return deviceEnrollment.status()
})
ipcMain.handle(DEVICE_ENROLL_START_CHANNEL, (event, deviceName: unknown) => {
  if (!isTrustedSender(event.senderFrame)) {
    return { ok: false, error: 'The device request was not trusted.' }
  }
  return deviceEnrollment.start(deviceName)
})
ipcMain.handle(DEVICE_ENROLL_POLL_CHANNEL, (event) => {
  if (!isTrustedSender(event.senderFrame)) {
    return { ok: false, error: 'The device request was not trusted.' }
  }
  return deviceEnrollment.poll()
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
