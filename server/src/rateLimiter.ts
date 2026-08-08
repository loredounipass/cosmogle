import { redis, isRedisConnected, logRedisOperation } from './redis';
import { logger, LogChannel } from './logger';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '30');


// RATE LIMIT CHECK RESULT INTERFACE
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}


// GENERATE A REDIS KEY FOR RATE LIMITING
const getClientKey = (identifier: string, event: string): string => {
  return `ratelimit:${event}:${identifier}`;
};

const memoryLimits = new Map<string, { timestamps: number[] }>();


// PERIODIC CLEANUP OF EXPIRED IN-MEMORY RATE LIMIT ENTRIES
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of memoryLimits) {
    data.timestamps = data.timestamps.filter(t => t > now - RATE_LIMIT_WINDOW_MS);
    if (data.timestamps.length === 0) memoryLimits.delete(key);
  }
}, 60_000);


// CHECK RATE LIMIT USING REDIS OR IN-MEMORY FALLBACK
export const checkRateLimit = async (
  identifier: string,
  event: string,
  maxRequests = RATE_LIMIT_MAX_REQUESTS,
  windowMs = RATE_LIMIT_WINDOW_MS
): Promise<RateLimitResult> => {
  const key = getClientKey(identifier, event);
  const now = Date.now();
  const windowStart = now - windowMs;

  if (!isRedisConnected()) {
    let entry = memoryLimits.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      memoryLimits.set(key, entry);
    }
    entry.timestamps = entry.timestamps.filter(t => t > windowStart);
    entry.timestamps.push(now);

    const requestCount = entry.timestamps.length;
    if (requestCount > maxRequests) {
      const oldestTime = entry.timestamps[0];
      const retryAfter = Math.ceil((oldestTime + windowMs - now) / 1000);
      logger.warn(LogChannel.RATE, 'Rate limit exceeded (in-memory)', { identifier, event, current: requestCount, max: maxRequests });
      return { allowed: false, remaining: 0, resetTime: now + windowMs, retryAfter };
    }

    return { allowed: true, remaining: Math.max(0, maxRequests - requestCount), resetTime: now + windowMs };
  }

  try {
    const pipeline = redis.pipeline();
    
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now, `${now}`);
    pipeline.expire(key, Math.ceil(windowMs / 1000));
    pipeline.zcard(key);
    
    const results = await pipeline.exec();
    logRedisOperation('checkRateLimit', key, true, { event, identifier });
    
    if (!results) {
      return {
        allowed: true,
        remaining: maxRequests,
        resetTime: now + windowMs,
      };
    }

    const requestCount = results[3]?.[1] as number || 0;
    const allowed = requestCount <= maxRequests;
    const remaining = Math.max(0, maxRequests - requestCount);
    const resetTime = now + windowMs;

    if (!allowed) {
      const oldestRequest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const oldestTime = oldestRequest[1] ? parseInt(oldestRequest[1]) : now;
      const retryAfter = Math.ceil((oldestTime + windowMs - now) / 1000);
      
      logger.warn(LogChannel.RATE, 'Rate limit exceeded', {
        identifier,
        event,
        current: requestCount,
        max: maxRequests,
        retryAfter,
      });
      
      return {
        allowed: false,
        remaining: 0,
        resetTime,
        retryAfter,
      };
    }

    logger.debug(LogChannel.RATE, 'Rate limit check passed', {
      identifier,
      event,
      current: requestCount,
      remaining,
    });

    return {
      allowed: true,
      remaining,
      resetTime,
    };
  } catch (error) {
    logger.logError(LogChannel.RATE, 'Rate limit check failed', error, { identifier, event });
    logRedisOperation('checkRateLimit', key, false, { event, identifier, error: String(error) });
    return {
      allowed: true,
      remaining: maxRequests,
      resetTime: now + windowMs,
    };
  }
};


// CREATE A RATE LIMIT MIDDLEWARE FOR A SPECIFIC EVENT
export const rateLimitMiddleware = (
  event: string,
  maxRequests = RATE_LIMIT_MAX_REQUESTS,
  windowMs = RATE_LIMIT_WINDOW_MS
) => {
  return async (identifier: string): Promise<RateLimitResult> => {
    return checkRateLimit(identifier, event, maxRequests, windowMs);
  };
};


// RESET RATE LIMIT COUNTER FOR A SPECIFIC IDENTIFIER AND EVENT
export const resetRateLimit = async (identifier: string, event: string): Promise<void> => {
  const key = getClientKey(identifier, event);
  
  try {
    await redis.del(key);
    logRedisOperation('resetRateLimit', key, true, { event, identifier });
    logger.info(LogChannel.RATE, 'Rate limit reset', { identifier, event });
  } catch (error) {
    logger.logError(LogChannel.RATE, 'Failed to reset rate limit', error, { identifier, event });
    logRedisOperation('resetRateLimit', key, false, { event, identifier, error: String(error) });
  }
};


// GET CURRENT RATE LIMIT STATS FOR A SPECIFIC IDENTIFIER AND EVENT
export const getRateLimitStats = async (identifier: string, event: string): Promise<{
  current: number;
  max: number;
  remaining: number;
} | null> => {
  const key = getClientKey(identifier, event);
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  if (!isRedisConnected()) {
    return null;
  }

  try {
    await redis.zremrangebyscore(key, 0, windowStart);
    const current = await redis.zcard(key);
    
    logger.debug(LogChannel.RATE, 'Rate limit stats', {
      identifier,
      event,
      current,
      max: RATE_LIMIT_MAX_REQUESTS,
      remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - current),
    });
    
    return {
      current,
      max: RATE_LIMIT_MAX_REQUESTS,
      remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - current),
    };
  } catch (error) {
    logger.logError(LogChannel.RATE, 'Failed to get rate limit stats', error, { identifier, event });
    return null;
  }
};
