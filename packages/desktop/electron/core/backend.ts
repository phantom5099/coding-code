import { resolve } from 'path'
import { app } from 'electron'

let _ready = false

function getInstallRoot(): string {
  return resolve(app.getAppPath(), '../../')
}

export async function initBackend(): Promise<void> {
  if (_ready) return
  const { initWorkspace, loadConfig, ensureUserConfig, bootstrapApplication, AppLayer } = await import('@codingcode/core')
  const { Effect } = await import('effect')
  ensureUserConfig()
  const config = loadConfig()
  initWorkspace({ installRoot: getInstallRoot(), config })
  await Effect.runPromise((bootstrapApplication(process.cwd()) as any).pipe(Effect.provide(AppLayer)))
  _ready = true
}
