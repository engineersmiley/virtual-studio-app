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

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setBlob(null);
      chunksRef.current = [];

      // 1. Get Screen Stream (System Audio + Video)
      // IMPORTANT: User must select "Share System Audio" in the browser prompt
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
          echoCancellation: true, // Echo cancellation needed for mic
          noiseSuppression: true,
        }
      });

      // Keep track to stop later
      streamsRef.current = [displayStream, userStream];

      // 3. Setup Audio Context for mixing
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioContextRef.current = audioCtx;

      const dest = audioCtx.createMediaStreamDestination();
      destinationRef.current = dest;

      // Analyser for visualizer
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      dest.connect(analyser); // Connect mixed output to analyser

      // 4. Create Source Nodes & Gains
      // System Audio
      if (displayStream.getAudioTracks().length > 0) {
        const sysSource = audioCtx.createMediaStreamSource(displayStream);
        const sysGain = audioCtx.createGain();
        sysGain.gain.value = systemVolume;
        sysSource.connect(sysGain);
        sysGain.connect(dest);
        sysGainRef.current = sysGain;
      } else {
        console.warn("No system audio track found. Make sure 'Share System Audio' was checked.");
        setError("System audio not detected. Did you check 'Share System Audio'?");
      }

      // Microphone Audio
      if (userStream.getAudioTracks().length > 0) {
        const micSource = audioCtx.createMediaStreamSource(userStream);
        const micGain = audioCtx.createGain();
        micGain.gain.value = micVolume;
        micSource.connect(micGain);
        micGain.connect(dest);
        micGainRef.current = micGain;
      }

      // 5. Combine Video from Display with Mixed Audio
      const mixedAudioTrack = dest.stream.getAudioTracks()[0];
      const videoTrack = displayStream.getVideoTracks()[0];
      
      const combinedStream = new MediaStream([videoTrack, mixedAudioTrack]);

      // Handle user clicking "Stop Sharing" in browser UI
      videoTrack.onended = () => {
        stopRecording();
      };

      // 6. Start MediaRecorder
      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9,opus'
      });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const recordedBlob = new Blob(chunksRef.current, { type: 'video/webm' });
        setBlob(recordedBlob);
        setStatus('stopped');
        
        // Cleanup Audio Context
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        
        // Stop all tracks
        streamsRef.current.forEach(stream => {
          stream.getTracks().forEach(track => track.stop());
        });
        streamsRef.current = [];

        if (onStop) onStop(recordedBlob);
      };

      mediaRecorder.start(100); // Collect 100ms chunks
      setStatus('recording');
      
      // Timer
      setDuration(0);
      timerRef.current = window.setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

    } catch (err: any) {
      console.error("Error starting recording:", err);
      setError(err.message || "Failed to start recording");
      setStatus('idle');
    }
  }, [micVolume, systemVolume, onStop]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

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
