import { createClient } from 'redis'

// Redis client instance
let redisClient: ReturnType<typeof createClient> | null = null
let isConnected = false

/**
 * Initialize Redis connection
 */
export async function initRedis(): Promise<void> {
    const redisUrl = process.env.REDIS_PUBLIC_URL

    if (!redisUrl) {
        console.warn('⚠️  REDIS_PUBLIC_URL not configured. Redis caching disabled.')
        return
    }

    try {
        redisClient = createClient({ url: redisUrl })

        redisClient.on('error', (err) => {
            console.error('❌ Redis connection error:', err.message)
            isConnected = false
        })

        redisClient.on('connect', () => {
            console.log('🔄 Connecting to Redis...')
        })

        redisClient.on('ready', () => {
            console.log('✅ Redis connected and ready')
            isConnected = true
        })

        redisClient.on('end', () => {
            console.log('🔌 Redis connection closed')
            isConnected = false
        })

        await redisClient.connect()
    } catch (error) {
        console.error('❌ Failed to initialize Redis:', error)
        redisClient = null
        isConnected = false
    }
}

/**
 * Get Redis client (returns null if not connected)
 */
export function getRedisClient() {
    return isConnected && redisClient ? redisClient : null
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable(): boolean {
    return isConnected && redisClient !== null
}

/**
 * Get cached value from Redis
 */
export async function getCache<T>(key: string): Promise<T | null> {
    const client = getRedisClient()
    if (!client) return null

    try {
        const value = await client.get(key)
        if (!value) return null

        return JSON.parse(value) as T
    } catch (error) {
        console.error(`Redis GET error for key "${key}":`, error)
        return null
    }
}

/**
 * Set cached value in Redis with TTL
 * @param key Cache key
 * @param value Value to cache
 * @param ttlSeconds Time to live in seconds
 */
export async function setCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const client = getRedisClient()
    if (!client) return

    try {
        await client.setEx(key, ttlSeconds, JSON.stringify(value))
    } catch (error) {
        console.error(`Redis SET error for key "${key}":`, error)
    }
}

/**
 * Delete cached value from Redis
 */
export async function deleteCache(key: string): Promise<void> {
    const client = getRedisClient()
    if (!client) return

    try {
        await client.del(key)
    } catch (error) {
        console.error(`Redis DEL error for key "${key}":`, error)
    }
}

/**
 * Delete multiple cached values matching a pattern
 */
export async function deleteCachePattern(pattern: string): Promise<void> {
    const client = getRedisClient()
    if (!client) return

    try {
        const keys = await client.keys(pattern)
        if (keys.length > 0) {
            await client.del(keys)
            console.log(`🗑️  Deleted ${keys.length} cache entries matching: ${pattern}`)
        }
    } catch (error) {
        console.error(`Redis DEL pattern error for "${pattern}":`, error)
    }
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedis(): Promise<void> {
    if (redisClient) {
        try {
            await redisClient.quit()
            console.log('👋 Redis connection closed gracefully')
        } catch (error) {
            console.error('Error closing Redis connection:', error)
        }
        redisClient = null
        isConnected = false
    }
}
