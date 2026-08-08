import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export const useCheckingLogic = () => {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const firstRender = useRef(true);
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


  // INITIALIZE AUDIO AND CLEANUP ON UNMOUNT
  useEffect(() => {
    initAudio();
    return () => {
      cleanup();
    };
  }, []);


  // SAVE CAMERA STATE TO LOCAL STORAGE ON CHANGE
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    console.log('[localStorage] Guardando checking_camera_on:', cameraOn);
    localStorage.setItem('checking_camera_on', cameraOn);
  }, [cameraOn]);


  // CLEANUP RESOURCES AND MEDIA TRACKS
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
    setRecordedAudio((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };


  // REQUEST MICROPHONE ACCESS AND SETUP AUDIO LEVEL
  const initAudio = async () => {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      streamRef.current = audioStream;
      setStatus('success');
      setupAudioLevel(audioStream);

      const savedCamera = localStorage.getItem('checking_camera_on');
      console.log('[localStorage] Leído checking_camera_on:', savedCamera);
      if (savedCamera === 'true') {
        await toggleCamera();
      }
    } catch (err) {
      console.error('Error accessing audio:', err);
      setStatus('error');
      setError('No se pudo acceder al micrófono');
    }
  };


  // TOGGLE CAMERA STREAM ON OR OFF
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


  // ANALYZE AUDIO STREAM FREQUENCY FOR VISUAL FEEDBACK
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


  // TOGGLE RECORDING STATE
  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };


  // START RECORDING AUDIO STREAM
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
      setRecordedAudio((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(audioBlob);
      });
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(100);
    setIsRecording(true);
  };


  // STOP RECORDING AUDIO STREAM
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };


  // PLAY THE RECORDED AUDIO BLOB
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


  // HANDLE AUDIO PLAYBACK ENDED
  const handleAudioEnded = () => {
    setSpeakerPlaying(false);
  };


  // NAVIGATE TO VIDEO PAGE AND CLEANUP
  const handleStart = () => {
    cleanup();
    navigate('/video');
  };


  // NAVIGATE TO HOME PAGE AND CLEANUP
  const handleBack = () => {
    cleanup();
    navigate('/');
  };


  return {
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
  };
};
