import { ipcMain } from 'electron'
import { resolve } from 'path'
import { readFile, writeFile, readDir, searchFiles, watchDir, unwatchDir } from '../core/file.service'
import { storeService } from '../core/store.service'

function assertSafe(targetPath: string, rootPath: string): void {
  if (!rootPath) return
  const resolved = resolve(targetPath)
  const root = resolve(rootPath)
  if (!resolved.startsWith(root + '\\') && !resolved.startsWith(root + '/') && resolved !== root) {
    throw new Error(`Access denied: path is outside workspace root`)
  }
}

export function registerFsHandlers(): void {
  ipcMain.handle('fs:readFile', (_e, path: string) => {
    const root = storeService.getWorkspace().rootPath
    assertSafe(path, root)
    return readFile(path)
  })

  ipcMain.handle('fs:writeFile', (_e, path: string, content: string) => {
    const root = storeService.getWorkspace().rootPath
    assertSafe(path, root)
    writeFile(path, content)
  })

  ipcMain.handle('fs:readDir', (_e, dir: string) => {
    return readDir(dir)
  })

  ipcMain.handle('fs:watch', (_e, dir: string) => {
    const { sender } = _e
    return watchDir(dir, (payload) => {
      if (!sender.isDestroyed()) sender.send('fs:change', payload)
    })
  })

  ipcMain.handle('fs:unwatch', (_e, watchId: string) => {
    unwatchDir(watchId)
  })

  ipcMain.handle('fs:index', (_e, query: string) => {
    const root = storeService.getWorkspace().rootPath
    if (!root) return []
    return searchFiles(query, root)
  })
}
