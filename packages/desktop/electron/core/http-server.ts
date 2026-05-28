import { createServer as createHttpServer } from 'http'
import { createServer } from '@codingcode/core'

async function findPort(start: number): Promise<number> {
  let port = start
  while (port < start + 100) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = createHttpServer(() => {})
      s.on('error', () => { s.close(); resolve(false) })
      s.listen(port, '127.0.0.1', () => { s.close(); resolve(true) })
    })
    if (ok) return port
    port++
  }
  throw new Error('No available port found (8080-8179)')
}

export async function startHttpServer(): Promise<number> {
  const port = await findPort(8080)
  const app = await createServer()
  const { serve } = await import('@hono/node-server')
  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })
  return port
}
