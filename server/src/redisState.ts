import { redis, isRedisConnected, logRedisOperation } from './redis';
import { logger, LogChannel } from './logger';
import type { Room, Peer, PeerRole } from './types';

const ROOMS_KEY = 'strangers:rooms';
const SOCKET_TO_ROOM_KEY = 'strangers:socket_to_room';
const WAITING_QUEUE_KEY = 'strangers:waiting_queue';
const ACTIVE_SOCKETS_KEY = 'strangers:active_sockets';

const ROOM_TTL = 300;
const SOCKET_TTL = 3600;

export const redisState = {

  // ADD A SOCKET TO THE WAITING QUEUE IN REDIS
  async addToWaitingQueue(socketId: string): Promise<number> {
    if (!isRedisConnected()) return -1;
    
    try {
      await redis.lrem(WAITING_QUEUE_KEY, 0, socketId);
      await redis.rpush(WAITING_QUEUE_KEY, socketId);
      await redis.expire(WAITING_QUEUE_KEY, ROOM_TTL);
      const size = await redis.llen(WAITING_QUEUE_KEY);
      
      logRedisOperation('addToWaitingQueue', WAITING_QUEUE_KEY, true, { socketId, queueSize: size });
      logger.info(LogChannel.QUEUE, `Added ${socketId} to waiting queue`, { queueSize: size });
      
      return size;
    } catch (error) {
      logger.logError(LogChannel.QUEUE, 'Error adding to waiting queue', error, { socketId });
      logRedisOperation('addToWaitingQueue', WAITING_QUEUE_KEY, false, { socketId, error: String(error) });
      return -1;
    }
  },


  // REMOVE A SOCKET FROM THE WAITING QUEUE IN REDIS
  async removeFromWaitingQueue(socketId: string): Promise<number> {
    if (!isRedisConnected()) return -1;
    
    try {
      await redis.lrem(WAITING_QUEUE_KEY, 0, socketId);
      const size = await redis.llen(WAITING_QUEUE_KEY);
      
      logRedisOperation('removeFromWaitingQueue', WAITING_QUEUE_KEY, true, { socketId, queueSize: size });
      logger.info(LogChannel.QUEUE, `Removed ${socketId} from waiting queue`, { queueSize: size });
      
      return size;
    } catch (error) {
      logger.logError(LogChannel.QUEUE, 'Error removing from waiting queue', error, { socketId });
      logRedisOperation('removeFromWaitingQueue', WAITING_QUEUE_KEY, false, { socketId, error: String(error) });
      return -1;
    }
  },


  // GET ALL SOCKET IDS IN THE WAITING QUEUE
  async getWaitingQueue(): Promise<string[]> {
    if (!isRedisConnected()) return [];
    
    try {
      const queue = await redis.lrange(WAITING_QUEUE_KEY, 0, -1);
      logger.debug(LogChannel.QUEUE, 'Get waiting queue', { size: queue.length });
      return queue;
    } catch (error) {
      logger.logError(LogChannel.QUEUE, 'Error getting waiting queue', error);
      return [];
    }
  },


  // GET THE SIZE OF THE WAITING QUEUE
  async getWaitingQueueSize(): Promise<number> {
    if (!isRedisConnected()) return 0;
    
    try {
      const size = await redis.llen(WAITING_QUEUE_KEY);
      logger.debug(LogChannel.QUEUE, 'Get waiting queue size', { size });
      return size;
    } catch (error) {
      logger.logError(LogChannel.QUEUE, 'Error getting queue size', error);
      return 0;
    }
  },


  // ATOMICALLY TAKE THE NEXT AVAILABLE SOCKET FROM THE QUEUE USING LUA SCRIPT
  async takeFromWaitingQueue(excludeId?: string): Promise<string | null> {
    if (!isRedisConnected()) return null;
    
    const luaScript = `
      local list = redis.call('LRANGE', KEYS[1], 0, -1)
      for i, id in ipairs(list) do
        if id ~= ARGV[1] then
          redis.call('LREM', KEYS[1], 1, id)
          return id
        end
      end
      return nil
    `;

    try {
      const taken = await redis.eval(luaScript, 1, WAITING_QUEUE_KEY, excludeId || '') as string | null;
      if (taken) {
        logger.info(LogChannel.QUEUE, `Took ${taken} from waiting queue (atomic)`, { excluded: excludeId });
        logRedisOperation('takeFromWaitingQueue', WAITING_QUEUE_KEY, true, { taken, excluded: excludeId });
      }
      return taken;
    } catch (error) {
      logger.logError(LogChannel.QUEUE, 'Error in atomic take from queue', error, { excludeId });
      logRedisOperation('takeFromWaitingQueue', WAITING_QUEUE_KEY, false, { excludeId, error: String(error) });
      return null;
    }
  },


  // CREATE A NEW ROOM IN REDIS
  async createRoom(roomId: string, socketId: string, clientId: string | null): Promise<void> {
    if (!isRedisConnected()) return;
    
    try {
      const room: Room = {
        roomId,
        p1: { socketId, clientId },
        p2: null,
        createdAt: Date.now(),
      };
      
      await redis.hset(ROOMS_KEY, roomId, JSON.stringify(room));
      await redis.hset(SOCKET_TO_ROOM_KEY, socketId, roomId);
      
      logRedisOperation('createRoom', ROOMS_KEY, true, { roomId, socketId });
      logger.info(LogChannel.ROOM, `Created room ${roomId}`, { p1: socketId, clientId });
    } catch (error) {
      logger.logError(LogChannel.ROOM, 'Error creating room', error, { roomId, socketId });
      logRedisOperation('createRoom', ROOMS_KEY, false, { roomId, socketId, error: String(error) });
    }
  },


  // ADD A SECOND PEER TO AN EXISTING ROOM
  async addPeerToRoom(roomId: string, socketId: string, clientId: string | null, role: PeerRole): Promise<void> {
    if (!isRedisConnected()) return;
    
    try {
      const roomJson = await redis.hget(ROOMS_KEY, roomId);
      if (!roomJson) {
        logger.warn(LogChannel.ROOM, 'Room not found when adding peer', { roomId, socketId });
        return;
      }
      
      const room: Room = JSON.parse(roomJson);
      room.p2 = { socketId, clientId };
      
      await redis.hset(ROOMS_KEY, roomId, JSON.stringify(room));
      await redis.hset(SOCKET_TO_ROOM_KEY, socketId, roomId);
      
      logRedisOperation('addPeerToRoom', ROOMS_KEY, true, { roomId, socketId, role });
      logger.info(LogChannel.ROOM, `Added ${socketId} to room ${roomId} as ${role}`, { role });
    } catch (error) {
      logger.logError(LogChannel.ROOM, 'Error adding peer to room', error, { roomId, socketId, role });
      logRedisOperation('addPeerToRoom', ROOMS_KEY, false, { roomId, socketId, role, error: String(error) });
    }
  },


  // GET A ROOM BY ITS ID
  async getRoom(roomId: string): Promise<Room | null> {
    if (!isRedisConnected()) return null;
    
    try {
      const roomJson = await redis.hget(ROOMS_KEY, roomId);
      const room = roomJson ? JSON.parse(roomJson) : null;
      
      logger.debug(LogChannel.ROOM, 'Get room', { roomId, found: !!room });
      return room;
    } catch (error) {
      logger.logError(LogChannel.ROOM, 'Error getting room', error, { roomId });
      return null;
    }
  },


  // GET A ROOM BY SOCKET ID
  async getRoomBySocket(socketId: string): Promise<Room | null> {
    if (!isRedisConnected()) return null;
    
    try {
      const roomId = await redis.hget(SOCKET_TO_ROOM_KEY, socketId);
      if (!roomId) {
        logger.debug(LogChannel.ROOM, 'No room found for socket', { socketId });
        return null;
      }
      
      const room = await this.getRoom(roomId);
      logger.debug(LogChannel.ROOM, 'Get room by socket', { socketId, roomId, found: !!room });
      return room;
    } catch (error) {
      logger.logError(LogChannel.ROOM, 'Error getting room by socket', error, { socketId });
      return null;
    }
  },


  // DESTROY A ROOM AND CLEAN UP ALL RELATED MAPPINGS
  async destroyRoom(roomId: string): Promise<void> {
    if (!isRedisConnected()) return;
    
    try {
      const room = await this.getRoom(roomId);
      if (room) {
        if (room.p1) {
          await redis.hdel(SOCKET_TO_ROOM_KEY, room.p1.socketId);
          logger.debug(LogChannel.ROOM, 'Removed socket mapping', { socketId: room.p1.socketId });
        }
        if (room.p2) {
          await redis.hdel(SOCKET_TO_ROOM_KEY, room.p2.socketId);
          logger.debug(LogChannel.ROOM, 'Removed socket mapping', { socketId: room.p2.socketId });
        }
      }
      
      await redis.hdel(ROOMS_KEY, roomId);
      
      logRedisOperation('destroyRoom', ROOMS_KEY, true, { roomId });
      logger.info(LogChannel.ROOM, `Destroyed room ${roomId}`);
    } catch (error) {
      logger.logError(LogChannel.ROOM, 'Error destroying room', error, { roomId });
      logRedisOperation('destroyRoom', ROOMS_KEY, false, { roomId, error: String(error) });
    }
  },


  // SCAN AND DESTROY ZOMBIE ROOMS USING BATCH CURSOR
  async cleanZombieRooms(): Promise<{ checked: number, destroyed: number }> {
    let checked = 0;
    let destroyed = 0;
    
    if (!isRedisConnected()) return { checked, destroyed };
    
    try {
      let cursor = '0';
      const now = Date.now();
      
      do {
        const [nextCursor, elements] = await redis.hscan(ROOMS_KEY, cursor, 'COUNT', 100);
        cursor = nextCursor;
        
        const queue = await this.getWaitingQueue();

        for (let i = 0; i < elements.length; i += 2) {
          const roomId = elements[i];
          const roomJson = elements[i + 1];
          checked++;
          
          try {
            const room: Room = JSON.parse(roomJson);
            const hasP1 = room.p1 !== null;
            const hasP2 = room.p2 !== null;

            if (!hasP1 && !hasP2) {
              await this.destroyRoom(roomId);
              destroyed++;
              continue;
            }

            if (now - room.createdAt > 60_000) {
              if (hasP1 && !hasP2 && !queue.includes(room.p1!.socketId)) {
                await this.destroyRoom(roomId);
                destroyed++;
              }
            }
          } catch (e) {
            logger.logError(LogChannel.ROOM, 'Corrupt room JSON, destroying', e as Error, { roomId });
            await this.destroyRoom(roomId);
            destroyed++;
          }
        }
      } while (cursor !== '0');
      
    } catch (error) {
      logger.logError(LogChannel.ROOM, 'Error running automated zone cleanup', error);
    }
    
    return { checked, destroyed };
  },


  // ADD A SOCKET TO THE ACTIVE SOCKETS SET
  async addActiveSocket(socketId: string): Promise<number> {
    if (!isRedisConnected()) return 0;
    
    try {
      await redis.sadd(ACTIVE_SOCKETS_KEY, socketId);
      await redis.expire(ACTIVE_SOCKETS_KEY, SOCKET_TTL);
      const count = await redis.scard(ACTIVE_SOCKETS_KEY);
      
      logRedisOperation('addActiveSocket', ACTIVE_SOCKETS_KEY, true, { socketId, total: count });
      logger.debug(LogChannel.SOCKET, `Socket ${socketId} added to active sockets`, { total: count });
      
      return count;
    } catch (error) {
      logger.logError(LogChannel.SOCKET, 'Error adding active socket', error, { socketId });
      return 0;
    }
  },


  // REMOVE A SOCKET FROM THE ACTIVE SOCKETS SET
  async removeActiveSocket(socketId: string): Promise<number> {
    if (!isRedisConnected()) return 0;
    
    try {
      await redis.srem(ACTIVE_SOCKETS_KEY, socketId);
      const count = await redis.scard(ACTIVE_SOCKETS_KEY);
      
      logRedisOperation('removeActiveSocket', ACTIVE_SOCKETS_KEY, true, { socketId, total: count });
      logger.debug(LogChannel.SOCKET, `Socket ${socketId} removed from active sockets`, { total: count });
      
      return count;
    } catch (error) {
      logger.logError(LogChannel.SOCKET, 'Error removing active socket', error, { socketId });
      return 0;
    }
  },


  // GET THE TOTAL COUNT OF ACTIVE SOCKETS
  async getActiveSocketCount(): Promise<number> {
    if (!isRedisConnected()) return 0;
    
    try {
      const count = await redis.scard(ACTIVE_SOCKETS_KEY);
      logger.debug(LogChannel.SOCKET, 'Get active socket count', { count });
      return count;
    } catch (error) {
      logger.logError(LogChannel.SOCKET, 'Error getting active socket count', error);
      return 0;
    }
  },


  // GET ALL ACTIVE SOCKET IDS
  async getActiveSockets(): Promise<string[]> {
    if (!isRedisConnected()) return [];
    
    try {
      const sockets = await redis.smembers(ACTIVE_SOCKETS_KEY);
      logger.debug(LogChannel.SOCKET, 'Get active sockets', { count: sockets.length });
      return sockets;
    } catch (error) {
      logger.logError(LogChannel.SOCKET, 'Error getting active sockets', error);
      return [];
    }
  },


  // REMOVE DEAD SOCKETS AND THEIR ASSOCIATED ROOMS
  async pruneDeadSockets(aliveSocketIds: Set<string>): Promise<void> {
    if (!isRedisConnected()) return;
    
    try {
      const allSockets = await this.getActiveSockets();
      let pruned = 0;
      
      for (const socketId of allSockets) {
        if (!aliveSocketIds.has(socketId)) {
          await this.removeActiveSocket(socketId);
          
          const roomId = await redis.hget(SOCKET_TO_ROOM_KEY, socketId);
          if (roomId) {
            await this.destroyRoom(roomId);
          }
          
          await this.removeFromWaitingQueue(socketId);
          pruned++;
        }
      }
      
      if (pruned > 0) {
        logger.info(LogChannel.SOCKET, `Pruned ${pruned} dead sockets`);
      }
    } catch (error) {
      logger.logError(LogChannel.SOCKET, 'Error pruning dead sockets', error);
    }
  },
};
