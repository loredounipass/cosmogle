import { io } from 'socket.io-client';

// Elementos del DOM
const myVideo = document.getElementById('my-video');
const strangerVideo = document.getElementById('video');
const sendButton = document.getElementById('send');
const inputField = document.getElementById('messageInput');
const chatWrapper = document.querySelector('.chat-holder .wrapper');
const typingIndicator = document.getElementById('typingIndicator');
const nextBtn = document.getElementById('nextBtn');
const exitBtn = document.getElementById('exitBtn');
const spinner = document.querySelector('.modal');
const cameraBtn = document.getElementById('cameraBtn');

// Estado global
let peer = null;
let localStream = null;
let remoteSocket = null;
let type = null;
let roomid = null;
let socket = null;
let isCameraOff = false;
let isExiting = false; 

// Cola para mensajes WebRTC que llegan antes del peer
let pendingSdp = null;
let pendingIceCandidates = []; 

// NUEVA función para detectar móviles
function isMobile() {
  return /Mobi|Android/i.test(navigator.userAgent);
}

// Inicializar la aplicación:  usa tu url de uso o localhost:8000
async function init() {
  socket = io('https://special-chainsaw-rqr4g6grw55c6qq-8000.app.github.dev');
  setupSocketEvents();
  await initMedia();
  setupUIEvents();
}

// Función de limpieza completa
function fullCleanup() {
  if (peer) {
    peer.close();
    peer = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  myVideo.srcObject = null;
  strangerVideo.srcObject = null;

  spinner.style.display = 'flex';
  chatWrapper.innerHTML = '';
  
  // Limpiar mensajes pendientes
  pendingSdp = null;
  pendingIceCandidates = [];
}

// Inicializar cámara/micrófono
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
        sampleRate: { ideal: 48000 },
        channelCount: { ideal: 1 },
        latency: { ideal: 0.01 }
      },
      video: {
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 480 },
        frameRate: { ideal: 30, min: 15 },
        facingMode: "user"
      }
    });
    myVideo.srcObject = localStream;
    myVideo.muted = true; 
    
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      await videoTrack.applyConstraints({
        advanced: [{ brightness: 0.5, contrast: 1.0, saturation: 1.2 }]
      });
    }
  } catch (err) {
    if (err.name === 'NotAllowedError' && !isMobile()) {
      showNotification('Permiso denegado para acceder a la cámara');
      return;
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
            sampleRate: { ideal: 48000 },
            channelCount: { ideal: 1 },
            latency: { ideal: 0.01 }
          },
          video: false
        });
        myVideo.srcObject = localStream;
        myVideo.muted = true;
      } catch (audioErr) {
        
      }
    } else {
      
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
            sampleRate: { ideal: 48000 },
            channelCount: { ideal: 1 },
            latency: { ideal: 0.01 }
          },
          video: {
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
            frameRate: { ideal: 30, min: 15 },
            facingMode: "user"
          }
        });
        myVideo.srcObject = localStream;
        myVideo.muted = true;
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
          await videoTrack.applyConstraints({
            advanced: [{ brightness: 0.5, contrast: 1.0, saturation: 1.2 }]
          });
        }
      } catch (retryErr) {
        
        if (!isExiting && !isMobile() && retryErr.name !== 'NotFoundError' && retryErr.name !== 'DevicesNotFoundError') {
          showNotification('No hay acceso');
        }
      }
    }
  }
}

