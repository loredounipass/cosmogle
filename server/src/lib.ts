import { v4 as uuidv4 } from 'uuid';
import type { Server, Socket } from 'socket.io';
import type { Room, PeerRole, PeerInfo, GetTypesResult } from './types';
import { redisState } from './redisState';
import { isRedisConnected } from './redis';
import { logger, LogChannel } from './logger';

const useRedis = (): boolean => isRedisConnected();

const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, string>();
const waitingQueue: string[] = [];


// CHECK IF A SOCKET IS STILL CONNECTED
function isSocketAlive(io: Server, socketId: string): boolean {
  return io.sockets.sockets.has(socketId);
}


// REMOVE DEAD SOCKETS FROM THE WAITING QUEUE
function pruneWaitingQueue(io: Server): void {
  for (let i = waitingQueue.length - 1; i >= 0; i--) {
    if (!isSocketAlive(io, waitingQueue[i])) {
      const removed = waitingQueue[i];
      waitingQueue.splice(i, 1);
      logger.info(LogChannel.QUEUE, 'Pruned dead socket from waiting queue', { socketId: removed });
      
      if (useRedis()) {
        redisState.removeFromWaitingQueue(removed);
      }
    }
  }
}


// ADD A SOCKET TO THE WAITING QUEUE
function addToWaitingQueue(socketId: string): void {
  if (!waitingQueue.includes(socketId)) {
    waitingQueue.push(socketId);
    logger.info(LogChannel.QUEUE, `Added ${socketId} to waiting queue`, { queueSize: waitingQueue.length });
    
    if (useRedis()) {
      redisState.addToWaitingQueue(socketId);
    }
  }
}


// REMOVE A SOCKET FROM THE WAITING QUEUE
export function removeFromWaitingQueue(socketId: string): void {
  const idx = waitingQueue.indexOf(socketId);
  if (idx !== -1) {
    waitingQueue.splice(idx, 1);
    logger.info(LogChannel.QUEUE, `Removed ${socketId} from waiting queue`, { queueSize: waitingQueue.length });
  }
  
  if (useRedis()) {
    redisState.removeFromWaitingQueue(socketId);
  }
}


// TAKE THE NEXT AVAILABLE SOCKET FROM THE WAITING QUEUE
async function takeFromWaitingQueueAsync(io: Server, excludeId?: string): Promise<string | null> {
  if (useRedis()) {
    const taken = await redisState.takeFromWaitingQueue(excludeId);
    if (taken) {
      logger.info(LogChannel.QUEUE, 'Took socket from Redis queue', { taken, excluded: excludeId });
    }
    return taken;
  }
  
  pruneWaitingQueue(io);
  for (let i = 0; i < waitingQueue.length; i++) {
    const id = waitingQueue[i];
    if (id !== excludeId && isSocketAlive(io, id)) {
      waitingQueue.splice(i, 1);
      logger.info(LogChannel.QUEUE, 'Took socket from memory queue', { taken: id, excluded: excludeId });
      return id;
    }
  }
  return null;
}


// CREATE A NEW ROOM WITH A SINGLE PEER
function createRoom(socketId: string, clientId: string | null): Room {
  const roomId = uuidv4();
  const room: Room = {
    roomId,
    p1: { socketId, clientId },
    p2: null,
    createdAt: Date.now(),
  };
  rooms.set(roomId, room);
  socketToRoom.set(socketId, roomId);
  
  logger.info(LogChannel.ROOM, `Created room ${roomId}`, { 
    p1: socketId, 
    clientId,
    totalRooms: rooms.size 
  });
  
  if (useRedis()) {
    redisState.createRoom(roomId, socketId, clientId);
  }
  
  return room;
}


// DESTROY A ROOM AND CLEAN UP SOCKET MAPPINGS
async function destroyRoomAsync(roomId: string): Promise<void> {
  const room = rooms.get(roomId);
  if (!room) {
    logger.warn(LogChannel.ROOM, 'Room not found for destruction', { roomId });
    return;
  }

  if (room.p1) {
    socketToRoom.delete(room.p1.socketId);
    logger.debug(LogChannel.ROOM, 'Removed socket mapping', { socketId: room.p1.socketId, role: 'p1' });
  }
  if (room.p2) {
    socketToRoom.delete(room.p2.socketId);
    logger.debug(LogChannel.ROOM, 'Removed socket mapping', { socketId: room.p2.socketId, role: 'p2' });
  }
  rooms.delete(roomId);
  
  logger.info(LogChannel.ROOM, `Destroyed room ${roomId}`, { 
    hadP1: !!room.p1, 
    hadP2: !!room.p2,
    totalRooms: rooms.size 
  });
  
  if (useRedis()) {
    await redisState.destroyRoom(roomId);
  }
}


