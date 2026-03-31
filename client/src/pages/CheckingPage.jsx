import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function CheckingPage() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [status, setStatus] = useState('checking');
  const [error, setError] = useState(null);
  const [speakerPlaying, setSpeakerPlaying] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    initAudio();
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
  };

  const initAudio = async () => {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true }
        }
      });

      streamRef.current = audioStream;
      setStatus('success');
      setupAudioLevel(audioStream);
    } catch (err) {
      console.error('Error accessing audio:', err);
      setStatus('error');
      setError('No se pudo acceder al micrófono');
    }
  };

  const toggleCamera = async () => {
    if (cameraOn) {
      const videoTrack = streamRef.current?.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.stop();
        streamRef.current.removeTrack(videoTrack);
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setCameraOn(false);
    } else {
      setCameraLoading(true);
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
            frameRate: { ideal: 30, min: 24 },
            facingMode: "user"
          }
        });

        const videoTrack = videoStream.getVideoTracks()[0];
        if (streamRef.current) {
          streamRef.current.addTrack(videoTrack);
        } else {
          streamRef.current = videoStream;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = streamRef.current;
        }

        setCameraOn(true);
      } catch (err) {
        console.error('Error accessing camera:', err);
        setError('No se pudo acceder a la cámara');
      } finally {
        setCameraLoading(false);
      }
    }
  };

  const setupAudioLevel = (mediaStream) => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(mediaStream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;

      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateLevel = () => {
        if (audioContextRef.current?.state === 'running') {
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          setAudioLevel(average / 255);
          animationRef.current = requestAnimationFrame(updateLevel);
        }
      };

      updateLevel();
    } catch (err) {
      console.error('Error setting up audio level:', err);
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const startRecording = () => {
    if (!streamRef.current) {
      setError('No hay acceso al micrófono');
      return;
    }

    audioChunksRef.current = [];
    const mediaRecorder = new MediaRecorder(streamRef.current);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(audioBlob);
      setRecordedAudio(audioUrl);
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(100);
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const playRecordedAudio = () => {
    if (audioRef.current && recordedAudio) {
      audioRef.current.src = recordedAudio;
      audioRef.current.play().then(() => {
        setSpeakerPlaying(true);
      }).catch(err => {
        console.error('Error playing recorded audio:', err);
      });
    }
  };

  const handleAudioEnded = () => {
    setSpeakerPlaying(false);
  };

  const handleStart = () => {
    cleanup();
    navigate('/video');
  };

  const handleBack = () => {
    cleanup();
    navigate('/');
  };

  return (
    <div className="page-checking-root">
      <div className="checking-wrapper">
        <h1>Verifica tu audio y cámara</h1>
        <p className="subtitle">Asegúrate de que todo funcione antes de comenzar</p>

        <div className="preview-container">
          {status === 'checking' && (
            <div className="loading-preview">
              <div className="loader"></div>
              <span>Verificando micrófono...</span>
            </div>
          )}

          {status === 'error' && (
            <div className="error-preview">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{error || 'Error al acceder a los dispositivos'}</span>
            </div>
          )}

          {status === 'success' && (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="preview-video"
                style={{ display: cameraOn ? 'block' : 'none' }}
              />
              {!cameraOn && (
                <div className="camera-off-preview">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                  <span>Cámara apagada</span>
                </div>
              )}
            </>
          )}
        </div>

        {status === 'success' && (
          <>
            <div className="audio-indicator-standalone">
              <div className="audio-label">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
                <span>Micrófono</span>
              </div>
              <div className={`audio-bar-container ${audioLevel > 0.05 ? 'active' : ''}`}>
                <div className="audio-bar">
                  <div
                    className="audio-level"
                    style={{ width: `${Math.max(audioLevel * 100, 2)}%` }}
                  />
                </div>
                <span className="audio-status">{audioLevel > 0.05 ? 'Detectando...' : 'Activo'}</span>
              </div>
            </div>

            <div className="testing-buttons">
              <button 
                className={`btn-camera ${cameraOn ? 'on' : ''}`}
                onClick={toggleCamera}
                disabled={cameraLoading}
              >
                {cameraLoading ? (
                  <>
                    <div className="btn-loader"></div>
                    <span>Cargando...</span>
                  </>
                ) : cameraOn ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                    <span>Apagar Cámara</span>
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                    <span>Probar Cámara</span>
                  </>
                )}
              </button>

              <button 
                className={`btn-record ${isRecording ? 'recording' : ''}`}
                onClick={toggleRecording}
              >
                {isRecording ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                      <rect x="6" y="6" width="12" height="12" rx="2"/>
                    </svg>
                    <span>Detener</span>
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                      <line x1="12" y1="19" x2="12" y2="23"/>
                      <line x1="8" y1="23" x2="16" y2="23"/>
                    </svg>
                    <span>Grabar Audio</span>
                  </>
                )}
              </button>

              {recordedAudio && !isRecording && (
                <button 
                  className={`btn-speaker ${speakerPlaying ? 'playing' : ''}`}
                  onClick={playRecordedAudio}
                  disabled={speakerPlaying}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 12 3 19 10 19 14 12 21 5 14 5 3"/>
                    <path d="M15 8a3 3 0 0 1 0 6"/>
                  </svg>
                  {speakerPlaying ? 'Reproduciendo...' : 'Reproducir'}
                </button>
              )}
            </div>
            <audio ref={audioRef} onEnded={handleAudioEnded} />
          </>
        )}

        <div className="checking-actions">
          {status === 'success' && (
            <button className="btn-start" onClick={handleStart}>
              Iniciar
            </button>
          )}
          <button className="btn-back" onClick={handleBack}>
            Volver
          </button>
        </div>
      </div>
    </div>
  );
}