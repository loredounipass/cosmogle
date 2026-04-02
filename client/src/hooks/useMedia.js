import { useCallback, useRef } from 'react';
import {
  getMediaStreamWithFallback,
  getAudioOnlyStream,
  enableAudioTracks,
  getStreamTracks,
  stopMediaStream,
} from '../webrtc/media.js';

/**
 * useMedia — Encapsula initMedia(), toggle cámara y toggle audio.
 * Mantiene la lógica exacta del index.js original.
 */
export function useMedia(STATE, showNotification) {
  const initMedia = useCallback(async (myVideoEl) => {
    try {
      STATE.isCameraOff = true;

      STATE.localStream = await getAudioOnlyStream();
      enableAudioTracks(STATE.localStream);

      if (myVideoEl) {
        myVideoEl.srcObject = STATE.localStream;
        myVideoEl.muted = true;
      }

      const tracks = getStreamTracks(STATE.localStream);
      console.log('[MEDIA] Stream initialized - Audio only', {
        videoTracks: tracks.video.length,
        audioTracks: tracks.audio.length,
      });
    } catch (err) {
      console.error('[MEDIA] Error initializing media', err);
      throw err;
    }
  }, [STATE]);

  const toggleCamera = useCallback(async (myVideoEl, setCameraBtnText) => {
    if (!STATE.localStream) {
      showNotification('No camera available');
      return;
    }

    const { video } = getStreamTracks(STATE.localStream);

    // Si no hay tracks de video aún → solicitar cámara
    if (video.length === 0 && STATE.isCameraOff) {
      showNotification('Requesting camera...');
      try {
        const newStream = await getMediaStreamWithFallback((err) => {
          console.warn('[MEDIA] Fallback camera init', err?.name);
        });

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

        // Detener audio tracks del helper stream (evitar duplicados)
        newStream.getAudioTracks().forEach((t) => t.stop());

        STATE.isCameraOff = false;
        setCameraBtnText('ON');
        if (myVideoEl) myVideoEl.srcObject = STATE.localStream;
        showNotification('Video ON');

        // Enable audio when camera turns on
        const { audio } = getStreamTracks(STATE.localStream);
        if (audio.length > 0) {
          STATE.isMuted = false;
          audio.forEach((track) => {
            track.enabled = true;
          });
        }

        // Renegociación
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
                // createOffer se disparará por onnegotiationneeded
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

    // Toggle tracks existentes
    STATE.isCameraOff = !STATE.isCameraOff;
    video.forEach((track) => {
      track.enabled = !STATE.isCameraOff;
    });

    setCameraBtnText(STATE.isCameraOff ? 'OFF' : 'ON');
    showNotification(STATE.isCameraOff ? 'Video OFF' : 'Video ON');

    // When camera turns off, mute the microphone
    if (STATE.isCameraOff) {
      const { audio } = getStreamTracks(STATE.localStream);
      if (audio.length > 0) {
        STATE.isMuted = true;
        audio.forEach((track) => {
          track.enabled = false;
        });
      }
    }

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

  const toggleMute = useCallback((setMuteBtnText) => {
    if (!STATE.localStream) {
      showNotification('No audio available');
      return;
    }

    // Don't allow mute toggle if camera is off
    if (STATE.isCameraOff) {
      showNotification('Turn on camera first');
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

  const cleanupMedia = useCallback(() => {
    if (STATE.localStream) {
      stopMediaStream(STATE.localStream);
      STATE.localStream = null;
    }
  }, [STATE]);

  return { initMedia, toggleCamera, toggleMute, cleanupMedia };
}