// FIND A ROOM BY SOCKET ID
async function getRoomBySocketAsync(socketId: string): Promise<Room | null> {
  if (useRedis()) {
    const room = await redisState.getRoomBySocket(socketId);
    if (room) {
      logger.debug(LogChannel.ROOM, 'Found room in Redis', { socketId, roomId: room.roomId });
    }
    return room;
  }
  
  const roomId = socketToRoom.get(socketId);
  if (!roomId) {
    logger.debug(LogChannel.ROOM, 'No room mapping for socket', { socketId });
    return null;
  }
  
  const room = rooms.get(roomId) || null;
  logger.debug(LogChannel.ROOM, 'Found room in memory', { socketId, roomId, found: !!room });
  return room;
}


// DETERMINE WHICH ROLE A SOCKET HAS IN A ROOM
function getRoleInRoom(socketId: string, room: Room): PeerRole | null {
  if (room.p1?.socketId === socketId) return 'p1';
  if (room.p2?.socketId === socketId) return 'p2';
  return null;
}


// GET THE PARTNER SOCKET ID IN A ROOM
function getPartnerInRoom(socketId: string, room: Room): string | null {
  if (room.p1?.socketId === socketId) return room.p2?.socketId || null;
  if (room.p2?.socketId === socketId) return room.p1?.socketId || null;
  return null;
}


// MATCH TWO PEERS INTO THE SAME ROOM
async function matchPeersAsync(
  io: Server,
  p1SocketId: string,
  p2Socket: Socket,
  p1ClientId: string | null,
  p2ClientId: string | null
): Promise<Room> {
  let room = await getRoomBySocketAsync(p1SocketId);

  if (!room) {
    logger.warn(LogChannel.MATCH, 'No existing room for p1, creating new', { p1: p1SocketId });
    room = createRoom(p1SocketId, p1ClientId);
    io.in(p1SocketId).socketsJoin(room.roomId);
  }

  room.p2 = { socketId: p2Socket.id, clientId: p2ClientId };
  socketToRoom.set(p2Socket.id, room.roomId);
  rooms.set(room.roomId, room);
  
  logger.info(LogChannel.MATCH, `Matched peers in room ${room.roomId}`, {
    p1: p1SocketId,
    p2: p2Socket.id,
    p1ClientId,
    p2ClientId
  });

  if (useRedis()) {
    await redisState.addPeerToRoom(room.roomId, p2Socket.id, p2ClientId, 'p2');
  }

  p2Socket.join(room.roomId);

  io.to(p1SocketId).emit('roomid', room.roomId);
  p2Socket.emit('roomid', room.roomId);

  io.to(p1SocketId).emit('remote-socket', p2Socket.id);
  p2Socket.emit('remote-socket', p1SocketId);

  io.to(p1SocketId).emit('start', 'p1');

  logger.info(LogChannel.MATCH, `Paired ${p1SocketId} (p1) <-> ${p2Socket.id} (p2)`, { roomId: room.roomId });
  
  return room;
}


// HANDLE START EVENT: FIND A MATCH OR CREATE A WAITING ROOM
export async function handleStart(
  socket: Socket,
  clientId: string | undefined,
  cb: (role: PeerRole) => void,
  io: Server
): Promise<void> {
  const cid = clientId || null;
  
  logger.info(LogChannel.SOCKET, 'Received start event', { 
    socketId: socket.id, 
    clientId: cid,
    hasRoom: !!socketToRoom.get(socket.id)
  });

  await cleanupSocketAsync(socket.id, io, true);

  let waitingId: string | null = null;
  let p1ClientId: string | null = null;

  do {
    waitingId = await takeFromWaitingQueueAsync(io, socket.id);
    if (!waitingId) break;
    
    const room = await getRoomBySocketAsync(waitingId);
    if (!room) {
      logger.warn(LogChannel.MATCH, 'Waiting socket room not found, skipping', { waitingSocket: waitingId });
      waitingId = null;
    } else {
      p1ClientId = room.p1?.clientId || null;
    }
  } while (!waitingId);

  if (waitingId) {
    logger.info(LogChannel.MATCH, 'Found match in queue', { 
      waitingSocket: waitingId, 
      newSocket: socket.id 
    });

    await matchPeersAsync(io, waitingId, socket, p1ClientId, cid);

    cb('p2');

    logger.info(LogChannel.MATCH, 'Match completed', { 
      p1: waitingId, 
      p2: socket.id,
      role: 'p2'
    });
  } else {
    const room = createRoom(socket.id, cid);
    socket.join(room.roomId);
    socket.emit('roomid', room.roomId);

    cb('p1');
    addToWaitingQueue(socket.id);

    logger.info(LogChannel.MATCH, 'Socket waiting for match', { 
      socketId: socket.id,
      roomId: room.roomId,
      role: 'p1',
      queueSize: waitingQueue.length
    });
  }
}