// Configurar la conexión WebRTC
function setupPeerConnection() {
  console.log('[PEER] Creando RTCPeerConnection...');
  
  peer = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  });

  peer.onicecandidate = (e) => {
    if (e.candidate && remoteSocket) {
      socket.emit('ice:send', { candidate: e.candidate, to: remoteSocket });
    }
  };

  peer.ontrack = (e) => {
    console.log('[PEER] Track recibido!', e.track.kind);
    strangerVideo.srcObject = e.streams[0];

    // Asegurarse de que el video no intente reproducirse si ya está cargando
    strangerVideo.onloadeddata = () => {
      console.log('[PEER] Video cargando, reproduciendo...');
      strangerVideo.play().catch(() => {});
    };
  };

  peer.onconnectionstatechange = () => {
    console.log('[PEER] Estado de conexión:', peer.connectionState);
  };

  peer.onnegotiationneeded = () => {
    console.log('[PEER] Negociación necesaria!');
    if (type === 'p1' && peer) {
      createOffer();
    }
  };

  if (localStream) {
    console.log('[PEER] Agregando tracks al peer...', localStream.getTracks().length, 'tracks');
    localStream.getTracks().forEach(track => {
      console.log('[PEER] Agregando track:', track.kind, track.label);
      peer.addTrack(track, localStream);
      
      // Configurar calidad de video y audio
      setTimeout(() => {
        const sender = peer.getSenders().find(s => s.track?.kind === track.kind);
        if (sender) {
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          
          if (track.kind === 'video') {
            params.encodings[0] = {
              ...params.encodings[0],
              maxBitrate: 2500000,
              minBitrate: 500000,
              scalabilityMode: 'L1T3'
            };
          } else if (track.kind === 'audio') {
            params.encodings[0] = {
              ...params.encodings[0],
              maxBitrate: 128000,
              priority: 'high',
              networkPriority: 'high'
            };
          }
          
          sender.setParameters(params).catch(err => {
            console.warn('No se pudo setear parámetros:', err);
          });
        }
      }, 100);
    });
  } else {
    console.debug('[PEER] localStream se agregará después...');
  }
  
  // Monitorear calidad de conexión
  monitorConnectionQuality();
}

// Función para monitorear calidad de conexión WebRTC
let statsInterval = null;
function monitorConnectionQuality() {
  if (statsInterval) clearInterval(statsInterval);
  
  statsInterval = setInterval(async () => {
    if (!peer || peer.connectionState === 'closed') {
      clearInterval(statsInterval);
      return;
    }
    
    try {
      const stats = await peer.getStats();
      let videoStats = null;
      let audioStats = null;
      
      stats.forEach(report => {
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          videoStats = report;
        }
        if (report.type === 'outbound-rtp' && report.kind === 'audio') {
          audioStats = report;
        }
      });
      
      // Log para debugging (quitar en producción)
      if (videoStats) {
        console.debug('Video Stats:', {
          bytesSent: videoStats.bytesSent,
          packetsSent: videoStats.packetsSent,
          packetsLost: videoStats.packetsLost,
          bitrate: videoStats.bitrateMean,
          frameWidth: videoStats.frameWidth,
          frameHeight: videoStats.frameHeight,
          framesPerSecond: videoStats.framesPerSecond
        });
      }
    } catch (err) {
      console.warn('Error monitoreando stats:', err);
    }
  }, 3000);
}

// Reiniciar conexión
function restartConnection() {
  remoteSocket = null;
  roomid = null;
  type = null;

  socket.emit('disconnect-me');

  setTimeout(() => {
    spinner.style.display = 'flex';
    // Reiniciar la cámara antes de buscar una nueva sala
    initMedia().then(() => {
      socket.emit('start', (newType) => {
        type = newType;
      });
    }).catch(() => {
      socket.emit('start', (newType) => {
        type = newType;
      });
    });
  }, 300);
}

