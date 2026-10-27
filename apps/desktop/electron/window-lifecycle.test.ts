import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldHideWindowOnClose } from './window-lifecycle.js'

describe('desktop window lifecycle', () => {
  it('keeps the Windows receiver running when a tray is available', () => {
    assert.equal(shouldHideWindowOnClose({
      isQuitting: false,
      platform: 'win32',
      trayAvailable: true,
    }), true)
  })

  it('allows an explicit quit to close the window', () => {
    assert.equal(shouldHideWindowOnClose({
      isQuitting: true,
      platform: 'win32',
      trayAvailable: true,
    }), false)
  })

  it('does not hide the window when no tray is available', () => {
    assert.equal(shouldHideWindowOnClose({
      isQuitting: false,
      platform: 'win32',
      trayAvailable: false,
    }), false)
  })
})
