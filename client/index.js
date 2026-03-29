// ============================================
// APLICACIÓN PRINCIPAL - WebRTC P2P (Production Ready)
// ============================================

import { io } from 'socket.io-client';

// ============================================
// FSM - Finite State Machine
// ============================================
const AppState = {
  IDLE: 'IDLE',
  CONNECTING: 'CONNECTING',
  MATCHED: 'MATCHED',
  NEGOTIATING: 'NEGOTIATING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  DISCONNECTED: 'DISCONNECTED'
};

// ============================================
// ESTADO CENTRALIZADO
// ============================================
const STATE = {
  // Core state
  appState: AppState.IDLE,
  
  // Connection
  peer: null,
  localStream: null,
  remoteSocket: null,
  type: null,
  roomid: null,
  socket: null,
  
  // Media state
  isCameraOff: false,
  isMuted: false,
  
  // Flow control
  isExiting: false,
  isNegotiating: false,
  isReconnecting: false,
  
  // Pending messages
  pendingSdp: null,
  pendingIceCandidates: [],
  
  // Retry system
  retryCount: 0,
  
  // Media
  videoPlayRetries: 0,
  preferredVideoConstraints: null,
  currentQualityLevel: 'high'
};

// ============================================
// TIMERS MANAGER (evita memory leaks)
// ============================================
const timers = new Map();

function setTimer(name, fn, time) {
  clearTimer(name);
  timers.set(name, setTimeout(fn, time));
}

function clearTimer(name) {
  if (timers.has(name)) {
    clearTimeout(timers.get(name));
    timers.delete(name);
  }
}

function clearAllTimers() {
  timers.forEach((timeout) => clearTimeout(timeout));
  timers.clear();
}

// ============================================
// CONFIGURACIÓN
// ============================================
const CONFIG = {
  SOCKET_URL: 'https://urban-capybara-jv4j5754gpw3qpv6-8000.app.github.dev',
  ICE_CONNECTION_TIMEOUT: 30000,
  MAX_VIDEO_PLAY_RETRIES: 5,
  MAX_RECONNECT_RETRIES: 5,
  STATS_INTERVAL: 5000,
  QUALITY: {
    high: { maxBitrate: 5000000, minBitrate: 1500000 },
    medium: { maxBitrate: 2500000, minBitrate: 800000 },
    low: { maxBitrate: 1000000, minBitrate: 300000 }
  }
};

// ============================================
// ELEMENTOS DEL DOM
// ============================================
const DOM = {
  myVideo: document.getElementById('my-video'),
  strangerVideo: document.getElementById('video'),
  sendButton: document.getElementById('send'),
  inputField: document.getElementById('messageInput'),
  chatWrapper: document.querySelector('.chat-holder .wrapper'),
  typingIndicator: document.getElementById('typingIndicator'),
  nextBtn: document.getElementById('nextBtn'),
  exitBtn: document.getElementById('exitBtn'),
  spinner: document.querySelector('.modal'),
  cameraBtn: document.getElementById('cameraBtn'),
  statusIndicator: null
};

// ============================================
// HELPERS
// ============================================
function isMobile() {
  return /Mobi|Android/i.test(navigator.userAgent);
}

function sanitize(text) {
  return text.replace(/[<>]/g, '');
}

function log(type, msg, data = null) {
  console.log(`[${type}] ${msg}`, data || '');
}

// ============================================
// FSM - State Management
// ============================================
function setAppState(newState) {
  const oldState = STATE.appState;
  STATE.appState = newState;
  log('FSM', `${oldState} → ${newState}`);
  
  // Update UI status indicator
  updateStatusIndicator(newState);
}

function canPerformAction(action) {
  const current = STATE.appState;
  
  // Always allowed actions
  if (action === 'cleanup' || action === 'exit') return true;
  
  // Block conflicting actions during certain states
  if (current === AppState.NEGOTIATING && (action === 'match' || action === 'offer')) {
    log('FSM', `Blocked: ${action} during ${current}`);
    return false;
  }
  
  if (current === AppState.RECONNECTING && (action === 'match' || action === 'offer')) {
    log('FSM', `Blocked: ${action} during ${current}`);
    return false;
  }
  
  return true;
}

