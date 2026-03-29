// Socket Events Module

export function setupSocketEvents(socket, handlers = {}) {
  const {
    onConnect,
    onStart,
    onRoomId,
    onRemoteSocket,
    onDisconnected,
    onDisconnectConfirm,
    onSdpReply,
    onIceReply,
    onMessage,
    onTyping
  } = handlers;
  
  socket.on('connect', () => {
    if (onConnect) onConnect();
  });
  
  socket.on('start', (personType) => {
    if (onStart) onStart(personType);
  });
  
  socket.on('roomid', (id) => {
    if (onRoomId) onRoomId(id);
  });
  
  socket.on('remote-socket', (partnerId) => {
    if (onRemoteSocket) onRemoteSocket(partnerId);
  });
  
  socket.on('disconnected', () => {
    if (onDisconnected) onDisconnected();
  });
  
  socket.on('disconnect-confirm', () => {
    if (onDisconnectConfirm) onDisconnectConfirm();
  });
  
  socket.on('sdp:reply', (data) => {
    if (onSdpReply) onSdpReply(data);
  });
  
  socket.on('ice:reply', (data) => {
    if (onIceReply) onIceReply(data);
  });
  
  socket.on('get-message', (message) => {
    if (onMessage) onMessage(message);
  });
  
  socket.on('typing', (isTyping) => {
    if (onTyping) onTyping(isTyping);
  });
}

export function emitSdp(socket, sdp) {
  socket.emit('sdp:send', { sdp });
}

export function emitIce(socket, candidate, to) {
  socket.emit('ice:send', { candidate, to });
}

export function emitStart(socket, callback) {
  socket.emit('start', callback);
}

export function emitDisconnectMe(socket) {
  socket.emit('disconnect-me');
}

export function emitSendMessage(socket, message, userType, roomid) {
  socket.emit('send-message', message, userType, roomid);
}

export function emitTyping(socket, roomid, isTyping) {
  socket.emit('typing', { roomid, isTyping });
}
