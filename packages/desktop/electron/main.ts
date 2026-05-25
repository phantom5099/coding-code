import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { createMenu } from './menu'
import { registerAgentHandlers } from './ipc/agent.handler'
import { registerFsHandlers } from './ipc/fs.handler'
import { registerGitHandlers } from './ipc/git.handler'
import { registerSettingsHandlers } from './ipc/settings.handler'
import { startPolling } from './core/git.service'
import { storeService } from './core/store.service'
import { initBackend } from './core/backend'

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    ...(process.platform === 'win32' ? {
      titleBarOverlay: {
        color: '#1a1a1a',
        symbolColor: '#858585',
      },
    } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

app.whenReady().then(async () => {
  const workspace = storeService.getWorkspace()
  await initBackend(workspace.rootPath || process.cwd())

  mainWindow = createWindow()

  createMenu(mainWindow)

  ipcMain.handle('ping', () => 'pong')

  registerAgentHandlers(() => mainWindow)
  registerFsHandlers()
  registerGitHandlers()
  registerSettingsHandlers()

  startPolling(mainWindow, () => storeService.getWorkspace().rootPath || process.cwd())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
