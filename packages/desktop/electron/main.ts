import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import { join } from 'path';
import { createMenu } from './menu';
import { registerFsHandlers } from './ipc/fs.handler';
import { registerGitHandlers } from './ipc/git.handler';
import { startPolling, stopPolling } from './core/git.service';
import { initBackend } from './core/backend';
import { startHttpServer } from './core/http-server';

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in main process:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in main process:', reason);
});

let mainWindow: BrowserWindow | null = null;
let currentWorkspaceCwd: string = process.cwd();

function createWindow(apiPort: number): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: '#1a1a1a',
            symbolColor: '#858585',
          },
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?apiPort=${apiPort}`);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { apiPort: String(apiPort) },
    });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    stopPolling();
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  return win;
}

app.whenReady().then(async () => {
  await initBackend();

  const apiPort = await startHttpServer();

  mainWindow = createWindow(apiPort);

  createMenu(mainWindow);

  ipcMain.handle('ping', () => 'pong');

  ipcMain.handle('project:openFolderDialog', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // Renderer notifies main process of workspace cwd changes
  ipcMain.on('workspace:setCwd', (_e, cwd: string) => {
    currentWorkspaceCwd = cwd;
  });

  registerFsHandlers();
  registerGitHandlers();

  // Git polling uses the workspace cwd from renderer
  startPolling(mainWindow, () => currentWorkspaceCwd);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(apiPort);
    }
  });
});

app.on('window-all-closed', () => {
  stopPolling();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
