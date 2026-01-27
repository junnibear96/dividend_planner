import 'dotenv/config'
import mysql from 'mysql2/promise'

function requireEnv(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required env var: ${name}`)
    return value
}

async function main() {
    const connection = await mysql.createConnection({
        host: requireEnv('DB_HOST'),
        port: Number(process.env.DB_PORT ?? '3306'),
        user: requireEnv('DB_USER'),
        password: process.env.DB_PASSWORD ?? '',
    })

    try {
        console.log('🔍 Finding tables on Railway MySQL server...\n')

        // Get all non-system databases
        const [databases] = await connection.query<mysql.RowDataPacket[]>(
            `SHOW DATABASES WHERE \`Database\` NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')`
        )

        console.log('User databases found:')
        for (const db of databases as unknown as Array<{ Database: string }>) {
            console.log(`  ✓ ${db.Database}`)
        }
        console.log('')

        // Check each database for our tables
        for (const db of databases as unknown as Array<{ Database: string }>) {
            const dbName = db.Database

            await connection.query(`USE \`${dbName}\``)

            const [tables] = await connection.query<mysql.RowDataPacket[]>(
                'SHOW TABLES'
            )

            const tableNames = (tables as any[]).map(t => Object.values(t)[0] as string)

            if (tableNames.length > 0) {
                console.log(`📁 Database: "${dbName}" has ${tableNames.length} tables:`)
                for (const tableName of tableNames) {
                    console.log(`    - ${tableName}`)
                }
                console.log('')
            } else {
                console.log(`📁 Database: "${dbName}" is empty`)
                console.log('')
            }
        }

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('💡 Railway 웹사이트에서 확인할 데이터베이스:')
        console.log(`   테이블이 있는 데이터베이스 이름을 위에서 확인하세요!`)
        console.log('')
        console.log('현재 .env 설정:')
        console.log(`   DB_DATABASE="${process.env.DB_DATABASE}"`)
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    } finally {
        await connection.end()
    }
}

main().catch((err) => {
    console.error('❌ Error:', err instanceof Error ? err.message : err)
    process.exitCode = 1
})
