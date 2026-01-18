import { useState, useRef, useEffect, useCallback } from 'react';

export interface RecorderState {
  status: 'idle' | 'recording' | 'paused' | 'stopped';
  duration: number; // in seconds
  error: string | null;
  blob: Blob | null;
}

interface UseRecorderOptions {
  onStop?: (blob: Blob) => void;
}

export function useRecorder({ onStop }: UseRecorderOptions = {}) {
  const [status, setStatus] = useState<RecorderState['status']>('idle');
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [micVolume, setMicVolume] = useState(1.0);
  const [systemVolume, setSystemVolume] = useState(1.0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  
  // Web Audio API refs for mixing
  const audioContextRef = useRef<AudioContext | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const sysGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);

  // Update gain nodes when volume state changes
  useEffect(() => {
    if (micGainRef.current) micGainRef.current.gain.value = micVolume;
  }, [micVolume]);

  useEffect(() => {
    if (sysGainRef.current) sysGainRef.current.gain.value = systemVolume;
  }, [systemVolume]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async (options: { highQuality?: boolean } = {}) => {
    try {
      setError(null);
      setBlob(null);
      chunksRef.current = [];

      // 1. Get Screen Stream (System Audio + Video)
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1920, height: 1080, frameRate: 60 },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });

      // 2. Get Microphone Stream
      const userStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      streamsRef.current = [displayStream, userStream];

      // 3. Setup Audio Context
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioContextRef.current = audioCtx;

      const dest = audioCtx.createMediaStreamDestination();
      destinationRef.current = dest;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      dest.connect(analyser);

      // 4. Mixing
      if (displayStream.getAudioTracks().length > 0) {
        const sysSource = audioCtx.createMediaStreamSource(displayStream);
        const sysGain = audioCtx.createGain();
        sysGain.gain.value = systemVolume;
        sysSource.connect(sysGain);
        sysGain.connect(dest);
        sysGainRef.current = sysGain;
      }

      if (userStream.getAudioTracks().length > 0) {
        const micSource = audioCtx.createMediaStreamSource(userStream);
        const micGain = audioCtx.createGain();
        micGain.gain.value = micVolume;
        micSource.connect(micGain);
        micGain.connect(dest);
        micGainRef.current = micGain;
      }

      const mixedAudioTrack = dest.stream.getAudioTracks()[0];
      const videoTrack = displayStream.getVideoTracks()[0];
      const combinedStream = new MediaStream([videoTrack, mixedAudioTrack]);

      videoTrack.onended = () => stopRecording();

      // 6. MediaRecorder with High Quality options
      const audioBitsPerSecond = options.highQuality ? 320000 : 128000;

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9,opus',
        audioBitsPerSecond
      });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const recordedBlob = new Blob(chunksRef.current, { type: 'video/webm' });
        setBlob(recordedBlob);
        setStatus('stopped');
        
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        
        streamsRef.current.forEach(stream => {
          stream.getTracks().forEach(track => track.stop());
        });
        streamsRef.current = [];

        if (onStop) onStop(recordedBlob);
      };

      mediaRecorder.start(100);
      setStatus('recording');
      
      setDuration(0);
      timerRef.current = window.setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

    } catch (err: any) {
      console.error("Error starting recording:", err);
      setError(err.message || "Failed to start recording");
      setStatus('idle');
    }
  }, [micVolume, systemVolume, onStop, stopRecording]);

  const resetRecorder = useCallback(() => {
    setBlob(null);
    setDuration(0);
    setStatus('idle');
    setError(null);
  }, []);

  return {
    status,
    duration,
    error,
    blob,
    startRecording,
    stopRecording,
    resetRecorder,
    micVolume,
    setMicVolume,
    systemVolume,
    setSystemVolume,
    analyserNode: analyserRef.current // Expose for visualizer
  };
}
