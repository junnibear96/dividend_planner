
import { createClient } from 'redis';
import 'dotenv/config'

async function main() {
    console.log('Clearing FBY cache...');
    const client = createClient({
        url: process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379'
    });

    await client.connect();

    // The key format is stock:{symbol}:{limit} or similar
    // List all keys to debug
    const allKeys = await client.keys('*');
    console.log('All Keys in Redis:', allKeys);

    // Flush everything to be safe
    console.log('Flushing all keys...');
    await client.flushAll();
    console.log('Flushed.');

    await client.quit();
}

main().catch(console.error);
