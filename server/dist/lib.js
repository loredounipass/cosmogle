"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handelStart = handelStart;
exports.handelDisconnect = handelDisconnect;
exports.getType = getType;
const uuid_1 = require("uuid");
function handelStart(roomArr, socket, cb, io) {
    console.log('[SERVER] Nueva conexión start:', socket.id);
    // check available rooms
    let availableroom = checkAvailableRoom();
    if (availableroom.is) {
        console.log('[SERVER] Sala disponible:', availableroom.roomid);
        socket.join(availableroom.roomid);
        cb('p2');
        closeRoom(availableroom.roomid);
        if (availableroom === null || availableroom === void 0 ? void 0 : availableroom.room) {
            console.log('[SERVER] Enviando remote-socket a p1:', availableroom.room.p1.id, 'nuevo p2:', socket.id);
            io.to(availableroom.room.p1.id).emit('remote-socket', socket.id);
            socket.emit('remote-socket', availableroom.room.p1.id);
            socket.emit('roomid', availableroom.room.roomid);
        }
    }
    else {
        let roomid = (0, uuid_1.v4)();
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
    function closeRoom(roomid) {
        for (let i = 0; i < roomArr.length; i++) {
            if (roomArr[i].roomid == roomid) {
                roomArr[i].isAvailable = false;
                roomArr[i].p2.id = socket.id;
                break;
            }
        }
    }
    function checkAvailableRoom() {
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
function handelDisconnect(disconnectedId, roomArr, io) {
    var _a, _b, _c, _d, _e;
    const cleanRooms = [];
    for (let i = 0; i < roomArr.length; i++) {
        const room = roomArr[i];
        if (room.p1.id === disconnectedId || ((_a = room.p2) === null || _a === void 0 ? void 0 : _a.id) === disconnectedId) {
            const partner = room.p1.id === disconnectedId ? (_b = room.p2) === null || _b === void 0 ? void 0 : _b.id : (_c = room.p1) === null || _c === void 0 ? void 0 : _c.id;
            if (partner)
                io.to(partner).emit('disconnected');
            if (room.p1.id === disconnectedId && ((_d = room.p2) === null || _d === void 0 ? void 0 : _d.id)) {
                cleanRooms.push({
                    roomid: room.roomid,
                    isAvailable: true,
                    p1: { id: room.p2.id },
                    p2: { id: null }
                });
            }
            else if (((_e = room.p2) === null || _e === void 0 ? void 0 : _e.id) === disconnectedId) {
                cleanRooms.push({
                    roomid: room.roomid,
                    isAvailable: true,
                    p1: { id: room.p1.id },
                    p2: { id: null }
                });
            }
        }
        else {
            cleanRooms.push(room);
        }
    }
    // Filtrar salas donde el único usuario era el desconectado
    roomArr.length = 0;
    roomArr.push(...cleanRooms.filter(room => {
        var _a;
        if (room.p1.id === disconnectedId && !((_a = room.p2) === null || _a === void 0 ? void 0 : _a.id))
            return false;
        return true;
    }));
}
function getType(id, roomArr) {
    for (let i = 0; i < roomArr.length; i++) {
        if (roomArr[i].p1.id == id) {
            return { type: 'p1', p2id: roomArr[i].p2.id };
        }
        else if (roomArr[i].p2.id == id) {
            return { type: 'p2', p1id: roomArr[i].p1.id };
        }
    }
    return false;
}
