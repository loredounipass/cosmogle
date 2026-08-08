import { Socket } from 'socket.io';
import { logger, LogChannel } from './logger';

export const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) || [];


// VALIDATE ORIGIN FOR EXPRESS AND SOCKET.IO
export function validateOrigin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void {
  if (!origin) {
    logger.debug(LogChannel.CORS, 'Request without origin, allowing', { origin });
    return callback(null, true);
  }

  if (allowedOrigins.includes(origin)) {
    logger.info(LogChannel.CORS, 'Origin allowed (configured)', { origin });
    return callback(null, true);
  }

  logger.warn(LogChannel.CORS, 'Origin blocked', { origin });
  return callback(new Error('Not allowed by CORS'));
}


// SANITIZE HTML ENTITIES FOR XSS PROTECTION
export function sanitizeMessage(input: string): string {
  return input
    .slice(0, 1000)
    .replace(/[<>&"'`]/g, (char) => {
      const map: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#x27;', '`': '&#x60;' };
      return map[char] || char;
    })
    .trim();
}


const TRUST_PROXY = process.env.TRUST_PROXY === 'true';


// EXTRACT CLIENT IP ADDRESS FOR RATE LIMITING
export function getClientIp(socket: Socket): string {
  if (TRUST_PROXY) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const realIp = forwarded.split(',')[0].trim();
      if (realIp) return realIp.replace(/^::ffff:/, '');
    }
  }
  
  const rawIp = socket.handshake.address || '';
  return rawIp.replace(/^::ffff:/, '');
}
