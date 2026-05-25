import { _electron as electron } from 'playwright-core'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..')
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(APP_DIR, 'out', 'shots')
fs.mkdirSync(SHOT_DIR, { recursive: true })

const electronBin = process.platform === 'win32'
  ? path.join(APP_DIR, '..', '..', 'node_modules', 'electron', 'dist', 'electron.exe')
  : process.platform === 'darwin'
    ? path.join(APP_DIR, '..', '..', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : path.join(APP_DIR, '..', '..', 'node_modules', 'electron', 'dist', 'electron')

const mainScript = path.join(APP_DIR, 'out', 'main', 'main.js')

console.log('Launching Electron from:', APP_DIR)
console.log('Electron binary:', electronBin)
console.log('Main script:', mainScript)

const { ELECTRON_RUN_AS_NODE: _removed, ...cleanEnv } = process.env

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_DIR],
  env: cleanEnv,
  timeout: 30_000,
})

console.log('Launched, waiting for window...')
await new Promise(r => setTimeout(r, 5_000))

const windows = app.windows()
console.log('Windows:', windows.length)
for (const w of windows) console.log(' -', w.url())

const page = windows.find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow()

// Take screenshot to verify UI
const shot1 = path.join(SHOT_DIR, '01-agent-mode.png')
await page.screenshot({ path: shot1 })
console.log('Screenshot (Agent mode):', shot1)

// Check page content
const bodyText = await page.evaluate(() => document.body.innerText)
console.log('Page text:', bodyText.slice(0, 200))

// Click the mode switch button
const switchResult = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const btn = btns.find(b => b.textContent?.includes('IDE'))
  if (!btn) return 'NOT_FOUND'
  btn.click()
  return 'CLICKED: ' + btn.textContent?.trim()
})
console.log('Switch button:', switchResult)

await new Promise(r => setTimeout(r, 500))
const shot2 = path.join(SHOT_DIR, '02-ide-mode.png')
await page.screenshot({ path: shot2 })
console.log('Screenshot (IDE mode):', shot2)

// Verify mode switched
const bodyText2 = await page.evaluate(() => document.body.innerText)
console.log('Page text after switch:', bodyText2.slice(0, 200))

// Test IPC ping
const pingResult = await page.evaluate(() => {
  return window.electronAPI?.ping?.()
})
console.log('IPC ping result:', pingResult)

await app.close()
console.log('DONE — all checks passed')
