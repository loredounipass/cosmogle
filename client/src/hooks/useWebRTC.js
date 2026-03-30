import { useCallback, useRef } from 'react';
import { AppState } from './useAppState.js';
import { enableAudioTracks, enableVideoTracks, getStreamTracks } from '../webrtc/media.js';

// ============================================
// TIMERS MANAGER (igual que en index.js)
// ============================================
function createTimerManager() {
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
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
  }

  return { setTimer, clearTimer, clearAllTimers };
}

// ============================================
// ICE SERVERS
// ============================================
const ICE_SERVERS = [
  // ── STUN
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },

  // ── Open Relay (Metered) — UDP + TCP + TLS para atravesar cualquier firewall
  { urls: 'turn:openrelay.metered.ca:80',                username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:3478',              username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:3478?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443',              username: 'openrelayproject', credential: 'openrelayproject' },

  // ── Freestun — proveedor de backup
  { urls: 'turn:freestun.net:3478',  username: 'free', credential: 'free' },
  { urls: 'turns:freestun.net:5349', username: 'free', credential: 'free' },
];


const CONFIG = {
  SOCKET_URL: 'https://silver-guide-rqr4g6grrjgcqrv-8000.app.github.dev',
  ICE_CONNECTION_TIMEOUT: 30000, // 30s — 60s era demasiado esperar
  STATS_INTERVAL: 5000,
  QUALITY: {
    high:   { maxBitrate: 5000000, minBitrate: 1500000 },
    medium: { maxBitrate: 2500000, minBitrate: 800000 },
    low:    { maxBitrate: 1000000, minBitrate: 300000 },
  },
};

/**
 * useWebRTC — Encapsula toda la lógica WebRTC del index.js original:
 * createPeerConnection, createOffer, handleSdp, handleIce,
 * processPendingMessages, fullCleanup, lightCleanup, restartConnection,
 * configureBitrate, adaptBitrate, startStatsMonitoring.
 */
