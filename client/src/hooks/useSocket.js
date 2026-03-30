import { useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { AppState } from './useAppState.js';
import { getClientId } from './useWebRTC.js';

const SOCKET_URL = 'https://ctqkwg7k-8000.use2.devtunnels.ms';

/**
 * useSocket — Inicializa Socket.IO y enlaza todos los eventos del servidor.
 * Mantiene la lógica exacta de setupSocketEvents() del index.js original.
 */
export function useSocket({
  STATE,
  setAppState,
  canPerformAction,
  showNotification,
  addMessage,
  clearMessages,
  showTyping,
  setSpinnerVisible,
  strangerVideoRef,
  webrtc, // objeto retornado por useWebRTC
  initMedia,
  myVideoRef,
  setCameraBtnText,
}) {
  const initSocket = useCallback(async () => {
    STATE.socket = io(SOCKET_URL);

    // Cargar ICE servers dinámicos del servidor
    try {
      const resp = await fetch(`${SOCKET_URL}/ice`);
      const json = await resp.json();
      if (json?.servers) {
        STATE.iceServers = json.servers;
        console.log('[INIT] ICE servers loaded', STATE.iceServers);
      }
    } catch (e) {
      console.warn('[INIT] Could not fetch ICE servers', e);
    }

    // ---- SOCKET EVENTS ----

    STATE.socket.on('connect', () => {
      console.log('[SOCKET] Connected');
      setAppState(AppState.CONNECTING);
    });

    STATE.socket.on('roomid', (id) => {
      STATE.roomid = id;
      console.log(`[SOCKET] Room: ${id}`);
    });

    STATE.socket.on('remote-socket', (partnerId) => {
      if (!canPerformAction('match')) return;
      // Guarda: si ya tenemos peer activo, ignorar el evento duplicado
      if (STATE.peer) return;

      console.log(`[SOCKET] Partner: ${partnerId}`);
      STATE.remoteSocket = partnerId;
      setSpinnerVisible(false);
      setAppState(AppState.MATCHED);

      webrtc.createPeerConnection();

      try {
        if (STATE.socket && STATE.roomid) {
          STATE.socket.emit('media:state', {
            cameraOff: STATE.isCameraOff,
            muted: STATE.isMuted,
            roomid: STATE.roomid,
            type: STATE.type,
          });
        }
      } catch (e) { }

      if (STATE.localStream) {
        webrtc.processPendingMessages();
      }
    });

    STATE.socket.on('disconnected', () => {
      if (!STATE.isExiting) {
        if (STATE.remoteSocket) {
          showNotification('Partner disconnected.');
          setAppState(AppState.IDLE);
          webrtc.lightCleanup();
          return;
        }
        showNotification('Disconnected. Searching...');
        setAppState(AppState.DISCONNECTED);
        webrtc.fullCleanup();
      }
    });

    STATE.socket.on('media:state', ({ cameraOff, muted }) => {
      const video = strangerVideoRef?.current;
      if (!video) return;

      if (cameraOff) {
        try { video.pause(); } catch (e) { }
        video.style.opacity = '0.3';
        video.dataset.cameraOff = '1';
      } else {
        video.style.opacity = '1';
        delete video.dataset.cameraOff;
        webrtc.attemptPlay();
      }

      if (typeof muted === 'boolean') {
        video.muted = muted;
      }
    });

    STATE.socket.on('renegotiate', ({ from }) => {
      console.log(`[SOCKET] Renegotiate from ${from}`);
    });

    STATE.socket.on('disconnect-confirm', () => {
      webrtc.fullCleanup();
    });

    STATE.socket.on('sdp:reply', ({ sdp }) => {
      console.log(`[SDP] Received: ${sdp.type}`);
      if (!STATE.peer) {
        STATE.pendingSdp = sdp;
        return;
      }
      webrtc.handleSdp(sdp);
      webrtc.processPendingMessages();
    });

    STATE.socket.on('ice:reply', ({ candidate }) => {
      webrtc.handleIce(candidate);
    });

    STATE.socket.on('get-message', (message) => {
      addMessage(message, false);
    });

    STATE.socket.on('typing', (isTyping) => {
      showTyping(isTyping);
    });

    // ---- EMIT START ----
    const doStart = () => {
      try {
        STATE.socket.emit('start', getClientId(), (personType) => {
          STATE.type = personType;
          console.log(`[SOCKET] My type: ${personType}`);
        });
      } catch (e) {
        console.error('[SOCKET] emit start failed', e);
      }
    };

    if (STATE.socket.connected) {
      doStart();
    } else {
      STATE.socket.once('connect', doStart);
    }

    return STATE.socket;
  }, [STATE, setAppState, canPerformAction, showNotification, addMessage, clearMessages, showTyping, setSpinnerVisible, strangerVideoRef, webrtc, initMedia, myVideoRef]);

  const disconnectSocket = useCallback(() => {
    try {
      if (STATE.socket) {
        STATE.socket.disconnect();
        STATE.socket = null;
      }
    } catch (e) { }
  }, [STATE]);

  return { initSocket, disconnectSocket };
}
