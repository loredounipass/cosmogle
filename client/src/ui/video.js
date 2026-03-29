// Video UI Module

const MAX_VIDEO_PLAY_RETRIES = 5;
let videoPlayRetries = 0;

export function setupVideoElement(videoElement, onPlay, onError) {
  if (!videoElement) return;
  
  videoElement.onplaying = () => {
    videoPlayRetries = 0;
    if (onPlay) onPlay();
  };
  
  videoElement.onwaiting = () => {
    attemptPlay(videoElement);
  };
  
  videoElement.onstalled = () => {
    attemptPlay(videoElement);
  };
  
  videoElement.onerror = () => {
    if (onError) onError(videoElement.error);
    attemptPlay(videoElement);
  };
}

export function attemptPlay(videoElement) {
  if (!videoElement || !videoElement.srcObject) return;
  
  videoElement.muted = true;
  
  const playPromise = videoElement.play();
  
  if (playPromise !== undefined) {
    playPromise
      .then(() => {
        videoPlayRetries = 0;
      })
      .catch(err => {
        if (videoPlayRetries >= MAX_VIDEO_PLAY_RETRIES) {
          return;
        }
        
        videoPlayRetries++;
        const delay = Math.min(1000 * Math.pow(2, videoPlayRetries), 5000);
        setTimeout(() => attemptPlay(videoElement), delay);
      });
  }
}

export function forcePlay(videoElement) {
  if (!videoElement) return;
  
  videoElement.muted = true;
  videoElement.play().catch(() => {});
}

export function resetVideoRetries() {
  videoPlayRetries = 0;
}
