import { useCallback, useRef } from 'react';
import { AppState } from './useAppState.js';
import { enableAudioTracks, enableVideoTracks, getStreamTracks } from '../webrtc/media.js';


// CREATE A TIMER MANAGER FOR MANAGING TIMEOUTS
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


const ICE_SERVERS_FALLBACK = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const CONFIG = {
  ICE_CONNECTION_TIMEOUT: 30000,
  STATS_INTERVAL: 5000,
  QUALITY: {
    high:   { maxBitrate: 5000000, minBitrate: 1500000 },
    medium: { maxBitrate: 2500000, minBitrate: 800000 },
    low:    { maxBitrate: 1000000, minBitrate: 300000 },
  },
};

export function useWebRTC(STATE, setAppState, canPerformAction, showNotification, addMessage, clearMessages, showTyping, strangerVideoRef, setSpinnerVisible) {
  const timers = useRef(createTimerManager()).current;
  const statsIntervalRef = useRef(null);
  const lastBytesRef = useRef(0);
  const lastTimeRef = useRef(0);


  // LOG A MESSAGE TO THE CONSOLE
  function log(type, msg, data = null) {
    console.log(`[${type}] ${msg}`, data || '');
  }


  // HANDLE ERRORS AND TRIGGER RECONNECTION ATTEMPTS
  function handleError(type, error) {
    log('ERROR', type, error);

    const now = Date.now();
    if (STATE._iceRestartTime && (now - STATE._iceRestartTime < 10000)) {
       log('ERROR', 'Ignored because ICE restart is recently in progress');
       return;
    }

    if (type.includes('ICE') || type.includes('connection')) {
      if (!STATE._iceRestartTime && STATE.peer && STATE.peer.connectionState !== 'closed') {
        STATE._iceRestartTime = now;
        STATE._iceRestartAttempted = true;
        log('ICE', 'Attempting ICE restart...');
        showNotification('Reconnecting...');
        
        if (STATE.appState === AppState.NEGOTIATING) {
          setAppState(AppState.CONNECTED);
        }

        try {
          STATE.isNegotiating = false;
          STATE.peer.restartIce();
          return;
        } catch (e) {
          log('ICE', 'ICE restart failed', e);
        }
      }

      STATE._iceRestartAttempted = false;
      STATE._iceRestartTime = 0;
      setSpinnerVisible(true);
      showNotification('Connection failed. Press NEXT to try again.');
      STATE.retryCount = 0;
    }
  }


  // ATTEMPT TO PLAY THE REMOTE VIDEO WITH RETRIES
  function attemptPlay() {
    const video = strangerVideoRef?.current;
    if (!video || !video.srcObject) return;
    
    if (STATE.videoPlayRetries >= 5) {
      log('VIDEO', 'Max retries reached');
      return;
    }

    STATE.videoPlayRetries++;
    const delay = Math.min(1000 * Math.pow(2, STATE.videoPlayRetries), 5000);

    video.play().catch((err) => {
      if (err.name === 'NotAllowedError') {
        log('VIDEO', 'Autoplay blocked by browser. Muting to bypass policy...');
        video.muted = true;
        video.play().catch(() => {
          timers.setTimer('videoRetry', attemptPlay, delay);
        });
      } else {
        log('VIDEO', `Retry ${STATE.videoPlayRetries} in ${delay}ms`, err);
        timers.setTimer('videoRetry', attemptPlay, delay);
      }
    });
  }


  // SET UP VIDEO EVENT LISTENERS FOR PLAYBACK RECOVERY
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


  // CONFIGURE ENCODING PARAMETERS AND BITRATE FOR VIDEO SENDER
  function configureBitrate() {
    if (!STATE.peer) return;

    STATE.peer.getSenders().forEach((sender) => {
      if (!sender.track) return;
      const params = sender.getParameters();
      if (!params.encodings) params.encodings = [{}];

      if (sender.track.kind === 'video') {
        params.encodings[0] = {
          ...params.encodings[0],
          maxBitrate: 2500000, 
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


  // START MONITORING CONNECTION STATISTICS
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
        lastBytesRef.current = videoInbound.bytesReceived || 0;
        lastTimeRef.current = now;
      } catch (e) {
        log('STATS', 'Error getting stats', e);
      }
    }, CONFIG.STATS_INTERVAL);
  }


  // HANDLE INCOMING ICE CANDIDATES
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


  // CREATE AND SEND AN SDP OFFER
  async function createOffer(force = false) {
    if (!STATE.peer || (!force && !canPerformAction('offer'))) {
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


  // HANDLE INCOMING SDP OFFERS OR ANSWERS
  async function handleSdp(sdp) {
    if (!STATE.peer) {
      STATE.pendingSdp = sdp;
      return;
    }

    try {
      if (sdp.type === 'offer') {
        const offerCollision = STATE.peer.signalingState !== 'stable' || STATE.isNegotiating;
        const polite = STATE.type === 'p2';

        if (offerCollision) {
          if (!polite) {
            log('SDP', 'Glare detected: ignoring offer (impolite)');
            return;
          }
          log('SDP', 'Glare detected: rolling back (polite)');
          await Promise.all([
            STATE.peer.setLocalDescription({ type: 'rollback' }),
            STATE.peer.setRemoteDescription(new RTCSessionDescription(sdp))
          ]);
        } else {
          await STATE.peer.setRemoteDescription(new RTCSessionDescription(sdp));
        }

        const answer = await STATE.peer.createAnswer();
        await STATE.peer.setLocalDescription(answer);
        log('SDP', 'Sending answer', STATE.peer.localDescription.type);
        try { STATE.socket.emit('sdp:send', { sdp: STATE.peer.localDescription }); } catch (e) {}
        log('SDP', 'Answer sent');
      } else if (sdp.type === 'answer') {
        if (STATE.peer.signalingState !== 'have-local-offer') {
          log('SDP', 'Ignoring answer in state: ' + STATE.peer.signalingState);
          return;
        }
        await STATE.peer.setRemoteDescription(new RTCSessionDescription(sdp));
      }
      STATE.isNegotiating = false;
    } catch (err) {
      log('ERROR', 'handleSdp failed', err);
    }
  }


  // PROCESS PENDING MESSAGES FROM THE QUEUE
  async function processPendingMessages() {
    if (!STATE.peer) return;

    if (STATE.pendingIceCandidates.length > 0) {
      const candidates = [...STATE.pendingIceCandidates];
      STATE.pendingIceCandidates = [];
      for (const candidate of candidates) {
        await handleIce(candidate);
      }
    }

    if (STATE.pendingSdp) {
      const s = STATE.pendingSdp;
      STATE.pendingSdp = null;
      await handleSdp(s);
    }
  }


  // INITIALIZE A NEW PEER CONNECTION
  function createPeerConnection() {
    if (!canPerformAction('peer')) {
      log('PEER', 'Cannot create - action blocked by FSM');
      return;
    }

    const iceServers = STATE.iceServers || ICE_SERVERS_FALLBACK;
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
        setSpinnerVisible(false);
        showNotification('Connected');
        STATE.isReconnecting = false;
        STATE.retryCount = 0;
        STATE._iceRestartAttempted = false;
        STATE._iceRestartTime = 0;
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
        timers.setTimer('iceDisconnect', () => {
          if (STATE.peer?.iceConnectionState === 'disconnected') {
            handleError('ICE_FAILED', 'disconnected');
          }
        }, 4000);
      } else if (pState === 'connected') {
        timers.clearTimer('iceDisconnect');
      }
    };

    STATE.peer.onnegotiationneeded = () => {
      const isInitiator = STATE.type === 'p1';
      const isConnected = STATE.peer.connectionState === 'connected';

      if (STATE.peer.signalingState === 'stable' && (isInitiator || isConnected)) {
        createOffer();
      }
    };

    if (STATE.localStream) {
      if (!STATE.isCameraOff) {
        enableVideoTracks(STATE.localStream);
      }
      if (!STATE.isMuted) {
        enableAudioTracks(STATE.localStream);
      }
      STATE.localStream.getTracks().forEach((track) => {
        STATE.peer.addTrack(track, STATE.localStream);
      });
      configureBitrate();
    }

    timers.setTimer('iceTimeout', () => {
      if (STATE.peer?.iceConnectionState !== 'connected') {
        handleError('ICE_TIMEOUT', `No connection after ${CONFIG.ICE_CONNECTION_TIMEOUT / 1000}s`);
      }
    }, CONFIG.ICE_CONNECTION_TIMEOUT);

    log('PEER', 'Connection created');
  }


  // COMPLETELY CLEAN UP WEBRTC AND MEDIA STATE
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


  // PARTIALLY CLEAN UP STATE FOR NEXT CONNECTION
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
    STATE._iceRestartAttempted = false;

    if (STATE.localStream) {
      STATE.localStream.getVideoTracks().forEach((track) => {
        track.stop();
        STATE.localStream.removeTrack(track);
      });
    }
    STATE.isCameraOff = true;

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


  // RESTART THE CONNECTION BY DISCONNECTING AND STARTING OVER
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

  const fnsRef = useRef({});
  fnsRef.current = {
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
  };

  /* eslint-disable react-hooks/exhaustive-deps */
  const stableCreatePeerConnection = useCallback((...args) => fnsRef.current.createPeerConnection(...args), []);
  const stableCreateOffer = useCallback((...args) => fnsRef.current.createOffer(...args), []);
  const stableHandleSdp = useCallback((...args) => fnsRef.current.handleSdp(...args), []);
  const stableHandleIce = useCallback((...args) => fnsRef.current.handleIce(...args), []);
  const stableProcessPendingMessages = useCallback((...args) => fnsRef.current.processPendingMessages(...args), []);
  const stableFullCleanup = useCallback((...args) => fnsRef.current.fullCleanup(...args), []);
  const stableLightCleanup = useCallback((...args) => fnsRef.current.lightCleanup(...args), []);
  const stableRestartConnection = useCallback((...args) => fnsRef.current.restartConnection(...args), []);
  const stableStartStatsMonitoring = useCallback((...args) => fnsRef.current.startStatsMonitoring(...args), []);
  const stableAttemptPlay = useCallback((...args) => fnsRef.current.attemptPlay(...args), []);
  /* eslint-enable react-hooks/exhaustive-deps */

  return {
    createPeerConnection: stableCreatePeerConnection,
    createOffer: stableCreateOffer,
    handleSdp: stableHandleSdp,
    handleIce: stableHandleIce,
    processPendingMessages: stableProcessPendingMessages,
    fullCleanup: stableFullCleanup,
    lightCleanup: stableLightCleanup,
    restartConnection: stableRestartConnection,
    startStatsMonitoring: stableStartStatsMonitoring,
    attemptPlay: stableAttemptPlay,
    CONFIG,
  };
}


// GET OR GENERATE A PERSISTENT CLIENT ID
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
