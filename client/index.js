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

// Control de reproducción de video
let videoPlayRetries = 0;
const MAX_VIDEO_PLAY_RETRIES = 5;
let videoPlayInterval = null;

// Preferencias de calidad
let preferredVideoConstraints = null;

// Detección de errores de conexión
let connectionTimeout = null;
let iceTimeout = null;
let iceKeepAliveInterval = null;
const ICE_CONNECTION_TIMEOUT = 30000;
const CONNECTION_RETRY_DELAY = 2000;
const ICE_KEEP_ALIVE_INTERVAL = 15000; // 15 segundos 

// NUEVA función para detectar móviles
function isMobile() {
  return /Mobi|Android/i.test(navigator.userAgent);
}

// Inicializar la aplicación:  usa tu url de uso o localhost:8000
async function init() {
  socket = io('https://urban-capybara-jv4j5754gpw3qpv6-8000.app.github.dev');
  setupSocketEvents();
  await initMedia();
  setupUIEvents();
}

// Función de limpieza completa
function fullCleanup() {
  console.log('[CLEANUP] Limpiando conexión...');
  
  // Limpiar timeouts
  if (iceTimeout) {
    clearTimeout(iceTimeout);
    iceTimeout = null;
  }
  if (connectionTimeout) {
    clearTimeout(connectionTimeout);
    connectionTimeout = null;
  }
  if (videoPlayInterval) {
    clearInterval(videoPlayInterval);
    videoPlayInterval = null;
  }
  
  // Limpiar ICE keep-alive
  if (iceKeepAliveInterval) {
    clearInterval(iceKeepAliveInterval);
    iceKeepAliveInterval = null;
  }
  
  // Resetear contadores
  videoPlayRetries = 0;
  
  // Cerrar peer connection
  if (peer) {
    peer.close();
    peer = null;
  }

  // Detener tracks de media
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // Limpiar videos
  myVideo.srcObject = null;
  strangerVideo.srcObject = null;

  // Resetear UI
  spinner.style.display = 'flex';
  chatWrapper.innerHTML = '';
  
  // Limpiar mensajes pendientes
  pendingSdp = null;
  pendingIceCandidates = [];
  
  console.log('[CLEANUP] Completado');
}

// Obtener la mejor resolución nativa del dispositivo
async function getNativeVideoConstraints() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    
    if (videoDevices.length === 0) {
      return {
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
        frameRate: { ideal: 30, min: 24 },
        facingMode: "user"
      };
    }

    // Intentar obtener la capacidad máxima del dispositivo
    const deviceId = videoDevices[0].deviceId;
    const capabilities = navigator.mediaDevices.getSupportedConstraints();
    
    const constraints = {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 1920, max: 1920, min: 1280 },
      height: { ideal: 1080, max: 1080, min: 720 },
      frameRate: { ideal: 30, min: 24 },
      facingMode: "user"
    };

    // Eliminar deviceId si no es soportado
    if (!capabilities.deviceId) {
      delete constraints.deviceId;
    }

    return constraints;
  } catch (err) {
    console.warn('[MEDIA] Error obteniendo resolución nativa:', err);
    return {
      width: { ideal: 1920, min: 1280 },
      height: { ideal: 1080, min: 720 },
      frameRate: { ideal: 30, min: 24 },
      facingMode: "user"
    };
  }
}

// Inicializar cámara/micrófono
async function initMedia() {
  preferredVideoConstraints = await getNativeVideoConstraints();
  
  const audioConstraints = {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 1 },
    latency: { ideal: 0.01 }
  };

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: preferredVideoConstraints
    });
    
    myVideo.srcObject = localStream;
    myVideo.muted = true;
    
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      const settings = videoTrack.getSettings();
      console.log('[MEDIA] Resolución nativa obtenida:', settings.width, 'x', settings.height);
      
      await videoTrack.applyConstraints({
        advanced: [
          { brightness: 0.5, contrast: 1.0, saturation: 1.2 },
          { width: { ideal: settings.width } },
          { height: { ideal: settings.height } }
        ]
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
          audio: audioConstraints,
          video: false
        });
        myVideo.srcObject = localStream;
        myVideo.muted = true;
      } catch (audioErr) {
        console.error('[MEDIA] Error solo audio:', audioErr);
      }
    } else {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: {
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
            frameRate: { ideal: 30, min: 15 },
            facingMode: "user"
          }
        });
        myVideo.srcObject = localStream;
        myVideo.muted = true;
      } catch (retryErr) {
        if (!isExiting && !isMobile() && retryErr.name !== 'NotFoundError' && retryErr.name !== 'DevicesNotFoundError') {
          showNotification('No hay acceso');
        }
      }
    }
  }
}

