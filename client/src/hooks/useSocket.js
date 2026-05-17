import { useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { AppState } from './useAppState.js';
import { getClientId } from './useWebRTC.js';

// C-03: URL from environment variable instead of hardcoded
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'https://shiny-waffle-rqr4g6grxq9fpwj4-8000.app.github.dev';

const RECONNECT_CONFIG = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  matchTimeout: 60000,
};

function isValidRoomForSocket(STATE, targetRoomid) {
  return STATE.roomid && STATE.roomid === targetRoomid && STATE.roomid.length > 0;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff(fn, config = RECONNECT_CONFIG) {
  let lastError = null;
  
  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const delay = Math.min(config.baseDelay * Math.pow(2, attempt), config.maxDelay);
      console.log(`[RETRY] Attempt ${attempt + 1} failed, waiting ${delay}ms`);
      await sleep(delay);
    }
  }
  
  throw lastError;
}

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
  webrtc,
  initMedia,
  myVideoRef,
  setCameraBtnText,
}) {
  const matchmakingTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const isReconnectingRef = useRef(false);

  const clearMatchmakingTimeout = useCallback(() => {
    if (matchmakingTimeoutRef.current) {
      clearTimeout(matchmakingTimeoutRef.current);
      matchmakingTimeoutRef.current = null;
    }
  }, []);

  const startMatchmakingTimeout = useCallback((onTimeout) => {
    clearMatchmakingTimeout();
    matchmakingTimeoutRef.current = setTimeout(() => {
      console.log('[SOCKET] Matchmaking timeout after 60s');
      if (onTimeout) onTimeout();
    }, RECONNECT_CONFIG.matchTimeout);
  }, [clearMatchmakingTimeout]);

  const initSocket = useCallback(async () => {
    STATE.socket = io(SOCKET_URL, {
      reconnection: true,
      reconnectionAttempts: RECONNECT_CONFIG.maxAttempts,
      reconnectionDelay: RECONNECT_CONFIG.baseDelay,
      reconnectionDelayMax: RECONNECT_CONFIG.maxDelay,
      timeout: 20000,
    });

    console.log('[SOCKET] Initializing socket connection');

    try {
      const resp = await fetch(`${SOCKET_URL}/ice`);
      const json = await resp.json();
      if (json?.servers) {
        STATE.iceServers = json.servers;
        console.log('[INIT] ICE servers loaded', STATE.iceServers.length);
      }
    } catch (e) {
      console.warn('[INIT] Could not fetch ICE servers', e);
    }

    STATE.socket.on('connect', () => {
      console.log('[SOCKET] Connected', STATE.socket.id);
      setAppState(AppState.CONNECTING);
      reconnectAttemptsRef.current = 0;
    });

    STATE.socket.on('connect_error', (error) => {
      console.error('[SOCKET] Connection error', error.message);
      reconnectAttemptsRef.current++;
      
      if (reconnectAttemptsRef.current >= RECONNECT_CONFIG.maxAttempts) {
        showNotification('Connection failed. Please refresh the page.');
      }
    });

    STATE.socket.on('error', (data) => {
      console.error('[SOCKET] Server error:', data);
      
      if (data.message) {
        showNotification(data.message);
        
        if (data.message.includes('Rate limit') || data.message.includes('Rate limit exceeded')) {
          const retryAfter = data.retryAfter || 10;
          console.log(`[SOCKET] Rate limited, retry after ${retryAfter}s`);
          
          setTimeout(() => {
            showNotification('You can try again now');
          }, retryAfter * 1000);
        }
      }
    });

    STATE.socket.on('start', (personType) => {
      clearMatchmakingTimeout();
      STATE.type = personType;
      console.log(`[SOCKET] Type updated: ${personType}`);
    });

    STATE.socket.on('roomid', (id) => {
      STATE.roomid = id;
      console.log(`[SOCKET] Room: ${id}`);
    });

    STATE.socket.on('remote-socket', (partnerId) => {
      clearMatchmakingTimeout();
      
      if (!canPerformAction('match')) {
        console.log('[SOCKET] Blocked by FSM, ignoring remote-socket');
        return;
      }
      if (STATE.peer) {
        console.log('[SOCKET] Peer already exists, ignoring duplicate remote-socket');
        return;
      }

      console.log(`[SOCKET] Partner: ${partnerId}`);
      STATE.remoteSocket = partnerId;
      setSpinnerVisible(false);
      setAppState(AppState.MATCHED);

      webrtc.createPeerConnection();

      if (STATE.socket && STATE.roomid && isValidRoomForSocket(STATE, STATE.roomid)) {
        try {
          STATE.socket.emit('media:state', {
            cameraOff: STATE.isCameraOff,
            muted: STATE.isMuted,
            roomid: STATE.roomid,
            type: STATE.type,
          });
        } catch (e) {
          console.warn('[SOCKET] Failed to send initial media:state', e);
        }
      }

      if (STATE.localStream) {
        webrtc.processPendingMessages();
      }
    });

    STATE.socket.on('disconnected', () => {
      if (STATE.isExiting) return;
      if (isReconnectingRef.current) return;

      console.log('[SOCKET] Partner disconnected');
      showNotification('Partner disconnected. Searching...');
      webrtc.lightCleanup();
      setCameraBtnText('OFF');
      clearMessages();
      setSpinnerVisible(true);
      setAppState(AppState.CONNECTING);

      const doReconnect = async () => {
        isReconnectingRef.current = true;
        
        try {
          if (!STATE.localStream) {
            try {
              await initMedia(myVideoRef?.current);
            } catch (e) {
              console.warn('[SOCKET] Reinit media failed', e);
            }
          }

          await retryWithBackoff(async () => {
            return new Promise((resolve, reject) => {
              STATE.socket.emit('start', getClientId(), (personType) => {
                STATE.type = personType;
                console.log(`[SOCKET] Reconnect type: ${personType}`);
                resolve();
              });
              
              setTimeout(() => {
                reject(new Error('Start timeout'));
              }, 5000);
            });
          }, RECONNECT_CONFIG);

        } catch (error) {
          console.error('[SOCKET] Reconnect failed after all attempts', error);
          showNotification('Connection failed. Press NEXT to try again.');
          setAppState(AppState.IDLE);
        } finally {
          isReconnectingRef.current = false;
        }
      };

      startMatchmakingTimeout(() => {
        showNotification('Taking too long. Try again later.');
        setAppState(AppState.IDLE);
      });

      doReconnect();
    });

    STATE.socket.on('media:state', ({ cameraOff, muted }) => {
      const video = strangerVideoRef?.current;
      if (!video) return;

      if (cameraOff) {
        // NO HACER video.pause() porque eso también pausa el audio que viene en el mismo stream!
        video.style.opacity = '0.3';
        video.dataset.cameraOff = '1';
      } else {
        video.style.opacity = '1';
        delete video.dataset.cameraOff;
        webrtc.attemptPlay();
      }

      // H-03: Don't mute the <video> element — it causes permanent audio loss.
      // Instead, handle partner mute state via the remote audio track.
      if (typeof muted === 'boolean') {
        const remoteStream = video.srcObject;
        if (remoteStream) {
          remoteStream.getAudioTracks().forEach(track => {
            track.enabled = !muted;
          });
        }
      }
    });

    STATE.socket.on('renegotiate', ({ from }) => {
      console.log(`[SOCKET] Renegotiate from ${from}`);
    });

    STATE.socket.on('disconnect-confirm', () => {
      webrtc.fullCleanup();
    });

    STATE.socket.on('sdp:reply', async ({ sdp, from }) => {
      if (!from || !isValidRoomForSocket(STATE, STATE.roomid)) {
        console.warn('[SDP] Invalid room for SDP reply');
        return;
      }
      
      console.log(`[SDP] Received: ${sdp.type} from ${from}`);
      if (!STATE.peer) {
        STATE.pendingSdp = sdp;
        return;
      }
      await webrtc.handleSdp(sdp);
      await webrtc.processPendingMessages();
    });

    STATE.socket.on('ice:reply', async ({ candidate, from }) => {
      if (!from) return;
      
      if (!isValidRoomForSocket(STATE, STATE.roomid)) {
        console.warn('[ICE] Invalid room for ICE reply');
        return;
      }
      
      await webrtc.handleIce(candidate);
    });

    STATE.socket.on('get-message', (message) => {
      if (!isValidRoomForSocket(STATE, STATE.roomid)) {
        console.warn('[CHAT] Invalid room for message');
        return;
      }
      addMessage(message, false);
    });

    STATE.socket.on('typing', (isTyping) => {
      if (!isValidRoomForSocket(STATE, STATE.roomid)) {
        return;
      }
      showTyping(isTyping);
    });

    const doStart = () => {
      startMatchmakingTimeout(() => {
        showNotification('No partners available. Please wait...');
      });
      
      try {
        STATE.socket.emit('start', getClientId(), (personType) => {
          clearMatchmakingTimeout();
          STATE.type = personType;
          console.log(`[SOCKET] My type: ${personType}`);
        });
      } catch (e) {
        console.error('[SOCKET] emit start failed', e);
        clearMatchmakingTimeout();
      }
    };

    if (STATE.socket.connected) {
      doStart();
    } else {
      STATE.socket.once('connect', doStart);
    }

    return STATE.socket;
  }, [
    STATE,
    setAppState,
    canPerformAction,
    showNotification,
    addMessage,
    clearMessages,
    showTyping,
    setSpinnerVisible,
    strangerVideoRef,
    webrtc,
    initMedia,
    myVideoRef,
    clearMatchmakingTimeout,
    startMatchmakingTimeout
  ]);

  const disconnectSocket = useCallback(() => {
    clearMatchmakingTimeout();
    try {
      if (STATE.socket) {
        STATE.socket.disconnect();
        STATE.socket = null;
      }
    } catch (e) {}
  }, [STATE, clearMatchmakingTimeout]);

  useEffect(() => {
    return () => {
      clearMatchmakingTimeout();
    };
  }, [clearMatchmakingTimeout]);

  return { initSocket, disconnectSocket };
}
