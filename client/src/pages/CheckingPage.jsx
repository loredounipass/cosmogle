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
      {/* Animated Background */}
      <div className="home-bg-gradient"></div>
      <div className="home-bg-grid"></div>
      <div className="home-floating-orbs">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
      </div>

      {/* Main Content */}
      <main className="checking-main">
        <div className="checking-container">
          {/* Header */}
          <div className="checking-header">
            <h2>Configuración</h2>
            <p>Verifica tu cámara y micrófono</p>
          </div>

          {/* Camera Section */}
          <div className="checking-card">
            <div className="card-header">
              <div className="card-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </div>
              <span className="card-title">Cámara</span>
              <span className={`card-status ${cameraOn ? 'active' : ''}`}>
                {cameraOn ? 'ON' : 'OFF'}
              </span>
            </div>

            <div className="camera-preview">
              {status === 'checking' && (
                <div className="preview-loading">
                  <div className="mini-loader"></div>
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
                    <div className="preview-off">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                        <circle cx="12" cy="13" r="4"/>
                      </svg>
                    </div>
                  )}
                </>
              )}
            </div>

            <button 
              className={`card-btn ${cameraOn ? 'active' : ''}`}
              onClick={toggleCamera}
              disabled={cameraLoading || status !== 'success'}
            >
              {cameraLoading ? 'Conectando...' : cameraOn ? 'Apagar' : 'Encender'}
            </button>
          </div>

          {/* Microphone Section */}
          <div className="checking-card">
            <div className="card-header">
              <div className="card-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </div>
              <span className="card-title">Micrófono</span>
              <span className={`card-status ${audioLevel > 0.05 ? 'active' : ''}`}>
                {audioLevel > 0.05 ? 'Detectando' : 'Listo'}
              </span>
            </div>

            {status === 'success' && (
              <>
                <div className="audio-meter">
                  <div 
                    className="audio-fill"
                    style={{ width: `${Math.max(audioLevel * 100, 2)}%` }}
                  />
                </div>

                <div className="mic-buttons">
                  <button 
                    className={`card-btn record ${isRecording ? 'recording' : ''}`}
                    onClick={toggleRecording}
                  >
                    {isRecording ? 'Detener' : 'Grabar Prueba'}
                  </button>

                  {recordedAudio && !isRecording && (
                    <button 
                      className="card-btn play"
                      onClick={playRecordedAudio}
                      disabled={speakerPlaying}
                    >
                      {speakerPlaying ? 'Reproduciendo...' : 'Reproducir'}
                    </button>
                  )}
                </div>
                <audio ref={audioRef} onEnded={handleAudioEnded} />
              </>
            )}
          </div>

          {/* Actions */}
          <div className="checking-actions">
            <div className="status-bar">
              <div className={`status-dot ${status === 'success' && cameraOn ? 'ready' : ''}`}></div>
              <span>
                {status === 'checking' && 'Verificando...'}
                {status === 'error' && 'Error'}
                {status === 'success' && !cameraOn && 'Cámara requerida'}
                {status === 'success' && cameraOn && 'Listo'}
              </span>
            </div>

            <div className="action-buttons">
              <button className="btn-back" onClick={handleBack}>
                Volver
              </button>
              <button 
                className="btn-start" 
                onClick={handleStart}
                disabled={status !== 'success' || !cameraOn}
              >
                Comenzar
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
