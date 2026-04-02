import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAppState, AppState } from '../hooks/useAppState.js';
import { useWebRTC, getClientId } from '../hooks/useWebRTC.js';
import { useMedia } from '../hooks/useMedia.js';
import { useChat } from '../hooks/useChat.js';
import { useSocket } from '../hooks/useSocket.js';
import { useNotification } from '../components/video/Notification.jsx';
import Notification from '../components/video/Notification.jsx';
import VideoHolder from '../components/video/VideoHolder.jsx';
import ChatHolder from '../components/video/ChatHolder.jsx';

/**
 * VideoPage — Orquestador principal de la sesión de video.
 * Migración exacta de video.html + index.js, descompuesta en hooks y componentes.
 * La estructura JSX replica fielmente el layout grid del CSS original.
 */
export default function VideoPage() {
  const navigate = useNavigate();

  // ---- REFS DOM ----
  const myVideoRef      = useRef(null);
  const strangerVideoRef = useRef(null);
  const inputRef        = useRef(null);

  // ---- UI STATE ----
  const [spinnerVisible, setSpinnerVisible] = useState(true);
  const [muteBtnText,    setMuteBtnText]    = useState('MUTED');
  const [cameraBtnText,  setCameraBtnText]  = useState('OFF');

  // ---- HOOKS ----
  const { STATE, setAppState, canPerformAction } = useAppState();
  const { messages, isTyping, addMessage, clearMessages, showTyping, sanitize } = useChat();
  const { notifications, showNotification } = useNotification();

  const webrtc = useWebRTC(
    STATE,
    setAppState,
    canPerformAction,
    showNotification,
    addMessage,
    clearMessages,
    showTyping,
    strangerVideoRef,
    setSpinnerVisible
  );

  const { initMedia, toggleCamera, toggleMute, cleanupMedia } = useMedia(
    STATE,
    showNotification
  );

  const { initSocket, disconnectSocket } = useSocket({
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
  });

  // ---- INIT ----
  useEffect(() => {
    let mounted = true;

    async function init() {
      await initSocket();
      setAppState(AppState.CONNECTING);

      try {
        await initMedia(myVideoRef.current);
      } catch (err) {
        console.error('[INIT] Media init failed', err);
      }
    }

    init();

    return () => {
      mounted = false;
      webrtc.fullCleanup();
      disconnectSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- HANDLERS ----
  const handleNext = useCallback(() => {
    // 1. Emitir al server ANTES de limpiar (para que encuentre la room)
    try { STATE.socket.emit('next'); } catch (e) {
      console.error('[SOCKET] emit next failed', e);
    }

    // 2. Limpiar localmente (lightCleanup ya apaga cámara y detiene video tracks)
    webrtc.lightCleanup();
    STATE.type = null;
    STATE.retryCount = 0;
    STATE.isReconnecting = false;
    STATE.isCameraOff = true;
    STATE.isMuted = true;
    setCameraBtnText('OFF');
    setMuteBtnText('MUTED');
    setSpinnerVisible(true);
    setAppState(AppState.CONNECTING);
  }, [STATE, webrtc, setAppState]);

  const handleExit = useCallback(() => {
    STATE.isExiting = true;
    let didAck = false;

    const cleanup = () => {
      try { webrtc.fullCleanup(); } catch (e) {}
      try { disconnectSocket(); } catch (e) {}
      navigate('/checking');
    };

    try {
      STATE.socket.emit('disconnect-me', () => {
        didAck = true;
        cleanup();
      });
    } catch (e) {
      cleanup();
    }

    setTimeout(() => {
      if (!didAck) cleanup();
    }, 500);
  }, [STATE, webrtc, disconnectSocket, navigate]);

  const handleCamera = useCallback(() => {
    toggleCamera(myVideoRef.current, setCameraBtnText);
  }, [toggleCamera]);

  const handleMute = useCallback(() => {
    toggleMute((text) => setMuteBtnText(text));
  }, [toggleMute]);

  const handleSend = useCallback(() => {
    const message = inputRef.current?.value?.trim();
    if (message && STATE.roomid) {
      const sanitized = sanitize(message);
      try {
        STATE.socket.emit('send-message', sanitized, STATE.type, STATE.roomid);
      } catch (e) {}
      addMessage(sanitized, true);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [STATE, sanitize, addMessage]);

  const handleInput = useCallback((value) => {
    try {
      if (STATE.socket && STATE.roomid) {
        STATE.socket.emit('typing', { roomid: STATE.roomid, isTyping: true });
        clearTimeout(window.__typingTimer__);
        window.__typingTimer__ = setTimeout(() => {
          try {
            if (STATE.socket && STATE.roomid) {
              STATE.socket.emit('typing', { roomid: STATE.roomid, isTyping: false });
            }
          } catch (e) {}
        }, 1000);
      }
    } catch (e) {}
  }, [STATE]);

  // ---- RENDER ----
  return (
    <div className="page-video-root">
      <div className="glass-app-container">
        <div className="sidebar-holder">
          <div className="sidebar-logo">
            <img src="/assets/cosmogle.png" alt="Logo" />
          </div>
        </div>

        <VideoHolder
          ref={{ myVideoRef, strangerVideoRef }}
          spinnerVisible={spinnerVisible}
          onNext={handleNext}
          onMute={handleMute}
          onExit={handleExit}
          onCamera={handleCamera}
          muteBtnText={muteBtnText}
          cameraBtnText={cameraBtnText}
        />

        <ChatHolder
          messages={messages}
          isTyping={isTyping}
          inputRef={inputRef}
          onSend={handleSend}
          onInput={handleInput}
        />
      </div>

      <Notification notifications={notifications} />
    </div>
  );
}