export function useWebRTC(STATE, setAppState, canPerformAction, showNotification, addMessage, clearMessages, showTyping, strangerVideoRef, setSpinnerVisible) {
  const timers = useRef(createTimerManager()).current;
  const statsIntervalRef = useRef(null);
  const lastBytesRef = useRef(0);
  const lastTimeRef = useRef(0);

  // ----------------------------------------
  // HELPERS
  // ----------------------------------------
  function log(type, msg, data = null) {
    console.log(`[${type}] ${msg}`, data || '');
  }

  function handleError(type, error) {
    log('ERROR', type, error);
    if (type.includes('ICE') || type.includes('connection')) {
      // Intentar ICE restart una vez antes de rendirse
      if (!STATE._iceRestartAttempted && STATE.peer && STATE.peer.connectionState !== 'closed') {
        STATE._iceRestartAttempted = true;
        log('ICE', 'Attempting ICE restart...');
        showNotification('Reconnecting...');
        try {
          STATE.peer.restartIce();
          // Solo p1 renegocia con offer tras ICE restart
          if (STATE.type === 'p1') {
            STATE.isNegotiating = false;
            createOffer();
          }
          return; // no mostrar error aún, esperar resultado del restart
        } catch (e) {
          log('ICE', 'ICE restart failed', e);
        }
      }

      // Si ya se intentó ICE restart o falló, mostrar error
      STATE._iceRestartAttempted = false;
      setSpinnerVisible(true);
      showNotification('Connection failed. Press NEXT to try again.');
      STATE.retryCount = 0;
    }
  }

  // ----------------------------------------
  // VIDEO PLAYBACK
  // ----------------------------------------
  function attemptPlay() {
    const video = strangerVideoRef?.current;
    if (!video || !video.srcObject) return;

    video.muted = true;
    if (STATE.videoPlayRetries >= 5) {
      log('VIDEO', 'Max retries reached');
      return;
    }

    STATE.videoPlayRetries++;
    const delay = Math.min(1000 * Math.pow(2, STATE.videoPlayRetries), 5000);

    video.play().catch(() => {
      log('VIDEO', `Retry ${STATE.videoPlayRetries} in ${delay}ms`);
      timers.setTimer('videoRetry', attemptPlay, delay);
    });
  }

  function setupVideoListeners() {
    const video = strangerVideoRef?.current;
    if (!video) return;

    video.onplaying = () => {
      STATE.videoPlayRetries = 0;
      log('VIDEO', 'Playing');
    };
    video.onwaiting  = () => attemptPlay();
    video.onstalled  = () => attemptPlay();
    video.onerror    = () => attemptPlay();
  }

  // ----------------------------------------
  // BITRATE / STATS
  // ----------------------------------------
  function configureBitrate() {
    if (!STATE.peer) return;

    STATE.peer.getSenders().forEach((sender) => {
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
          degradationPreference: 'maintain-framerate',
        };
      } else if (sender.track.kind === 'audio') {
        params.encodings[0] = {
          ...params.encodings[0],
          maxBitrate: 128000,
          priority: 'high',
        };
      }
      sender.setParameters(params).catch(() => {});
    });
  }

  function adaptBitrate(bitrate, rtt) {
    if (!STATE.peer) return;

    let newLevel = 'high';
    if (rtt > 400 || bitrate < 300000) newLevel = 'low';
    else if (rtt > 200 || bitrate < 800000) newLevel = 'medium';

    if (newLevel !== STATE.currentQualityLevel) {
      const preset = CONFIG.QUALITY[newLevel];
      STATE.currentQualityLevel = newLevel;

      STATE.peer.getSenders().forEach((sender) => {
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

  function startStatsMonitoring() {
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);

    statsIntervalRef.current = setInterval(async () => {
      if (!STATE.peer || STATE.peer.connectionState === 'closed') return;

      try {
        const stats = await STATE.peer.getStats();
        let videoInbound = null;
        let candidatePair = null;

        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            videoInbound = report;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            candidatePair = report;
          }
        });

        if (!videoInbound) return;

        const now = Date.now();
        if (lastTimeRef.current > 0) {
          const timeDiff = (now - lastTimeRef.current) / 1000;
          const bytesDiff = (videoInbound.bytesReceived || 0) - lastBytesRef.current;
          const bitrate = timeDiff > 0 ? Math.round((bytesDiff * 8) / timeDiff) : 0;
          const rtt = candidatePair?.currentRoundTripTime
            ? candidatePair.currentRoundTripTime * 1000
            : 0;
          adaptBitrate(bitrate, rtt);
        }

        lastBytesRef.current = videoInbound.bytesReceived || 0;
        lastTimeRef.current = now;
      } catch (e) {
        log('STATS', 'Error getting stats', e);
      }
    }, CONFIG.STATS_INTERVAL);
  }

  // ----------------------------------------
  // ICE
  // ----------------------------------------
  async function handleIce(candidate) {
    log('ICE', 'handleIce called', candidate);

    if (!STATE.peer) {
      const key = candidate?.candidate ?? JSON.stringify(candidate);
      if (!STATE.pendingIceCandidates.some((c) => (c?.candidate ?? JSON.stringify(c)) === key)) {
        STATE.pendingIceCandidates.push(candidate);
      }
      return;
    }

    if (!STATE.peer.remoteDescription?.type) {
      const key = candidate?.candidate ?? JSON.stringify(candidate);
      if (!STATE.pendingIceCandidates.some((c) => (c?.candidate ?? JSON.stringify(c)) === key)) {
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

  // ----------------------------------------
  // SDP
  // ----------------------------------------
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
        offerToReceiveVideo: true,
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

    const state = STATE.peer.signalingState;
    try {
      if (sdp.type === 'offer') {
        if (state !== 'stable') {
          STATE.pendingSdp = sdp;
          return;
        }
        await STATE.peer.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await STATE.peer.createAnswer();
        await STATE.peer.setLocalDescription(answer);
        log('SDP', 'Sending answer', STATE.peer.localDescription.type);
        try { STATE.socket.emit('sdp:send', { sdp: STATE.peer.localDescription }); } catch (e) {}
        log('SDP', 'Answer sent');
      } else if (sdp.type === 'answer') {
        if (state !== 'have-local-offer' && state !== 'stable') {
          STATE.pendingSdp = sdp;
          return;
        }
        await STATE.peer.setRemoteDescription(new RTCSessionDescription(sdp));
      }
      STATE.isNegotiating = false;
    } catch (err) {
      log('ERROR', 'handleSdp failed', err);
      if (err?.name === 'InvalidStateError') {
        STATE.pendingSdp = sdp;
      }
    }
  }

  function processPendingMessages() {
    if (!STATE.peer) return;

    if (STATE.pendingIceCandidates.length > 0) {
      STATE.pendingIceCandidates.forEach(handleIce);
      STATE.pendingIceCandidates = [];
    }

    if (STATE.pendingSdp) {
      const s = STATE.pendingSdp;
      const st = STATE.peer.signalingState;
      if (s.type === 'offer' && st === 'stable') {
        STATE.pendingSdp = null;
        handleSdp(s);
      } else if (s.type === 'answer' && (st === 'have-local-offer' || st === 'stable')) {
        STATE.pendingSdp = null;
        handleSdp(s);
      }
    }
  }

  // ----------------------------------------
  // PEER CONNECTION
  // ----------------------------------------
  function createPeerConnection() {
    if (!canPerformAction('peer')) {
      log('PEER', 'Cannot create - action blocked by FSM');
      return;
    }

    const iceServers = STATE.iceServers || ICE_SERVERS;
    STATE.peer = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 20,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    STATE.peer.onicecandidate = (e) => {
      if (e.candidate) {
        const isRelay = e.candidate.candidate?.includes('typ relay');
        log('ICE', `Candidate (relay=${isRelay})`, e.candidate);
        try {
          if (STATE.remoteSocket) {
            STATE.socket.emit('ice:send', { candidate: e.candidate });
          } else {
            const key = e.candidate.candidate || JSON.stringify(e.candidate);
            if (!STATE.pendingIceCandidates.some((c) => (c?.candidate ?? JSON.stringify(c)) === key)) {
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
      if (strangerVideoRef?.current) {
        strangerVideoRef.current.srcObject = e.streams[0];
        setupVideoListeners();
        attemptPlay();
      }
    };

    STATE.peer.onconnectionstatechange = () => {
      const pState = STATE.peer?.connectionState;
      log('PEER', `Connection state: ${pState}`);
      if (pState === 'connected') {
        timers.clearTimer('iceTimeout');
        setAppState(AppState.CONNECTED);
        STATE.isReconnecting = false;
        STATE.retryCount = 0;
        STATE._iceRestartAttempted = false; // reset para futuras reconexiones
      } else if (pState === 'failed') {
        handleError('CONNECTION_FAILED', pState);
      }
    };

    STATE.peer.oniceconnectionstatechange = () => {
      const pState = STATE.peer?.iceConnectionState;
      log('PEER', `ICE state: ${pState}`);
      if (pState === 'failed') {
        handleError('ICE_FAILED', pState);
      } else if (pState === 'disconnected') {
        // 'disconnected' puede ser transitorio — esperamos 4s antes de notificar
        timers.setTimer('iceDisconnect', () => {
          if (STATE.peer?.iceConnectionState === 'disconnected') {
            handleError('ICE_FAILED', 'disconnected');
          }
        }, 4000);
      } else if (pState === 'connected') {
        // Si se recupera, cancelar el timer de disconnection
        timers.clearTimer('iceDisconnect');
      }
    };

    STATE.peer.onnegotiationneeded = () => {
      // Solo el initiator (p1) crea el offer.
      // p2 espera el offer de p1 y responde con answer.
      // Esto evita el "SDP glare" (colisión donde ambos envían offer al mismo tiempo).
      const isInitiator = STATE.type === 'p1';
      if (STATE.peer.signalingState === 'stable' && isInitiator) {
        createOffer();
      }
    };

    if (STATE.localStream) {
      enableVideoTracks(STATE.localStream);
      enableAudioTracks(STATE.localStream);
      STATE.localStream.getTracks().forEach((track) => {
        STATE.peer.addTrack(track, STATE.localStream);
      });
      configureBitrate();
    }

    timers.setTimer('iceTimeout', () => {
      if (STATE.peer?.iceConnectionState !== 'connected') {
        handleError('ICE_TIMEOUT', 'No connection after 60s');
      }
    }, CONFIG.ICE_CONNECTION_TIMEOUT);

    log('PEER', 'Connection created');
  }

  // ----------------------------------------
  // CLEANUP
  // ----------------------------------------
  function fullCleanup() {
    log('CLEANUP', 'Starting full cleanup');
    timers.clearAllTimers();

    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    STATE.videoPlayRetries = 0;
    STATE.pendingSdp = null;
    STATE.pendingIceCandidates = [];
    STATE.currentQualityLevel = 'high';
    STATE.isNegotiating = false;

    if (STATE.peer) {
      try { STATE.peer.onicecandidate = null; } catch (e) {}
      try { STATE.peer.ontrack = null; } catch (e) {}
      try { STATE.peer.onconnectionstatechange = null; } catch (e) {}
      try { STATE.peer.oniceconnectionstatechange = null; } catch (e) {}
      try { STATE.peer.onnegotiationneeded = null; } catch (e) {}
      try { STATE.peer.close(); } catch (e) {}
      STATE.peer = null;
    }

    if (STATE.localStream) {
      STATE.localStream.getTracks().forEach((t) => t.stop());
      STATE.localStream = null;
    }

    if (strangerVideoRef?.current) strangerVideoRef.current.srcObject = null;
    setSpinnerVisible(true);
    clearMessages();

    log('CLEANUP', 'Complete');
  }

  function lightCleanup() {
    timers.clearAllTimers();

    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    STATE.videoPlayRetries = 0;
    STATE.pendingSdp = null;
    STATE.pendingIceCandidates = [];
    STATE.currentQualityLevel = 'high';
    STATE.isNegotiating = false;

    if (STATE.peer) {
      try { STATE.peer.onicecandidate = null; } catch (e) {}
      try { STATE.peer.ontrack = null; } catch (e) {}
      try { STATE.peer.onconnectionstatechange = null; } catch (e) {}
      try { STATE.peer.oniceconnectionstatechange = null; } catch (e) {}
      try { STATE.peer.onnegotiationneeded = null; } catch (e) {}
      try { STATE.peer.close(); } catch (e) {}
      STATE.peer = null;
    }

    if (strangerVideoRef?.current) strangerVideoRef.current.srcObject = null;
    setSpinnerVisible(true);

    STATE.remoteSocket = null;
    STATE.roomid = null;
  }

  // ----------------------------------------
  // RESTART
  // ----------------------------------------
  async function restartConnection(initMedia, myVideoEl) {
    STATE.remoteSocket = null;
    STATE.roomid = null;
    STATE.type = null;
    STATE.isNegotiating = false;

    let restarted = false;
    const doRestart = async () => {
      if (restarted) return;
      restarted = true;

      try {
        await initMedia(myVideoEl);
      } catch (err) {
        log('MEDIA', 'Init media failed during restart', err);
      }

      try {
        STATE.socket.emit('start', getClientId(), (newType) => {
          STATE.type = newType;
        });
      } catch (e) {
        log('SOCKET', 'emit start failed during restart', e);
      }
    };

    try {
      STATE.socket.emit('disconnect-me', () => doRestart());
    } catch (e) {}

    timers.setTimer('restart-fallback', doRestart, 500);
  }

  return {
    createPeerConnection,
    createOffer,
    handleSdp,
    handleIce,
    processPendingMessages,
    fullCleanup,
    lightCleanup,
    restartConnection,
    startStatsMonitoring,
    attemptPlay,
    CONFIG,
  };
}

// ============================================
// CLIENT ID (estable entre recargas)
// ============================================
const CLIENT_ID_KEY = 'strangers_client_id';
export function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    try { id = crypto.randomUUID(); } catch (e) {
      id = 'c_' + Math.random().toString(36).slice(2);
    }
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}