function updateStatusIndicator(state) {
  if (!DOM.statusIndicator) return;
  
  const statusMap = {
    [AppState.IDLE]: { text: 'Idle', color: '#666' },
    [AppState.CONNECTING]: { text: 'Connecting...', color: '#ff9800' },
    [AppState.MATCHED]: { text: 'Matched!', color: '#4caf50' },
    [AppState.NEGOTIATING]: { text: 'Negotiating...', color: '#2196f3' },
    [AppState.CONNECTED]: { text: 'Connected', color: '#4caf50' },
    [AppState.RECONNECTING]: { text: 'Reconnecting...', color: '#ff9800' },
    [AppState.DISCONNECTED]: { text: 'Disconnected', color: '#f44336' }
  };
  
  const status = statusMap[state];
  if (status) {
    DOM.statusIndicator.textContent = status.text;
    DOM.statusIndicator.style.color = status.color;
  }
}

// ============================================
// ERROR HANDLING CENTRALIZADO
// ============================================
function safeAsync(fn, context) {
  return (...args) => {
    try {
      return fn(...args).catch(e => log('ERROR', context, e));
    } catch (err) {
      log('ERROR', `${context} - sync`, err);
    }
  };
}

function handleError(type, error) {
  log('ERROR', type, error);
  
  if (type.includes('ICE') || type.includes('connection')) {
    if (!STATE.isReconnecting && STATE.retryCount < CONFIG.MAX_RECONNECT_RETRIES) {
      scheduleReconnect();
    } else if (STATE.retryCount >= CONFIG.MAX_RECONNECT_RETRIES) {
      showNotification('Connection failed. Please try again.');
      STATE.retryCount = 0;
    }
  }
}

// ============================================
// EXPONENTIAL BACKOFF
// ============================================
function getBackoffDelay(retryCount) {
  // delay = min(1000 * 2^retryCount, 10000)
  return Math.min(1000 * Math.pow(2, retryCount), 10000);
}

function scheduleReconnect() {
  if (STATE.isExiting || STATE.isReconnecting) return;
  
  STATE.isReconnecting = true;
  STATE.retryCount++;
  
  const delay = getBackoffDelay(STATE.retryCount);
  
  log('RECONNECT', `Attempt ${STATE.retryCount}/${CONFIG.MAX_RECONNECT_RETRIES} in ${delay}ms`);
  showNotification(`Reconnecting... (${STATE.retryCount}/${CONFIG.MAX_RECONNECT_RETRIES})`);
  
  setAppState(AppState.RECONNECTING);
  
  setTimer('reconnect', () => {
    fullCleanup();
    restartConnection();
  }, delay);
}

// ============================================
// MEDIA
// ============================================
async function initMedia() {
  try {
    // Reset camera state to ON
    STATE.isCameraOff = false;
    if (DOM.cameraBtn) {
      DOM.cameraBtn.querySelector('.glitch-text').textContent = 'OFF';
    }
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    
    const videoConstraints = videoDevices.length > 0 ? {
      deviceId: { exact: videoDevices[0].deviceId },
      width: { ideal: 1920, min: 1280 },
      height: { ideal: 1080, min: 720 },
      frameRate: { ideal: 30, min: 24 },
      facingMode: "user"
    } : {
      width: { ideal: 1920, min: 1280 },
      height: { ideal: 1080, min: 720 },
      frameRate: { ideal: 30, min: 24 },
      facingMode: "user"
    };
    
    STATE.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true }
      },
      video: videoConstraints
    });
    
    // Ensure all video and audio tracks are ENABLED
    STATE.localStream.getVideoTracks().forEach(track => {
      track.enabled = true;
    });
    STATE.localStream.getAudioTracks().forEach(track => {
      track.enabled = true;
    });
    
    DOM.myVideo.srcObject = STATE.localStream;
    DOM.myVideo.muted = true;
    STATE.preferredVideoConstraints = videoConstraints;
    
    log('MEDIA', 'Stream initialized - Camera ON', { 
      width: videoConstraints.width.ideal, 
      height: videoConstraints.height.ideal,
      videoTracks: STATE.localStream.getVideoTracks().length,
      audioTracks: STATE.localStream.getAudioTracks().length
    });
  } catch (err) {
    log('MEDIA', 'Error initializing media', err);
    throw err;
  }
}