// ============================================
// SISTEMA SIMPLIFICADO DE REPRODUCCIÓN DE VIDEO
// ============================================

// Intentar reproducir el video con retry
function attemptVideoPlay() {
  if (!strangerVideo.srcObject) return;
  
  strangerVideo.muted = true;
  
  const playPromise = strangerVideo.play();
  
  if (playPromise !== undefined) {
    playPromise
      .then(() => {
        console.log('[VIDEO] Reproducción iniciada');
        videoPlayRetries = 0;
      })
      .catch(err => {
        if (videoPlayRetries >= MAX_VIDEO_PLAY_RETRIES) {
          console.warn('[VIDEO] Máximo de intentos alcanzado');
          return;
        }
        
        videoPlayRetries++;
        const delay = Math.min(1000 * Math.pow(2, videoPlayRetries), 5000);
        console.warn('[VIDEO] Error:', err.name, '- Reintentando en', delay, 'ms');
        setTimeout(attemptVideoPlay, delay);
      });
  }
}

// Configurar listeners esenciales para video
function setupVideoListeners() {
  strangerVideo.onplaying = () => {
    console.log('[VIDEO] Reproducción activa');
    videoPlayRetries = 0;
  };
  
  strangerVideo.onpause = () => {
    console.warn('[VIDEO] Video pausado');
  };
  
  strangerVideo.onwaiting = () => {
    console.warn('[VIDEO] Esperando datos...');
    attemptVideoPlay();
  };
  
  strangerVideo.onstalled = () => {
    console.warn('[VIDEO] Video stagnated');
    attemptVideoPlay();
  };
  
  strangerVideo.onerror = () => {
    console.error('[VIDEO] Error:', strangerVideo.error);
    attemptVideoPlay();
  };
}

// Detectar y manejar errores de conexión
function handleConnectionError(errorType) {
  console.error('[CONNECTION] Error detectado:', errorType);
  
  if (iceTimeout) {
    clearTimeout(iceTimeout);
    iceTimeout = null;
  }
  if (connectionTimeout) {
    clearTimeout(connectionTimeout);
    connectionTimeout = null;
  }
  
  showNotification('Conexión perdida. Reconectando...');
  
  setTimeout(() => {
    if (!isExiting) {
      fullCleanup();
      restartConnection();
    }
  }, CONNECTION_RETRY_DELAY);
}

