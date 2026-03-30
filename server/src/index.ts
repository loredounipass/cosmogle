import express from 'express';
import path from 'path';
import dotenv from 'dotenv';

// Load env from server/.env
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import cors from 'cors';
import { Server, Socket } from 'socket.io';
import {
  handelStart,
  handelDisconnect,
  getType,
  removeFromWaitingQueue,
  markRoomAsWaiting,
} from './lib';
import type { Room } from './types';

// ============================================
// EXPRESS + CORS
// ============================================

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) || [];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, mobile)
    if (!origin) return callback(null, true);
    // Allow configured origins
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow any GitHub Codespaces or dev tunnel origin
    if (origin.endsWith('.app.github.dev') || origin.endsWith('.devtunnels.ms')) return callback(null, true);
    // Allow ngrok
    if (origin.endsWith('.ngrok-free.app') || origin.endsWith('.ngrok.io')) return callback(null, true);
    // Allow localhost
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return callback(null, true);

    console.warn('[CORS] Blocked:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
}));

// ============================================
// ICE SERVERS ENDPOINT
// ============================================

app.get('/ice', (_req, res) => {
  const servers: any[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const turnUrl  = process.env.TURN_URL;
  const turnUser = process.env.TURN_USERNAME;
  const turnCred = process.env.TURN_CREDENTIAL;

  if (turnUrl && turnUser && turnCred) {
    const hostMatch = turnUrl.match(/turn:([^:]+)/);
    const host = hostMatch ? hostMatch[1] : null;

    if (host) {
      servers.push({ urls: `turn:${host}:80`,                    username: turnUser, credential: turnCred });
      servers.push({ urls: `turn:${host}:443`,                   username: turnUser, credential: turnCred });
      servers.push({ urls: `turn:${host}:443?transport=tcp`,     username: turnUser, credential: turnCred });
    } else {
      servers.push({ urls: turnUrl, username: turnUser, credential: turnCred });
    }
  }

  res.json({ servers });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ============================================
// SOCKET.IO
// ============================================

const PORT = parseInt(process.env.PORT || '8000');
const server = app.listen(PORT, () => console.log(`[SERVER] Listening on port ${PORT}`));

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 15000,
  pingInterval: 5000,
});

const activeSockets = new Set<string>();

// roomArr ya no se usa internamente (lib.ts usa Map), pero lo pasamos
// por compatibilidad de firma.
const roomArr: Room[] = [];

function broadcastOnline() {
  io.emit('online', activeSockets.size);
}

// ============================================
// CONNECTION HANDLER
// ============================================

io.on('connection', (socket: Socket) => {
  activeSockets.add(socket.id);
  broadcastOnline();
  console.log(`[SERVER] Connected: ${socket.id} (online: ${activeSockets.size})`);

  // ---- START ----
  socket.on('start', (clientIdOrCb?: any, cb?: (person: string) => void) => {
    try {
      // Handle both signatures: (cb) or (clientId, cb)
      const actualCb = typeof clientIdOrCb === 'function' ? clientIdOrCb : cb;
      const clientId = typeof clientIdOrCb === 'string' ? clientIdOrCb : undefined;

      if (typeof actualCb !== 'function') {
        console.warn(`[SERVER] start from ${socket.id} without callback`);
        socket.emit('error', { message: 'Missing callback for start event' });
        return;
      }

      handelStart(roomArr, socket, clientId, actualCb, io);
    } catch (error) {
      console.error('[SERVER] Error in start handler:', error);
    }
  });

  // ---- NEXT ----
  socket.on('next', () => {
    try {
      console.log(`[SERVER] next from ${socket.id}`);

      // 1. Limpiar la room actual (el partner será notificado y puesto en waitingQueue)
      handelDisconnect(socket.id, roomArr, io, true);

      // 2. Buscar nueva pareja
      handelStart(roomArr, socket, undefined, (person: string) => {
        // El tipo ya se envía via callback al cliente
      }, io);
    } catch (error) {
      console.error('[SERVER] Error in next handler:', error);
    }
  });

  // ---- DISCONNECT (network) ----
  socket.on('disconnect', () => {
    console.log(`[SERVER] Disconnected (network): ${socket.id}`);
    handelDisconnect(socket.id, roomArr, io, false);
    removeFromWaitingQueue(socket.id);
    activeSockets.delete(socket.id);
    broadcastOnline();
  });

  // ---- DISCONNECT-ME (explicit exit) ----
  socket.on('disconnect-me', (cb?: Function) => {
    try {
      console.log(`[SERVER] disconnect-me from ${socket.id}`);
      handelDisconnect(socket.id, roomArr, io, true);
      removeFromWaitingQueue(socket.id);
      activeSockets.delete(socket.id);
      broadcastOnline();

      if (typeof cb === 'function') {
        try { cb(); } catch (e) { }
      }
      try { socket.emit('disconnect-confirm'); } catch (e) { }
    } catch (err) {
      console.error('[SERVER] Error in disconnect-me:', err);
      if (typeof cb === 'function') try { cb(err); } catch (e) { }
    }
  });

  // ---- SDP SIGNALING ----
  socket.on('sdp:send', (data: { sdp: any }) => {
    try {
      if (!data?.sdp?.type) {
        socket.emit('error', { message: 'Invalid SDP data' });
        return;
      }

      const info = getType(socket.id, roomArr);
      if (!info) {
        console.warn(`[SDP] No room found for ${socket.id}`);
        return;
      }

      const targetId = info.partnerId;
      if (!targetId) {
        console.warn(`[SDP] No partner for ${socket.id}`);
        return;
      }

      console.log(`[SDP] ${data.sdp.type} from ${socket.id} -> ${targetId}`);
      io.to(targetId).emit('sdp:reply', { sdp: data.sdp, from: socket.id });
    } catch (error) {
      console.error('[SERVER] Error in sdp:send:', error);
    }
  });

  // ---- ICE CANDIDATES ----
  socket.on('ice:send', (data: { candidate: any }) => {
    try {
      if (!data?.candidate || typeof data.candidate !== 'object') {
        socket.emit('error', { message: 'Invalid ICE candidate data' });
        return;
      }

      const info = getType(socket.id, roomArr);
      if (!info) return;

      const targetId = info.partnerId;
      if (!targetId) return;

      io.to(targetId).emit('ice:reply', { candidate: data.candidate, from: socket.id });
    } catch (error) {
      console.error('[SERVER] Error in ice:send:', error);
    }
  });

  // ---- RENEGOTIATE ----
  socket.on('renegotiate', () => {
    try {
      const info = getType(socket.id, roomArr);
      if (!info) return;

      const targetId = info.partnerId;
      if (targetId) {
        console.log(`[SERVER] renegotiate ${socket.id} -> ${targetId}`);
        io.to(targetId).emit('renegotiate', { from: socket.id });
      }
    } catch (error) {
      console.error('[SERVER] Error in renegotiate:', error);
    }
  });

  // ---- MEDIA STATE ----
  socket.on('media:state', (data: { cameraOff: boolean; muted: boolean; roomid: string; type: string }) => {
    try {
      if (!data?.roomid) return;
      socket.to(data.roomid).emit('media:state', {
        cameraOff: data.cameraOff,
        muted: data.muted,
      });
    } catch (error) {
      console.error('[SERVER] Error in media:state:', error);
    }
  });

  // ---- CHAT ----
  socket.on('send-message', (input: string, userType: string, roomid: string) => {
    try {
      if (typeof input === 'string' && typeof roomid === 'string') {
        socket.to(roomid).emit('get-message', input);
      }
    } catch (error) {
      console.error('[SERVER] Error in send-message:', error);
    }
  });

  // ---- TYPING ----
  socket.on('typing', ({ roomid, isTyping }: { roomid: string; isTyping: boolean }) => {
    try {
      if (typeof roomid === 'string') {
        socket.to(roomid).emit('typing', isTyping);
      }
    } catch (error) {
      console.error('[SERVER] Error in typing:', error);
    }
  });
});
