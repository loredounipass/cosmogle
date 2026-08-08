import { useCallback, useRef } from 'react';
import {
  getMediaStreamWithFallback,
  getAudioOnlyStream,
  enableAudioTracks,
  getStreamTracks,
  stopMediaStream,
} from '../webrtc/media.js';

export function useMedia(STATE, showNotification) {

  // INITIALIZE MEDIA WITH AUDIO ONLY BY DEFAULT
  const initMedia = useCallback(async (myVideoEl) => {
    try {
      STATE.isCameraOff = true;
      STATE.isMuted = true;

      STATE.localStream = await getAudioOnlyStream();
      const { audio } = getStreamTracks(STATE.localStream);
      audio.forEach(track => track.enabled = false);

      if (myVideoEl) {
        myVideoEl.srcObject = STATE.localStream;
        myVideoEl.muted = true;
      }

      console.log('[MEDIA] Stream initialized - Audio only', {
        videoTracks: 0,
        audioTracks: audio.length,
      });
    } catch (err) {
      console.error('[MEDIA] Error initializing media', err);
      throw err;
    }
  }, [STATE]);


  // TOGGLE LOCAL VIDEO TRACK ON OR OFF
  const toggleCamera = useCallback(async (myVideoEl, setCameraBtnText, setMuteBtnText) => {
    if (!STATE.localStream) {
      showNotification('No camera available');
      return;
    }

    const { video } = getStreamTracks(STATE.localStream);

      if (video.length === 0 && STATE.isCameraOff) {
        showNotification('Requesting camera...');
        try {
          const newStream = await getMediaStreamWithFallback((err) => {
            console.warn('[MEDIA] Fallback camera init', err?.name);
          }, false);

          const newVideo = newStream.getVideoTracks();
          if (!newVideo || newVideo.length === 0) {
            showNotification('No camera found');
            newStream.getTracks().forEach((t) => t.stop());
            return;
          }

          newVideo.forEach((track) => {
            try { STATE.localStream.addTrack(track); } catch (e) {}
            try {
              if (STATE.peer) STATE.peer.addTrack(track, STATE.localStream);
            } catch (e) {}
          });

          STATE.isCameraOff = false;
          setCameraBtnText('ON');
        if (myVideoEl) myVideoEl.srcObject = STATE.localStream;
        showNotification('Video ON');

        const { audio } = getStreamTracks(STATE.localStream);
        if (audio.length > 0) {
          audio.forEach((track) => {
            track.enabled = !STATE.isMuted;
          });
        }

        try {
          if (STATE.socket && STATE.roomid) {
            STATE.socket.emit('renegotiate');
          }
          setTimeout(() => {
            try {
              if (
                STATE.peer &&
                STATE.peer.signalingState === 'stable' &&
                !STATE.isNegotiating
              ) {
              }
            } catch (e) {}
          }, 250);
        } catch (e) {}

        try {
          if (STATE.socket && STATE.roomid) {
            STATE.socket.emit('media:state', {
              cameraOff: STATE.isCameraOff,
              muted: STATE.isMuted,
              roomid: STATE.roomid,
              type: STATE.type,
            });
          }
        } catch (e) {}
      } catch (err) {
        console.error('[MEDIA] Could not access camera', err?.name);
        showNotification('Could not access camera');
      }
      return;
    }

    STATE.isCameraOff = !STATE.isCameraOff;
    video.forEach((track) => {
      track.enabled = !STATE.isCameraOff;
    });

    setCameraBtnText(STATE.isCameraOff ? 'OFF' : 'ON');
    showNotification(STATE.isCameraOff ? 'Video OFF' : 'Video ON');

    try {
      if (STATE.socket && STATE.roomid) {
        STATE.socket.emit('media:state', {
          cameraOff: STATE.isCameraOff,
          muted: STATE.isMuted,
          roomid: STATE.roomid,
          type: STATE.type,
        });
      }
    } catch (e) {}
  }, [STATE, showNotification]);


  // TOGGLE LOCAL AUDIO TRACK MUTED STATE
  const toggleMute = useCallback((setMuteBtnText) => {
    if (!STATE.localStream) {
      showNotification('No audio available');
      return;
    }

    const { audio } = getStreamTracks(STATE.localStream);
    if (audio.length === 0) {
      showNotification('No audio track');
      return;
    }

    STATE.isMuted = !STATE.isMuted;
    audio.forEach((track) => {
      track.enabled = !STATE.isMuted;
    });

    setMuteBtnText(STATE.isMuted ? 'MUTED' : 'MUTE');
    showNotification(STATE.isMuted ? 'Audio OFF' : 'Audio ON');

    try {
      if (STATE.socket && STATE.roomid) {
        STATE.socket.emit('media:state', {
          cameraOff: STATE.isCameraOff,
          muted: STATE.isMuted,
          roomid: STATE.roomid,
          type: STATE.type,
        });
      }
    } catch (e) {}
  }, [STATE, showNotification]);


  // STOP ALL MEDIA TRACKS AND RELEASE RESOURCES
  const cleanupMedia = useCallback(() => {
    if (STATE.localStream) {
      stopMediaStream(STATE.localStream);
      STATE.localStream = null;
    }
  }, [STATE]);


  return { initMedia, toggleCamera, toggleMute, cleanupMedia };
}
