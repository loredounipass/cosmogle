import { Server, Socket } from 'socket.io';
import {
  handleStart,
  handleDisconnect,
  getType,
  removeFromWaitingQueue,
} from './lib';
import { redisState } from './redisState';
import { isRedisConnected } from './redis';
import { checkRateLimit } from './rateLimiter';
import { logger, LogChannel } from './logger';
import { validateOrigin, sanitizeMessage, getClientIp } from './utils';
import http from 'http';

const activeSockets = new Set<string>();


// GET LOCAL ACTIVE SOCKET COUNT
export function getLocalOnlineCount(): number {
  return activeSockets.size;
}


// INITIALIZE SOCKET.IO SERVER AND REGISTER ALL EVENT HANDLERS
export function setupSocket(server: http.Server) {
  const io = new Server(server, {
    cors: {
      origin: validateOrigin,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 15000,
    pingInterval: 5000,
  });


  // BROADCAST ONLINE USER COUNT TO ALL CONNECTED CLIENTS
  async function broadcastOnline() {
    let count = activeSockets.size;
    
    if (isRedisConnected()) {
      count = await redisState.getActiveSocketCount() || count;
    }
    
    io.emit('online', count);
    logger.debug(LogChannel.SERVER, 'Broadcast online count', { count });
  }

  io.on('connection', (socket: Socket) => {
    activeSockets.add(socket.id);
    
    logger.info(LogChannel.SOCKET, 'Client connected', {
      socketId: socket.id,
      totalConnections: activeSockets.size,
      ip: socket.handshake.address
    });
    
    if (isRedisConnected()) {
      redisState.addActiveSocket(socket.id);
    }
    
    broadcastOnline();


    // HANDLE START EVENT TO JOIN OR CREATE A ROOM
    socket.on('start', async (clientIdOrCb?: any, cb?: (person: string) => void) => {
      try {
        const rateLimit = await checkRateLimit(getClientIp(socket), 'start');
        
        if (!rateLimit.allowed) {
          logger.warn(LogChannel.RATE, 'Rate limit exceeded for start', {
            socketId: socket.id,
            retryAfter: rateLimit.retryAfter
          });
          socket.emit('error', { message: 'Rate limit exceeded', retryAfter: rateLimit.retryAfter });
          return;
        }

        const actualCb = typeof clientIdOrCb === 'function' ? clientIdOrCb : cb;
        const clientId = typeof clientIdOrCb === 'string' ? clientIdOrCb : undefined;

        if (typeof actualCb !== 'function') {
          logger.warn(LogChannel.SOCKET, 'Start event without callback', { socketId: socket.id });
          socket.emit('error', { message: 'Missing callback for start event' });
          return;
        }

        logger.info(LogChannel.SOCKET, 'Start event received', {
          socketId: socket.id,
          clientId,
          hasCallback: true
        });

        await handleStart(socket, clientId, actualCb, io);
      } catch (error) {
        logger.logError(LogChannel.SERVER, 'Error in start handler', error, { socketId: socket.id });
      }
    });


    // HANDLE NEXT EVENT TO DISCONNECT AND FIND A NEW PARTNER
    socket.on('next', async () => {
      try {
        const rateLimit = await checkRateLimit(getClientIp(socket), 'next');
        
        if (!rateLimit.allowed) {
          logger.warn(LogChannel.RATE, 'Rate limit exceeded for next', {
            socketId: socket.id,
            retryAfter: rateLimit.retryAfter
          });
          socket.emit('error', { message: 'Rate limit exceeded', retryAfter: rateLimit.retryAfter });
          return;
        }

        logger.info(LogChannel.SOCKET, 'Next event received', { socketId: socket.id });

        await handleDisconnect(socket.id, io, true);

        await handleStart(socket, undefined, (person: string) => {
          socket.emit('start', person);
          logger.info(LogChannel.SOCKET, 'Next -> assigned role', { socketId: socket.id, role: person });
        }, io);
      } catch (error) {
        logger.logError(LogChannel.SERVER, 'Error in next handler', error, { socketId: socket.id });
      }
    });


    // HANDLE SOCKET DISCONNECT AND CLEANUP RESOURCES
    socket.on('disconnect', async (reason) => {
      logger.info(LogChannel.SOCKET, 'Client disconnected', {
        socketId: socket.id,
        reason,
        totalConnections: activeSockets.size
      });
      
      await handleDisconnect(socket.id, io, false);
      removeFromWaitingQueue(socket.id);
      activeSockets.delete(socket.id);
      
      if (isRedisConnected()) {
        await redisState.removeActiveSocket(socket.id);
      }
      
      broadcastOnline();
    });


    // HANDLE EXPLICIT DISCONNECT REQUEST FROM CLIENT
    socket.on('disconnect-me', async (cb?: Function) => {
      try {
        logger.info(LogChannel.SOCKET, 'Explicit disconnect requested', { socketId: socket.id });
        
        await handleDisconnect(socket.id, io, true);
        removeFromWaitingQueue(socket.id);
        activeSockets.delete(socket.id);
        
        if (isRedisConnected()) {
          await redisState.removeActiveSocket(socket.id);
        }
        
        broadcastOnline();

        if (typeof cb === 'function') {
          try { cb(); } catch (e) { }
        }
        try { socket.emit('disconnect-confirm'); } catch (e) { }
      } catch (err) {
        logger.logError(LogChannel.SERVER, 'Error in disconnect-me handler', err, { socketId: socket.id });
        if (typeof cb === 'function') try { cb(err); } catch (e) { }
      }
    });


    // FORWARD SDP OFFER/ANSWER TO PEER
    socket.on('sdp:send', async (data: { sdp: any }) => {
      try {
        const rateLimit = await checkRateLimit(getClientIp(socket), 'sdp:send');
        
        if (!rateLimit.allowed) {
          logger.warn(LogChannel.RATE, 'Rate limit exceeded for sdp:send', { socketId: socket.id });
          socket.emit('error', { message: 'Rate limit exceeded' });
          return;
        }

        if (!data?.sdp?.type || typeof data.sdp.type !== 'string') {
          logger.warn(LogChannel.SDP, 'Invalid SDP data received', {
            socketId: socket.id,
            hasSdp: !!data?.sdp,
            hasType: !!data?.sdp?.type
          });
          socket.emit('error', { message: 'Invalid SDP data' });
          return;
        }

        const info = await getType(socket.id);
        if (!info) {
          logger.warn(LogChannel.SDP, 'No room found for SDP', { socketId: socket.id });
          return;
        }

        const targetId = info.partnerId;
        if (!targetId) {
          logger.warn(LogChannel.SDP, 'No partner for SDP', { socketId: socket.id });
          return;
        }

        logger.info(LogChannel.SDP, `SDP ${data.sdp.type} forwarded`, {
          socketId: socket.id,
          targetId,
          type: data.sdp.type
        });
        
        io.to(targetId).emit('sdp:reply', { sdp: data.sdp, from: socket.id });
      } catch (error) {
        logger.logError(LogChannel.SERVER, 'Error in sdp:send handler', error, { socketId: socket.id });
      }
    });


    // FORWARD ICE CANDIDATE TO PEER
    socket.on('ice:send', async (data: { candidate: any }) => {
      try {
        const rateLimit = await checkRateLimit(getClientIp(socket), 'ice:send');
        
        if (!rateLimit.allowed) {
          logger.warn(LogChannel.RATE, 'Rate limit exceeded for ice:send', { socketId: socket.id });
          return;
        }

        if (!data?.candidate || typeof data.candidate !== 'object') {
          logger.warn(LogChannel.ICE, 'Invalid ICE candidate received', { socketId: socket.id });
          socket.emit('error', { message: 'Invalid ICE candidate data' });
          return;
        }

        const info = await getType(socket.id);
        if (!info) {
          logger.debug(LogChannel.ICE, 'No room for ICE candidate', { socketId: socket.id });
          return;
        }

        const targetId = info.partnerId;
        if (!targetId) return;

        logger.debug(LogChannel.ICE, 'ICE candidate forwarded', { socketId: socket.id, targetId });
        io.to(targetId).emit('ice:reply', { candidate: data.candidate, from: socket.id });
      } catch (error) {
        logger.logError(LogChannel.SERVER, 'Error in ice:send handler', error, { socketId: socket.id });
      }
    });


    // HANDLE WEBRTC RENEGOTIATION REQUEST
    socket.on('renegotiate', async () => {
      try {
        const info = await getType(socket.id);
        if (!info) return;

        const targetId = info.partnerId;
        if (targetId) {
          logger.info(LogChannel.SDP, 'Renegotiation requested', { socketId: socket.id, targetId });
          io.to(targetId).emit('renegotiate', { from: socket.id });
        }
      } catch (error) {
        logger.logError(LogChannel.SERVER, 'Error in renegotiate handler', error, { socketId: socket.id });
      }
    });


    // BROADCAST MEDIA STATE CHANGES TO ROOM PARTNER
    socket.on('media:state', async (data: { cameraOff: boolean; muted: boolean; roomid: string; type: string }) => {
      try {
        const rateLimit = await checkRateLimit(getClientIp(socket), 'media:state');
        if (!rateLimit.allowed) return;

        if (!data?.roomid) {
          logger.warn(LogChannel.MEDIA, 'Media state without roomid', { socketId: socket.id });
          return;
        }
        
        const info = await getType(socket.id);
        if (!info || info.roomId !== data.roomid) {
          const actualRoomId = info && typeof info === 'object' ? info.roomId : null;
          logger.warn(LogChannel.MEDIA, 'Invalid roomid for media state', {
            socketId: socket.id,
            providedRoomId: data.roomid,
            actualRoomId
          });
          return;
        }

        logger.debug(LogChannel.MEDIA, 'Media state update', {
          socketId: socket.id,
          roomId: data.roomid,
          cameraOff: data.cameraOff,
          muted: data.muted
        });
        
        socket.to(data.roomid).emit('media:state', {
          cameraOff: Boolean(data.cameraOff),
          muted: Boolean(data.muted),
        });
      } catch (error) {
        logger.logError(LogChannel.SERVER, 'Error in media:state handler', error, { socketId: socket.id });
      }
    });


    // RECEIVE AND FORWARD CHAT MESSAGE TO ROOM PARTNER
    socket.on('send-message', async (input: string, _userType: string, roomid: string) => {
      try {
        const rateLimit = await checkRateLimit(getClientIp(socket), 'send-message');
        
        if (!rateLimit.allowed) {
          logger.warn(LogChannel.RATE, 'Rate limit exceeded for send-message', { socketId: socket.id });
          socket.emit('error', { message: 'Rate limit exceeded' });
          return;
        }

        if (typeof input !== 'string' || typeof roomid !== 'string') {
          logger.warn(LogChannel.CHAT, 'Invalid message data', { socketId: socket.id });
          return;
        }
        
        const info = await getType(socket.id);
        if (!info || info.roomId !== roomid) {
          const actualRoomId = info && typeof info === 'object' ? info.roomId : null;
          logger.warn(LogChannel.CHAT, 'Invalid roomid for message', {
            socketId: socket.id,
            providedRoomId: roomid,
            actualRoomId
          });
          return;
        }

        const sanitized = sanitizeMessage(input);
        
        logger.info(LogChannel.CHAT, 'Message sent', {
          socketId: socket.id,
          roomId: roomid,
          length: sanitized.length
        });
        
        socket.to(roomid).emit('get-message', sanitized);
      } catch (error) {
        logger.logError(LogChannel.SERVER, 'Error in send-message handler', error, { socketId: socket.id });
      }
    });


    // FORWARD TYPING STATUS TO ROOM PARTNER
    socket.on('typing', async ({ roomid, isTyping }: { roomid: string; isTyping: boolean }) => {
      try {
        const rateLimit = await checkRateLimit(getClientIp(socket), 'typing');
        if (!rateLimit.allowed) return;

        if (typeof roomid !== 'string') {
          logger.warn(LogChannel.CHAT, 'Invalid typing data', { socketId: socket.id });
          return;
        }
        
        const info = await getType(socket.id);
        if (!info || info.roomId !== roomid) {
          const actualRoomId = info && typeof info === 'object' ? info.roomId : null;
          logger.warn(LogChannel.CHAT, 'Invalid roomid for typing', {
            socketId: socket.id,
            providedRoomId: roomid,
            actualRoomId
          });
          return;
        }

        logger.debug(LogChannel.CHAT, 'Typing status', {
          socketId: socket.id,
          roomId: roomid,
          isTyping
        });
        
        socket.to(roomid).emit('typing', Boolean(isTyping));
      } catch (error) {
        logger.logError(LogChannel.SERVER, 'Error in typing handler', error, { socketId: socket.id });
      }
    });
  });


  // PERIODIC CLEANUP OF DEAD SOCKETS IN REDIS
  setInterval(async () => {
    if (isRedisConnected()) {
      const aliveSocketIds = new Set(io.sockets.sockets.keys());
      await redisState.pruneDeadSockets(aliveSocketIds);
    }
  }, 60_000);

  return io;
}