// Configurar la conexión WebRTC
function setupPeerConnection() {
  console.log('[PEER] Creando RTCPeerConnection...');
  
  // Limpiar conexiones anteriores
  if (peer) {
    peer.close();
    peer = null;
  }
  
  // Servidores ICE mejorados con múltiples STUN y TURN públicos
  const iceServers = [
    // Google STUN
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    
    // Otros STUN públicos
    { urls: 'stun:stun.stunprotocol.org:3478' },
    { urls: 'stun:stun.voiparound.com' },
    { urls: 'stun:stun.voipbuster.com' },
    { urls: 'stun:stun.voxgratia.org' },
    { urls: 'stun:stun.antisip.com' },
    { urls: 'stun:stun.blinkenshell.org' },
    { urls: 'stun:stun.ekiga.net' },
    
    // TURN públicos (limitado uso pero mejor que nada)
    { urls: 'turn:turn.bistriz.com:80', username: 'homeo', credential: 'homeo' },
    { urls: 'turn:turn.bistriz.com:443', username: 'homeo', credential: 'homeo' },
    { urls: 'turn:turn.anyfirewall.com:443?transport=udp', username: 'webrtc', credential: 'webrtc' }
  ];
  
  peer = new RTCPeerConnection({
    iceServers: iceServers,
    iceCandidatePoolSize: 20,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceTransportPolicy: 'all', // Intentar todos los tipos de candidatos
    // Configuraciones de tiempo para mejorar reconexión
    iceConnectionTimeout: 15000,
    iceDisconnectedTimeout: 30000
  });
  
  // Preferir codecs VP9/AV1 para mejor calidad
  const codecs = RTCRtpSender.getCapabilities('video')?.codecs || [];
  const preferredCodecs = codecs
    .filter(c => c.mimeType.toLowerCase().includes('vp9') || c.mimeType.toLowerCase().includes('av1'))
    .sort((a, b) => (b.clockRate || 0) - (a.clockRate || 0));
  
    // Prioritize widely supported codecs: VP8 > VP9 > AV1 > H264
    const codecPriority = ['vp8', 'vp9', 'av1', 'h264'];
    const sortedCodecs = codecPriority
      .map(prefix => codecs
        .filter(c => c.mimeType.toLowerCase().includes(prefix))
        .sort((a, b) => (b.clockRate || 0) - (a.clockRate || 0)))
      .filter(group => group.length > 0)
      .reduce((acc, group) => acc.concat(group), []);
    
    if (sortedCodecs.length > 0) {
      console.log('[PEER] Codecs ordenados por prioridad:', sortedCodecs.map(c => c.mimeType).join(', '));
      // Optionally set codecs via setCodecPreferences if supported (Chrome 74+)
      if (typeof peer.setCodecPreferences === 'function') {
        try {
          peer.setCodecPreferences(sortedCodecs);
          console.log('[PEER] Codec preferences establecidas');
        } catch (e) {
          console.warn('[PEER] No se pudo establecer codec preferences:', e);
        }
      }
    }

// Keep-alive para mantener conexión ICE activa
let iceKeepAliveInterval = null;
const ICE_KEEP_ALIVE_INTERVAL = 15000; // 15 segundos

// Función para enviar keep-alive periódicamente
function startIceKeepAlive() {
  if (iceKeepAliveInterval) return;
  
  iceKeepAliveInterval = setInterval(() => {
    if (!peer) {
      stopIceKeepAlive();
      return;
    }
    
    // Enviar un paquetes nulo o hacer algo para mantener la conexión viva
    // En WebRTC, simplemente mantener el peer connection activo es suficiente
    // Pero podemos verificar el estado y reiniciar si es necesario
    
    if (peer.iceConnectionState === 'disconnected') {
      console.warn('[ICE] Estado disconnected detectado en keep-alive, intentando recuperación...');
      // Intentar renegociación suave
      if (peer.signalingState === 'stable') {
        if (type === 'p1') {
          console.log('[ICE] Intentando renegociación como p1...');
          createOffer().catch(err => {
            console.error('[ICE] Error en renegociación:', err);
          });
        }
      }
    }
  }, ICE_KEEP_ALIVE_INTERVAL);
}

function stopIceKeepAlive() {
  if (iceKeepAliveInterval) {
    clearInterval(iceKeepAliveInterval);
    iceKeepAliveInterval = null;
  }
}

// Timeout para ICE connection - solo activar después de crear offer
let iceTimeoutStarted = false;
const startIceTimeout = () => {
  if (iceTimeoutStarted) return;
  iceTimeoutStarted = true;
  
  iceTimeout = setTimeout(() => {
    if (peer && peer.iceConnectionState !== 'connected' && peer.iceConnectionState !== 'completed') {
      console.warn('[PEER] Timeout de conexión ICE, estado:', peer.iceConnectionState);
      handleConnectionError('ice-timeout');
    }
  }, ICE_CONNECTION_TIMEOUT);
};

// Cuando la conexión se establece, iniciar keep-alive
peer.oniceconnectionstatechange = () => {
  console.log('[PEER] Estado ICE:', peer.iceConnectionState, '| ICE gathering state:', peer.iceGatheringState);
  
  if (peer.iceConnectionState === 'failed') {
    console.error('[PEER] ICE fallido');
    if (!iceFailedNotified) {
      iceFailedNotified = true;
      handleConnectionError('ice-failed');
    }
  } else if (peer.iceConnectionState === 'disconnected') {
    console.warn('[PEER] ICE desconectado');
    if (iceDisconnectedStartTime === 0) {
      iceDisconnectedStartTime = Date.now();
    }
    
    // If disconnected for more than 5 seconds, treat as error
    const disconnectedDuration = Date.now() - iceDisconnectedStartTime;
    if (disconnectedDuration > 5000 && !iceFailedNotified) {
      console.warn('[PEER] ICE desconectado por demasiado tiempo, tratándolo como fallo');
      iceFailedNotified = true;
      handleConnectionError('ice-disconnected-timeout');
    }
  } else if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
    console.log('[PEER] ICE conectado exitosamente');
    iceFailedNotified = false;
    iceDisconnectedStartTime = 0;
    if (iceTimeout) {
      clearTimeout(iceTimeout);
      iceTimeout = null;
    }
    // Iniciar keep-alive cuando la conexión esté estable
    startIceKeepAlive();
  } else if (peer.iceConnectionState === 'checking' || peer.iceConnectionState === 'completed') {
    // Detener keep-alive durante estados transitorios
    stopIceKeepAlive();
  }
};

  peer.onicecandidate = (e) => {
    if (e.candidate && remoteSocket) {
      socket.emit('ice:send', { candidate: e.candidate, to: remoteSocket });
    }
  };

  peer.ontrack = (e) => {
    console.log('[PEER] Track recibido!', e.track.kind, 'Total streams:', e.streams.length);
    
    if (e.streams && e.streams[0]) {
      strangerVideo.srcObject = e.streams[0];
      strangerVideo.muted = true;
      
      setupVideoListeners();
      attemptVideoPlay();
    }
  };

  peer.onconnectionstatechange = () => {
    console.log('[PEER] Estado de conexión:', peer.connectionState);
    
    switch (peer.connectionState) {
      case 'failed':
        console.error('[PEER] Conexión fallida');
        handleConnectionError('failed');
        break;
      case 'disconnected':
        console.warn('[PEER] Conexión perdida');
        handleConnectionError('disconnected');
        break;
      case 'closed':
        console.log('[PEER] Conexión cerrada');
        break;
      case 'connected':
        console.log('[PEER] ¡Conexión establecida!');
        if (iceTimeout) {
          clearTimeout(iceTimeout);
          iceTimeout = null;
        }
        setupVideoListeners();
        attemptVideoPlay();
        break;
    }
  };

