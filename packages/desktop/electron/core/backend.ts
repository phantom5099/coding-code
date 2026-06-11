import { resolve } from 'path';
import { app } from 'electron';

let _ready = false;

function getInstallRoot(): string {
  return resolve(app.getAppPath(), '../../');
}

export async function initBackend(): Promise<void> {
  if (_ready) return;
  const { initWorkspace } = await import('@codingcode/core/core/workspace');
  const { loadConfig, ensureUserConfig } = await import('@codingcode/infra/config');
  const { AppLayer } = await import('@codingcode/core/layer');
  ensureUserConfig();
  const config = loadConfig();
  initWorkspace({ processRoot: getInstallRoot(), config });
  _ready = true;
}
