import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

type PortConfig = { agentPort: number; clientPort: number; adminPort: number }

let cachedConfig: PortConfig | null = null

function readPortConfig(): PortConfig {
  if (cachedConfig) return cachedConfig
  try {
    const raw = readFileSync('../backend/.port', 'utf-8').trim()
    if (raw.startsWith('{')) {
      cachedConfig = JSON.parse(raw)
      return cachedConfig!
    }
    const port = parseInt(raw, 10)
    cachedConfig = { agentPort: port, clientPort: port, adminPort: port + 1 }
    return cachedConfig
  } catch {
    return { agentPort: 3100, clientPort: 3100, adminPort: 3101 }
  }
}

export default defineConfig({
  build: {
    target: 'es2023',
  },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${readPortConfig().agentPort}`,
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('error', () => {
            // Suppress proxy errors (backend may be restarting with --watch)
          })
        },
        router: () => `http://localhost:${readPortConfig().agentPort}`,
      },
      '/ws': {
        target: `ws://localhost:${readPortConfig().clientPort}`,
        ws: true,
        router: () => `ws://localhost:${readPortConfig().clientPort}`,
      },
    },
  },
})
