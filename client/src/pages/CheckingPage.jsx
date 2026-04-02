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
      <div className="studio-container">
        {/* Header */}
        <div className="studio-header">
          <div className="studio-logo">
            <img src="/assets/cosmogle.png" alt="Cosmogle" />
          </div>
          <h1>Configuración del Estudio</h1>
          <p className="studio-subtitle">Verifica que tu cámara y micrófono funcionen correctamente</p>
        </div>

        {/* Main Content */}
        <div className="studio-main">
          {/* Camera Section */}
          <div className="studio-section camera-section">
            <div className="section-header">
              <div className="section-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </div>
              <div className="section-info">
                <h3>Cámara</h3>
                <span className="section-status" data-active={cameraOn}>
                  {cameraOn ? 'Activa' : 'Inactiva'}
                </span>
              </div>
            </div>

            <div className="camera-preview">
              {status === 'checking' && (
                <div className="loading-preview">
                  <div className="loader"></div>
                  <span>Inicializando cámara...</span>
                </div>
              )}

              {status === 'error' && (
                <div className="error-preview">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                    className="studio-video"
                    style={{ display: cameraOn ? 'block' : 'none' }}
                  />
                  {!cameraOn && (
                    <div className="camera-off-placeholder">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                        <circle cx="12" cy="13" r="4"/>
                      </svg>
                      <span>Presiona para activar</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <button 
              className={`studio-btn camera-btn ${cameraOn ? 'active' : ''}`}
              onClick={toggleCamera}
              disabled={cameraLoading || status !== 'success'}
            >
              {cameraLoading ? (
                <>
                  <div className="btn-loader"></div>
                  <span>Conectando...</span>
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                  <span>{cameraOn ? 'Desactivar Cámara' : 'Activar Cámara'}</span>
                </>
              )}
            </button>
          </div>

          {/* Microphone Section */}
          <div className="studio-section mic-section">
            <div className="section-header">
              <div className="section-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </div>
              <div className="section-info">
                <h3>Micrófono</h3>
                <span className="section-status" data-active={audioLevel > 0.05}>
                  {audioLevel > 0.05 ? 'Detectando audio' : 'Activo'}
                </span>
              </div>
            </div>

            {status === 'success' && (
              <>
                <div className="audio-visualizer">
                  <div className="audio-bars">
                    {[...Array(20)].map((_, i) => (
                      <div 
                        key={i} 
                        className="audio-bar-segment"
                        style={{ 
                          height: `${Math.max(audioLevel * 100, 5)}%`,
                          opacity: audioLevel > 0.05 ? 1 : 0.3
                        }}
                      />
                    ))}
                  </div>
                  <div className="audio-meter">
                    <div 
                      className="audio-meter-fill"
                      style={{ width: `${Math.max(audioLevel * 100, 2)}%` }}
                    />
                  </div>
                </div>

                <div className="mic-controls">
                  <button 
                    className={`studio-btn record-btn ${isRecording ? 'recording' : ''}`}
                    onClick={toggleRecording}
                  >
                    {isRecording ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                          <rect x="6" y="6" width="12" height="12" rx="2"/>
                        </svg>
                        <span>Detener Grabación</span>
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                          <line x1="12" y1="19" x2="12" y2="23"/>
                          <line x1="8" y1="23" x2="16" y2="23"/>
                        </svg>
                        <span>Grabar Audio de Prueba</span>
                      </>
                    )}
                  </button>

                  {recordedAudio && !isRecording && (
                    <button 
                      className={`studio-btn play-btn ${speakerPlaying ? 'playing' : ''}`}
                      onClick={playRecordedAudio}
                      disabled={speakerPlaying}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 12 3 19 10 19 14 12 21 5 14 5 3"/>
                        <path d="M15 8a3 3 0 0 1 0 6"/>
                      </svg>
                      <span>{speakerPlaying ? 'Reproduciendo...' : 'Reproducir Grabación'}</span>
                    </button>
                  )}
                </div>
                <audio ref={audioRef} onEnded={handleAudioEnded} />
              </>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="studio-footer">
          <div className="footer-status">
            <div className="status-indicator" data-ready={status === 'success' && cameraOn}>
              <div className="status-dot"></div>
              <span>
                {status === 'checking' && 'Verificando dispositivos...'}
                {status === 'error' && 'Error en los dispositivos'}
                {status === 'success' && !cameraOn && 'Activa la cámara para continuar'}
                {status === 'success' && cameraOn && 'Todo listo para comenzar'}
              </span>
            </div>
          </div>

          <div className="footer-actions">
            <button className="studio-btn-secondary" onClick={handleBack}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5"/>
                <path d="M12 19l-7-7 7-7"/>
              </svg>
              <span>Volver</span>
            </button>

            <button 
              className="studio-btn-primary" 
              onClick={handleStart}
              disabled={status !== 'success' || !cameraOn}
            >
              <span>Comenzar Sesión</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14"/>
                <path d="M12 5l7 7-7 7"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
