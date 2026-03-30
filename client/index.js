// ============================================
// APLICACIÓN PRINCIPAL - WebRTC P2P (Production Ready)
// ============================================

import { io } from 'socket.io-client';
import { getMediaStreamWithFallback, getAudioOnlyStream, enableVideoTracks, enableAudioTracks, stopMediaStream, getStreamTracks } from './src/webrtc/media.js';

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
  appState: AppState.IDLE,
  peer: null,
  localStream: null,
  remoteSocket: null,
  type: null,
  roomid: null,
  socket: null,
  isCameraOff: true,
  isMuted: false,
  isExiting: false,
  isNegotiating: false,
  isReconnecting: false,
  pendingSdp: null,
  pendingIceCandidates: [],
  retryCount: 0,
  videoPlayRetries: 0,
  preferredVideoConstraints: null,
  currentQualityLevel: 'high'
};

// Client stable id to allow reconnects across page reload
const CLIENT_ID_KEY = 'strangers_client_id';
let CLIENT_ID = localStorage.getItem(CLIENT_ID_KEY);
if (!CLIENT_ID) {
  try {
    CLIENT_ID = crypto.randomUUID();
  } catch (e) {
    CLIENT_ID = 'c_' + Math.random().toString(36).slice(2);
  }
  localStorage.setItem(CLIENT_ID_KEY, CLIENT_ID);
}

// ============================================
// TIMERS MANAGER
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
  SOCKET_URL: 'https://silver-guide-rqr4g6grrjgcqrv-8000.app.github.dev',
  ICE_CONNECTION_TIMEOUT: 30000,
  // Increase ICE timeout to allow slower networks / TURN allocation
  // Note: server-side TURN reliability needed for cross-network tests
  ICE_CONNECTION_TIMEOUT: 60000,
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
  cameraBtn: document.getElementById('cameraBtn')
};

// ============================================
// HELPERS
// ============================================
function sanitize(text) {
  return text.replace(/[<>]/g, '');
}

function log(type, msg, data = null) {
  console.log(`[${type}] ${msg}`, data || '');
}

// ============================================
// FSM
// ============================================
function setAppState(newState) {
  const oldState = STATE.appState;
  STATE.appState = newState;
  log('FSM', `${oldState} → ${newState}`);
}

function canPerformAction(action) {
  const current = STATE.appState;
  
  if (action === 'cleanup' || action === 'exit') return true;
  
  if (current === AppState.NEGOTIATING && (action === 'match' || action === 'offer')) {
    return false;
  }
  
  if (current === AppState.RECONNECTING && (action === 'match' || action === 'offer')) {
    return false;
  }
  
  return true;
}

// ============================================
// ERROR HANDLING
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
    // Do not attempt automatic reconnection — require user action (Next) to reconnect
    showNotification('Connection failed. Please press NEXT to try another partner.');
    STATE.retryCount = 0;
  }
}

// ============================================
// EXPONENTIAL BACKOFF
// ============================================
function getBackoffDelay(retryCount) {
  return Math.min(1000 * Math.pow(2, retryCount), 10000);
}

function scheduleReconnect() {
  if (STATE.isExiting || STATE.isReconnecting) return;
  
  STATE.isReconnecting = true;
  STATE.retryCount++;
  
  const delay = getBackoffDelay(STATE.retryCount);
  
  setAppState(AppState.RECONNECTING);
  
  // Reconnections are disabled. Do not schedule automatic reconnects.
}