// ============================================
// VIDEO PLAYBACK
// ============================================
function setupVideoListeners() {
  DOM.strangerVideo.onplaying = () => {
    STATE.videoPlayRetries = 0;
    log('VIDEO', 'Playing');
  };
  
  DOM.strangerVideo.onwaiting = () => attemptPlay();
  DOM.strangerVideo.onstalled = () => attemptPlay();
  DOM.strangerVideo.onerror = () => attemptPlay();
  
  // Pause video when tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      log('VIDEO', 'Tab hidden - pausing');
    } else {
      log('VIDEO', 'Tab visible - resuming');
      attemptPlay();
    }
  });
}

function attemptPlay() {
  if (!DOM.strangerVideo.srcObject) return;
  
  DOM.strangerVideo.muted = true;
  
  if (STATE.videoPlayRetries >= CONFIG.MAX_VIDEO_PLAY_RETRIES) {
    log('VIDEO', 'Max retries reached');
    return;
  }
  
  STATE.videoPlayRetries++;
  const delay = Math.min(1000 * Math.pow(2, STATE.videoPlayRetries), 5000);
  
  DOM.strangerVideo.play()
    .catch(() => {
      log('VIDEO', `Retry ${STATE.videoPlayRetries} in ${delay}ms`);
      setTimer('videoRetry', attemptPlay, delay);
    });
}

// ============================================
// PEER CONNECTION
// ============================================
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
  { urls: 'turn:turn.bistriz.com:80', username: 'homeo', credential: 'homeo' },
  { urls: 'turn:turn.bistriz.com:443', username: 'homeo', credential: 'homeo' }
];

function createPeerConnection() {
  if (!canPerformAction('peer')) return;
  
  STATE.peer = new RTCPeerConnection({
    iceServers: ICE_SERVERS,
    iceCandidatePoolSize: 20,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  });
  
  // ICE Candidate Handler
  STATE.peer.onicecandidate = (e) => {
    if (e.candidate && STATE.remoteSocket) {
      STATE.socket.emit('ice:send', { candidate: e.candidate });
    }
  };
  
  // Track Handler
  STATE.peer.ontrack = (e) => {
    log('PEER', `Track received: ${e.track.kind}`);
    DOM.strangerVideo.srcObject = e.streams[0];
    setupVideoListeners();
    attemptPlay();
  };
  
  // Connection State Handler
  STATE.peer.onconnectionstatechange = () => {
    const state = STATE.peer?.connectionState;
    log('PEER', `Connection state: ${state}`);
    
    if (state === 'connected') {
      clearTimer('iceTimeout');
      setAppState(AppState.CONNECTED);
      STATE.isReconnecting = false;
      STATE.retryCount = 0;
    } else if (state === 'failed') {
      handleError('CONNECTION_FAILED', state);
    }
  };
  
  // ICE Connection State Handler
  STATE.peer.oniceconnectionstatechange = () => {
    const state = STATE.peer?.iceConnectionState;
    log('PEER', `ICE state: ${state}`);
    
    if (state === 'failed') {
      handleError('ICE_FAILED', state);
    }
  };
  
  // Add tracks if stream exists
  if (STATE.localStream) {
    STATE.localStream.getVideoTracks().forEach(track => {
      track.enabled = true;
    });
    STATE.localStream.getAudioTracks().forEach(track => {
      track.enabled = true;
    });
    
    STATE.localStream.getTracks().forEach(track => {
      STATE.peer.addTrack(track, STATE.localStream);
    });
    configureBitrate();
  }
  
  // Start ICE timeout
  setTimer('iceTimeout', () => {
    if (STATE.peer?.iceConnectionState !== 'connected') {
      handleError('ICE_TIMEOUT', 'No connection after 30s');
    }
  }, CONFIG.ICE_CONNECTION_TIMEOUT);
  
  log('PEER', 'Connection created');
}

