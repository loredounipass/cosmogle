import Redis from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';
import { logger, LogChannel } from './logger';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_DB = parseInt(process.env.REDIS_DB || '0');


// CREATE REDIS CLIENT WITH RETRY AND RECONNECT STRATEGY
export const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  db: REDIS_DB,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => {
    if (times > 3) {
      logger.warn(LogChannel.REDIS, 'Connection failed, running in-memory fallback');
      return null;
    }
    return Math.min(times * 200, 2000);
  },
  reconnectOnError: (err: Error) => {
    logger.logError(LogChannel.REDIS, 'Reconnect on error', err);
    return true;
  },
});

redis.on('connect', () => {
  logger.info(LogChannel.REDIS, `Connected to ${REDIS_HOST}:${REDIS_PORT}`);
});

redis.on('ready', () => {
  logger.info(LogChannel.REDIS, 'Redis ready for commands');
});

redis.on('error', (err) => {
  logger.logError(LogChannel.REDIS, 'Redis error', err);
});

redis.on('close', () => {
  logger.warn(LogChannel.REDIS, 'Redis connection closed');
});

redis.on('reconnecting', () => {
  logger.info(LogChannel.REDIS, 'Reconnecting to Redis...');
});


// CHECK IF REDIS CONNECTION IS READY
export const isRedisConnected = (): boolean => {
  return redis.status === 'ready';
};


// WAIT FOR REDIS TO BECOME READY WITH TIMEOUT
export const waitForRedis = async (timeout = 5000): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (redis.status === 'ready') {
      logger.info(LogChannel.REDIS, 'Redis connection established');
      return true;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  logger.warn(LogChannel.REDIS, `Redis connection timeout after ${timeout}ms`);
  return false;
};


// EXECUTE A REDIS OPERATION WITH IN-MEMORY FALLBACK
export const withFallback = async <T>(
  redisFn: () => Promise<T>,
  fallbackFn: () => T,
  key: string
): Promise<T> => {
  try {
    if (isRedisConnected()) {
      return await redisFn();
    }
  } catch (err) {
    logger.warn(LogChannel.REDIS, `Failed for key ${key}, using fallback`, { error: String(err) });
  }
  return fallbackFn();
};


// LOG A REDIS OPERATION RESULT FOR DEBUGGING
export const logRedisOperation = (operation: string, key: string, success: boolean, details?: any) => {
  if (success) {
    logger.debug(LogChannel.REDIS, `Operation ${operation} success`, { key, ...details });
  } else {
    logger.warn(LogChannel.REDIS, `Operation ${operation} failed`, { key, ...details });
  }
};
