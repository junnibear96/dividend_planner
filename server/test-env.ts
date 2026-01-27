import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, '../.env')

console.log('--- Env Debug Script ---')
console.log(`Current directory: ${process.cwd()}`)
console.log(`__dirname: ${__dirname}`)
console.log(`Target .env path: ${envPath}`)

if (!fs.existsSync(envPath)) {
    console.error('❌ .env file NOT found at target path!')
} else {
    console.log('✅ .env file exists.')
    const content = fs.readFileSync(envPath, 'utf-8')
    console.log('--- File Content Preview (first 100 chars) ---')
    console.log(content.slice(0, 100))
    console.log('----------------------------------------------')
}

const result = dotenv.config({ path: envPath, debug: true })

if (result.error) {
    console.error('❌ dotenv config error:', result.error)
}

if (result.parsed) {
    console.log('✅ parsed keys:', Object.keys(result.parsed))
} else {
    console.log('⚠️ result.parsed is undefined or empty')
}

// Manually check what's in process.env
const dbHost = process.env.DB_HOST
console.log(`process.env.DB_HOST: ${dbHost}`)

if (dbHost) {
    console.log('✅ Success! DB_HOST is loaded.')
} else {
    console.log('❌ Failure! DB_HOST is missing.')
}
