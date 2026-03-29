// Media Module

export async function getNativeVideoConstraints() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    
    if (videoDevices.length === 0) {
      return {
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
        frameRate: { ideal: 30, min: 24 },
        facingMode: "user"
      };
    }
    
    const deviceId = videoDevices[0].deviceId;
    const capabilities = navigator.mediaDevices.getSupportedConstraints();
    
    const constraints = {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 1920, max: 1920, min: 1280 },
      height: { ideal: 1080, max: 1080, min: 720 },
      frameRate: { ideal: 30, min: 24 },
      facingMode: "user"
    };
    
    if (!capabilities.deviceId) {
      delete constraints.deviceId;
    }
    
    return constraints;
  } catch (err) {
    console.warn('[MEDIA] Error getting native constraints:', err);
    return {
      width: { ideal: 1920, min: 1280 },
      height: { ideal: 1080, min: 720 },
      frameRate: { ideal: 30, min: 24 },
      facingMode: "user"
    };
  }
}

export async function getMediaStream(videoConstraints, audioConstraints = {}) {
  const defaultAudio = {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 1 },
    latency: { ideal: 0.01 }
  };
  
  return navigator.mediaDevices.getUserMedia({
    audio: { ...defaultAudio, ...audioConstraints },
    video: videoConstraints
  });
}

export async function getAudioOnlyStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true }
    },
    video: false
  });
}

export function stopMediaStream(stream) {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
}

export function applyVideoSettings(videoTrack, settings = {}) {
  if (!videoTrack) return;
  
  const defaultSettings = {
    advanced: [
      { brightness: 0.5, contrast: 1.0, saturation: 1.2 }
    ]
  };
  
  return videoTrack.applyConstraints({
    ...defaultSettings,
    ...settings
  });
}

export function toggleVideoTrack(stream, enabled) {
  if (stream) {
    stream.getVideoTracks().forEach(track => {
      track.enabled = enabled;
    });
  }
}

export function toggleAudioTrack(stream, enabled) {
  if (stream) {
    stream.getAudioTracks().forEach(track => {
      track.enabled = enabled;
    });
  }
}
