import express from 'express';
import path from 'path';
import dotenv from 'dotenv';

// Load env from server/.env (works when running from dist/ or src/)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import { handelStart, handelDisconnect, getType, removeFromWaitingQueue, markRoomAsWaiting } from './lib';
import { GetTypesResult, room } from './types';

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
app.use(cors({
  origin: (origin, callback) => {
    const allowedClean = (allowedOrigins || []).map(s => s.trim()).filter(Boolean);
    // Log for debugging during development
    console.log('[CORS] request origin =', origin, 'allowed =', allowedClean);
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    // Allow explicit allowed origins or any app.github.dev preview origin for this dev environment
    if (allowedClean.indexOf(origin) !== -1 || origin.endsWith('.app.github.dev')) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
}));

// Endpoint to return ICE servers (STUN/TURN) configured via environment
app.get('/ice', (req, res) => {
  const servers: any[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  const turnUrl      = process.env.TURN_URL;
  const turnUser     = process.env.TURN_USERNAME;
  const turnCred     = process.env.TURN_CREDENTIAL;

  if (turnUrl && turnUser && turnCred) {
    // Extraer host del TURN_URL (ej: "turn:openrelay.metered.ca:80" → "openrelay.metered.ca")
    const hostMatch = turnUrl.match(/turn:([^:]+)/);
    const host = hostMatch ? hostMatch[1] : null;

    if (host) {
      // Múltiples puertos para mayor compatibilidad con firewalls
      servers.push({ urls: `turn:${host}:80`,                    username: turnUser, credential: turnCred });
      servers.push({ urls: `turn:${host}:443`,                   username: turnUser, credential: turnCred });
      servers.push({ urls: `turn:${host}:443?transport=tcp`,     username: turnUser, credential: turnCred });
    } else {
      servers.push({ urls: turnUrl, username: turnUser, credential: turnCred });
    }
  }

  console.log('[ICE] returning ICE servers:', servers);
  res.json({ servers });
});

const server = app.listen(8000, () => console.log('Server is up, 8000'));
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 10000,
  pingInterval: 5000,
});

const activeSockets: Set<string> = new Set();
let roomArr: room[] = [];