let iceFailedNotified = false;
let iceDisconnectedStartTime = 0;
let lastIceStateChange = Date.now();
  
  peer.oniceconnectionstatechange = () => {
    console.log('[PEER] Estado ICE:', peer.iceConnectionState, '| ICE gathering state:', peer.iceGatheringState);
    
    // Track time since last state change for stability detection
    const now = Date.now();
    const timeSinceLastChange = now - lastIceStateChange;
    lastIceStateChange = now;
    
    if (peer.iceConnectionState === 'failed') {
      console.error('[PEER] ICE fallido');
      if (!iceFailedNotified) {
        iceFailedNotified = true;
        handleConnectionError('ice-failed');
      }
    } else if (peer.iceConnectionState === 'disconnected') {
      console.warn('[PEER] ICE desconectado (estable desde hace', timeSinceLastChange, 'ms)');
      if (iceDisconnectedStartTime === 0) {
        iceDisconnectedStartTime = Date.now();
      }
      
      // If disconnected for more than 10 seconds, treat as error (increased from 5s)
      const disconnectedDuration = Date.now() - iceDisconnectedStartTime;
      if (disconnectedDuration > 10000 && !iceFailedNotified) {
        console.warn('[PEER] ICE desconectado por demasiado tiempo (>10s), tratándolo como fallo');
        iceFailedNotified = true;
        handleConnectionError('ice-disconnected-timeout');
      }
      
      // Try to recover if we've been disconnected for a while but not too long
      if (disconnectedDuration > 3000 && disconnectedDuration < 8000) {
        console.log('[PEER] Intentando recuperación suave de ICE desconectado...');
        // Try to restart ICE gathering if we've been stable disconnected for a few seconds
        if (peer.iceGatheringState === 'complete' && timeSinceLastChange > 2000) {
          console.log('[PEER] Reiniciando gathering de ICE...');
          // This might help restart ICE candidate gathering
        }
      }
    } else if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
      console.log('[PEER] ICE conectado exitosamente (estable desde hace', timeSinceLastChange, 'ms)');
      iceFailedNotified = false;
      iceDisconnectedStartTime = 0;
      if (iceTimeout) {
        clearTimeout(iceTimeout);
        iceTimeout = null;
      }
    }
  };

  peer.onnegotiationneeded = () => {
    console.log('[PEER] Negociación necesaria!');
    if (type === 'p1' && peer && peer.signalingState === 'stable') {
      createOffer();
    }
  };

  if (localStream) {
    addTracksToPeerGlobal();
  } else {
    console.debug('[PEER] localStream se agregará después...');
  }
  
  monitorConnectionQuality();
}

