import { createServer as createNetServer } from 'net';

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        reject(err);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

export async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No available port in range [${startPort}, ${startPort + 100})`);
}