// Configuración de eventos del socket
function setupSocketEvents() {
  socket.on('connect', () => {
    console.log('[SOCKET] Conectado, solicitando sala...');
    socket.emit('start', (personType) => {
      console.log('[SOCKET] Recibido tipo:', personType);
      type = personType;
    });
  });

  socket.on('start', (personType) => {
    console.log('[SOCKET] Evento start recibido:', personType);
    type = personType;
  });

  socket.on('roomid', (id) => {
    console.log('[SOCKET] RoomID:', id);
    roomid = id;
  });

  socket.on('remote-socket', (partnerId) => {
    console.log('[SOCKET] Partner conectado:', partnerId, '| Mi tipo:', type);
    remoteSocket = partnerId;
    spinner.style.display = 'none';
    
    // Crear peer connection INMEDIATAMENTE, sin esperar localStream
    setupPeerConnection();
    
    // Iniciar cámara primero, luego agregar tracks
    initMedia().then(() => {
      if (peer) {
        addTracksToPeer();
        
        // Si tenemos un SDP pendiente, procesarlo ahora que tenemos tracks
        if (pendingSdp) {
          console.log('[WEBRTC] Procesando SDP pendiente con tracks listos...');
          processPendingMessages();
        }
        
        if (type === 'p1') {
          console.log('[WEBRTC] Soy p1, creando offer...');
          createOffer();
        }
      }
    }).catch(() => {
      if (type === 'p1') {
        createOffer();
      }
    });
  });

  function addTracksToPeer() {
    if (!localStream || !peer) return;
    
    localStream.getTracks().forEach(track => {
      const existingSender = peer.getSenders().find(s => s.track?.kind === track.kind);
      if (!existingSender) {
        console.log('[PEER] Agregando track:', track.kind);
        peer.addTrack(track, localStream);
      }
    });
    
    console.log('[PEER] Total senders:', peer.getSenders().length);
    
    // Procesar mensajes pendientes (SDP e ICE)
    processPendingMessages();
  }
  
  function processPendingMessages() {
    if (!peer) return;
    
    // Procesar ICE candidates primero
    if (pendingIceCandidates.length > 0) {
      pendingIceCandidates.forEach(candidate => {
        console.log('[ICE] Procesando ICE pendiente...');
        handleIce(candidate);
      });
      pendingIceCandidates = [];
    }
    
    // Procesar SDP
    if (pendingSdp) {
      console.log('[SDP] Procesando SDP pendiente...');
      handleSdp(pendingSdp);
      pendingSdp = null;
    }
  }

  socket.on('disconnected', () => {
    if (!isExiting) {
      showNotification('Desconectado. Buscando...');
      fullCleanup();
      restartConnection();
    }
  });

  socket.on('disconnect-confirm', () => {
    fullCleanup();
  });

// WebRTC
    socket.on('sdp:reply', async ({ sdp }) => {
      console.log('[SDP] Recibido SDP reply:', sdp.type, '| Mi tipo:', type, '| Tracks listos:', localStream?.getTracks().length);
      
      // Guardar SDP pendiente - se procesará cuando los tracks estén listos
      if (!peer || !localStream) {
        console.log('[SDP] Guardando SDP para después...');
        pendingSdp = sdp;
        return;
      }
      handleSdp(sdp);
    });

    function handleSdp(sdp) {
      if (!peer) return;
      
      try {
        peer.setRemoteDescription(new RTCSessionDescription(sdp)).then(() => {
          console.log('[SDP] Remote description configurada');
          if (type === 'p2') {
            console.log('[SDP] Soy p2, creando answer...');
            peer.createAnswer().then(answer => {
              return peer.setLocalDescription(answer);
            }).then(() => {
              socket.emit('sdp:send', { sdp: peer.localDescription });
              console.log('[SDP] Answer enviada!');
            });
          } else if (type === 'p1') {
            console.log('[SDP] Soy p1, respuesta recibida');
          }
        });
      } catch (err) {
        console.error('[SDP] Error handling SDP reply:', err);
      }
    }

    socket.on('ice:reply', async ({ candidate }) => {
      console.log('[ICE] Recibido ICE candidate');
      if (!peer) {
        console.log('[ICE] Peer no existe, guardando para después');
        pendingIceCandidates.push(candidate);
        return;
      }
      handleIce(candidate);
    });

    function handleIce(candidate) {
      if (!peer) return;
      
      // Solo procesar ICE si tenemos remote description
      if (!peer.remoteDescription) {
        console.log('[ICE] No hay remote description, guardando...');
        pendingIceCandidates.push(candidate);
        return;
      }
      
      try {
        peer.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('[ICE] ICE candidate añadido');
      } catch (err) {
        console.error('[ICE] Error handling ICE candidate:', err);
      }
    }

  // Chat
  socket.on('typing', (isTyping) => {
    typingIndicator.style.display = isTyping ? 'block' : 'none';
  });

  socket.on('get-message', (message) => {
    const sanitizedMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    chatWrapper.innerHTML += `
      <div class="msg">
        <b>Stranger: </b> <span>${sanitizedMessage}</span>
      </div>
    `;
    chatWrapper.scrollTop = chatWrapper.scrollHeight;
  });

  // Verificar estado de la sala
  socket.on('check-room-status', (status) => {
    if (status === 'not_ready') {
      alert('Debe haber dos personas en la sala para proceder.');
    }
  });
}

