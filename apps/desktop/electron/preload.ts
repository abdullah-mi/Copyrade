import { contextBridge, ipcRenderer } from 'electron'

const CLIPBOARD_WRITE_CHANNEL = 'clipboard:write-text'

contextBridge.exposeInMainWorld('copyrade', {
  clipboard: {
    writeText: (text: string): Promise<unknown> =>
      ipcRenderer.invoke(CLIPBOARD_WRITE_CHANNEL, text),
  },
})
