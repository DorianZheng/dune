import { getDb } from './storage/database.js'
import { resetAllStatuses } from './storage/agent-store.js'
import { reconcileSandboxesOnStartup } from './sandboxes/sandbox-manager.js'
import { startServer } from './server.js'

// Initialize database and reset agent statuses (containers are lost on restart)
getDb()
resetAllStatuses()
await reconcileSandboxesOnStartup()

// Start server
startServer()
