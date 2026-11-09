import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktop = join(root, 'apps', 'desktop')
const stage = join(desktop, '.forge-stage')
const packageJson = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8'))
const desktopRequire = createRequire(join(desktop, 'package.json'))
const electronPackage = JSON.parse(await readFile(desktopRequire.resolve('electron/package.json'), 'utf8'))
const reactPackage = JSON.parse(await readFile(desktopRequire.resolve('react/package.json'), 'utf8'))
const reactDomPackage = JSON.parse(await readFile(desktopRequire.resolve('react-dom/package.json'), 'utf8'))

if (reactPackage.version !== reactDomPackage.version) {
  throw new Error(`React ${reactPackage.version} does not match React DOM ${reactDomPackage.version}`)
}

await rm(stage, { recursive: true, force: true })
await mkdir(join(stage, 'dist-electron'), { recursive: true })
await cp(join(desktop, 'dist'), join(stage, 'dist'), { recursive: true })
await cp(join(desktop, 'assets'), join(stage, 'assets'), { recursive: true })

for (const name of await readdir(join(desktop, 'dist-electron'))) {
  if (name.endsWith('.js') && !name.endsWith('.test.js')) {
    await cp(join(desktop, 'dist-electron', name), join(stage, 'dist-electron', name))
  }
}

await writeFile(join(stage, 'package.json'), JSON.stringify({
  name: 'copyrade',
  productName: 'Copyrade',
  version: packageJson.version,
  description: 'Copyrade Windows clipboard receiver',
  author: 'Abdullah Ijaz',
  license: 'Apache-2.0',
  main: 'dist-electron/main.js',
  devDependencies: {
    electron: electronPackage.version,
    '@electron-forge/cli': '8.0.1',
    '@electron-forge/maker-squirrel': '8.0.1',
  },
  config: { forge: 'forge.config.cjs' },
}, null, 2) + '\n')

await writeFile(join(stage, 'forge.config.cjs'), `const path = require('node:path')
module.exports = {
  outDir: path.resolve(__dirname, '..', '..', '..', 'out'),
  packagerConfig: {
    name: 'Copyrade',
    executableName: 'Copyrade',
    icon: path.join(__dirname, 'assets', 'copyrade'),
    asar: true,
    prune: false,
    ignore: [/^\\/forge\\.config\\.cjs$/],
    download: { cacheRoot: path.resolve(__dirname, '..', '..', '..', '.cache', 'electron') },
  },
  makers: [{
    name: path.resolve(__dirname, '..', '..', '..', 'node_modules', '@electron-forge', 'maker-squirrel', 'dist', 'MakerSquirrel.js'),
    config: {
      name: 'Copyrade',
      setupIcon: path.join(__dirname, 'assets', 'copyrade.ico'),
    },
  }],
}\n`)

console.log(`Staged Copyrade ${packageJson.version} at ${stage}`)
