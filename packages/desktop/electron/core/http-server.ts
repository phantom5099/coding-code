import { createServer, findAvailablePort } from '@codingcode/core'

export async function startHttpServer(): Promise<number> {
  const port = await findAvailablePort(8080)
  const app = await createServer()
  const { serve } = await import('@hono/node-server')
  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })
  return port
}