io.on('connection', (socket: Socket) => {
  activeSockets.add(socket.id);
  console.log('[SERVER] emit online ->', activeSockets.size);
  io.emit('online', activeSockets.size);
  console.log('[SERVER] New socket connected:', socket.id);

  // START (client may provide a persistent clientId to allow reconnection)
  socket.on('start', (clientIdOrCb?: any, cb?: (person: string) => void) => {
    try {
      console.log('[SERVER] start event from', socket.id, 'args:', clientIdOrCb ? '[clientId]' : '[cb]');
      // Allow both signatures: (cb) or (clientId, cb)
      if (typeof clientIdOrCb === 'function') {
        // old signature
        handelStart(roomArr, socket, undefined, clientIdOrCb, io);
      } else if (typeof cb === 'function') {
        handelStart(roomArr, socket, clientIdOrCb, cb, io);
      } else {
        console.warn('Client emitted start without callback');
        console.log('[SERVER] emit error -> Missing callback for start event to', socket.id);
        socket.emit('error', { message: 'Missing callback for start event' });
      }
    } catch (error) {
      console.error('Error in start handler:', error);
    }
  });

// DISCONNECT (unexpected network disconnect)
socket.on('disconnect', () => {
  handelDisconnect(socket.id, roomArr, io, false);
  removeFromWaitingQueue(socket.id);
  if (activeSockets.has(socket.id)) activeSockets.delete(socket.id);
  console.log('[SERVER] emit online ->', activeSockets.size);
  io.emit('online', activeSockets.size);
});

// DISCONNECT-ME
socket.on('disconnect-me', (cb?: Function) => {
    try {
      // Explicit client-initiated exit: force immediate cleanup so resources
      // are not held and the user won't be rematched with stale entries.
      handelDisconnect(socket.id, roomArr, io, true);
      removeFromWaitingQueue(socket.id);
      if (activeSockets.has(socket.id)) activeSockets.delete(socket.id);
      console.log('[SERVER] emit online ->', activeSockets.size);
      io.emit('online', activeSockets.size);
      // Acknowledge the client that disconnect handling is done
      if (typeof cb === 'function') {
        try { cb(); } catch (e) {}
      }
      // Also emit a named confirmation for clients that listen for it
      try { socket.emit('disconnect-confirm'); } catch (e) {}
    } catch (err) {
      console.error('Error handling disconnect-me:', err);
      if (typeof cb === 'function') {
        try { cb(err); } catch (e) {}
      }
    }
});

  // NEXT
  socket.on('next', () => {
    try {
      const room = roomArr.find(r => r.p1.id === socket.id || r.p2.id === socket.id);
      
      if (room && (room.p1.id && room.p2.id)) {
        // El otro usuario queda esperando
        const partnerId = room.p1.id === socket.id ? room.p2.id : room.p1.id;
        handelDisconnect(socket.id, roomArr, io);
        // Marcar la sala del partner como having waiting
        if (partnerId) {
          markRoomAsWaiting(roomArr, partnerId);
        }
        handelStart(roomArr, socket, undefined, (person: string) => {
          if (socket.connected) {
              console.log('[SERVER] emit start ->', person, 'to', socket.id);
              socket.emit('start', person);
            }
        }, io);
      } else {
          try {
            console.log('[SERVER] next requested by', socket.id);
            try { handelDisconnect(socket.id, roomArr, io); } catch (e) { console.warn('[SERVER] handelDisconnect failed in next', e); }
            handelStart(roomArr, socket, undefined, (person: string) => {
              if (socket.connected) {
                console.log('[SERVER] emit start ->', person, 'to', socket.id, 'after next');
                socket.emit('start', person);
              }
            }, io);
          } catch (error) {
            console.error('Error in next handler:', error);
            socket.emit('error', { message: 'Internal server error in next' });
          }
      }
    } catch (error) {
      console.error('Error in leave handler:', error);
    }
  });

// ICE CANDIDATE
socket.on('ice:send', (data: { candidate: any }) => {
  try {
    // Validar que candidate sea un objeto válido
    if (!data || !data.candidate || typeof data.candidate !== 'object') {
      socket.emit('error', { message: 'Invalid ICE candidate data' });
      return;
    }
    
    const type: GetTypesResult = getType(socket.id, roomArr);
    if (type && 'type' in type) {
      const target = type.type === 'p1' ? type.p2id : type.p1id;
      console.log(`[SOCKET] ICE from ${socket.id} -> ${target}`);
      if (target) { console.log('[SERVER] emit ice:reply -> to', target); io.to(target).emit('ice:reply', { candidate: data.candidate, from: socket.id }); }
    }
  } catch (error) {
    console.error('Error in ice:send handler:', error);
    socket.emit('error', { message: 'Internal server error' });
  }
});

// SDP
socket.on('sdp:send', (data: { sdp: any }) => {
  try {
    // Validar que sdp sea un objeto válido con type y sdp
    if (!data || !data.sdp || typeof data.sdp !== 'object' || !data.sdp.type) {
      socket.emit('error', { message: 'Invalid SDP data' });
      return;
    }
    
    const type = getType(socket.id, roomArr);
    if (type && 'type' in type) {
      const target = type.type === 'p1' ? type.p2id : type.p1id;
      console.log(`[SOCKET] SDP (${data.sdp?.type}) from ${socket.id} -> ${target}`);
      if (target) { console.log('[SERVER] emit sdp:reply -> to', target, 'type', data.sdp?.type); io.to(target).emit('sdp:reply', { sdp: data.sdp, from: socket.id }); }
    }
  } catch (error) {
    console.error('Error in sdp:send handler:', error);
    socket.emit('error', { message: 'Internal server error' });
  }
});

  // CHAT
  socket.on('send-message', (input: string, userType: string, roomid: string) => {
    try {
      if (typeof input === 'string' && typeof roomid === 'string') {
        const prefix = userType === 'p1' ? 'You: ' : 'Stranger: ';
        console.log('[SERVER] emit get-message -> to room', roomid);
        socket.to(roomid).emit('get-message', input, prefix);
      }
    } catch (error) {
      console.error('Error in send-message handler:', error);
    }
  });

  // TYPING
  socket.on('typing', ({ roomid, isTyping }: { roomid: string; isTyping: boolean }) => {
    try {
      if (typeof roomid === 'string') {
        console.log('[SERVER] emit typing -> to room', roomid, isTyping);
        socket.to(roomid).emit('typing', isTyping);
      }
    } catch (error) {
      console.error('Error in typing handler:', error);
    }
  });

  // RECONNECT
  socket.on('reconnect', (attemptNumber: number) => {
    console.log(`[SERVER] client ${socket.id} reconnected after ${attemptNumber} attempts`);
    console.log('[SERVER] emit reconnected ->', socket.id);
    socket.emit('reconnected');
  });

  // RENEGOTIATE - forward to partner to coordinate adding/removing tracks
  socket.on('renegotiate', () => {
    try {
      const type = getType(socket.id, roomArr);
      if (type && 'type' in type) {
        const targetId = type.type === 'p1' ? type.p2id : type.p1id;
        if (targetId) { console.log('[SERVER] emit renegotiate -> to', targetId); io.to(targetId).emit('renegotiate', { from: socket.id }); }
      }
    } catch (error) {
      console.error('Error in renegotiate handler:', error);
    }
  });

  // Verificar el estado de la sala antes de proceder con el "Next"
  socket.on('check-room-status', (roomid: string, callback: (status: string) => void) => {
    try {
      const room = roomArr.find(r => r.roomid === roomid);

      if (room && room.p1.id && room.p2.id) {
        callback('ready');
      } else {
        callback('not_ready');
      }
    } catch (error) {
      console.error('Error checking room status:', error);
      callback('not_ready');
    }
  });
});