// ============================================
// MONITOREO DE CONEXIÓN (optimizado)
// ============================================
let statsInterval = null;
let lastBytesReceived = 0;
let lastCheckTime = 0;

function monitorConnectionQuality() {
  if (statsInterval) clearInterval(statsInterval);
  
  statsInterval = setInterval(async () => {
    if (!peer || peer.connectionState === 'closed') {
      clearInterval(statsInterval);
      return;
    }
    
    try {
      const stats = await peer.getStats();
      let videoInbound = null;
      let candidatePair = null;
      
      // Solo收集 métricas clave
      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          videoInbound = report;
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          candidatePair = report;
        }
      });
      
      if (!videoInbound) return;
      
      // Calcular bitrate recibido
      const now = Date.now();
      if (lastCheckTime > 0) {
        const timeDiff = (now - lastCheckTime) / 1000;
        const bytesDiff = (videoInbound.bytesReceived || 0) - lastBytesReceived;
        const bitrateReceived = timeDiff > 0 ? Math.round((bytesDiff * 8) / timeDiff) : 0;
        
        // Adaptar calidad según bitrate
        adaptBitrate(bitrateReceived, candidatePair);
      }
      
      lastBytesReceived = videoInbound.bytesReceived || 0;
      lastCheckTime = now;
      
      // Verificar pérdida de paquetes
      const packetsLost = videoInbound.packetsLost || 0;
      const totalPackets = (videoInbound.packetsReceived || 0) + packetsLost;
      const lossRate = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;
      
      if (lossRate > 10) {
        console.warn('[STATS] Alta pérdida de paquetes:', lossRate.toFixed(2) + '%');
        handleConnectionError('high-packet-loss');
      }
    } catch (err) {
      console.warn('[STATS] Error:', err.message);
    }
  }, 5000);
}

// ============================================
// SISTEMA SIMPLIFICADO DE ADAPTACIÓN DE BITRATE
// ============================================

const QUALITY_PRESETS = {
  high: { maxBitrate: 5000000, minBitrate: 1500000 },
  medium: { maxBitrate: 2500000, minBitrate: 800000 },
  low: { maxBitrate: 1000000, minBitrate: 300000 }
};

let currentQualityLevel = 'high';

