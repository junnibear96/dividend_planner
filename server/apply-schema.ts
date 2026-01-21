
import 'dotenv/config';
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? '3306'),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        multipleStatements: true, // Enable multiple statements
    });

    try {
        const schemaPath = path.join(process.cwd(), 'server', 'schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        console.log('Applying schema...');
        await pool.query(schemaSql);
        console.log('Schema applied successfully.');

    } catch (err) {
        console.error('Failed to apply schema:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
