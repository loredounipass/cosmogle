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
import AROverlay from '../components/video/AROverlay.jsx';
import { useInstacam } from '../hooks/useInstacam.js';

/**
 * VideoPage — Orquestador principal de la sesión de video.
 * Migración exacta de video.html + index.js, descompuesta en hooks y componentes.
 * La estructura JSX replica fielmente el layout grid del CSS original.
 */
export default function VideoPage() {
  const navigate = useNavigate();

  // ---- REFS DOM ----
  const myVideoRef       = useRef(null);
  const strangerVideoRef = useRef(null);
  const videoContainerRef = useRef(null);
  const inputRef         = useRef(null);
  const typingTimerRef   = useRef(null); // H-04: avoid window pollution

  // ---- UI STATE ----
  const [spinnerVisible, setSpinnerVisible] = useState(true);
  // El audio inicia deshabilitado (apagado), por lo que el botón debe mostrar 'MUTED' (Silenciado)
  const [muteBtnText,    setMuteBtnText]    = useState('MUTED');
  const [cameraBtnText,  setCameraBtnText]  = useState('OFF');
  const [activeVideo, setActiveVideo] = useState('stranger'); // 'stranger' | 'self'
  const [filterBarVisible, setFilterBarVisible] = useState(false);
  const [activeFilter, setActiveFilter] = useState('none');

  // ---- HOOKS ----
  const { STATE, appState, setAppState, canPerformAction } = useAppState();
  const { messages, isTyping, addMessage, clearMessages, showTyping, sanitize } = useChat();
  const { notifications, showNotification } = useNotification();

  const { init: initInstacam, applyFilter, destroy: destroyInstacam } = useInstacam(videoContainerRef, myVideoRef);

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

  // ---- SIDE EFFECTS ----
  // Si se apaga la cámara, también se desactivan los filtros
  useEffect(() => {
    if (cameraBtnText === 'OFF') {
      if (activeFilter !== 'none') {
        destroyInstacam();
        setActiveFilter('none');
      }
      if (filterBarVisible) {
        setFilterBarVisible(false);
      }
    }
  }, [cameraBtnText, activeFilter, filterBarVisible, destroyInstacam]);

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
      destroyInstacam();
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
    destroyInstacam();
    setFilterBarVisible(false);
    setActiveFilter('none');
    clearMessages();
    webrtc.lightCleanup();
    STATE.type = null;
    STATE.retryCount = 0;
    STATE.isReconnecting = false;
    STATE.isCameraOff = true;
    STATE.isMuted = true;
    setCameraBtnText('OFF');
    setMuteBtnText('MUTED');

    // M-04: Limpiar el frame congelado del video local.
    // Al detener los tracks en lightCleanup(), el elemento <video> se queda congelado en el último frame.
    // Reasignar el srcObject fuerza al navegador a dibujar un cuadro negro (ya que no hay tracks de video).
    if (myVideoRef.current) {
      myVideoRef.current.srcObject = null;
      myVideoRef.current.srcObject = STATE.localStream;
    }

    setSpinnerVisible(true);
    setActiveVideo('stranger'); // <--- Resetear vista principal al stranger
    setAppState(AppState.CONNECTING);
  }, [STATE, webrtc, clearMessages, destroyInstacam, setAppState]);

  // M-03: handleExit and handleBack were identical — unified into handleLeave
  const handleLeave = useCallback(() => {
    STATE.isExiting = true;
    let didAck = false;

    const cleanup = () => {
      destroyInstacam();
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
  }, [STATE, webrtc, disconnectSocket, navigate, destroyInstacam]);

  const handleCamera = useCallback(() => {
    toggleCamera(myVideoRef.current, setCameraBtnText, setMuteBtnText);
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

  // H-04: Use ref instead of window global for typing debounce timer
  const handleInput = useCallback((value) => {
    try {
      if (STATE.socket && STATE.roomid) {
        STATE.socket.emit('typing', { roomid: STATE.roomid, isTyping: true });
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => {
          try {
            if (STATE.socket && STATE.roomid) {
              STATE.socket.emit('typing', { roomid: STATE.roomid, isTyping: false });
            }
          } catch (e) {}
        }, 1000);
      }
    } catch (e) {}
  }, [STATE]);

  const handleVideoClick = useCallback((video) => {
    setActiveVideo(video);
  }, []);

  const handleToggleFilter = useCallback(() => {
    // No permitir filtros si la cámara está apagada
    if (STATE.isCameraOff) return;
    setFilterBarVisible(prev => !prev);
  }, [STATE.isCameraOff]);

  const handleSelectFilter = useCallback(async (filterKey) => {
    setActiveFilter(filterKey);

    if (filterKey === 'none') {
      // === DESACTIVAR FILTROS ===
      destroyInstacam();

      // Restaurar el track de video original en la conexión WebRTC
      const videoSender = STATE.peer?.getSenders().find(s => s.track?.kind === 'video');
      const originalTrack = STATE.localStream?.getVideoTracks()[0];
      if (videoSender && originalTrack) {
        try {
          await videoSender.replaceTrack(originalTrack);
        } catch (e) {
          console.error('[INSTACAM] Error restoring original track:', e);
        }
      }

      // Restaurar el stream original en el video local
      if (myVideoRef.current) {
        myVideoRef.current.srcObject = STATE.localStream;
      }

    } else {
      // === ACTIVAR O CAMBIAR FILTRO ===
      applyFilter(filterKey);

      const canvasStream = initInstacam();
      if (!canvasStream) return;

      const newTrack = canvasStream.getVideoTracks()[0];
      if (!newTrack) {
        destroyInstacam();
        return;
      }

      // Reemplazar el stream en el video local para ver los pixel filters
      if (myVideoRef.current && myVideoRef.current.srcObject !== canvasStream) {
        myVideoRef.current.srcObject = canvasStream;
      }

      // Reemplazar el track de video en la conexión WebRTC con el del canvas filtrado
      const videoSender = STATE.peer?.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender && videoSender.track !== newTrack) {
        try {
          await videoSender.replaceTrack(newTrack);
        } catch (e) {
          console.error('[INSTACAM] Error replacing track:', e);
          // Rollback en caso de fallo
          destroyInstacam();
          setActiveFilter('none');
          if (myVideoRef.current) {
            myVideoRef.current.srcObject = STATE.localStream;
          }
        }
      }
    }
  }, [initInstacam, destroyInstacam, applyFilter, STATE]);

  // ---- RENDER ----
  return (
    <div className="page-video-root">
      <div className="glass-app-container">
        <div className="sidebar-holder">
          <div className="sidebar-logo">
            <img src="/assets/cosmogle.png" alt="Logo" />
          </div>
          <button className="sidebar-back-btn" onClick={handleLeave}>
            Atrás
          </button>
        </div>

        <VideoHolder
          ref={{ myVideoRef, strangerVideoRef, videoContainerRef }}
          spinnerVisible={spinnerVisible}
          appState={appState}
          onNext={handleNext}
          onMute={handleMute}
          onExit={handleLeave}
          onCamera={handleCamera}
          muteBtnText={muteBtnText}
          cameraBtnText={cameraBtnText}
          activeVideo={activeVideo}
          onVideoClick={handleVideoClick}
          filterBarVisible={filterBarVisible}
          activeFilter={activeFilter}
          onSelectFilter={handleSelectFilter}
          onToggleFilter={handleToggleFilter}
        />

        <ChatHolder
          messages={messages}
          isTyping={isTyping}
          inputRef={inputRef}
          onSend={handleSend}
          onInput={handleInput}
          appState={appState}
        />
      </div>

      <Notification notifications={notifications} />
      
      {/* Sistema AR Invisible: Mantiene el motor de seguimiento 3D corriendo cuando hay un filtro AR activo */}
      <AROverlay stream={STATE.localStream} activeFilter={activeFilter} />
    </div>
  );
}
