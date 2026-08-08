

// GET OPTIMAL NATIVE VIDEO CONSTRAINTS FOR THE DEVICE
export async function getNativeVideoConstraints() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    
    if (videoDevices.length === 0) {
      return {
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 480 },
        frameRate: { ideal: 30, min: 15 },
        facingMode: "user"
      };
    }
    
    const deviceId = videoDevices[0].deviceId;
    const capabilities = navigator.mediaDevices.getSupportedConstraints();
    
    const constraints = {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 1280, min: 640 },
      height: { ideal: 720, min: 480 },
      frameRate: { ideal: 30, min: 15 },
      facingMode: "user"
    };
    
    if (!capabilities.deviceId) {
      delete constraints.deviceId;
    }
    
    return constraints;
  } catch (err) {
    console.warn('[MEDIA] Error getting native constraints:', err);
    return getFallbackVideoConstraints();
  }
}


// GET FALLBACK VIDEO CONSTRAINTS WHEN OPTIMAL FAILS
export function getFallbackVideoConstraints() {
  return {
    width: { ideal: 1280, min: 640 },
    height: { ideal: 720, min: 480 },
    frameRate: { ideal: 30, min: 15 },
    facingMode: "user"
  };
}


// GET MINIMAL VIDEO CONSTRAINTS FOR LOW-END DEVICES OR POOR CONNECTIONS
export function getMinimalVideoConstraints() {
  return {
    width: { ideal: 640, min: 320 },
    height: { ideal: 480, min: 240 },
    frameRate: { ideal: 24, min: 15 },
    facingMode: "user"
  };
}


// GET MEDIA STREAM WITH SPECIFIED CONSTRAINTS
export async function getMediaStream(videoConstraints, audioConstraints = null) {
  if (audioConstraints === false || audioConstraints === null) {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints
    });
  }

  const defaultAudio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  
  return navigator.mediaDevices.getUserMedia({
    audio: typeof audioConstraints === 'object' ? { ...defaultAudio, ...audioConstraints } : defaultAudio,
    video: videoConstraints
  });
}


// GET MEDIA STREAM WITH FALLBACK LOGIC ACROSS QUALITY TIERS
export async function getMediaStreamWithFallback(onFallback, requestAudio = false) {
  const highConstraints = await getNativeVideoConstraints();
  
  try {
    return await getMediaStream(highConstraints, requestAudio);
  } catch (err) {
    console.warn('[MEDIA] High quality failed, trying fallback:', err.name);
    
    const fallbackConstraints = getFallbackVideoConstraints();
    
    try {
      return await getMediaStream(fallbackConstraints, requestAudio);
    } catch (fallbackErr) {
      console.warn('[MEDIA] Fallback failed, trying minimal:', fallbackErr.name);
      
      const minimalConstraints = getMinimalVideoConstraints();
      
      try {
        return await getMediaStream(minimalConstraints, requestAudio);
      } catch (minimalErr) {
        console.error('[MEDIA] All video constraints failed:', minimalErr.name);
        
        if (onFallback) onFallback(minimalErr);
        
        if (requestAudio) {
          try {
            return await getAudioOnlyStream();
          } catch (audioErr) {
            console.error('[MEDIA] Even audio failed:', audioErr.name);
            throw audioErr;
          }
        } else {
          throw minimalErr;
        }
      }
    }
  }
}


// GET AN AUDIO-ONLY MEDIA STREAM
export async function getAudioOnlyStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false
  });
}


// STOP ALL TRACKS IN A MEDIA STREAM
export function stopMediaStream(stream) {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
}


// APPLY ADVANCED VIDEO SETTINGS CONSTRAINTS
export async function applyVideoSettings(videoTrack, settings = {}) {
  if (!videoTrack) return;
  
  const defaultSettings = {
    advanced: [
      { brightness: 0.5, contrast: 1.0, saturation: 1.2 }
    ]
  };
  
  try {
    await videoTrack.applyConstraints({
      ...defaultSettings,
      ...settings
    });
  } catch (err) {
    console.warn('[MEDIA] Error applying video settings:', err);
  }
}


// ENABLE ALL VIDEO TRACKS IN A STREAM
export function enableVideoTracks(stream) {
  if (stream) {
    stream.getVideoTracks().forEach(track => {
      track.enabled = true;
    });
  }
}


// DISABLE ALL VIDEO TRACKS IN A STREAM
export function disableVideoTracks(stream) {
  if (stream) {
    stream.getVideoTracks().forEach(track => {
      track.enabled = false;
    });
  }
}


// ENABLE ALL AUDIO TRACKS IN A STREAM
export function enableAudioTracks(stream) {
  if (stream) {
    stream.getAudioTracks().forEach(track => {
      track.enabled = true;
    });
  }
}


// DISABLE ALL AUDIO TRACKS IN A STREAM
export function disableAudioTracks(stream) {
  if (stream) {
    stream.getAudioTracks().forEach(track => {
      track.enabled = false;
    });
  }
}


// GET SEPARATED VIDEO AND AUDIO TRACKS FROM A STREAM
export function getStreamTracks(stream) {
  if (!stream) return { video: [], audio: [] };
  
  return {
    video: stream.getVideoTracks(),
    audio: stream.getAudioTracks()
  };
}