function adaptBitrate(bitrate, candidatePair) {
  if (!peer) return;
  
  const rtt = candidatePair?.currentRoundTripTime ? candidatePair.currentRoundTripTime * 1000 : 0;
  
  // Determinar nivel de calidad
  let newQualityLevel = 'high';
  
  if (rtt > 400 || bitrate < 300000) {
    newQualityLevel = 'low';
  } else if (rtt > 200 || bitrate < 800000) {
    newQualityLevel = 'medium';
  }
  
  if (newQualityLevel !== currentQualityLevel) {
    const preset = QUALITY_PRESETS[newQualityLevel];
    console.log('[QUALITY] Cambiando calidad:', currentQualityLevel, '->', newQualityLevel, '| RTT:', rtt.toFixed(0), 'ms');
    currentQualityLevel = newQualityLevel;
    
    peer.getSenders().forEach(sender => {
      if (sender.track?.kind === 'video') {
        const params = sender.getParameters();
        if (params.encodings?.[0]) {
          params.encodings[0].maxBitrate = preset.maxBitrate;
          params.encodings[0].minBitrate = preset.minBitrate;
          sender.setParameters(params).catch(() => {});
        }
      }
    });
  }
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
    
    // Reiniciar contadores de retry
    videoPlayRetries = 0;
    
    // Crear peer connection PRIMERO, para estar listo para recibir SDP
    setupPeerConnection();
    
    // Luego inicializar media
    initMedia().then(() => {
      // Si somos p1, crear offer después de que todo esté listo
      if (type === 'p1') {
        console.log('[WEBRTC] Soy p1, creando offer...');
        // Pequeño delay para asegurar que el peer está listo
        setTimeout(() => {
          if (peer && peer.signalingState === 'stable') {
            createOffer();
          }
        }, 300);
      }
      
      // Si tenemos SDP pendiente (llegó antes de que estuviera listo), procesarlo ahora
      if (pendingSdp) {
        console.log('[WEBRTC] Procesando SDP pendiente con peer listo...');
        processPendingMessages();
      }
    }).catch((err) => {
      console.error('[SOCKET] Error initMedia:', err);
      // Continuar aunque falle initMedia - el peer ya está creado
      if (type === 'p1') {
        console.log('[WEBRTC] Soy p1, creando offer...');
        // Pequeño delay para asegurar que el peer está listo
        setTimeout(() => {
          if (peer && peer.signalingState === 'stable') {
            createOffer();
          }
        }, 300);
      }
      
      // Si tenemos SDP pendiente, procesarlo ahora
      if (pendingSdp) {
        console.log('[WEBRTC] Procesando SDP pendiente con peer listo...');
        processPendingMessages();
      }
    });
  });

  function addTracksToPeer() {
    if (!localStream || !peer) return;
    
    const videoTrack = localStream.getVideoTracks()[0];
    const audioTrack = localStream.getAudioTracks()[0];
    
    localStream.getTracks().forEach(track => {
      const existingSender = peer.getSenders().find(s => s.track?.kind === track.kind);
      if (!existingSender) {
        console.log('[PEER] Agregando track:', track.kind);
        peer.addTrack(track, localStream);
      }
    });
    
    console.log('[PEER] Total senders:', peer.getSenders().length);
    
    // Configurar calidad de video mejorada después de agregar tracks
    setTimeout(() => {
      configureTrackQuality(videoTrack, audioTrack);
    }, 200);
    
    // Procesar mensajes pendientes (SDP e ICE)
    processPendingMessages();
  }
  
  // Configurar calidad óptima de tracks
  function configureTrackQuality(videoTrack, audioTrack) {
    if (!peer) return;
    
    const senders = peer.getSenders();
    
    senders.forEach(sender => {
      if (!sender.track) return;
      
      const params = sender.getParameters();
      if (!params.encodings) params.encodings = [{}];
      
      if (sender.track.kind === 'video') {
        // Mayor bitrate para mejor calidad
        const isHD = preferredVideoConstraints?.width?.ideal >= 1920;
        const maxBitrate = isHD ? 6000000 : 4000000;
        const minBitrate = isHD ? 1500000 : 800000;
        
        params.encodings[0] = {
          ...params.encodings[0],
          maxBitrate: maxBitrate,
          minBitrate: minBitrate,
          scalabilityMode: 'L1T3',
          networkPriority: 'high'
        };
        
        console.log('[PEER] Configurando video:', { maxBitrate, minBitrate, isHD });
        
      } else if (sender.track.kind === 'audio') {
        params.encodings[0] = {
          ...params.encodings[0],
          maxBitrate: 128000,
          priority: 'high',
          networkPriority: 'high'
        };
      }
      
      sender.setParameters(params).catch(err => {
        console.warn('[PEER] Error configurando calidad:', err);
      });
    });
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
      console.log('[SDP] Recibido SDP reply:', sdp.type, '| Mi tipo:', type, '| Peer existe:', !!peer);
      
      if (!peer) {
        console.log('[SDP] Guardando SDP para después...');
        pendingSdp = sdp;
        return;
      }
      
      handleSdp(sdp);
    });

    function handleSdp(sdp) {
      if (!peer) return;
      
      // Verificar estado de señalización
      if (peer.signalingState === 'have-local-offer' && sdp.type === 'answer') {
        console.log('[SDP] Procesando answer...');
      } else if (sdp.type === 'offer') {
        console.log('[SDP] Procesando offer...');
      }
      
      try {
        peer.setRemoteDescription(new RTCSessionDescription(sdp))
          .then(() => {
            console.log('[SDP] Remote description configurada, signalingState:', peer.signalingState);
            
            if (type === 'p2' && sdp.type === 'offer') {
              console.log('[SDP] Soy p2, creando answer...');
              return peer.createAnswer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
              });
            }
            return null;
          })
          .then(answer => {
            if (answer) {
              return peer.setLocalDescription(answer);
            }
            return null;
          })
          .then(() => {
            if (type === 'p2' && peer.localDescription) {
              console.log('[SDP] Enviando answer...');
              socket.emit('sdp:send', { sdp: peer.localDescription });
            } else if (type === 'p1' && sdp.type === 'answer') {
              console.log('[SDP] Soy p1, respuesta recibida y completada');
            }
          })
          .catch(err => {
            console.error('[SDP] Error en proceso SDP:', err);
          });
      } catch (err) {
        console.error('[SDP] Error handling SDP:', err);
      }
    }

    socket.on('ice:reply', async ({ candidate }) => {
      console.log('[ICE] Recibido ICE candidate');
      handleIce(candidate);
    });

    function handleIce(candidate) {
      if (!peer) {
        console.log('[ICE] Peer no existe, guardando para después');
        pendingIceCandidates.push(candidate);
        return;
      }
      
      // Solo procesar ICE si tenemos remote description
      if (!peer.remoteDescription || peer.remoteDescription.type === '') {
        console.log('[ICE] No hay remote description completa, guardando...');
        pendingIceCandidates.push(candidate);
        return;
      }
      
      try {
        peer.addIceCandidate(new RTCIceCandidate(candidate))
          .then(() => {
            console.log('[ICE] ICE candidate añadido correctamente');
          })
          .catch(err => {
            console.error('[ICE] Error añadiendo candidate:', err);
          });
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

// Funciones globales para WebRTC (una sola fuente de verdad)
function addTracksToPeerGlobal() {
  if (!localStream || !peer) return;
  
  const videoTrack = localStream.getVideoTracks()[0];
  const audioTrack = localStream.getAudioTracks()[0];
  
  localStream.getTracks().forEach(track => {
    const existingSender = peer.getSenders().find(s => s.track?.kind === track.kind);
    if (!existingSender) {
      console.log('[PEER] Agregando track:', track.kind);
      peer.addTrack(track, localStream);
    }
  });
  
  console.log('[PEER] Total senders:', peer.getSenders().length);
  
  setTimeout(() => {
    configureTrackQualityGlobal(videoTrack, audioTrack);
  }, 200);
  
  processPendingMessagesGlobal();
}

function configureTrackQualityGlobal(videoTrack, audioTrack) {
  if (!peer) return;
  
  const senders = peer.getSenders();
  
  senders.forEach(sender => {
    if (!sender.track) return;
    
    const params = sender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    
    if (sender.track.kind === 'video') {
      const isHD = preferredVideoConstraints?.width?.ideal >= 1920;
      const maxBitrate = isHD ? 6000000 : 4000000;
      const minBitrate = isHD ? 1500000 : 800000;
      
      params.encodings[0] = {
        ...params.encodings[0],
        maxBitrate: maxBitrate,
        minBitrate: minBitrate,
        scalabilityMode: 'L1T3',
        networkPriority: 'high'
      };
      
      console.log('[PEER] Configurando video:', { maxBitrate, minBitrate, isHD });
      
    } else if (sender.track.kind === 'audio') {
      params.encodings[0] = {
        ...params.encodings[0],
        maxBitrate: 128000,
        priority: 'high',
        networkPriority: 'high'
      };
    }
    
    sender.setParameters(params).catch(err => {
      console.warn('[PEER] Error configurando calidad:', err);
    });
  });
}

function processPendingMessagesGlobal() {
  if (!peer) return;
  
  if (pendingIceCandidates.length > 0) {
    pendingIceCandidates.forEach(candidate => {
      console.log('[ICE] Procesando ICE pendiente...');
      handleIceGlobal(candidate);
    });
    pendingIceCandidates = [];
  }
  
  if (pendingSdp) {
    console.log('[SDP] Procesando SDP pendiente...');
    handleSdpGlobal(pendingSdp);
    pendingSdp = null;
  }
}

// Handlers globales para mensajes pendientes
function handleIceGlobal(candidate) {
  if (!peer) {
    console.debug('[ICE] Peer no existe, guardando para después');
    pendingIceCandidates.push(candidate);
    return;
  }
  
  // Solo procesar ICE si tenemos remote description
  if (!peer.remoteDescription || !peer.remoteDescription.type) {
    console.debug('[ICE] No hay remote description completa, guardando...');
    pendingIceCandidates.push(candidate);
    return;
  }
  
  try {
    peer.addIceCandidate(new RTCIceCandidate(candidate))
      .then(() => {
        console.debug('[ICE] ICE candidate añadido correctamente');
      })
      .catch(err => {
        console.error('[ICE] Error añadiendo candidate:', err);
      });
  } catch (err) {
    console.error('[ICE] Error handling ICE candidate:', err);
  }
}

function handleSdpGlobal(sdp) {
  if (!peer) return;
  
  // Si ya está en stable y recebimos answer, ignoramos (ICE ya conectó)
  if (peer.signalingState === 'stable' && sdp.type === 'answer') {
    console.log('[SDP] Ya en stable, ignorando answer duplicado');
    return;
  }
  
  if (peer.signalingState === 'have-local-offer' && sdp.type === 'answer') {
    console.log('[SDP] Procesando answer...');
  } else if (sdp.type === 'offer') {
    console.log('[SDP] Procesando offer...');
  }
  
  try {
    peer.setRemoteDescription(new RTCSessionDescription(sdp))
      .then(() => {
        console.log('[SDP] Remote description configurada, signalingState:', peer.signalingState);
        
        if (type === 'p2' && sdp.type === 'offer') {
          console.log('[SDP] Soy p2, creando answer...');
          return peer.createAnswer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
          });
        }
        return null;
      })
      .then(answer => {
        if (answer) {
          return peer.setLocalDescription(answer);
        }
        return null;
      })
      .then(() => {
        if (type === 'p2' && peer.localDescription) {
          console.log('[SDP] Enviando answer...');
          socket.emit('sdp:send', { sdp: peer.localDescription });
        } else if (type === 'p1' && sdp.type === 'answer') {
          console.log('[SDP] Soy p1, respuesta recibida y completada');
        }
      })
      .catch(err => {
        console.error('[SDP] Error en proceso SDP:', err);
      });
  } catch (err) {
    console.error('[SDP] Error handling SDP:', err);
  }
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
    
    // Iniciar timeout de ICE después de enviar oferta
    setTimeout(() => {
      if (peer && peer.iceConnectionState !== 'connected' && peer.iceConnectionState !== 'completed') {
        console.log('[PEER] Iniciando timeout de ICE...');
        iceTimeout = setTimeout(() => {
          if (peer && peer.iceConnectionState !== 'connected' && peer.iceConnectionState !== 'completed') {
            console.warn('[PEER] Timeout de conexión ICE, estado:', peer.iceConnectionState);
            handleConnectionError('ice-timeout');
          }
        }, ICE_CONNECTION_TIMEOUT);
      }
    }, 2000);
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