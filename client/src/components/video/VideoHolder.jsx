import { forwardRef } from 'react';
import WaitingModal from './WaitingModal.jsx';
import Controls from './Controls.jsx';
import FilterBar from './FilterBar.jsx';

import { FILTERS } from '../../hooks/useInstacam.js';

const VideoHolder = forwardRef(function VideoHolder(
  {
    spinnerVisible,
    appState,
    onNext,
    onMute,
    onExit,
    onCamera,
    muteBtnText,
    cameraBtnText,
    activeVideo = 'stranger',
    onVideoClick,
    filterBarVisible,
    activeFilter,
    onSelectFilter,
    onToggleFilter,
  },
  ref
) {
  const { myVideoRef, strangerVideoRef, videoContainerRef } = ref || {};

  const handleStrangerClick = () => {
    if (onVideoClick) onVideoClick('stranger');
  };

  const handleSelfClick = () => {
    if (onVideoClick) onVideoClick('self');
  };

  // Get classes based on active video - only apply animation classes when clicked
  const getStrangerClasses = () => {
    let classes = 'video-element';
    if (activeVideo === 'stranger') classes += ' video-main';
    else if (activeVideo === 'self') classes += ' video-pip';
    return classes;
  };

  const getSelfClasses = () => {
    let classes = 'video-element';
    if (activeVideo === 'self') classes += ' video-main';
    else if (activeVideo === 'stranger') classes += ' video-pip';
    return classes;
  };

  return (
    <div className="video-holder">
      <div className="video-container" ref={videoContainerRef}>
        <video
          autoPlay
          playsInline
          id="video"
          ref={strangerVideoRef}
          className={getStrangerClasses()}
          onClick={handleStrangerClick}
          onPlaying={(e) => {
            // M-04: Unmute after first successful play (browser autoplay requires muted start)
            if (e.target.muted) e.target.muted = false;
          }}
        />

        <video
          autoPlay
          playsInline
          muted
          id="my-video"
          ref={myVideoRef}
          className={getSelfClasses()}
          onClick={handleSelfClick}
        />
      </div>

      <FilterBar
        activeFilter={activeFilter}
        onSelectFilter={onSelectFilter}
        visible={filterBarVisible}
      />

      <Controls
        onNext={onNext}
        onMute={onMute}
        onExit={onExit}
        onCamera={onCamera}
        muteBtnText={muteBtnText}
        cameraBtnText={cameraBtnText}
        onToggleFilter={onToggleFilter}
        filterActive={activeFilter !== 'none'}
      />

      <WaitingModal visible={spinnerVisible} appState={appState} />
    </div>
  );
});

export default VideoHolder;