function configureBitrate() {
  if (!STATE.peer) return;
  
  const isHD = STATE.preferredVideoConstraints?.width?.ideal >= 1920;
  const maxBitrate = isHD ? 6000000 : 4000000;
  const minBitrate = isHD ? 1500000 : 800000;
  
  STATE.peer.getSenders().forEach(sender => {
    if (!sender.track) return;
    
    const params = sender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    
    if (sender.track.kind === 'video') {
      params.encodings[0] = {
        ...params.encodings[0],
        maxBitrate,
        minBitrate,
        scalabilityMode: 'L1T3',
        networkPriority: 'high',
        degradationPreference: 'maintain-framerate'
      };
    } else if (sender.track.kind === 'audio') {
      params.encodings[0] = {
        ...params.encodings[0],
        maxBitrate: 128000,
        priority: 'high'
      };
    }
    
    sender.setParameters(params).catch(() => {});
  });
  
  log('PEER', 'Bitrate configured', { maxBitrate, minBitrate, isHD });
}

// ============================================
// SDP HANDLING
// ============================================
async function createOffer() {
  if (!STATE.peer || !canPerformAction('offer')) {
    log('SDP', 'createOffer blocked');
    return;
  }
  
  // Prevent race condition - only one offer at a time
  if (STATE.isNegotiating) {
    log('SDP', 'Already negotiating, skipping');
    return;
  }
  
  STATE.isNegotiating = true;
  setAppState(AppState.NEGOTIATING);
  
  try {
    const offer = await STATE.peer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    
    await STATE.peer.setLocalDescription(offer);
    STATE.socket.emit('sdp:send', { sdp: STATE.peer.localDescription });
    
    log('SDP', 'Offer sent');
  } catch (err) {
    log('ERROR', 'createOffer failed', err);
    STATE.isNegotiating = false;
  }
}

async function handleSdp(sdp) {
  if (!STATE.peer) return;
  
  // Ignore duplicate answers
  if (STATE.peer.signalingState === 'stable' && sdp.type === 'answer') {
    return;
  }
  
  try {
    await STATE.peer.setRemoteDescription(new RTCSessionDescription(sdp));
    
    if (STATE.type === 'p2' && sdp.type === 'offer') {
      const answer = await STATE.peer.createAnswer();
      await STATE.peer.setLocalDescription(answer);
      STATE.socket.emit('sdp:send', { sdp: STATE.peer.localDescription });
      log('SDP', 'Answer sent');
    }
    
    STATE.isNegotiating = false;
  } catch (err) {
    log('ERROR', 'handleSdp failed', err);
  }
}

// ============================================
// ICE HANDLING
// ============================================
async function handleIce(candidate) {
  if (!STATE.peer) {
    STATE.pendingIceCandidates.push(candidate);
    return;
  }
  
  if (!STATE.peer.remoteDescription || !STATE.peer.remoteDescription.type) {
    STATE.pendingIceCandidates.push(candidate);
    return;
  }
  
  try {
    await STATE.peer.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    log('ICE', 'Error adding candidate', err);
  }
}

function processPendingMessages() {
  if (!STATE.peer) return;
  
  if (STATE.pendingIceCandidates.length > 0) {
    STATE.pendingIceCandidates.forEach(handleIce);
    STATE.pendingIceCandidates = [];
  }
  
  if (STATE.pendingSdp) {
    handleSdp(STATE.pendingSdp);
    STATE.pendingSdp = null;
  }
}

// ============================================
// QUALITY ADAPTATION
// ============================================
function adaptBitrate(bitrate, rtt) {
  if (!STATE.peer) return;
  
  let newLevel = 'high';
  if (rtt > 400 || bitrate < 300000) newLevel = 'low';
  else if (rtt > 200 || bitrate < 800000) newLevel = 'medium';
  
  if (newLevel !== STATE.currentQualityLevel) {
    const preset = CONFIG.QUALITY[newLevel];
    STATE.currentQualityLevel = newLevel;
    
    STATE.peer.getSenders().forEach(sender => {
      if (sender.track?.kind === 'video') {
        const params = sender.getParameters();
        if (params.encodings?.[0]) {
          params.encodings[0].maxBitrate = preset.maxBitrate;
          params.encodings[0].minBitrate = preset.minBitrate;
          sender.setParameters(params).catch(() => {});
        }
      }
    });
    
    log('QUALITY', `Changed to ${newLevel}`, { rtt, bitrate });
  }
}