// ============================================
// MEDIA
// ============================================
async function initMedia() {
  try {
    // Start with camera OFF by default (audio-only stream)
    STATE.isCameraOff = true;
    if (DOM.cameraBtn) {
      DOM.cameraBtn.querySelector('.glitch-text').textContent = 'ON';
    }

    // Initialize audio-only stream to avoid prompting for camera
    STATE.localStream = await getAudioOnlyStream();
    enableAudioTracks(STATE.localStream);

    // Attach audio-only stream to local video element (will be blank until camera added)
    DOM.myVideo.srcObject = STATE.localStream;
    DOM.myVideo.muted = true;
    
    const tracks = getStreamTracks(STATE.localStream);
    log('MEDIA', 'Stream initialized - Camera ON', {
      videoTracks: tracks.video.length,
      audioTracks: tracks.audio.length
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
  
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      log('VIDEO', 'Tab hidden');
    } else {
      log('VIDEO', 'Tab visible');
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
  if (!canPerformAction('peer')) {
    log('PEER', 'Cannot create - action blocked by FSM');
    return;
  }
  
  const iceServers = STATE.iceServers || ICE_SERVERS;
  log('PEER', 'Using ICE servers', iceServers);
  STATE.peer = new RTCPeerConnection({
    iceServers: iceServers,
    iceCandidatePoolSize: 20,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  });
  
  STATE.peer.onicecandidate = (e) => {
    if (e.candidate) {
      // Log candidate details and whether remote is set
      const isRelay = e.candidate.candidate && e.candidate.candidate.indexOf('typ relay') !== -1;
      log('ICE', `Candidate generated (relay=${isRelay})`, e.candidate);
      try {
        if (STATE.remoteSocket) {
          STATE.socket.emit('ice:send', { candidate: e.candidate });
        } else {
          // queue locally if remote not yet known
          const key = e.candidate.candidate || JSON.stringify(e.candidate);
          if (!STATE.pendingIceCandidates.some(c => (c && c.candidate ? c.candidate : JSON.stringify(c)) === key)) {
            STATE.pendingIceCandidates.push(e.candidate);
          }
        }
      } catch (err) {
        log('ICE', 'Failed to send candidate', err);
      }
    }
  };
  
  STATE.peer.ontrack = (e) => {
    log('PEER', `Track received: ${e.track.kind}`);
    DOM.strangerVideo.srcObject = e.streams[0];
    setupVideoListeners();
    attemptPlay();
  };
  
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
  
  STATE.peer.oniceconnectionstatechange = () => {
    const state = STATE.peer?.iceConnectionState;
    log('PEER', `ICE state: ${state}`);
    
    if (state === 'failed' || state === 'disconnected') {
      // gather diagnostics
      (async () => {
        try {
          const stats = await STATE.peer.getStats();
          log('ICE', 'Peer stats on failure', stats);
        } catch (e) {
          log('ICE', 'Failed to collect stats', e);
        }
      })();
      handleError('ICE_FAILED', state);
    }
  };
  
  STATE.peer.onnegotiationneeded = () => {
    if (STATE.peer.signalingState === 'stable') {
      createOffer();
    }
  };
  
  // Add tracks if stream exists
  if (STATE.localStream) {
    enableVideoTracks(STATE.localStream);
    enableAudioTracks(STATE.localStream);
    
    STATE.localStream.getTracks().forEach(track => {
      STATE.peer.addTrack(track, STATE.localStream);
    });
    configureBitrate();
  }
  
  setTimer('iceTimeout', () => {
    if (STATE.peer?.iceConnectionState !== 'connected') {
      handleError('ICE_TIMEOUT', 'No connection after 30s');
    }
  }, CONFIG.ICE_CONNECTION_TIMEOUT);
  
  log('PEER', 'Connection created');
}

function configureBitrate() {
  if (!STATE.peer) return;
  
  STATE.peer.getSenders().forEach(sender => {
    if (!sender.track) return;
    
    const params = sender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    
    if (sender.track.kind === 'video') {
      params.encodings[0] = {
        ...params.encodings[0],
        maxBitrate: 4000000,
        minBitrate: 1000000,
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
}

// ============================================
// SDP
// ============================================
async function createOffer() {
  if (!STATE.peer || !canPerformAction('offer')) {
    log('SDP', 'createOffer blocked');
    return;
  }
  
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
    log('SDP', 'Sending offer', STATE.peer.localDescription.type);
    try { STATE.socket.emit('sdp:send', { sdp: STATE.peer.localDescription }); } catch (e) {}
    
    log('SDP', 'Offer sent');
  } catch (err) {
    log('ERROR', 'createOffer failed', err);
    STATE.isNegotiating = false;
  }
}

async function handleSdp(sdp) {
  if (!STATE.peer) {
    STATE.pendingSdp = sdp;
    return;
  }

  // If SDP cannot be applied in current signaling state, queue it
  const state = STATE.peer.signalingState;
  try {
    if (sdp.type === 'offer') {
      if (state !== 'stable') {
        // Can't handle offer now
        STATE.pendingSdp = sdp;
        return;
      }

      await STATE.peer.setRemoteDescription(new RTCSessionDescription(sdp));
      // Create and send answer
      const answer = await STATE.peer.createAnswer();
      await STATE.peer.setLocalDescription(answer);
        log('SDP', 'Sending answer', STATE.peer.localDescription.type);
        try { STATE.socket.emit('sdp:send', { sdp: STATE.peer.localDescription }); } catch (e) {}
      log('SDP', 'Answer sent');

    } else if (sdp.type === 'answer') {
      // We must be in have-local-offer to set the remote answer
      if (state !== 'have-local-offer' && state !== 'stable') {
        STATE.pendingSdp = sdp;
        return;
      }

      await STATE.peer.setRemoteDescription(new RTCSessionDescription(sdp));
    }

    STATE.isNegotiating = false;
  } catch (err) {
    log('ERROR', 'handleSdp failed', err);
    // If setting failed due to wrong state, requeue
    if (err && err.name === 'InvalidStateError') {
      STATE.pendingSdp = sdp;
    }
  }
}

// ============================================
// ICE
// ============================================
async function handleIce(candidate) {
  log('ICE', 'handleIce called', candidate);
  if (!STATE.peer) {
    // queue without duplicates
    const key = candidate && candidate.candidate ? candidate.candidate : JSON.stringify(candidate);
    if (!STATE.pendingIceCandidates.some(c => (c && c.candidate ? c.candidate : JSON.stringify(c)) === key)) {
      STATE.pendingIceCandidates.push(candidate);
    }
    return;
  }
  
  if (!STATE.peer.remoteDescription || !STATE.peer.remoteDescription.type) {
    const key = candidate && candidate.candidate ? candidate.candidate : JSON.stringify(candidate);
    if (!STATE.pendingIceCandidates.some(c => (c && c.candidate ? c.candidate : JSON.stringify(c)) === key)) {
      STATE.pendingIceCandidates.push(candidate);
    }
    return;
  }
  
  try {
    await STATE.peer.addIceCandidate(new RTCIceCandidate(candidate));
    log('ICE', 'addIceCandidate succeeded');
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
    // Try to process pending SDP only if signaling state allows
    const s = STATE.pendingSdp;
    const st = STATE.peer.signalingState;
    if (s.type === 'offer' && st === 'stable') {
      const temp = s;
      STATE.pendingSdp = null;
      handleSdp(temp);
    } else if (s.type === 'answer' && (st === 'have-local-offer' || st === 'stable')) {
      const temp = s;
      STATE.pendingSdp = null;
      handleSdp(temp);
    }
    // otherwise leave it queued for later
  }
}

// ============================================
// QUALITY
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
// STATS
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
    try {
      // Remove event handlers to avoid onicecandidate firing during/after close
      try { STATE.peer.onicecandidate = null; } catch(e){}
      try { STATE.peer.ontrack = null; } catch(e){}
      try { STATE.peer.onconnectionstatechange = null; } catch(e){}
      try { STATE.peer.oniceconnectionstatechange = null; } catch(e){}
      try { STATE.peer.onnegotiationneeded = null; } catch(e){}
    } catch (e) {}
    STATE.peer.close();
    STATE.peer = null;
  }
  
  if (STATE.localStream) {
    stopMediaStream(STATE.localStream);
    STATE.localStream = null;
  }
  
  DOM.myVideo.srcObject = null;
  DOM.strangerVideo.srcObject = null;
  DOM.spinner.style.display = 'flex';
  DOM.chatWrapper.innerHTML = '';
  
  log('CLEANUP', 'Complete');
}

// Light cleanup: close peer and timers but preserve localStream and local video
function lightCleanup() {
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
    try {
      try { STATE.peer.onicecandidate = null; } catch(e){}
      try { STATE.peer.ontrack = null; } catch(e){}
      try { STATE.peer.onconnectionstatechange = null; } catch(e){}
      try { STATE.peer.oniceconnectionstatechange = null; } catch(e){}
      try { STATE.peer.onnegotiationneeded = null; } catch(e){}
    } catch (e) {}
    try { STATE.peer.close(); } catch (e) {}
    STATE.peer = null;
  }

  // Keep STATE.localStream and DOM.myVideo.srcObject intact so user doesn't lose mic permission
  DOM.strangerVideo.srcObject = null;
  DOM.spinner.style.display = 'flex';

  // Also clear remote socket/room references so no further signaling is attempted
  STATE.remoteSocket = null;
  STATE.roomid = null;

  // light cleanup performed (no logs)
}

// ============================================
// RESTART
// ============================================
function restartConnection() {
  STATE.remoteSocket = null;
  STATE.roomid = null;
  STATE.type = null;
  STATE.isNegotiating = false;
  
  // Request server to perform disconnect handling and wait for confirmation
  // to avoid racing with server-side cleanup (which could lead to stale rooms
  // or device locks). Use a short fallback timeout if server doesn't ack.
  try {
    let restarted = false;
    const doRestart = async () => {
      if (restarted) return;
      restarted = true;
      try {
        await initMedia();
      } catch (err) {
        log('MEDIA', 'Init media failed', err);
      }

      try {
        STATE.socket.emit('start', CLIENT_ID, (newType) => {
          STATE.type = newType;
        });
      } catch (e) {
        log('SOCKET', 'emit start failed during restart', e);
      }
    };

    // Listen for server confirmation
    try {
      STATE.socket.emit('disconnect-me', () => {
        doRestart();
      });
    } catch (e) {
      // emit failed, proceed after fallback
    }

    // Fallback if server doesn't respond quickly
    setTimer('restart-fallback', doRestart, 500);
  } catch (e) {
    log('SOCKET', 'restartConnection failed', e);
  }
}

// ============================================
// SOCKET
// ============================================
function setupSocketEvents() {
  STATE.socket.on('connect', () => {
    log('SOCKET', 'Connected');
    setAppState(AppState.CONNECTING);
    // Do not emit 'start' here — wait until ICE servers are loaded in init()
    log('SOCKET', 'Connect event (start will be sent after ICE servers fetched)');
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
    
    // Create peer connection
    createPeerConnection();
    // Send our current media state to the peer so they can reflect camera/audio immediately
    try {
      if (STATE.socket && STATE.roomid) {
        STATE.socket.emit('media:state', { cameraOff: STATE.isCameraOff, muted: STATE.isMuted, roomid: STATE.roomid, type: STATE.type });
      }
    } catch (e) {}
    
    // If we already have a stream, process pending messages
    if (STATE.localStream) {
      processPendingMessages();
    }
  });
  
  STATE.socket.on('disconnected', () => {
    if (!STATE.isExiting) {
      // If we had a matched partner, treat this as partner leaving: do not attempt automatic reconnect
      if (STATE.remoteSocket) {
        showNotification('Partner disconnected.');
        setAppState(AppState.IDLE);
        // Preserve local media (camera/mic) for the user who remains so they
        // don't need to refresh the page to continue. Use light cleanup to
        // close peer and signaling but keep `STATE.localStream` intact.
        lightCleanup();
        // Do not scheduleReconnect() when the other user intentionally left
        return;
      }

      // Otherwise, treat as connection/loss and attempt reconnect
      showNotification('Disconnected. Searching...');
      setAppState(AppState.DISCONNECTED);
      fullCleanup();
      scheduleReconnect();
    }
  });

  // Remote media state updates (camera/audio on-off)
  STATE.socket.on('media:state', ({ cameraOff, muted, type }) => {
    log('SOCKET', `Remote media state: cameraOff=${cameraOff} muted=${muted} type=${type}`);

    // If the remote turned camera off, pause/hide their video and show placeholder
    if (cameraOff) {
      try {
        if (DOM.strangerVideo) {
          DOM.strangerVideo.pause();
          DOM.strangerVideo.style.opacity = '0.3';
          DOM.strangerVideo.dataset.cameraOff = '1';
        }
      } catch (e) {}
    } else {
      try {
        if (DOM.strangerVideo) {
          DOM.strangerVideo.style.opacity = '1';
          delete DOM.strangerVideo.dataset.cameraOff;
          attemptPlay();
        }
      } catch (e) {}
    }

    // Respect remote audio mute state by muting/unmuting remote video element
    if (typeof muted === 'boolean' && DOM.strangerVideo) {
      DOM.strangerVideo.muted = muted;
    }
  });

  // Peer requested renegotiation (partner is changing tracks)
  STATE.socket.on('renegotiate', ({ from }) => {
    // When partner requests renegotiation, we should avoid creating our own offer
    // and be ready to respond. If we're currently stable and not negotiating, do nothing.
    // If local needs to renegotiate later, it will emit its own 'renegotiate'.
    log('SOCKET', `Renegotiate requested from ${from}`);
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
  
  STATE.socket.on('get-message', (message) => {
    DOM.chatWrapper.innerHTML += `<div class="msg"><b>Stranger: </b> <span>${sanitize(message)}</span></div>`;
    DOM.chatWrapper.scrollTop = DOM.chatWrapper.scrollHeight;
  });
  
  STATE.socket.on('typing', (isTyping) => {
    DOM.typingIndicator.style.display = isTyping ? 'block' : 'none';
  });
}

// ============================================
// UI
// ============================================
function setupUIEvents() {
  DOM.exitBtn.addEventListener('click', () => {
    STATE.isExiting = true;
    // Ask server to perform disconnect and wait for confirmation before cleaning up local resources.
    let didAck = false;
    try {
      STATE.socket.emit('disconnect-me', () => {
        didAck = true;
        try { fullCleanup(); } catch (e) {}
        try { STATE.socket.disconnect(); } catch (e) {}
        window.location.href = '/';
      });
    } catch (e) {
      // If emit itself fails, still perform cleanup and navigate
      try { fullCleanup(); } catch (e) {}
      try { STATE.socket.disconnect(); } catch (e) {}
      window.location.href = '/';
    }

    // Fallback: if server doesn't ack within 500ms, force cleanup, disconnect and navigate
    setTimeout(() => {
      if (!didAck) {
        try { fullCleanup(); } catch (e) {}
        try { STATE.socket.disconnect(); } catch (e) {}
        window.location.href = '/';
      }
    }, 500);
  });
  
  DOM.nextBtn.addEventListener('click', () => {
    // Turn off camera before finding new partner
    if (STATE.localStream) {
      const { video } = getStreamTracks(STATE.localStream);
      video.forEach(track => {
        STATE.localStream.removeTrack(track);
        track.stop();
      });
      if (STATE.peer) {
        STATE.peer.getSenders().forEach(sender => {
          if (sender.track?.kind === 'video') {
            STATE.peer.removeTrack(sender);
          }
        });
      }
    }
    STATE.isCameraOff = true;
    if (DOM.cameraBtn) {
      DOM.cameraBtn.querySelector('.glitch-text').textContent = 'ON';
    }

    // For 'Next' we want to keep local media and just ask server for a new partner
    lightCleanup();
    STATE.retryCount = 0;
    STATE.isReconnecting = false;
    try { STATE.socket.emit('next'); } catch (e) { log('SOCKET', 'emit next failed', e); }
    setAppState(AppState.CONNECTING);
  });
  
  DOM.cameraBtn.addEventListener('click', () => {
    if (!STATE.localStream) {
      showNotification('No camera available');
      return;
    }
    
    const { video } = getStreamTracks(STATE.localStream);

    // If we don't have any video tracks yet and user requested camera ON, request camera
    if (video.length === 0 && STATE.isCameraOff) {
      showNotification('Requesting camera...');
      getMediaStreamWithFallback((err) => {
        log('MEDIA', 'Fallback camera init triggered', err && err.name);
      }).then(newStream => {
        const newVideo = newStream.getVideoTracks();
        console.log('[MEDIA] getMediaStreamWithFallback returned tracks', { video: newVideo.length, audio: newStream.getAudioTracks().length });
        if (!newVideo || newVideo.length === 0) {
          showNotification('No camera found');
          // stop any tracks from the helper stream
          newStream.getTracks().forEach(t => t.stop());
          return;
        }

        // Add video tracks to our existing local stream and to peer
        newVideo.forEach(track => {
          try {
            STATE.localStream.addTrack(track);
          } catch (e) {}
          try {
            if (STATE.peer) {
              STATE.peer.addTrack(track, STATE.localStream);
            }
          } catch (e) {}
        });

        // stop audio tracks from the helper stream to avoid duplicates
        newStream.getAudioTracks().forEach(t => t.stop());

        // Update UI and state
        STATE.isCameraOff = false;
        DOM.cameraBtn.querySelector('.glitch-text').textContent = 'OFF';
        DOM.myVideo.srcObject = STATE.localStream;
        showNotification('Video ON');

        // Coordinate renegotiation: inform peer and attempt offer when stable
        try {
          if (STATE.socket && STATE.roomid) {
            STATE.socket.emit('renegotiate');
          }

          // attempt createOffer after short delay if signalingState allows
          setTimeout(() => {
            try {
              if (STATE.peer && STATE.peer.signalingState === 'stable' && !STATE.isNegotiating) {
                createOffer();
              }
            } catch (e) {}
          }, 250);
        } catch (e) {}

        // Notify peer about media state as well
        try { if (STATE.socket && STATE.roomid) STATE.socket.emit('media:state', { cameraOff: STATE.isCameraOff, muted: STATE.isMuted, roomid: STATE.roomid, type: STATE.type }); } catch (e) {}
      }).then(null, err => {
        log('MEDIA', 'Could not access camera', err && err.name);
        showNotification('Could not access camera');
      });

      return;
    }

    // Toggle existing video tracks
    STATE.isCameraOff = !STATE.isCameraOff;
    video.forEach(track => {
      track.enabled = !STATE.isCameraOff;
    });

    DOM.cameraBtn.querySelector('.glitch-text').textContent = STATE.isCameraOff ? 'ON' : 'OFF';
    showNotification(STATE.isCameraOff ? 'Video OFF' : 'Video ON');
    // Notify peer about camera state change
    try {
      if (STATE.socket && STATE.roomid) {
        STATE.socket.emit('media:state', { cameraOff: STATE.isCameraOff, muted: STATE.isMuted, roomid: STATE.roomid, type: STATE.type });
      }
    } catch (e) {}
  });
  
  const muteBtn = document.getElementById('muteBtn');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      if (!STATE.localStream) {
        showNotification('No audio available');
        return;
      }
      
      const { audio } = getStreamTracks(STATE.localStream);
      if (audio.length === 0) {
        showNotification('No audio track');
        return;
      }
      
      STATE.isMuted = !STATE.isMuted;
      audio.forEach(track => {
        track.enabled = !STATE.isMuted;
      });
      
      muteBtn.querySelector('.glitch-text').textContent = STATE.isMuted ? 'ON' : 'OFF';
      showNotification(STATE.isMuted ? 'Audio OFF' : 'Audio ON');
      // Notify peer about audio state change
      try {
        if (STATE.socket && STATE.roomid) {
          STATE.socket.emit('media:state', { cameraOff: STATE.isCameraOff, muted: STATE.isMuted, roomid: STATE.roomid, type: STATE.type });
        }
      } catch (e) {}
    });
  }
  
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

  // Typing indicator: emit typing true/false with debounce
  let typingTimer = null;
  DOM.inputField.addEventListener('input', () => {
    try {
      if (STATE.socket && STATE.roomid) {
        STATE.socket.emit('typing', { roomid: STATE.roomid, isTyping: true });
      }
    } catch (e) {}
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      try {
        if (STATE.socket && STATE.roomid) {
          STATE.socket.emit('typing', { roomid: STATE.roomid, isTyping: false });
        }
      } catch (e) {}
    }, 1000);
  });
}

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

  // Fetch ICE servers from server (may include TURN)
  try {
    const resp = await fetch(`${CONFIG.SOCKET_URL.replace(/\/$/, '')}/ice`);
    const json = await resp.json();
    if (json && json.servers) {
      STATE.iceServers = json.servers;
      log('INIT', 'ICE servers loaded', STATE.iceServers);
    }
  } catch (e) {
    log('INIT', 'Could not fetch ICE servers', e);
  }
  // Now that ICE servers are known, emit start (or wait for connect)
  try {
    const doStart = () => {
      try {
        STATE.socket.emit('start', CLIENT_ID, (personType) => {
          STATE.type = personType;
          log('SOCKET', `My type: ${personType}`);
        });
      } catch (e) {
        log('SOCKET', 'emit start failed', e);
      }
    };

    if (STATE.socket && STATE.socket.connected) {
      doStart();
    } else if (STATE.socket) {
      STATE.socket.once('connect', doStart);
    }
  } catch (e) {}
  setupUIEvents();
  
  setAppState(AppState.CONNECTING);
  
  try {
    await initMedia();
  } catch (err) {
    log('INIT', 'Media init failed', err);
  }
}

init();
