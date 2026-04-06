import { forwardRef } from 'react';
import WaitingModal from './WaitingModal.jsx';
import Controls from './Controls.jsx';

const VideoHolder = forwardRef(function VideoHolder(
  {
    spinnerVisible,
    onNext,
    onMute,
    onExit,
    onCamera,
    muteBtnText,
    cameraBtnText,
    activeVideo = 'stranger',
    onVideoClick,
  },
  ref
) {
  const { myVideoRef, strangerVideoRef } = ref || {};

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
      <div className="video-container">
        <video
          autoPlay
          playsInline
          muted
          id="video"
          ref={strangerVideoRef}
          className={getStrangerClasses()}
          onClick={handleStrangerClick}
        />

        <video
          autoPlay
          muted
          id="my-video"
          ref={myVideoRef}
          className={getSelfClasses()}
          onClick={handleSelfClick}
        />
      </div>

      <Controls
        onNext={onNext}
        onMute={onMute}
        onExit={onExit}
        onCamera={onCamera}
        muteBtnText={muteBtnText}
        cameraBtnText={cameraBtnText}
      />

      <WaitingModal visible={spinnerVisible} />
    </div>
  );
});

export default VideoHolder;