// HANDLE SOCKET DISCONNECT AND TRIGGER CLEANUP
export async function handleDisconnect(
  disconnectedId: string,
  io: Server,
  forceCleanup: boolean = false
): Promise<void> {
  logger.info(LogChannel.SOCKET, 'Processing disconnect', { 
    socketId: disconnectedId,
    forceCleanup 
  });
  
  await cleanupSocketAsync(disconnectedId, io, forceCleanup);
}


// CLEANUP SOCKET STATE: REMOVE FROM QUEUE, NOTIFY PARTNER, DESTROY ROOM
async function cleanupSocketAsync(socketId: string, io: Server, notifyPartner: boolean = true): Promise<void> {
  removeFromWaitingQueue(socketId);

  const room = await getRoomBySocketAsync(socketId);
  if (!room) {
    logger.debug(LogChannel.ROOM, 'No room found for disconnecting socket', { socketId });
    return;
  }

  const partnerId = getPartnerInRoom(socketId, room);

  if (notifyPartner && partnerId && isSocketAlive(io, partnerId)) {
    io.to(partnerId).emit('disconnected');
    logger.info(LogChannel.SOCKET, 'Notified partner of disconnect', { 
      disconnected: socketId,
      partner: partnerId 
    });
  }

  if (partnerId) {
    socketToRoom.delete(partnerId);
    logger.debug(LogChannel.ROOM, 'Cleared partner socket mapping', { partnerId });
  }

  await destroyRoomAsync(room.roomId);
}


// GET SOCKET ROLE, PARTNER ID, AND ROOM ID
export async function getType(socketId: string): Promise<GetTypesResult> {
  const room = await getRoomBySocketAsync(socketId);
  if (!room) {
    logger.debug(LogChannel.ROOM, 'getType: No room found', { socketId });
    return false;
  }

  const role = getRoleInRoom(socketId, room);
  if (!role) {
    logger.warn(LogChannel.ROOM, 'getType: Socket not in room', { socketId, roomId: room.roomId });
    return false;
  }

  const partnerId = getPartnerInRoom(socketId, room);
  
  logger.debug(LogChannel.ROOM, 'getType result', { 
    socketId, 
    roomId: room.roomId, 
    role, 
    partnerId 
  });
  
  return { type: role, partnerId, roomId: room.roomId };
}


// ADD SOCKET BACK TO THE WAITING QUEUE
export function markRoomAsWaiting(socketId: string): void {
  addToWaitingQueue(socketId);
}


// PERIODIC CLEANUP OF ZOMBIE ROOMS
setInterval(async () => {
  const now = Date.now();
  let roomsChecked = 0;
  let roomsDestroyed = 0;
  
  if (useRedis()) {
    const stats = await redisState.cleanZombieRooms();
    roomsChecked += stats.checked;
    roomsDestroyed += stats.destroyed;
  } else {
    const toDestroy: string[] = [];
    for (const [roomId, room] of rooms) {
      roomsChecked++;
      const hasP1 = room.p1 !== null;
      const hasP2 = room.p2 !== null;

      if (!hasP1 && !hasP2) {
        toDestroy.push(roomId);
        continue;
      }

      if (now - room.createdAt > 60_000) {
        if (hasP1 && !hasP2 && !waitingQueue.includes(room.p1!.socketId)) {
          toDestroy.push(roomId);
        }
      }
    }
    for (const roomId of toDestroy) {
      await destroyRoomAsync(roomId);
      roomsDestroyed++;
    }
  }
  
  if (roomsDestroyed > 0) {
    logger.info(LogChannel.ROOM, 'Zombie cleanup completed', { roomsChecked, roomsDestroyed });
  }
}, 30_000);


// PERIODIC STATE REPORT FOR DEBUGGING
setInterval(() => {
  if (useRedis()) {
    redisState.getWaitingQueueSize().then(size => {
      logger.debug(LogChannel.STATE, 'State report (Redis)', { 
        waitingQueue: size,
        inMemoryRooms: rooms.size
      });
    });
  } else {
    logger.debug(LogChannel.STATE, 'State report (Memory)', { 
      rooms: rooms.size,
      waitingQueue: waitingQueue.length,
      socketMap: socketToRoom.size
    });
  }
}, 30_000);
