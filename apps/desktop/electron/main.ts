import { app, BrowserWindow, ClipboardItem, clipboard, ipcMain, nativeImage } from 'electron'
import type { IpcMainInvokeEvent, WebFrameMain } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  clipboardWriteFailure,
  validateClipboardImage,
  validateClipboardText,
} from './clipboard-request.js'
import type { ClipboardWriteResult } from './clipboard-request.js'
import { DeviceEnrollmentManager } from './device-enrollment.js'

const CLIPBOARD_WRITE_CHANNEL = 'clipboard:write-text'
const CLIPBOARD_WRITE_IMAGE_CHANNEL = 'clipboard:write-image'
const DEVICE_STATUS_CHANNEL = 'device:status'
const DEVICE_ENROLL_START_CHANNEL = 'device:enroll-start'
const DEVICE_ENROLL_POLL_CHANNEL = 'device:enroll-poll'
const DEVICE_SIGNAL_TICKET_CHANNEL = 'device:signal-ticket'
const DEVICE_PRESENCE_TICKET_CHANNEL = 'device:presence-ticket'

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

async function writeClipboardImage(
  event: IpcMainInvokeEvent,
  mimeType: unknown,
  payload: unknown,
): Promise<ClipboardWriteResult> {
  if (!isTrustedSender(event.senderFrame)) {
    return clipboardWriteFailure('UNTRUSTED_SENDER', 'The clipboard request was not trusted.')
  }
  const validation = validateClipboardImage(mimeType, payload)
  if (!validation.ok) return validation
  try {
    const image = nativeImage.createFromBuffer(Buffer.from(validation.bytes))
    if (image.isEmpty()) {
      return clipboardWriteFailure('INVALID_PAYLOAD', 'Windows could not decode the image.')
    }
    await clipboard.write([
      new ClipboardItem({
        [validation.mimeType]: new Blob(
          [Uint8Array.from(validation.bytes)],
          { type: validation.mimeType },
        ),
      }),
    ])
    return { ok: true, byteLength: validation.byteLength }
  } catch {
    return clipboardWriteFailure('WRITE_FAILED', 'Windows rejected the clipboard image.')
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
ipcMain.handle(CLIPBOARD_WRITE_IMAGE_CHANNEL, writeClipboardImage)
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
ipcMain.handle(DEVICE_SIGNAL_TICKET_CHANNEL, (event) => {
  if (!isTrustedSender(event.senderFrame)) {
    return { ok: false, error: 'The device request was not trusted.' }
  }
  return deviceEnrollment.signalingTicket()
})
ipcMain.handle(DEVICE_PRESENCE_TICKET_CHANNEL, (event) => {
  if (!isTrustedSender(event.senderFrame)) {
    return { ok: false, error: 'The device request was not trusted.' }
  }
  return deviceEnrollment.presenceTicket()
})

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

if (hasSingleInstanceLock) app.whenReady().then(() => {
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
