import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

function getBackendPort(): number {
  try {
    const port = readFileSync('../backend/.port', 'utf-8').trim()
    return parseInt(port, 10)
  } catch {
    return 3100
  }
}

export default defineConfig({
  build: {
    target: 'es2023',
  },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${getBackendPort()}`,
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.error('[vite proxy error]', err.message)
            if (res && 'writeHead' in res) {
              ;(res as any).writeHead(502, { 'Content-Type': 'text/plain' })
              ;(res as any).end(`Proxy error: ${err.message}`)
            }
          })
        },
        router: () => `http://localhost:${getBackendPort()}`,
      },
      '/ws': {
        target: `ws://localhost:${getBackendPort()}`,
        ws: true,
        router: () => `ws://localhost:${getBackendPort()}`,
      },
    },
  },
})
