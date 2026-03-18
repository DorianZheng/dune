import * as net from 'net'

export function findFreePort(startPort: number, maxAttempts = 100): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0

    function tryPort(port: number) {
      if (attempt >= maxAttempts) {
        reject(new Error(`Could not find a free port after ${maxAttempts} attempts (tried ${startPort}-${startPort + maxAttempts - 1})`))
        return
      }

      attempt++
      const server = net.createServer()

      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          tryPort(port + 1)
        } else {
          reject(err)
        }
      })

      server.once('listening', () => {
        server.close(() => resolve(port))
      })

      server.listen(port, '127.0.0.1')
    }

    tryPort(startPort)
  })
}
