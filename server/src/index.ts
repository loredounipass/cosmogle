import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { logger, LogChannel } from './logger';
import { redis, waitForRedis } from './redis';
import { createApp } from './app';
import { setupSocket, getLocalOnlineCount } from './socket';

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = parseInt(process.env.PORT || '8000');


// INITIALIZE REDIS CONNECTION WITH FALLBACK TO IN-MEMORY MODE
async function initializeRedis() {
  try {
    logger.info(LogChannel.REDIS, 'Attempting Redis connection', {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });
    await redis.connect();
    await waitForRedis(5000);
    logger.info(LogChannel.REDIS, 'Redis connection established');
  } catch (error) {
    logger.warn(LogChannel.REDIS, 'Redis connection failed, running in-memory mode', {
      error: error instanceof Error ? error.message : error
    });
  }
}

initializeRedis();


// CREATE EXPRESS APP AND START HTTP SERVER
const app = createApp(getLocalOnlineCount);
const server = app.listen(PORT, () => {
  logger.info(LogChannel.SERVER, `Server listening on port ${PORT}`, { 
    port: PORT,
    nodeEnv: NODE_ENV
  });
});


// ATTACH SOCKET.IO TO HTTP SERVER
setupSocket(server);


// HANDLE GRACEFUL SHUTDOWN ON SIGTERM
process.on('SIGTERM', async () => {
  logger.info(LogChannel.SERVER, 'SIGTERM received, shutting down');
  await redis.quit();
  process.exit(0);
});


// HANDLE GRACEFUL SHUTDOWN ON SIGINT
process.on('SIGINT', async () => {
  logger.info(LogChannel.SERVER, 'SIGINT received, shutting down');
  await redis.quit();
  process.exit(0);
});


// LOG UNCAUGHT EXCEPTIONS
process.on('uncaughtException', (error) => {
  logger.logError(LogChannel.SERVER, 'Uncaught exception', error);
});


// LOG UNHANDLED PROMISE REJECTIONS
process.on('unhandledRejection', (reason, promise) => {
  logger.error(LogChannel.SERVER, 'Unhandled rejection', { reason: String(reason), promise: String(promise) });
});

logger.info(LogChannel.SERVER, 'Server initialization complete', {
  port: PORT,
  nodeEnv: NODE_ENV,
  logLevel: process.env.LOG_LEVEL || 'INFO'
});
