import { spawn } from 'child_process'

// Remove ELECTRON_RUN_AS_NODE set by VS Code / Claude Code parent process
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env

const proc = spawn('npx', ['electron-vite', 'dev'], {
  env,
  stdio: 'inherit',
  shell: true,
})

proc.on('exit', (code) => process.exit(code ?? 0))
