import { ipcMain } from 'electron';
import { resolve } from 'path';
import {
  readFile,
  writeFile,
  readDir,
  searchFiles,
  watchDir,
  unwatchDir,
} from '../core/file.service';

function assertSafe(targetPath: string, rootPath: string): void {
  if (!rootPath) throw new Error('rootPath is required');
  const resolved = resolve(targetPath);
  const root = resolve(rootPath);
  if (!resolved.startsWith(root + '\\') && !resolved.startsWith(root + '/') && resolved !== root) {
    throw new Error(`Access denied: path is outside workspace root`);
  }
}

export function registerFsHandlers(): void {
  ipcMain.handle('fs:readFile', (_e, rootPath: string, path: string) => {
    assertSafe(path, rootPath);
    return readFile(path);
  });

  ipcMain.handle('fs:writeFile', (_e, rootPath: string, path: string, content: string) => {
    assertSafe(path, rootPath);
    writeFile(path, content);
  });

  ipcMain.handle('fs:readDir', (_e, rootPath: string, dir: string) => {
    return readDir(dir);
  });

  ipcMain.handle('fs:watch', (_e, rootPath: string, dir: string) => {
    const { sender } = _e;
    return watchDir(dir, (payload) => {
      if (!sender.isDestroyed()) sender.send('fs:change', payload);
    });
  });

  ipcMain.handle('fs:unwatch', (_e, watchId: string) => {
    unwatchDir(watchId);
  });

  ipcMain.handle('fs:index', (_e, rootPath: string, query: string) => {
    return searchFiles(query, rootPath);
  });
}
