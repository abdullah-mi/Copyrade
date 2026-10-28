import { contextBridge, ipcRenderer } from 'electron'

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

contextBridge.exposeInMainWorld('copyrade', {
  clipboard: {
    writeText: (text: string): Promise<unknown> =>
      ipcRenderer.invoke(CLIPBOARD_WRITE_CHANNEL, text),
    writeImage: (mimeType: 'image/png' | 'image/jpeg', bytes: Uint8Array): Promise<unknown> =>
      ipcRenderer.invoke(CLIPBOARD_WRITE_IMAGE_CHANNEL, mimeType, bytes),
  },
  device: {
    getStatus: (): Promise<unknown> => ipcRenderer.invoke(DEVICE_STATUS_CHANNEL),
    startEnrollment: (deviceName: string): Promise<unknown> =>
      ipcRenderer.invoke(DEVICE_ENROLL_START_CHANNEL, deviceName),
    pollEnrollment: (): Promise<unknown> =>
      ipcRenderer.invoke(DEVICE_ENROLL_POLL_CHANNEL),
    getSignalingTicket: (): Promise<unknown> =>
      ipcRenderer.invoke(DEVICE_SIGNAL_TICKET_CHANNEL),
    getPresenceTicket: (): Promise<unknown> =>
      ipcRenderer.invoke(DEVICE_PRESENCE_TICKET_CHANNEL),
  },
  system: {
    getLoginItemStatus: (): Promise<unknown> =>
      ipcRenderer.invoke(SYSTEM_LOGIN_ITEM_STATUS_CHANNEL),
    setLoginItem: (enabled: boolean): Promise<unknown> =>
      ipcRenderer.invoke(SYSTEM_LOGIN_ITEM_SET_CHANNEL, enabled),
    onPowerEvent: (listener: (event: 'suspend' | 'resume') => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        if (value === 'suspend' || value === 'resume') listener(value)
      }
      ipcRenderer.on(SYSTEM_POWER_CHANNEL, handler)
      return () => ipcRenderer.removeListener(SYSTEM_POWER_CHANNEL, handler)
    },
  },
})
