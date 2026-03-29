import { v4 as uuidv4 } from 'uuid';
import { GetTypesResult, room } from './types';

export function handelStart(roomArr: Array<room>, socket: any, cb: Function, io: any): void {
  console.log('[SERVER] Nueva conexión start:', socket.id);
  
  // check available rooms
  let availableroom = checkAvailableRoom();
  if (availableroom.is) {
    console.log('[SERVER] Sala disponible:', availableroom.roomid);
    socket.join(availableroom.roomid);
    cb('p2');
    closeRoom(availableroom.roomid);
    if (availableroom?.room) {
      console.log('[SERVER] Enviando remote-socket a p1:', availableroom.room.p1.id, 'nuevo p2:', socket.id);
      io.to(availableroom.room.p1.id).emit('remote-socket', socket.id);
      socket.emit('remote-socket', availableroom.room.p1.id);
      socket.emit('roomid', availableroom.room.roomid);
    }
  } else {
    let roomid = uuidv4();
    socket.join(roomid);
    roomArr.push({
      roomid,
      isAvailable: true,
      p1: {
        id: socket.id,
      },
      p2: {
        id: null,
      }
    });
    cb('p1');
    socket.emit('roomid', roomid);
  }

  function closeRoom(roomid: string): void {
    for (let i = 0; i < roomArr.length; i++) {
      if (roomArr[i].roomid == roomid) {
        roomArr[i].isAvailable = false;
        roomArr[i].p2.id = socket.id;
        break;
      }
    }
  }

  function checkAvailableRoom(): { is: boolean, roomid: string, room: room | null } {
    for (let i = 0; i < roomArr.length; i++) {
      const currentRoom = roomArr[i];

      // Si hay una sala disponible, y el usuario no es el que ya está en ella
      if (currentRoom.isAvailable && currentRoom.p1.id !== socket.id) {
        return { is: true, roomid: currentRoom.roomid, room: currentRoom };
      }
    }
    return { is: false, roomid: '', room: null };
  }
}

export function handelDisconnect(disconnectedId: string, roomArr: Array<room>, io: any) {
  const cleanRooms = [];
  
  for (let i = 0; i < roomArr.length; i++) {
    const room = roomArr[i];

    if (room.p1.id === disconnectedId || room.p2?.id === disconnectedId) {
      const partner = room.p1.id === disconnectedId ? room.p2?.id : room.p1?.id;
      if (partner) io.to(partner).emit('disconnected');

      if (room.p1.id === disconnectedId && room.p2?.id) {
        cleanRooms.push({
          roomid: room.roomid,
          isAvailable: true,
          p1: { id: room.p2.id },
          p2: { id: null }
        });
      } else if (room.p2?.id === disconnectedId) {
        cleanRooms.push({
          roomid: room.roomid,
          isAvailable: true,
          p1: { id: room.p1.id },
          p2: { id: null }
        });
      }
    } else {
      cleanRooms.push(room);
    }
  }

  // Filtrar salas donde el único usuario era el desconectado
  roomArr.length = 0;
  roomArr.push(...cleanRooms.filter(room => {
    if (room.p1.id === disconnectedId && !room.p2?.id) return false;
    return true;
  }));
}

export function getType(id: string, roomArr: Array<room>): GetTypesResult {
  for (let i = 0; i < roomArr.length; i++) {
    if (roomArr[i].p1.id == id) {
      return { type: 'p1', p2id: roomArr[i].p2.id };
    } else if (roomArr[i].p2.id == id) {
      return { type: 'p2', p1id: roomArr[i].p1.id };
    }
  }
  return false;
}
