import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState, AppState } from './useAppState.js';
import { useWebRTC } from './useWebRTC.js';
import { useMedia } from './useMedia.js';
import { useChat } from './useChat.js';
import { useSocket } from './useSocket.js';
import { useNotification } from '../components/video/Notification.jsx';
import { useInstacam } from './useInstacam.js';

export const useVideoLogic = () => {
  const navigate = useNavigate();

  const myVideoRef = useRef(null);
  const strangerVideoRef = useRef(null);
  const videoContainerRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimerRef = useRef(null);

  const [spinnerVisible, setSpinnerVisible] = useState(true);
  const [muteBtnText, setMuteBtnText] = useState('MUTED');
  const [cameraBtnText, setCameraBtnText] = useState('OFF');
  const [activeVideo, setActiveVideo] = useState('stranger');
  const [filterBarVisible, setFilterBarVisible] = useState(false);
  const [activeFilter, setActiveFilter] = useState('none');

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


  // SYNCHRONIZE CAMERA STATE WITH FILTER VISIBILITY
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


  // INITIALIZE SOCKET AND MEDIA ON COMPONENT MOUNT
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
  }, []);


  // HANDLE TRANSITION TO NEXT STRANGER
  const handleNext = useCallback(() => {
    try { STATE.socket.emit('next'); } catch (e) {
      console.error('[SOCKET] emit next failed', e);
    }

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

    if (myVideoRef.current) {
      myVideoRef.current.srcObject = null;
      myVideoRef.current.srcObject = STATE.localStream;
    }

    setSpinnerVisible(true);
    setActiveVideo('stranger');
    setAppState(AppState.CONNECTING);
  }, [STATE, webrtc, clearMessages, destroyInstacam, setAppState]);


  // HANDLE LEAVING THE VIDEO ROOM
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


  // TOGGLE LOCAL CAMERA STREAM
  const handleCamera = useCallback(() => {
    toggleCamera(myVideoRef.current, setCameraBtnText, setMuteBtnText);
  }, [toggleCamera]);


  // TOGGLE LOCAL AUDIO STREAM
  const handleMute = useCallback(() => {
    toggleMute((text) => setMuteBtnText(text));
  }, [toggleMute]);


  // SEND CHAT MESSAGE TO PEER
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


  // EMIT TYPING STATUS EVENT
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


  // SET ACTIVE VIDEO STREAM VIEW
  const handleVideoClick = useCallback((video) => {
    setActiveVideo(video);
  }, []);


  // TOGGLE VISIBILITY OF AR FILTERS BAR
  const handleToggleFilter = useCallback(() => {
    if (STATE.isCameraOff) return;
    setFilterBarVisible(prev => !prev);
  }, [STATE.isCameraOff]);


  // SELECT AND APPLY AR FILTER TO STREAM
  const handleSelectFilter = useCallback(async (filterKey) => {
    setActiveFilter(filterKey);

    if (filterKey === 'none') {
      destroyInstacam();

      const videoSender = STATE.peer?.getSenders().find(s => s.track?.kind === 'video');
      const originalTrack = STATE.localStream?.getVideoTracks()[0];
      if (videoSender && originalTrack) {
        try {
          await videoSender.replaceTrack(originalTrack);
        } catch (e) {
          console.error('[INSTACAM] Error restoring original track:', e);
        }
      }

      if (myVideoRef.current) {
        myVideoRef.current.srcObject = STATE.localStream;
      }

    } else {
      applyFilter(filterKey);

      const canvasStream = initInstacam();
      if (!canvasStream) return;

      const newTrack = canvasStream.getVideoTracks()[0];
      if (!newTrack) {
        destroyInstacam();
        return;
      }

      if (myVideoRef.current && myVideoRef.current.srcObject !== canvasStream) {
        myVideoRef.current.srcObject = canvasStream;
      }

      const videoSender = STATE.peer?.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender && videoSender.track !== newTrack) {
        try {
          await videoSender.replaceTrack(newTrack);
        } catch (e) {
          console.error('[INSTACAM] Error replacing track:', e);
          destroyInstacam();
          setActiveFilter('none');
          if (myVideoRef.current) {
            myVideoRef.current.srcObject = STATE.localStream;
          }
        }
      }
    }
  }, [initInstacam, destroyInstacam, applyFilter, STATE]);


  return {
    myVideoRef,
    strangerVideoRef,
    videoContainerRef,
    inputRef,
    spinnerVisible,
    muteBtnText,
    cameraBtnText,
    activeVideo,
    filterBarVisible,
    activeFilter,
    appState,
    messages,
    isTyping,
    notifications,
    STATE,
    handleNext,
    handleLeave,
    handleCamera,
    handleMute,
    handleSend,
    handleInput,
    handleVideoClick,
    handleToggleFilter,
    handleSelectFilter
  };
};