// ============================================
// STATS MONITORING
// ============================================
let statsInterval = null;
let lastBytes = 0;
let lastTime = 0;

function startStatsMonitoring() {
  if (statsInterval) clearInterval(statsInterval);
  
  statsInterval = setInterval(safeAsync(async () => {
    if (!STATE.peer || STATE.peer.connectionState === 'closed') return;
    
    const stats = await STATE.peer.getStats();
    let videoInbound = null;
    let candidatePair = null;
    
    stats.forEach(report => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        videoInbound = report;
      }
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        candidatePair = report;
      }
    });
    
    if (!videoInbound) return;
    
    const now = Date.now();
    if (lastTime > 0) {
      const timeDiff = (now - lastTime) / 1000;
      const bytesDiff = (videoInbound.bytesReceived || 0) - lastBytes;
      const bitrate = timeDiff > 0 ? Math.round((bytesDiff * 8) / timeDiff) : 0;
      
      const rtt = candidatePair?.currentRoundTripTime 
        ? candidatePair.currentRoundTripTime * 1000 
        : 0;
      
      adaptBitrate(bitrate, rtt);
      
      const lost = videoInbound.packetsLost || 0;
      const total = (videoInbound.packetsReceived || 0) + lost;
      const lossRate = total > 0 ? (lost / total) * 100 : 0;
      
      if (lossRate > 10) {
        log('STATS', 'High packet loss', { lossRate: lossRate.toFixed(2) });
      }
    }
    
    lastBytes = videoInbound.bytesReceived || 0;
    lastTime = now;
  }, 'STATS'), CONFIG.STATS_INTERVAL);
}

// ============================================
// CLEANUP
// ============================================
function fullCleanup() {
  log('CLEANUP', 'Starting');
  
  clearAllTimers();
  
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  
  STATE.videoPlayRetries = 0;
  STATE.pendingSdp = null;
  STATE.pendingIceCandidates = [];
  STATE.currentQualityLevel = 'high';
  STATE.isNegotiating = false;
  
  if (STATE.peer) {
    STATE.peer.close();
    STATE.peer = null;
  }
  
  if (STATE.localStream) {
    STATE.localStream.getTracks().forEach(t => t.stop());
    STATE.localStream = null;
  }
  
  DOM.myVideo.srcObject = null;
  DOM.strangerVideo.srcObject = null;
  DOM.spinner.style.display = 'flex';
  DOM.chatWrapper.innerHTML = '';
  
  log('CLEANUP', 'Complete');
}

// ============================================
// RESTART CONNECTION
// ============================================
function restartConnection() {
  STATE.remoteSocket = null;
  STATE.roomid = null;
  STATE.type = null;
  STATE.isNegotiating = false;
  
  STATE.socket.emit('disconnect-me');
  
  setTimer('restart', async () => {
    try {
      await initMedia();
    } catch (err) {
      log('MEDIA', 'Init media failed', err);
    }
    
    STATE.socket.emit('start', (newType) => {
      STATE.type = newType;
    });
  }, CONFIG.MAX_RECONNECT_RETRIES);
}

// ============================================
// SOCKET EVENTS
// ============================================
function setupSocketEvents() {
  STATE.socket.on('connect', () => {
    log('SOCKET', 'Connected');
    setAppState(AppState.CONNECTING);
    STATE.socket.emit('start', (personType) => {
      STATE.type = personType;
      log('SOCKET', `My type: ${personType}`);
    });
  });
  
  STATE.socket.on('roomid', (id) => {
    STATE.roomid = id;
    log('SOCKET', `Room: ${id}`);
  });
  
  STATE.socket.on('remote-socket', (partnerId) => {
    if (!canPerformAction('match')) return;
    
    log('SOCKET', `Partner: ${partnerId}`);
    STATE.remoteSocket = partnerId;
    DOM.spinner.style.display = 'none';
    setAppState(AppState.MATCHED);
    
    // Create peer connection FIRST
    createPeerConnection();
    
    // Then init media
    safeAsync(async () => {
      await initMedia();
      
      if (STATE.type === 'p1') {
        setTimer('offer', createOffer, 300);
      }
      
      processPendingMessages();
    })();
  });
  
  STATE.socket.on('disconnected', () => {
    if (!STATE.isExiting) {
      showNotification('Disconnected. Searching...');
      setAppState(AppState.DISCONNECTED);
      fullCleanup();
      scheduleReconnect();
    }
  });
  
  STATE.socket.on('disconnect-confirm', fullCleanup);
  
  STATE.socket.on('sdp:reply', ({ sdp }) => {
    log('SDP', `Received: ${sdp.type}`);
    
    if (!STATE.peer) {
      STATE.pendingSdp = sdp;
      return;
    }
    
    handleSdp(sdp);
    processPendingMessages();
  });
  
  STATE.socket.on('ice:reply', ({ candidate }) => {
    handleIce(candidate);
  });
  
  // Chat
  STATE.socket.on('get-message', (message) => {
    DOM.chatWrapper.innerHTML += `<div class="msg"><b>Stranger: </b> <span>${sanitize(message)}</span></div>`;
    DOM.chatWrapper.scrollTop = DOM.chatWrapper.scrollHeight;
  });
  
  STATE.socket.on('typing', (isTyping) => {
    DOM.typingIndicator.style.display = isTyping ? 'block' : 'none';
  });
}

