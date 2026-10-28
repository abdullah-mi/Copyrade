import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loginItemTarget, shouldStartHidden } from './launch-at-login.js'

describe('Windows launch at login', () => {
  it('registers the packaged executable with a hidden-start argument', () => {
    assert.deepEqual(loginItemTarget({
      appPath: 'C:\\Copyrade\\resources\\app.asar',
      execPath: 'C:\\Copyrade\\Copyrade.exe',
      isPackaged: true,
    }), {
      path: 'C:\\Copyrade\\Copyrade.exe',
      args: ['--hidden'],
    })
  })

  it('includes the application path when running through Electron', () => {
    assert.deepEqual(loginItemTarget({
      appPath: 'E:\\dev\\source\\copyrade\\apps\\desktop',
      execPath: 'E:\\dev\\source\\copyrade\\node_modules\\electron.exe',
      isPackaged: false,
    }), {
      path: 'E:\\dev\\source\\copyrade\\node_modules\\electron.exe',
      args: ['E:\\dev\\source\\copyrade\\apps\\desktop', '--hidden'],
    })
  })

  it('starts hidden only for the explicit startup argument', () => {
    assert.equal(shouldStartHidden(['electron.exe', '.', '--hidden']), true)
    assert.equal(shouldStartHidden(['electron.exe', '.', '--hidden-window']), false)
  })
})
