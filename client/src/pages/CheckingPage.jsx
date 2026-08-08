import React from 'react';
import { useCheckingLogic } from '../hooks/useCheckingLogic';

export default function CheckingPage() {
  const {
    videoRef,
    audioRef,
    status,
    error,
    cameraOn,
    cameraLoading,
    audioLevel,
    isRecording,
    recordedAudio,
    speakerPlaying,
    toggleCamera,
    toggleRecording,
    playRecordedAudio,
    handleAudioEnded,
    handleStart,
    handleBack
  } = useCheckingLogic();

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
              <div className={`status-dot ${status === 'success' ? 'ready' : ''}`}></div>
              <span>
                {status === 'checking' && 'Verificando...'}
                {status === 'error' && 'Error'}
                {status === 'success' && !cameraOn && 'Solo audio'}
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
                disabled={status !== 'success'}
              >
                {cameraOn ? 'Comenzar' : 'Comenzar sin cámara'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
