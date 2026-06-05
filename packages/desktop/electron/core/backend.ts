import { resolve } from 'path';
import { app } from 'electron';

let _ready = false;

function getInstallRoot(): string {
  return resolve(app.getAppPath(), '../../');
}

export async function initBackend(): Promise<void> {
  if (_ready) return;
  const { initWorkspace, loadConfig, ensureUserConfig, AppLayer } =
    await import('@codingcode/core');
  ensureUserConfig();
  const config = loadConfig();
  initWorkspace({ installRoot: getInstallRoot(), config });
  _ready = true;
}
