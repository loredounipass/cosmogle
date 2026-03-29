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
}

// Inicializar cámara/micrófono
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false, 
        sampleRate: { ideal: 48000 },
        sampleSize: { ideal: 16 },
        channelCount: { ideal: 1 } 
      },
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
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
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
            sampleRate: { ideal: 48000 },
            sampleSize: { ideal: 16 },
            channelCount: { ideal: 1 }
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
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
            sampleRate: { ideal: 48000 },
            sampleSize: { ideal: 16 },
            channelCount: { ideal: 1 }
          },
          video: {
            width: { ideal: 640 },
            height: { ideal: 360 },
            frameRate: { ideal: 20 },
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
  peer = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });

  peer.onicecandidate = (e) => {
    if (e.candidate && remoteSocket) {
      socket.emit('ice:send', { candidate: e.candidate, to: remoteSocket });
    }
  };

  peer.ontrack = (e) => {
    strangerVideo.srcObject = e.streams[0];

    // Asegurarse de que el video no intente reproducirse si ya está cargando
    strangerVideo.onloadeddata = () => {
      strangerVideo.play().catch(() => {});
    };
  };

  if (localStream) {
    localStream.getTracks().forEach(track => {
      peer.addTrack(track, localStream);
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
    socket.emit('start', (personType) => {
      type = personType;
    });
  });

  socket.on('start', (personType) => {
    type = personType;
  });

  socket.on('roomid', (id) => {
    roomid = id;
  });

  socket.on('remote-socket', (partnerId) => {
    remoteSocket = partnerId;
    spinner.style.display = 'none';
    
    // Asegurar que la cámara esté activa antes de configurar la conexión
    if (!localStream) {
      initMedia().then(() => {
        setupPeerConnection();
        if (type === 'p1') {
          createOffer();
        }
      });
    } else {
      setupPeerConnection();
      if (type === 'p1') {
        createOffer();
      }
    }
  });

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
     if (!peer) return;

     try {
       await peer.setRemoteDescription(new RTCSessionDescription(sdp));
       if (type === 'p2') {
         const answer = await peer.createAnswer();
         await peer.setLocalDescription(answer);
         socket.emit('sdp:send', { sdp: peer.localDescription });
       }
     } catch (err) {
       console.error('Error handling SDP reply:', err);
     }
   });

   socket.on('ice:reply', async ({ candidate }) => {
     if (!peer) return;

     try {
       await peer.addIceCandidate(new RTCIceCandidate(candidate));
     } catch (err) {
       console.error('Error handling ICE candidate:', err);
     }
   });

   socket.on('ice:reply', async ({ candidate }) => {
     if (!peer) return;

     try {
       await peer.addIceCandidate(new RTCIceCandidate(candidate));
     } catch (err) {
       console.error('Error handling ICE candidate:', err);
     }
   });

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
  if (!peer) return;

  try {
    const offer = await peer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await peer.setLocalDescription(offer);
    socket.emit('sdp:send', { sdp: peer.localDescription });
  } catch (err) {}
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