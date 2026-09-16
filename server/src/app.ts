import express from 'express';
import cors from 'cors';
import { logger, LogChannel } from './logger';
import { isRedisConnected } from './redis';
import { redisState } from './redisState';
import { validateOrigin } from './utils';
import crypto from 'crypto';


// CONFIGURE AND EXPORT EXPRESS APPLICATION
export function createApp(getLocalOnlineCount: () => number) {
  const app = express();

  app.use(cors({
    origin: validateOrigin,
    methods: ['GET', 'POST'],
  }));

  app.get('/ice', (req, res) => {
    const origin = req.headers.origin;
    if (origin) {
      let blocked = false;
      validateOrigin(origin, (err) => { if (err) blocked = true; });
      if (blocked) {
        logger.warn(LogChannel.CORS, 'ICE endpoint blocked for origin', { origin });
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    logger.debug(LogChannel.SERVER, 'ICE servers endpoint called');
    
    const servers: any[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    let turnUrl  = process.env.TURN_URL?.trim().replace(/^[`'"]|[`'"]$/g, '');
    const turnSecret = process.env.TURN_SECRET || process.env.TURN_CREDENTIAL;

    if (turnUrl && turnSecret) {
      if (turnUrl.startsWith('http')) {
        const urlObj = new URL(turnUrl);
        const hostPort = urlObj.host; 
        turnUrl = `turn:${hostPort}`;
        logger.info(LogChannel.SERVER, 'Sanitized TURN_URL from HTTP to TURN protocol', { original: process.env.TURN_URL, sanitized: turnUrl });
      }

      // Generate ephemeral credentials valid for 24 hours
      const unixTimeStamp = Math.floor(Date.now() / 1000) + 24 * 3600;
      const turnUsername = [unixTimeStamp, 'cosmogle'].join(':');
      
      const hmac = crypto.createHmac('sha1', turnSecret);
      hmac.setEncoding('base64');
      hmac.write(turnUsername);
      hmac.end();
      const turnCredential = hmac.read();

      servers.push({ urls: turnUrl, username: turnUsername, credential: turnCredential });
      servers.push({ urls: `${turnUrl}?transport=tcp`, username: turnUsername, credential: turnCredential });
      
      logger.debug(LogChannel.SERVER, 'TURN servers configured with ephemeral credentials', { count: servers.length });
    }

    res.json({ servers });
  });

  app.get('/health', async (_req, res) => {
    const redisStatus = isRedisConnected();
    let onlineCount = getLocalOnlineCount();
    
    if (redisStatus) {
      onlineCount = await redisState.getActiveSocketCount() || onlineCount;
    }
    
    logger.debug(LogChannel.SERVER, 'Health check', { 
      uptime: process.uptime(),
      redis: redisStatus ? 'connected' : 'disconnected',
      online: onlineCount
    });
    
    res.json({ 
      status: 'ok', 
      uptime: process.uptime(),
      redis: redisStatus ? 'connected' : 'disconnected',
      online: onlineCount
    });
  });

  return app;
}
