import React from 'react';
import Notification from '../components/video/Notification.jsx';
import VideoHolder from '../components/video/VideoHolder.jsx';
import ChatHolder from '../components/video/ChatHolder.jsx';
import AROverlay from '../components/video/AROverlay.jsx';
import { useVideoLogic } from '../hooks/useVideoLogic.js';

export default function VideoPage() {
  const {
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
  } = useVideoLogic();

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