// Eventos de interfaz
function setupUIEvents() {
  exitBtn.addEventListener('click', () => {
    isExiting = true; 
    fullCleanup();
    socket.emit('disconnect-me');
    window.location.href = '/';
  });

  nextBtn.addEventListener('click', () => {
    // Cambiar directamente sin verificar el estado de la sala
    fullCleanup();
    restartConnection();
  });

  const sendMessage = () => {
    const message = inputField.value.trim();
    if (message && roomid) {
      const sanitizedMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      socket.emit('send-message', sanitizedMessage, type, roomid);

      chatWrapper.innerHTML += `
        <div class="msg">
          <b>You: </b> <span>${sanitizedMessage}</span>
        </div>
      `;
      inputField.value = '';
      chatWrapper.scrollTop = chatWrapper.scrollHeight;

      socket.emit('typing', { roomid, isTyping: false });
    }
  };

  sendButton.addEventListener('click', (e) => {
    e.preventDefault();
    sendMessage();
  });

  inputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });

  let typingTimeout;
  inputField.addEventListener('input', () => {
    if (!roomid) return;      const isTyping = inputField.value.length > 0;
    socket.emit('typing', { roomid, isTyping });

    clearTimeout(typingTimeout);
    if (isTyping) {
      typingTimeout = setTimeout(() => {
        socket.emit('typing', { roomid, isTyping: false });
      }, 2000);
    }
  });

  // Agregar funcionalidad de mute mejorada
  const muteBtn = document.getElementById('muteBtn');
  let isMuted = false;
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      if (localStream && localStream.getAudioTracks().length > 0) {
        isMuted = !isMuted;
        // Alternar habilitación de las pistas de audio
        localStream.getAudioTracks().forEach(track => {
          track.enabled = !isMuted;
        });
        // Actualizar el texto correctamente: muestra "OFF" si está muteado
        muteBtn.querySelector('.glitch-text').textContent = isMuted ? 'OFF' : 'ON';
        showNotification(isMuted ? 'Audio OFF' : 'Audio ON');
      } else {
        showNotification('No hay pista de audio');
      }
    });
  }

  // Corregir la lógica de encendido/apagado de la cámara
  cameraBtn.addEventListener('click', async () => {
    if (localStream) {
      try {
        const permissions = await navigator.mediaDevices.getUserMedia({ video: true });
        if (permissions) {
          isCameraOff = !isCameraOff;
          localStream.getVideoTracks().forEach(track => {
            track.enabled = !isCameraOff;
          });
          cameraBtn.querySelector('.glitch-text').textContent = isCameraOff ? 'ON' : 'OFF';
          showNotification(isCameraOff ? 'Video OFF' : 'Video ON');
        }
      } catch (error) {
        // Mostrar notificación solo si no se está saliendo y no es un dispositivo móvil
        if (!isExiting && !isMobile()) {
          showNotification('No hay acceso');
        }
        console.error('Error cámara:', error);
      }
    }
  });
}

// Crear oferta
async function createOffer() {
  console.log('[OFFER] Intentando crear offer...', { peerExists: !!peer, type });
  if (!peer) {
    console.error('[OFFER] No existe peer!');
    return;
  }

  try {
    const offer = await peer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    console.log('[OFFER] Offer creada, configurando local description...');
    await peer.setLocalDescription(offer);
    console.log('[OFFER] Enviando SDP al partner...');
    socket.emit('sdp:send', { sdp: peer.localDescription });
    console.log('[OFFER] SDP enviado!');
  } catch (err) {
    console.error('[OFFER] Error creando offer:', err);
  }
}

// Función para mostrar notificaciones no bloqueantes
function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  notification.style.position = 'fixed';
  notification.style.top = '50%';
  notification.style.left = '50%';
  notification.style.transform = 'translate(-50%, -50%)';
  notification.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  notification.style.color = 'white';
  notification.style.padding = '10px 20px';
  notification.style.borderRadius = '5px';
  notification.style.zIndex = '9999';

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.5s';
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 500);
  }, 3000);
}

init();