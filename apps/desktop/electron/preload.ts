import { contextBridge, ipcRenderer } from 'electron'

const CLIPBOARD_WRITE_CHANNEL = 'clipboard:write-text'
const DEVICE_STATUS_CHANNEL = 'device:status'
const DEVICE_ENROLL_START_CHANNEL = 'device:enroll-start'
const DEVICE_ENROLL_POLL_CHANNEL = 'device:enroll-poll'

contextBridge.exposeInMainWorld('copyrade', {
  clipboard: {
    writeText: (text: string): Promise<unknown> =>
      ipcRenderer.invoke(CLIPBOARD_WRITE_CHANNEL, text),
  },
  device: {
    getStatus: (): Promise<unknown> => ipcRenderer.invoke(DEVICE_STATUS_CHANNEL),
    startEnrollment: (deviceName: string): Promise<unknown> =>
      ipcRenderer.invoke(DEVICE_ENROLL_START_CHANNEL, deviceName),
    pollEnrollment: (): Promise<unknown> =>
      ipcRenderer.invoke(DEVICE_ENROLL_POLL_CHANNEL),
  },
})
