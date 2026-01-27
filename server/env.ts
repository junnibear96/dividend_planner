
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Always load the repo-root `.env` (even if the server is started from `server/`).
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, '../.env')

const result = dotenv.config({ path: envPath })

if (result.error) {
    console.error('[env] Failed to load .env file:', result.error)
}

// Export nothing, just ensure side effects run.
export { }
