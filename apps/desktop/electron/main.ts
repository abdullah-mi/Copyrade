import {
  app,
  BrowserWindow,
  ClipboardItem,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  Tray,
} from 'electron'
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
import { loginItemTarget, shouldStartHidden } from './launch-at-login.js'
import { shouldHideWindowOnClose } from './window-lifecycle.js'

const CLIPBOARD_WRITE_CHANNEL = 'clipboard:write-text'
const CLIPBOARD_WRITE_IMAGE_CHANNEL = 'clipboard:write-image'
const DEVICE_STATUS_CHANNEL = 'device:status'
const DEVICE_ENROLL_START_CHANNEL = 'device:enroll-start'
const DEVICE_ENROLL_POLL_CHANNEL = 'device:enroll-poll'
const DEVICE_SIGNAL_TICKET_CHANNEL = 'device:signal-ticket'
const DEVICE_PRESENCE_TICKET_CHANNEL = 'device:presence-ticket'
const SYSTEM_POWER_CHANNEL = 'system:power'
const SYSTEM_LOGIN_ITEM_STATUS_CHANNEL = 'system:login-item-status'
const SYSTEM_LOGIN_ITEM_SET_CHANNEL = 'system:login-item-set'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
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

function createWindow(show = true): void {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 680,
    minWidth: 520,
    minHeight: 560,
    backgroundColor: '#f4f7fb',
    show,
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
  mainWindow.on('close', (event) => {
    if (shouldHideWindowOnClose({
      isQuitting,
      platform: process.platform,
      trayAvailable: tray !== null,
    })) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function currentLoginItemTarget() {
  return loginItemTarget({
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged,
  })
}

function loginItemStatus() {
  if (process.platform !== 'win32') return { supported: false, enabled: false }
  const target = currentLoginItemTarget()
  const settings = app.getLoginItemSettings(target)
  return {
    supported: true,
    enabled: settings.openAtLogin || settings.executableWillLaunchAtLogin,
  }
}

function setLoginItem(enabled: unknown) {
  if (process.platform !== 'win32') return { supported: false, enabled: false }
  if (typeof enabled !== 'boolean') {
    return { supported: true, enabled: false, error: 'Invalid startup setting.' }
  }
  const target = currentLoginItemTarget()
  app.setLoginItemSettings({
    ...target,
    name: 'Copyrade',
    openAtLogin: enabled,
  })
  return loginItemStatus()
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function createTray(): Promise<void> {
  if (process.platform !== 'win32' || tray) return
  const icon = await app.getFileIcon(process.execPath, { size: 'small' })
  tray = new Tray(icon)
  tray.setToolTip('Copyrade')
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open Copyrade',
      click: showMainWindow,
    },
    { type: 'separator' },
    {
      label: 'Quit Copyrade',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ]))
  tray.on('click', showMainWindow)
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
ipcMain.handle(SYSTEM_LOGIN_ITEM_STATUS_CHANNEL, (event) => {
  if (!isTrustedSender(event.senderFrame)) {
    return { supported: true, enabled: false, error: 'The startup request was not trusted.' }
  }
  return loginItemStatus()
})
ipcMain.handle(SYSTEM_LOGIN_ITEM_SET_CHANNEL, (event, enabled: unknown) => {
  if (!isTrustedSender(event.senderFrame)) {
    return { supported: true, enabled: false, error: 'The startup request was not trusted.' }
  }
  return setLoginItem(enabled)
})

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (!shouldStartHidden(commandLine)) showMainWindow()
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  await createTray().catch(() => {
    tray = null
  })
  createWindow(!shouldStartHidden(process.argv))

  powerMonitor.on('suspend', () => {
    mainWindow?.webContents.send(SYSTEM_POWER_CHANNEL, 'suspend')
  })
  powerMonitor.on('resume', () => {
    mainWindow?.webContents.send(SYSTEM_POWER_CHANNEL, 'resume')
  })

  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) {
    app.quit()
  }
})