// ============================================
// UI CONTROLS
// ============================================
function setupUIEvents() {
  DOM.exitBtn.addEventListener('click', () => {
    STATE.isExiting = true;
    fullCleanup();
    STATE.socket.emit('disconnect-me');
    window.location.href = '/';
  });
  
  DOM.nextBtn.addEventListener('click', () => {
    fullCleanup();
    STATE.retryCount = 0;
    STATE.isReconnecting = false;
    restartConnection();
  });
  
  // Camera toggle
  DOM.cameraBtn.addEventListener('click', () => {
    if (!STATE.localStream) {
      showNotification('No camera available');
      return;
    }
    
    const videoTracks = STATE.localStream.getVideoTracks();
    if (videoTracks.length === 0) {
      showNotification('No video track');
      return;
    }
    
    STATE.isCameraOff = !STATE.isCameraOff;
    videoTracks.forEach(track => {
      track.enabled = !STATE.isCameraOff;
    });
    
    DOM.cameraBtn.querySelector('.glitch-text').textContent = STATE.isCameraOff ? 'ON' : 'OFF';
    showNotification(STATE.isCameraOff ? 'Video OFF' : 'Video ON');
  });
  
  // Mute toggle
  const muteBtn = document.getElementById('muteBtn');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      if (!STATE.localStream) {
        showNotification('No audio available');
        return;
      }
      
      const audioTracks = STATE.localStream.getAudioTracks();
      if (audioTracks.length === 0) {
        showNotification('No audio track');
        return;
      }
      
      STATE.isMuted = !STATE.isMuted;
      audioTracks.forEach(track => {
        track.enabled = !STATE.isMuted;
      });
      
      muteBtn.querySelector('.glitch-text').textContent = STATE.isMuted ? 'ON' : 'OFF';
      showNotification(STATE.isMuted ? 'Audio OFF' : 'Audio ON');
    });
  }
  
  // Chat
  const sendMessage = () => {
    const message = DOM.inputField.value.trim();
    if (message && STATE.roomid) {
      const sanitized = sanitize(message);
      STATE.socket.emit('send-message', sanitized, STATE.type, STATE.roomid);
      
      DOM.chatWrapper.innerHTML += `<div class="msg"><b>You: </b> <span>${sanitized}</span></div>`;
      DOM.inputField.value = '';
      DOM.chatWrapper.scrollTop = DOM.chatWrapper.scrollHeight;
    }
  };
  
  DOM.sendButton.addEventListener('click', sendMessage);
  DOM.inputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
}

// ============================================
// NOTIFICATIONS
// ============================================
function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  notification.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.7);color:white;padding:10px 20px;border-radius:5px;z-index:9999';
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.5s';
    setTimeout(() => document.body.removeChild(notification), 500);
  }, 3000);
}

// ============================================
// INIT
// ============================================
async function init() {
  STATE.socket = io(CONFIG.SOCKET_URL);
  setupSocketEvents();
  setupUIEvents();
  
  setAppState(AppState.CONNECTING);
  
  try {
    await initMedia();
  } catch (err) {
    log('INIT', 'Media init failed', err);
  }
}

init();
