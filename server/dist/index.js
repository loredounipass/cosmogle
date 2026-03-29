"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const socket_io_1 = require("socket.io");
const lib_1 = require("./lib");
const app = (0, express_1.default)();
const allowedOrigins = ((_a = process.env.ALLOWED_ORIGINS) === null || _a === void 0 ? void 0 : _a.split(',')) || ['http://localhost:3000'];
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        }
        else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST'],
}));
const server = app.listen(8000, () => console.log('Server is up, 8000'));
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
    pingTimeout: 10000,
    pingInterval: 5000,
});
let online = 0;
let roomArr = [];
io.on('connection', (socket) => {
    online++;
    io.emit('online', online);
    // START
    socket.on('start', (cb) => {
        try {
            if (typeof cb === 'function') {
                (0, lib_1.handelStart)(roomArr, socket, cb, io);
            }
            else {
                console.warn('Client emitted start without callback');
                socket.emit('error', { message: 'Missing callback for start event' });
            }
        }
        catch (error) {
            console.error('Error in start handler:', error);
        }
    });
    // DISCONNECT
    socket.on('disconnect', () => {
        (0, lib_1.handelDisconnect)(socket.id, roomArr, io);
        if (online > 0) {
            online--;
            io.emit('online', online);
        }
    });
    // DISCONNECT-ME
    socket.on('disconnect-me', () => {
        (0, lib_1.handelDisconnect)(socket.id, roomArr, io);
        if (online > 0) {
            online--;
            io.emit('online', online);
        }
    });
    // NEXT
    socket.on('next', () => {
        try {
            const room = roomArr.find(r => r.p1.id === socket.id || r.p2.id === socket.id);
            if (room && (room.p1.id && room.p2.id)) { // Ensure both players are in the room
                (0, lib_1.handelDisconnect)(socket.id, roomArr, io);
                (0, lib_1.handelStart)(roomArr, socket, (person) => {
                    if (socket.connected) {
                        socket.emit('start', person);
                    }
                }, io);
            }
            else {
                socket.emit('error', { message: 'There must be two people in the room to proceed.' });
            }
        }
        catch (error) {
            console.error('Error in next handler:', error);
        }
    });
    // LEAVE
    socket.on('leave', () => {
        try {
            const type = (0, lib_1.getType)(socket.id, roomArr);
            if (type && 'type' in type) {
                const targetId = type.type === 'p1' ? type.p2id : type.p1id;
                const room = roomArr.find(r => r.p1.id === socket.id || r.p2.id === socket.id);
                if (targetId)
                    io.to(targetId).emit('disconnected');
                if (room) {
                    if (type.type === 'p1') {
                        room.p1.id = room.p2.id;
                        room.p2.id = null;
                    }
                    else {
                        room.p2.id = null;
                    }
                    room.isAvailable = true;
                    socket.leave(room.roomid);
                }
            }
        }
        catch (error) {
            console.error('Error in leave handler:', error);
        }
    });
    // ICE CANDIDATE
    socket.on('ice:send', (data) => {
        try {
            // Validar que candidate sea un objeto válido
            if (!data || !data.candidate || typeof data.candidate !== 'object') {
                socket.emit('error', { message: 'Invalid ICE candidate data' });
                return;
            }
            const type = (0, lib_1.getType)(socket.id, roomArr);
            if (type && 'type' in type) {
                const target = type.type === 'p1' ? type.p2id : type.p1id;
                if (target)
                    io.to(target).emit('ice:reply', { candidate: data.candidate, from: socket.id });
            }
        }
        catch (error) {
            console.error('Error in ice:send handler:', error);
            socket.emit('error', { message: 'Internal server error' });
        }
    });
    // SDP
    socket.on('sdp:send', (data) => {
        try {
            // Validar que sdp sea un objeto válido con type y sdp
            if (!data || !data.sdp || typeof data.sdp !== 'object' || !data.sdp.type) {
                socket.emit('error', { message: 'Invalid SDP data' });
                return;
            }
            const type = (0, lib_1.getType)(socket.id, roomArr);
            if (type && 'type' in type) {
                const target = type.type === 'p1' ? type.p2id : type.p1id;
                if (target)
                    io.to(target).emit('sdp:reply', { sdp: data.sdp, from: socket.id });
            }
        }
        catch (error) {
            console.error('Error in sdp:send handler:', error);
            socket.emit('error', { message: 'Internal server error' });
        }
    });
    // CHAT
    socket.on('send-message', (input, userType, roomid) => {
        try {
            if (typeof input === 'string' && typeof roomid === 'string') {
                const prefix = userType === 'p1' ? 'You: ' : 'Stranger: ';
                socket.to(roomid).emit('get-message', input, prefix);
            }
        }
        catch (error) {
            console.error('Error in send-message handler:', error);
        }
    });
    // TYPING
    socket.on('typing', ({ roomid, isTyping }) => {
        try {
            if (typeof roomid === 'string') {
                socket.to(roomid).emit('typing', isTyping);
            }
        }
        catch (error) {
            console.error('Error in typing handler:', error);
        }
    });
    // RECONNECT
    socket.on('reconnect', (attemptNumber) => {
        console.log(`Client reconnected after ${attemptNumber} attempts`);
        socket.emit('reconnected');
    });
    // Verificar el estado de la sala antes de proceder con el "Next"
    socket.on('check-room-status', (roomid, callback) => {
        try {
            const room = roomArr.find(r => r.roomid === roomid);
            if (room && room.p1.id && room.p2.id) {
                callback('ready');
            }
            else {
                callback('not_ready');
            }
        }
        catch (error) {
            console.error('Error checking room status:', error);
            callback('not_ready');
        }
    });
});
