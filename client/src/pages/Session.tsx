import { useState, useEffect, useRef, useCallback } from 'react';
import { useRoute, Link } from 'wouter';
import { useWebRTC, type RemoteControlEvent, type RemoteStreamInfo } from '@/hooks/use-webrtc';
import { useUploadRecording } from '@/hooks/use-recordings';
import { Visualizer } from '@/components/Visualizer';
import { AudioDeviceSelector } from '@/components/AudioDeviceSelector';
import { SubscriptionGate } from '@/components/SubscriptionGate';
import { PhoneControl } from '@/components/PhoneControl';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Monitor, Mic, Square, Disc, Save, Download, Copy, 
  Users, Radio, ArrowLeft, CheckCircle, AlertTriangle, X,
  Video, VideoOff, Eye, PenTool, Zap, MousePointer2, Move, Maximize, Minimize,
  Volume2, VolumeX, Music
} from 'lucide-react';
import type { SessionRole } from '@shared/schema';

function generateUserId() {
  return 'user_' + Math.random().toString(36).substr(2, 9);
}

function formatSessionTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function ProducerAudio({ 
  stream, 
  userId, 
  onPlayBlocked,
  onPlaySuccess,
  registerRef
}: { 
  stream: MediaStream; 
  userId: string;
  onPlayBlocked: (userId: string) => void;
  onPlaySuccess: (userId: string) => void;
  registerRef: (userId: string, ref: HTMLAudioElement | null) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const streamIdRef = useRef<string | null>(null);
  
  // Register ref for external access
  useEffect(() => {
    registerRef(userId, audioRef.current);
    return () => registerRef(userId, null);
  }, [userId, registerRef]);
  
  // Handle new stream - mark as blocked initially, then try autoplay
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !stream) return;
    
    // Track stream by its id to detect changes
    const newStreamId = stream.id;
    if (streamIdRef.current === newStreamId) return;
    streamIdRef.current = newStreamId;
    
    audio.srcObject = stream;
    // Mark as blocked until autoplay succeeds
    onPlayBlocked(userId);
    
    // Try autoplay
    audio.play()
      .then(() => onPlaySuccess(userId))
      .catch(() => onPlayBlocked(userId));
  }, [stream, userId, onPlayBlocked, onPlaySuccess]);
  
  return (
    <audio
      ref={audioRef}
      playsInline
      data-testid={`audio-producer-${userId}`}
      style={{ display: 'none' }}
    />
  );
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
}

function canShareScreen() {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

function SessionContent() {
  const [, params] = useRoute('/session/:id/:role');
  const roomId = params?.id || '';
  const role = (params?.role as SessionRole) || 'artist';
  
  const [userId] = useState(() => generateUserId());
  const [isSharing, setIsSharing] = useState(false);
  const [isMobile] = useState(() => isMobileDevice());
  const [screenShareSupported] = useState(() => canShareScreen());
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [copied, setCopied] = useState(false);
  
  // Session timer - starts when connected
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [controlMode, setControlMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [remotePointer, setRemotePointer] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
  const pointerTimeoutRef = useRef<number | null>(null);
  
  // Agent/Full control state
  const [agentConnected, setAgentConnected] = useState(false);
  const [fullControlActive, setFullControlActive] = useState(false);
  const [controlPending, setControlPending] = useState(false);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  
  // Simple remote control toggle (for artists)
  const [remoteControlAllowed, setRemoteControlAllowed] = useState(false);
  const [togglingRemoteControl, setTogglingRemoteControl] = useState(false);
  
  // View mode toggle for engineers (regular view vs remote control view)
  const [remoteControlViewMode, setRemoteControlViewMode] = useState(false);
  
  // Main video audio state - track if audio is muted due to autoplay policy
  const [videoAudioMuted, setVideoAudioMuted] = useState(true);
  const [hasAudioTracks, setHasAudioTracks] = useState(false);
  const [audioConfirmed, setAudioConfirmed] = useState(false);
  const [volume, setVolume] = useState(100); // 0-100
  const [isTestingAudio, setIsTestingAudio] = useState(false);
  
  // Producer audio state - track status per user: pending (not tried), playing, blocked
  const [audioStatus, setAudioStatus] = useState<Map<string, 'pending' | 'playing' | 'blocked'>>(new Map());
  const producerAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  
  const { toast } = useToast();
  
  // Test audio function - plays a short tone to confirm audio is working
  const playTestAudio = useCallback(async () => {
    if (isTestingAudio) return;
    setIsTestingAudio(true);
    
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Create a pleasant chord for testing
      const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5 (C major chord)
      const duration = 0.5;
      
      frequencies.forEach((freq, i) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = freq;
        oscillator.type = 'sine';
        
        // Stagger start times slightly for a richer sound
        const startTime = audioContext.currentTime + (i * 0.02);
        gainNode.gain.setValueAtTime(0.15, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        
        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
      });
      
      toast({
        title: "Audio Test",
        description: "If you heard a tone, your audio is working!",
      });
      
      // Reset after sound finishes
      setTimeout(() => setIsTestingAudio(false), 600);
    } catch (err) {
      console.error('Audio test failed:', err);
      toast({
        title: "Audio Test Failed",
        description: "Could not play test sound. Check your audio settings.",
        variant: "destructive",
      });
      setIsTestingAudio(false);
    }
  }, [isTestingAudio, toast]);
  
  // Count blocked streams
  const blockedCount = Array.from(audioStatus.values()).filter(s => s === 'blocked').length;
  const hasBlockedAudio = blockedCount > 0;
  
  // Callbacks for ProducerAudio components
  const markAudioBlocked = useCallback((userId: string) => {
    setAudioStatus(prev => {
      const next = new Map(prev);
      next.set(userId, 'blocked');
      return next;
    });
  }, []);
  
  const markAudioPlaying = useCallback((userId: string) => {
    setAudioStatus(prev => {
      const next = new Map(prev);
      next.set(userId, 'playing');
      return next;
    });
  }, []);
  
  const registerAudioRef = useCallback((userId: string, ref: HTMLAudioElement | null) => {
    if (ref) {
      producerAudioRefs.current.set(userId, ref);
    } else {
      producerAudioRefs.current.delete(userId);
      // Clean up status when component unmounts
      setAudioStatus(prev => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    }
  }, []);
  
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const lastTouchRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastMouseMoveRef = useRef<number>(0);
  const MOUSE_THROTTLE_MS = 16; // ~60fps for smooth movement
  
  const uploadMutation = useUploadRecording();

  const handleRemoteControl = useCallback((event: RemoteControlEvent) => {
    // Show the remote pointer on artist's screen
    setRemotePointer({ x: event.x * 100, y: event.y * 100, visible: true });
    
    // Clear existing timeout
    if (pointerTimeoutRef.current) {
      clearTimeout(pointerTimeoutRef.current);
    }
    
    // Hide pointer after 2 seconds of inactivity
    pointerTimeoutRef.current = window.setTimeout(() => {
      setRemotePointer(prev => ({ ...prev, visible: false }));
    }, 2000);
  }, []);

  // Fullscreen toggle - always use container to preserve click handlers
  const toggleFullscreen = useCallback(() => {
    const container = videoContainerRef.current;
    if (!container) return;
    
    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      // Always use container for fullscreen to preserve click/touch handlers
      const enterFullscreen = (el: any) => {
        if (el.requestFullscreen) {
          return el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          return el.webkitRequestFullscreen();
        }
        return Promise.reject(new Error('Fullscreen not supported'));
      };
      
      enterFullscreen(container).then(() => {
        setIsFullscreen(true);
      }).catch((err: any) => {
        console.log('Fullscreen API not available:', err.message);
        // Fallback: maximize in viewport with CSS (works on all devices)
        container.style.position = 'fixed';
        container.style.top = '0';
        container.style.left = '0';
        container.style.width = '100vw';
        container.style.height = '100vh';
        container.style.zIndex = '9999';
        container.style.backgroundColor = 'black';
        setIsFullscreen(true);
      });
    } else {
      // Exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen().then(() => setIsFullscreen(false));
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
        setIsFullscreen(false);
      } else {
        // Undo CSS fallback
        container.style.position = '';
        container.style.top = '';
        container.style.left = '';
        container.style.width = '';
        container.style.height = '';
        container.style.zIndex = '';
        container.style.backgroundColor = '';
        setIsFullscreen(false);
      }
    }
  }, []);

  // Listen for fullscreen changes (including webkit)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement || !!(document as any).webkitFullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const {
    connected,
    participants,
    error,
    clearError,
    localStream,
    hasRemoteStream,
    remoteStreams,
    agentConnected: wsAgentConnected,
    controlAllowed: wsControlAllowed,
    controlPending: wsControlPending,
    audioConfirmations,
    isMicActive,
    connect,
    disconnect,
    startSharing,
    stopSharing,
    startMic,
    stopMic,
    sendControlEvent,
    requestFullControl,
    endFullControl,
    sendFullControlCommand,
    confirmAudio,
    unconfirmAudio,
  } = useWebRTC({
    roomId,
    userId,
    role,
    onRemoteControl: handleRemoteControl,
    onAgentStatus: (status) => {
      setAgentConnected(status.connected);
      setFullControlActive(status.controlAllowed);
      setControlPending(status.controlPending);
    },
  });

  // Start session timer when connected
  useEffect(() => {
    if (connected && !sessionStartTime) {
      setSessionStartTime(Date.now());
    }
  }, [connected, sessionStartTime]);

  // Session duration timer
  useEffect(() => {
    if (!sessionStartTime) return;
    
    const interval = setInterval(() => {
      setSessionDuration(Math.floor((Date.now() - sessionStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionStartTime]);

  // Direct screen touch control - touch on video to control computer
  const controlEnabled = fullControlActive || wsControlAllowed;
  
  const handleVideoTouchStart = useCallback((e: React.TouchEvent) => {
    if (!controlEnabled) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    lastTouchRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, [controlEnabled]);
  
  const handleVideoTouchMove = useCallback((e: React.TouchEvent) => {
    if (!controlEnabled || !lastTouchRef.current) return;
    e.preventDefault();
    
    // Throttle touch move to reduce lag (~60fps)
    const now = Date.now();
    if (now - lastMouseMoveRef.current < MOUSE_THROTTLE_MS) return;
    lastMouseMoveRef.current = now;
    
    const video = remoteVideoRef.current;
    if (!video) return;
    
    const touch = e.touches[0];
    const rect = video.getBoundingClientRect();
    
    // Calculate position relative to video
    const x = Math.max(0, Math.min(1920, ((touch.clientX - rect.left) / rect.width) * 1920));
    const y = Math.max(0, Math.min(1080, ((touch.clientY - rect.top) / rect.height) * 1080));
    
    sendFullControlCommand({ type: 'mouse-move', x, y });
    lastTouchRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, [controlEnabled, sendFullControlCommand]);
  
  const handleVideoTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!controlEnabled || !touchStartRef.current) return;
    
    const video = remoteVideoRef.current;
    if (!video) return;
    
    const touch = e.changedTouches[0];
    const rect = video.getBoundingClientRect();
    const touchDuration = Date.now() - touchStartRef.current.time;
    const moveDistance = Math.sqrt(
      Math.pow(touch.clientX - touchStartRef.current.x, 2) +
      Math.pow(touch.clientY - touchStartRef.current.y, 2)
    );
    
    // If it was a tap (not much movement), click at that position
    if (moveDistance < 15 && touchDuration < 400) {
      const x = ((touch.clientX - rect.left) / rect.width) * 1920;
      const y = ((touch.clientY - rect.top) / rect.height) * 1080;
      
      // Move to position then click
      sendFullControlCommand({ type: 'mouse-move', x, y });
      setTimeout(() => {
        sendFullControlCommand({ type: 'mouse-click', button: 'left' });
      }, 50);
    }
    
    touchStartRef.current = null;
    lastTouchRef.current = null;
  }, [controlEnabled, sendFullControlCommand]);

  // Get ALL audio-only streams (no video) - from any role (producers, engineers teaching, etc.)
  const audioOnlyStreams = Array.from(remoteStreams.values()).filter(
    info => !info.hasVideo && info.stream.getAudioTracks().length > 0
  );
  
  // Get the primary video stream (first stream with video - prioritize artist)
  const videoStreams = Array.from(remoteStreams.values()).filter(info => info.hasVideo);
  const primaryVideoStream = videoStreams.find(s => s.fromRole === 'artist') || videoStreams[0];
  
  // Attach primary video stream to video element when it changes
  useEffect(() => {
    if (remoteVideoRef.current && primaryVideoStream) {
      const currentSrc = remoteVideoRef.current.srcObject as MediaStream | null;
      if (currentSrc?.id !== primaryVideoStream.stream.id) {
        remoteVideoRef.current.srcObject = primaryVideoStream.stream;
        remoteVideoRef.current.muted = true;
        setVideoAudioMuted(true);
        
        // Check if stream has audio tracks
        const audioTracks = primaryVideoStream.stream.getAudioTracks();
        setHasAudioTracks(audioTracks.length > 0);
        console.log('Stream has audio tracks:', audioTracks.length, audioTracks.map(t => ({ label: t.label, enabled: t.enabled, muted: t.muted })));
        
        remoteVideoRef.current.play().catch(() => {
          console.log('Autoplay blocked even when muted');
        });
      }
    }
  }, [primaryVideoStream]);
  
  // Setup audio analyser for visualizer when primary video stream changes
  useEffect(() => {
    if (!primaryVideoStream) return;
    
    try {
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(primaryVideoStream.stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      
      return () => {
        audioContext.close().catch(() => {});
      };
    } catch (err) {
      console.error('Failed to setup audio analyser:', err);
    }
  }, [primaryVideoStream]);

  useEffect(() => {
    if (roomId) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [roomId]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const handleStartSharing = async (audioOnly: boolean = false) => {
    try {
      await startSharing(audioOnly);
      setIsSharing(true);
    } catch (e) {
      console.error('Failed to start sharing:', e);
    }
  };

  const handleStopSharing = () => {
    stopSharing();
    setIsSharing(false);
  };

  // Mic toggle handler
  const handleToggleMic = async () => {
    if (isMicActive) {
      stopMic();
      toast({ title: "Mic Off", description: "Your microphone is now muted" });
    } else {
      try {
        await startMic();
        toast({ title: "Mic On", description: "Others can now hear you speak" });
      } catch (e) {
        console.error('Failed to start mic:', e);
      }
    }
  };

  // Audio toggle handler
  const handleToggleAudio = async () => {
    if (videoAudioMuted) {
      // Enable audio
      let videoEnabled = false;
      let audioStreamsEnabled = 0;
      
      if (remoteVideoRef.current) {
        try {
          const video = remoteVideoRef.current;
          // Ensure volume is set to current slider value
          video.volume = volume / 100;
          
          // Pause, unmute, then play to force audio context to restart
          video.pause();
          video.muted = false;
          video.currentTime = video.currentTime; // Reset playhead
          
          await video.play();
          setVideoAudioMuted(false);
          videoEnabled = true;
          
          // Log audio track info for debugging
          const stream = video.srcObject as MediaStream;
          const audioTracks = stream?.getAudioTracks() || [];
          console.log('Audio enabled - muted:', video.muted, 'volume:', video.volume, 'audio tracks:', audioTracks.length);
          audioTracks.forEach(t => console.log('  Track:', t.label, 'enabled:', t.enabled, 'muted:', t.muted));
        } catch (err) {
          console.error('Video audio play failed:', err);
          toast({ title: "Audio Failed", description: "Could not enable audio. Try clicking again.", variant: "destructive" });
        }
      }
      
      // Enable all blocked audio-only streams
      const blockedUsers = Array.from(audioStatus.entries())
        .filter(([, status]) => status === 'blocked')
        .map(([userId]) => userId);
      
      for (const blockedUserId of blockedUsers) {
        const audio = producerAudioRefs.current.get(blockedUserId);
        if (audio) {
          try {
            await audio.play();
            markAudioPlaying(blockedUserId);
            audioStreamsEnabled++;
          } catch (err) {
            console.error(`Audio stream ${blockedUserId} failed:`, err);
          }
        }
      }
      
      if (videoEnabled || audioStreamsEnabled > 0) {
        toast({ title: "Audio On", description: "Session audio enabled" });
        // Confirm audio to all broadcasters
        confirmAudio();
        setAudioConfirmed(true);
      }
    } else {
      // Mute audio
      if (remoteVideoRef.current) {
        remoteVideoRef.current.muted = true;
        setVideoAudioMuted(true);
      }
      for (const audio of producerAudioRefs.current.values()) {
        audio.pause();
      }
      // Unconfirm audio to all broadcasters
      unconfirmAudio();
      setAudioConfirmed(false);
      toast({ title: "Audio Muted", description: "Session audio muted" });
    }
  };

  // Volume change handler
  const handleVolumeChange = (newVolume: number[]) => {
    const vol = newVolume[0];
    setVolume(vol);
    const normalizedVolume = vol / 100;
    
    // Update video element volume
    if (remoteVideoRef.current) {
      remoteVideoRef.current.volume = normalizedVolume;
    }
    
    // Update all producer audio elements
    for (const audio of producerAudioRefs.current.values()) {
      audio.volume = normalizedVolume;
    }
  };

  // Recording controls (Engineer only)
  const startRecordingSession = () => {
    if (!remoteVideoRef.current?.srcObject) return;
    
    const stream = remoteVideoRef.current.srcObject as MediaStream;
    
    // Determine supported MIME type with fallbacks
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    
    let selectedMimeType = 'video/webm';
    for (const mimeType of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        selectedMimeType = mimeType;
        break;
      }
    }
    
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType,
        audioBitsPerSecond: 320000,
      });
    } catch (err) {
      console.error('Failed to create MediaRecorder:', err);
      return;
    }
    
    chunksRef.current = [];
    
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    
    recorder.onerror = (e) => {
      console.error('MediaRecorder error:', e);
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    };
    
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: selectedMimeType.split(';')[0] });
      setRecordedBlob(blob);
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    };
    
    recorder.start(100);
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
    setRecordingDuration(0);
    
    timerRef.current = window.setInterval(() => {
      setRecordingDuration(prev => prev + 1);
    }, 1000);
  };

  const stopRecordingSession = () => {
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current?.stop();
    }
  };

  const handleDownload = () => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${roomId}-${Date.now()}.webm`;
    a.click();
  };

  const handleSave = async () => {
    if (!recordedBlob) return;
    await uploadMutation.mutateAsync({
      blob: recordedBlob,
      metadata: {
        title: `Session ${roomId} Recording`,
        duration: recordingDuration,
        description: `Remote recording session`,
        sessionId: roomId,
      }
    });
    setRecordedBlob(null);
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getAgentToken = async () => {
    // Both artists and engineers can get tokens
    if (role !== 'engineer' && role !== 'artist') return;
    
    setTokenLoading(true);
    try {
      const email = localStorage.getItem('studiolink_subscriber_email') || '';
      const response = await fetch('/api/agent/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode: roomId, email })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        toast({
          title: 'Token Error',
          description: data.error || 'Failed to get agent token',
          variant: 'destructive'
        });
        return;
      }
      
      await navigator.clipboard.writeText(data.token);
      setGeneratedToken(data.token);
      toast({
        title: 'Token Copied!',
        description: role === 'artist' 
          ? 'Share this token with your engineer.'
          : 'Paste it in the Virtual Studio Agent app.',
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to get agent token',
        variant: 'destructive'
      });
    } finally {
      setTokenLoading(false);
    }
  };

  // Toggle remote control (for artists - simple on/off, no token needed)
  const toggleRemoteControl = async () => {
    if (role !== 'artist') return;
    
    setTogglingRemoteControl(true);
    try {
      const endpoint = remoteControlAllowed 
        ? `/api/session/${roomId}/disable-remote-control`
        : `/api/session/${roomId}/enable-remote-control`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        toast({
          title: 'Error',
          description: data.error || 'Failed to toggle remote control',
          variant: 'destructive'
        });
        return;
      }
      
      setRemoteControlAllowed(data.enabled);
      toast({
        title: data.enabled ? 'Remote Control Enabled' : 'Remote Control Disabled',
        description: data.enabled 
          ? 'Your engineer can now connect the desktop app using just the room code.'
          : 'Remote control has been disabled.',
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to toggle remote control',
        variant: 'destructive'
      });
    } finally {
      setTogglingRemoteControl(false);
    }
  };

  const formatTime = (seconds: number) => {
    return new Date(seconds * 1000).toISOString().substr(11, 8);
  };

  const artistCount = participants.filter(p => p.role === 'artist').length + (role === 'artist' ? 1 : 0);
  const engineerCount = participants.filter(p => p.role === 'engineer').length + (role === 'engineer' ? 1 : 0);
  const producerCount = participants.filter(p => p.role === 'producer').length + (role === 'producer' ? 1 : 0);
  const otherCount = participants.filter(p => p.role === 'other').length + (role === 'other' ? 1 : 0);

  // Helper to get role color
  const getRoleColor = (r: SessionRole) => {
    switch (r) {
      case 'artist': return 'text-secondary';
      case 'engineer': return 'text-primary';
      case 'producer': return 'text-purple-400';
      case 'other': return 'text-amber-400';
    }
  };

  const getRoleBgColor = (r: SessionRole) => {
    switch (r) {
      case 'artist': return 'bg-secondary/20 border-secondary/30';
      case 'engineer': return 'bg-primary/20 border-primary/30';
      case 'producer': return 'bg-purple-500/20 border-purple-500/30';
      case 'other': return 'bg-amber-500/20 border-amber-500/30';
    }
  };

  const getRoleDotColor = (r: SessionRole) => {
    switch (r) {
      case 'artist': return 'bg-secondary';
      case 'engineer': return 'bg-primary';
      case 'producer': return 'bg-purple-500';
      case 'other': return 'bg-amber-500';
    }
  };

  const getRoleIcon = (r: SessionRole) => {
    switch (r) {
      case 'artist': return <Mic size={14} />;
      case 'engineer': return <Zap size={14} />;
      case 'producer': return <Eye size={14} />;
      case 'other': return <PenTool size={14} />;
    }
  };

  // Check if current role can record (only engineers)
  const canRecord = role === 'engineer';
  // Check if current role is a viewer (producer, other, engineer)
  const isViewer = role !== 'artist';

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col gap-4 md:gap-6 max-w-7xl mx-auto pb-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-primary transition-colors">
            <ArrowLeft size={24} />
          </Link>
          <div>
            <h1 className="text-2xl font-display font-bold text-white tracking-wider flex items-center gap-3">
              <Radio className={`${connected ? 'text-green-500 animate-pulse' : 'text-muted-foreground'}`} />
              SESSION: <span className="text-primary">{roomId}</span>
            </h1>
            <p className="text-muted-foreground font-tech text-sm mt-1">
              You are the <span className={`font-bold ${getRoleColor(role)}`}>{role.toUpperCase()}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={copyRoomCode}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-white/10 hover:border-primary/50 transition-colors"
          >
            {copied ? <CheckCircle size={16} className="text-green-500" /> : <Copy size={16} />}
            <span className="font-mono">{roomId}</span>
          </button>
          
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 text-sm">
            <Users size={16} />
            <span className="text-secondary">{artistCount}A</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-primary">{engineerCount}E</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-purple-400">{producerCount}P</span>
            {otherCount > 0 && (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="text-amber-400">{otherCount}O</span>
              </>
            )}
          </div>
          
          {/* Session Timer */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 text-sm" data-testid="session-timer">
            <Radio size={16} className={connected ? 'text-green-500' : 'text-muted-foreground'} />
            <span className="font-mono text-green-400">{formatSessionTime(sessionDuration)}</span>
          </div>
        </div>
      </header>

      {error && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} />
            {error}
          </div>
          <div className="flex items-center gap-2">
            {role === 'artist' && !isSharing && (
              <button 
                onClick={() => { clearError?.(); handleStartSharing(false); }}
                className="px-3 py-1 text-sm bg-primary/20 hover:bg-primary/30 text-primary rounded-lg transition-colors"
                data-testid="button-try-again"
              >
                Try Again
              </button>
            )}
            <button 
              onClick={() => window.location.reload()}
              className="px-3 py-1 text-sm bg-destructive/20 hover:bg-destructive/30 rounded-lg transition-colors"
              data-testid="button-refresh-page"
            >
              Refresh Page
            </button>
            <button 
              onClick={() => clearError?.()}
              className="text-destructive/70 hover:text-destructive transition-colors p-1"
              data-testid="button-dismiss-error"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        {/* Video/Stream Area */}
        <div className="lg:col-span-2 glass-panel rounded-2xl p-3 lg:p-6 flex flex-col gap-4">
          <div 
            ref={videoContainerRef}
            className="rounded-xl overflow-hidden bg-black/50 relative min-h-[200px] lg:min-h-[400px]"
            onClick={(e) => {
              if (role === 'engineer' && hasRemoteStream && remoteVideoRef.current) {
                const video = remoteVideoRef.current;
                const container = e.currentTarget.getBoundingClientRect();
                
                const videoRatio = video.videoWidth / video.videoHeight;
                const containerRatio = container.width / container.height;
                
                let videoDisplayWidth, videoDisplayHeight, offsetX, offsetY;
                
                if (videoRatio > containerRatio) {
                  videoDisplayWidth = container.width;
                  videoDisplayHeight = container.width / videoRatio;
                  offsetX = 0;
                  offsetY = (container.height - videoDisplayHeight) / 2;
                } else {
                  videoDisplayHeight = container.height;
                  videoDisplayWidth = container.height * videoRatio;
                  offsetX = (container.width - videoDisplayWidth) / 2;
                  offsetY = 0;
                }
                
                const clickX = e.clientX - container.left - offsetX;
                const clickY = e.clientY - container.top - offsetY;
                
                const normX = Math.max(0, Math.min(1, clickX / videoDisplayWidth));
                const normY = Math.max(0, Math.min(1, clickY / videoDisplayHeight));
                
                // Full control mode - send mouse commands to agent
                if (controlEnabled) {
                  const x = normX * 1920;
                  const y = normY * 1080;
                  sendFullControlCommand({ type: 'mouse-move', x, y });
                  setTimeout(() => {
                    sendFullControlCommand({ type: 'mouse-click', button: 'left' });
                  }, 50);
                } else if (controlMode) {
                  // Pointer mode - show pointer on artist's screen
                  sendControlEvent('click', normX, normY);
                }
              }
            }}
            onMouseMove={(e) => {
              if (role === 'engineer' && hasRemoteStream && remoteVideoRef.current) {
                // Throttle mouse move to reduce lag (~60fps)
                const now = Date.now();
                if (now - lastMouseMoveRef.current < MOUSE_THROTTLE_MS) return;
                lastMouseMoveRef.current = now;
                
                const video = remoteVideoRef.current;
                const container = e.currentTarget.getBoundingClientRect();
                
                const videoRatio = video.videoWidth / video.videoHeight;
                const containerRatio = container.width / container.height;
                
                let videoDisplayWidth, videoDisplayHeight, offsetX, offsetY;
                
                if (videoRatio > containerRatio) {
                  videoDisplayWidth = container.width;
                  videoDisplayHeight = container.width / videoRatio;
                  offsetX = 0;
                  offsetY = (container.height - videoDisplayHeight) / 2;
                } else {
                  videoDisplayHeight = container.height;
                  videoDisplayWidth = container.height * videoRatio;
                  offsetX = (container.width - videoDisplayWidth) / 2;
                  offsetY = 0;
                }
                
                const moveX = e.clientX - container.left - offsetX;
                const moveY = e.clientY - container.top - offsetY;
                
                const normX = Math.max(0, Math.min(1, moveX / videoDisplayWidth));
                const normY = Math.max(0, Math.min(1, moveY / videoDisplayHeight));
                
                // Full control mode - send mouse move to agent
                if (controlEnabled) {
                  const x = normX * 1920;
                  const y = normY * 1080;
                  sendFullControlCommand({ type: 'mouse-move', x, y });
                } else if (controlMode) {
                  // Pointer mode - show pointer on artist's screen
                  sendControlEvent('pointer', normX, normY);
                }
              }
            }}
          >
            {((role === 'artist' || role === 'engineer' || role === 'producer') && isSharing && localStream?.getVideoTracks().length) ? (
              // Artist, Engineer, or Producer (broadcasting) - show status instead of video preview to avoid mirror effect
              isSharing ? (
                <>
                  {/* Hidden video element for stream reference (needed for pointer positioning) */}
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="hidden"
                  />
                  {/* Broadcasting indicator instead of video preview to avoid infinite mirror loop */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-cyan-900/20 to-magenta-900/20">
                    <div className="relative">
                      <Monitor size={80} className="text-cyan-400" />
                      <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full animate-pulse flex items-center justify-center">
                        <div className="w-3 h-3 bg-white rounded-full" />
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-cyan-400 font-tech">Broadcasting Live</p>
                      <p className="text-muted-foreground mt-2">Your screen is being shared with participants</p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-4 p-8">
                  <Monitor size={64} className="opacity-30" />
                  <p className="font-tech text-center">Click "Start Sharing" to broadcast your screen</p>
                </div>
              )
            ) : (
              // Non-broadcasting participants see remote stream or their own placeholder
              <>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  controls={false}
                  className={`w-full h-full object-contain ${controlEnabled ? 'touch-none' : ''}`}
                  onTouchStart={handleVideoTouchStart}
                  onTouchMove={handleVideoTouchMove}
                  onTouchEnd={handleVideoTouchEnd}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (role === 'engineer' && controlEnabled && remoteVideoRef.current) {
                      const video = remoteVideoRef.current;
                      const rect = video.getBoundingClientRect();
                      const videoRatio = video.videoWidth / video.videoHeight || 16/9;
                      const containerRatio = rect.width / rect.height;
                      
                      let videoDisplayWidth, videoDisplayHeight, offsetX, offsetY;
                      if (videoRatio > containerRatio) {
                        videoDisplayWidth = rect.width;
                        videoDisplayHeight = rect.width / videoRatio;
                        offsetX = 0;
                        offsetY = (rect.height - videoDisplayHeight) / 2;
                      } else {
                        videoDisplayHeight = rect.height;
                        videoDisplayWidth = rect.height * videoRatio;
                        offsetX = (rect.width - videoDisplayWidth) / 2;
                        offsetY = 0;
                      }
                      
                      const clickX = e.clientX - rect.left - offsetX;
                      const clickY = e.clientY - rect.top - offsetY;
                      const normX = Math.max(0, Math.min(1, clickX / videoDisplayWidth));
                      const normY = Math.max(0, Math.min(1, clickY / videoDisplayHeight));
                      
                      const x = normX * 1920;
                      const y = normY * 1080;
                      sendFullControlCommand({ type: 'mouse-move', x, y });
                      setTimeout(() => {
                        sendFullControlCommand({ type: 'mouse-click', button: 'left' });
                      }, 50);
                    }
                  }}
                  style={{ cursor: 'default' }}
                />
                {!hasRemoteStream && !isSharing && !remoteVideoRef.current?.srcObject && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-4 bg-black/80">
                    <Radio size={64} className="opacity-30 animate-pulse" />
                    {participants.filter(p => p.role === 'artist' || p.role === 'producer' || p.role === 'engineer').length === 0 ? (
                      <>
                        <p className="font-tech">Waiting for someone to share their screen...</p>
                        <p className="text-sm opacity-50">Room code: <span className="text-primary font-mono">{roomId}</span></p>
                      </>
                    ) : (
                      <>
                        <p className="font-tech">Participants connected! Waiting for screen share...</p>
                        <p className="text-sm opacity-50">Someone needs to click "Share Screen" to start broadcasting</p>
                      </>
                    )}
                  </div>
                )}
                {/* Control mode indicator for engineer */}
                {role === 'engineer' && controlMode && hasRemoteStream && (
                  <div className="absolute top-3 left-3 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/90 text-primary-foreground text-sm font-medium">
                    <MousePointer2 size={14} />
                    Control Mode Active
                  </div>
                )}
                
              </>
            )}
            
            {/* Scanline overlay */}
            <div className="absolute inset-0 pointer-events-none opacity-10 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-10" style={{backgroundSize: "100% 2px, 3px 100%"}} />
            
            {/* Audio-only stream elements - hidden, just for playback */}
            {audioOnlyStreams.map((info) => (
              <ProducerAudio 
                key={info.fromUserId} 
                stream={info.stream} 
                userId={info.fromUserId}
                onPlayBlocked={markAudioBlocked}
                onPlaySuccess={markAudioPlaying}
                registerRef={registerAudioRef}
              />
            ))}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap gap-2 items-center justify-between">
            {role === 'artist' ? (
              // Artist controls - share screen and generate token for engineer
              <div className="flex gap-2 items-center flex-wrap">
                {isMobile || !screenShareSupported ? (
                  <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 text-xs">
                    <p className="font-bold">Screen sharing requires a computer</p>
                  </div>
                ) : !isSharing ? (
                  <button
                    onClick={() => handleStartSharing(false)}
                    data-testid="button-start-sharing"
                    className="px-3 py-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 text-background font-medium text-sm flex items-center gap-2 hover:brightness-110 transition-all"
                  >
                    <Video size={16} /> Share Screen
                  </button>
                ) : (
                  <button
                    onClick={handleStopSharing}
                    data-testid="button-stop-sharing"
                    className="px-3 py-2 rounded-lg bg-destructive text-white font-medium text-sm flex items-center gap-2 hover:bg-destructive/90 transition-all"
                  >
                    <VideoOff size={16} /> Stop
                  </button>
                )}
                
                {/* Mic toggle for artists - especially useful on mobile */}
                <button
                  onClick={handleToggleMic}
                  data-testid="button-artist-toggle-mic"
                  className={`px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border ${
                    isMicActive 
                      ? 'bg-green-500/20 border-green-500/50 text-green-400 hover:bg-green-500/30' 
                      : 'bg-gray-500/20 border-gray-500/50 text-gray-400 hover:bg-gray-500/30'
                  }`}
                  title={isMicActive ? 'Click to mute your mic' : 'Click to speak'}
                >
                  <div className={`w-2 h-2 rounded-full ${isMicActive ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
                  {isMicActive ? 'Mic On' : 'Mic Off'}
                </button>
                
                {/* Control status indicator - like agent lights */}
                <button
                  onClick={toggleRemoteControl}
                  disabled={togglingRemoteControl}
                  data-testid="button-allow-control"
                  className={`px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all disabled:opacity-50 border ${
                    remoteControlAllowed
                      ? 'bg-green-500/20 border-green-500/50 text-green-400'
                      : 'bg-amber-500/20 border-amber-500/50 text-amber-400 hover:bg-amber-500/30'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full ${remoteControlAllowed ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
                  {togglingRemoteControl ? 'Updating...' : remoteControlAllowed ? 'Control On' : 'Control Off'}
                </button>
              </div>
            ) : canRecord ? (
              // Engineer controls - can share screen, record, and control
              <>
              <div className="flex gap-2 items-center flex-wrap">
                {/* Audio indicator light - always visible */}
                <button
                  onClick={handleToggleAudio}
                  data-testid="button-toggle-stream-audio"
                  className={`px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border ${
                    !hasRemoteStream
                      ? 'bg-gray-500/20 border-gray-500/50 text-gray-400'
                      : !hasAudioTracks 
                        ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' 
                        : videoAudioMuted 
                          ? 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30' 
                          : 'bg-green-500/20 border-green-500/50 text-green-400 hover:bg-green-500/30'
                  }`}
                  title={!hasRemoteStream ? 'Waiting for stream' : !hasAudioTracks ? 'No audio - artist needs to share with audio' : videoAudioMuted ? 'Click to enable audio' : 'Click to mute'}
                  disabled={!hasRemoteStream}
                >
                  <div className={`w-2 h-2 rounded-full ${
                    !hasRemoteStream ? 'bg-gray-400' : !hasAudioTracks ? 'bg-yellow-400' : videoAudioMuted ? 'bg-red-400' : 'bg-green-400 animate-pulse'
                  }`} />
                  {!hasRemoteStream ? 'No Stream' : !hasAudioTracks ? 'No Audio' : videoAudioMuted ? 'Audio Off' : 'Audio On'}
                </button>
                
                {/* Volume Slider */}
                {!videoAudioMuted && hasRemoteStream && (
                  <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white/5 border border-white/10">
                    <VolumeX size={14} className="text-muted-foreground" />
                    <Slider
                      value={[volume]}
                      onValueChange={handleVolumeChange}
                      max={100}
                      min={0}
                      step={5}
                      className="w-20"
                      data-testid="slider-volume"
                    />
                    <Volume2 size={14} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground w-8">{volume}%</span>
                  </div>
                )}

                {/* Mic toggle for speaking */}
                <button
                  onClick={handleToggleMic}
                  data-testid="button-engineer-toggle-mic"
                  className={`px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border ${
                    isMicActive 
                      ? 'bg-green-500/20 border-green-500/50 text-green-400 hover:bg-green-500/30' 
                      : 'bg-gray-500/20 border-gray-500/50 text-gray-400 hover:bg-gray-500/30'
                  }`}
                  title={isMicActive ? 'Click to mute your mic' : 'Click to speak'}
                >
                  <div className={`w-2 h-2 rounded-full ${isMicActive ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
                  {isMicActive ? 'Mic On' : 'Mic Off'}
                </button>

                {/* Test Audio button - plays a test tone to confirm audio is working on this computer */}
                <button
                  onClick={playTestAudio}
                  data-testid="button-engineer-test-audio"
                  disabled={isTestingAudio}
                  className="px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border bg-blue-500/20 border-blue-500/50 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50"
                  title="Play a test tone to confirm audio is working on this device"
                >
                  <Volume2 size={16} />
                  Test Audio
                </button>

                {/* Share Screen for teaching */}
                {!isSharing ? (
                  <button
                    onClick={() => handleStartSharing(false)}
                    data-testid="button-engineer-share-screen"
                    className="px-3 py-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 text-background font-medium text-sm flex items-center gap-2 hover:brightness-110 transition-all"
                  >
                    <Video size={16} /> Share
                  </button>
                ) : (
                  <button
                    onClick={handleStopSharing}
                    data-testid="button-engineer-stop-sharing"
                    className="px-3 py-2 rounded-lg bg-destructive text-white font-medium text-sm flex items-center gap-2 hover:bg-destructive/90 transition-all"
                  >
                    <VideoOff size={16} /> Stop
                  </button>
                )}
                
                {/* Agent status indicator */}
                <div className={`px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 border ${
                  agentConnected 
                    ? 'bg-green-500/20 border-green-500/50 text-green-400' 
                    : 'bg-gray-500/20 border-gray-500/50 text-gray-400'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${agentConnected ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
                  Agent {agentConnected ? 'Connected' : 'Offline'}
                </div>
                
                {/* Download Agent - When agent is not connected */}
                {!agentConnected && (
                  <a
                    href="/remote-control"
                    target="_blank"
                    data-testid="link-download-agent"
                    className="px-3 py-2 rounded-lg bg-cyan-600 text-white font-medium text-sm flex items-center gap-2 hover:brightness-110 transition-all"
                  >
                    <Monitor size={16} /> Get Agent
                  </a>
                )}
                
                {/* Full Control - When agent is connected */}
                {agentConnected && (
                  fullControlActive ? (
                    <button
                      onClick={endFullControl}
                      data-testid="button-end-full-control"
                      className="px-3 py-2 rounded-lg bg-pink-600 text-white font-medium text-sm flex items-center gap-2 hover:brightness-110 transition-all"
                    >
                      <Monitor size={16} /> End Control
                    </button>
                  ) : (
                    <button
                      onClick={() => requestFullControl('Engineer')}
                      disabled={controlPending}
                      data-testid="button-request-full-control"
                      className="px-3 py-2 rounded-lg bg-cyan-600 text-white font-medium text-sm flex items-center gap-2 hover:brightness-110 transition-all disabled:opacity-50"
                    >
                      <Monitor size={16} /> {controlPending ? 'Requesting...' : 'Control'}
                    </button>
                  )
                )}

                {/* Fullscreen button */}
                {hasRemoteStream && (
                  <button
                    onClick={toggleFullscreen}
                    data-testid="button-fullscreen"
                    className="px-3 py-2 rounded-lg bg-slate-600 text-white font-medium text-sm flex items-center gap-2 hover:brightness-110 transition-all"
                    title={isFullscreen ? 'Exit Fullscreen' : 'View Fullscreen'}
                  >
                    {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                  </button>
                )}

                {!recordedBlob ? (
                  !isRecording ? (
                    <button
                      onClick={startRecordingSession}
                      disabled={!hasRemoteStream}
                      data-testid="button-start-recording"
                      className="px-3 py-2 rounded-lg bg-red-600 text-white font-medium text-sm flex items-center gap-2 hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Disc className="animate-pulse" size={16} /> Record
                    </button>
                  ) : (
                    <button
                      onClick={stopRecordingSession}
                      data-testid="button-stop-recording"
                      className="px-3 py-2 rounded-lg bg-destructive text-white font-medium text-sm flex items-center gap-2 hover:bg-destructive/90 transition-all"
                    >
                      <Square fill="currentColor" size={16} /> Stop
                    </button>
                  )
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={handleDownload}
                      data-testid="button-download-recording"
                      className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-sm flex items-center gap-2 transition-colors"
                    >
                      <Download size={14} /> Download
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={uploadMutation.isPending}
                      data-testid="button-save-recording"
                      className="px-3 py-2 rounded-lg bg-secondary text-white font-medium text-sm flex items-center gap-2 hover:bg-secondary/90 transition-all disabled:opacity-50"
                    >
                      {uploadMutation.isPending ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Save size={14} />
                      )}
                      Save
                    </button>
                  </div>
                )}
                
                {isRecording && (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/50">
                    <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                    <span className="font-mono text-red-400">{formatTime(recordingDuration)}</span>
                  </div>
                )}
              </div>

              {/* View Mode Toggle */}
              <div className="w-full mt-4 flex justify-center">
                <button
                  onClick={() => setRemoteControlViewMode(!remoteControlViewMode)}
                  data-testid="button-toggle-view-mode"
                  className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all ${
                    remoteControlViewMode
                      ? 'bg-gradient-to-r from-cyan-600 to-primary text-white shadow-lg shadow-cyan-500/30'
                      : 'bg-white/5 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  <Monitor size={20} />
                  {remoteControlViewMode ? 'Exit Mouse Control' : 'Phone Mouse Control'}
                </button>
              </div>

              {/* Phone/Touch Control for engineers - only visible in remote control view mode */}
              {remoteControlViewMode && (
                <div className="w-full mt-4">
                  <PhoneControl
                    sessionCode={roomId}
                    isConnected={connected}
                    agentConnected={agentConnected}
                    controlEnabled={fullControlActive}
                    onSendControl={sendFullControlCommand}
                    onRequestControl={() => requestFullControl('Engineer')}
                    onEndControl={endFullControl}
                  />
                </div>
              )}
            </> 
            ) : role === 'producer' ? (
              // Producer - can share screen for beat-making or audio only
              <div className="flex items-center gap-2 flex-wrap">
                {!isSharing ? (
                  <>
                    <button
                      onClick={() => handleStartSharing(false)}
                      data-testid="button-producer-share-screen"
                      className="px-3 py-2 rounded-lg bg-purple-600 text-white font-medium text-sm flex items-center gap-2 hover:brightness-110 transition-all"
                    >
                      <Monitor size={16} /> Screen
                    </button>
                    <button
                      onClick={() => handleStartSharing(true)}
                      data-testid="button-producer-share-audio"
                      className="px-3 py-2 rounded-lg bg-purple-700 text-white font-medium text-sm flex items-center gap-2 hover:brightness-110 transition-all"
                    >
                      <Volume2 size={16} /> Audio
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleStopSharing}
                    data-testid="button-producer-stop-sharing"
                    className="px-3 py-2 rounded-lg bg-destructive text-white font-medium text-sm flex items-center gap-2 hover:bg-destructive/90 transition-all"
                  >
                    <VolumeX size={16} /> Stop
                  </button>
                )}
                {/* Audio indicator for producer - always visible */}
                <button
                  onClick={handleToggleAudio}
                  data-testid="button-producer-toggle-audio"
                  className={`px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border ${
                    !hasRemoteStream
                      ? 'bg-gray-500/20 border-gray-500/50 text-gray-400'
                      : !hasAudioTracks 
                        ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' 
                        : videoAudioMuted 
                          ? 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30' 
                          : 'bg-green-500/20 border-green-500/50 text-green-400 hover:bg-green-500/30'
                  }`}
                  title={!hasRemoteStream ? 'Waiting for stream' : !hasAudioTracks ? 'No audio available' : videoAudioMuted ? 'Click to enable audio' : 'Click to mute'}
                  disabled={!hasRemoteStream}
                >
                  <div className={`w-2 h-2 rounded-full ${
                    !hasRemoteStream ? 'bg-gray-400' : !hasAudioTracks ? 'bg-yellow-400' : videoAudioMuted ? 'bg-red-400' : 'bg-green-400 animate-pulse'
                  }`} />
                  {!hasRemoteStream ? 'No Stream' : !hasAudioTracks ? 'No Audio' : videoAudioMuted ? 'Audio Off' : 'Audio On'}
                </button>
                
                {/* Volume Slider for Producers */}
                {!videoAudioMuted && hasRemoteStream && (
                  <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white/5 border border-white/10">
                    <VolumeX size={14} className="text-muted-foreground" />
                    <Slider
                      value={[volume]}
                      onValueChange={handleVolumeChange}
                      max={100}
                      min={0}
                      step={5}
                      className="w-20"
                      data-testid="slider-volume-producer"
                    />
                    <Volume2 size={14} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground w-8">{volume}%</span>
                  </div>
                )}
                
                {/* Mic toggle for producers */}
                <button
                  onClick={handleToggleMic}
                  data-testid="button-producer-toggle-mic"
                  className={`px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border ${
                    isMicActive 
                      ? 'bg-green-500/20 border-green-500/50 text-green-400 hover:bg-green-500/30' 
                      : 'bg-gray-500/20 border-gray-500/50 text-gray-400 hover:bg-gray-500/30'
                  }`}
                  title={isMicActive ? 'Click to mute your mic' : 'Click to speak'}
                >
                  <div className={`w-2 h-2 rounded-full ${isMicActive ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
                  {isMicActive ? 'Mic On' : 'Mic Off'}
                </button>

                {/* Test Audio button for producers */}
                <button
                  onClick={playTestAudio}
                  data-testid="button-producer-test-audio"
                  disabled={isTestingAudio}
                  className="px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border bg-blue-500/20 border-blue-500/50 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50"
                  title="Play a test tone to confirm audio is working on this device"
                >
                  <Volume2 size={16} />
                  Test Audio
                </button>
                
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/20 border border-purple-500/50">
                  <Music size={14} className="text-purple-400" />
                  <span className="text-xs text-purple-300">Producer</span>
                </div>
              </div>
            ) : (
              // Other - view only with audio control
              <div className="flex gap-2 items-center flex-wrap">
                {/* Audio button for guests - always visible */}
                <button
                  onClick={handleToggleAudio}
                  data-testid="button-other-toggle-audio"
                  className={`px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border ${
                    !hasRemoteStream
                      ? 'bg-gray-500/20 border-gray-500/50 text-gray-400'
                      : !hasAudioTracks 
                        ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' 
                        : videoAudioMuted 
                          ? 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30' 
                          : 'bg-green-500/20 border-green-500/50 text-green-400 hover:bg-green-500/30'
                  }`}
                  title={!hasRemoteStream ? 'Waiting for stream' : !hasAudioTracks ? 'No audio available' : videoAudioMuted ? 'Click to enable audio' : 'Click to mute'}
                  disabled={!hasRemoteStream}
                >
                  <div className={`w-2 h-2 rounded-full ${
                    !hasRemoteStream ? 'bg-gray-400' : !hasAudioTracks ? 'bg-yellow-400' : videoAudioMuted ? 'bg-red-400' : 'bg-green-400 animate-pulse'
                  }`} />
                  {!hasRemoteStream ? 'No Stream' : !hasAudioTracks ? 'No Audio' : videoAudioMuted ? 'Audio Off' : 'Audio On'}
                </button>
                
                {/* Volume Slider for Guests */}
                {!videoAudioMuted && hasRemoteStream && (
                  <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white/5 border border-white/10">
                    <VolumeX size={14} className="text-muted-foreground" />
                    <Slider
                      value={[volume]}
                      onValueChange={handleVolumeChange}
                      max={100}
                      min={0}
                      step={5}
                      className="w-20"
                      data-testid="slider-volume-guest"
                    />
                    <Volume2 size={14} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground w-8">{volume}%</span>
                  </div>
                )}
                
                {/* Mic toggle for guests */}
                <button
                  onClick={handleToggleMic}
                  data-testid="button-guest-toggle-mic"
                  className={`px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border ${
                    isMicActive 
                      ? 'bg-green-500/20 border-green-500/50 text-green-400 hover:bg-green-500/30' 
                      : 'bg-gray-500/20 border-gray-500/50 text-gray-400 hover:bg-gray-500/30'
                  }`}
                  title={isMicActive ? 'Click to mute your mic' : 'Click to speak'}
                >
                  <div className={`w-2 h-2 rounded-full ${isMicActive ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
                  {isMicActive ? 'Mic On' : 'Mic Off'}
                </button>

                {/* Test Audio button for guests */}
                <button
                  onClick={playTestAudio}
                  data-testid="button-guest-test-audio"
                  disabled={isTestingAudio}
                  className="px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border bg-blue-500/20 border-blue-500/50 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50"
                  title="Play a test tone to confirm audio is working on this device"
                >
                  <Volume2 size={16} />
                  Test Audio
                </button>
                
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                  <Eye size={14} className="text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Guest</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Side Panel */}
        <div className="glass-panel rounded-2xl p-6 flex flex-col gap-6">
          <div>
            <h3 className="font-display font-bold text-lg mb-4 flex items-center gap-2">
              <Users size={20} /> Participants
            </h3>
            <div className="space-y-2">
              {/* Self */}
              <div className={`flex items-center gap-3 p-3 rounded-lg border ${getRoleBgColor(role)}`}>
                <div className={`w-3 h-3 rounded-full ${getRoleDotColor(role)} shadow-lg`} />
                <span className="font-tech text-sm flex items-center gap-2">
                  {getRoleIcon(role)} You ({role})
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {/* Show audio confirmation status for viewers */}
                  {isViewer && (
                    <span 
                      className={`text-xs flex items-center gap-1 ${audioConfirmed ? 'text-green-400' : 'text-muted-foreground'}`}
                      title={audioConfirmed ? 'Audio synced' : 'Enable audio to sync'}
                    >
                      <span className={`w-2 h-2 rounded-full ${audioConfirmed ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'}`} />
                      {audioConfirmed ? 'Synced' : 'No Audio'}
                    </span>
                  )}
                  {/* Show broadcasting status for broadcasters */}
                  {(role === 'artist' || role === 'producer') && isSharing && (
                    <span className="text-xs text-green-400 flex items-center gap-1">
                      <Radio size={12} /> {role === 'producer' ? 'Audio' : 'Live'}
                      {/* Audio sync indicator - green when at least one listener confirmed */}
                      {audioConfirmations.size > 0 && (
                        <span className="ml-1 flex items-center gap-1 text-green-400" title={`${audioConfirmations.size} listener(s) confirmed audio`}>
                          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                          <span className="text-xs">{audioConfirmations.size}</span>
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </div>
              
              {/* Others */}
              {participants.map(p => {
                const isBroadcasting = remoteStreams.has(p.userId);
                const streamInfo = remoteStreams.get(p.userId);
                return (
                  <div 
                    key={p.userId}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${getRoleBgColor(p.role as SessionRole)}`}
                  >
                    <div className={`w-3 h-3 rounded-full ${getRoleDotColor(p.role as SessionRole)}`} />
                    <span className="font-tech text-sm flex items-center gap-2">
                      {getRoleIcon(p.role as SessionRole)} {p.role}
                    </span>
                    {isBroadcasting && (
                      <span className="ml-auto text-xs text-green-400 flex items-center gap-1">
                        <Radio size={12} /> {streamInfo?.hasVideo ? 'Live' : 'Audio'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Audio Visualizer (for viewers) */}
          {isViewer && (
            <div className="flex-1">
              <h3 className="font-display font-bold text-lg mb-4 flex items-center gap-2">
                <Mic size={20} /> Audio Level
              </h3>
              <div className="h-32 rounded-xl overflow-hidden">
                <Visualizer 
                  analyser={analyserRef.current} 
                  status={participants.filter(p => p.role === 'artist').length > 0 ? 'recording' : 'idle'} 
                />
              </div>
            </div>
          )}

          {/* Audio Device Selector */}
          <div className="mt-4">
            <h3 className="font-display font-bold text-lg mb-4 flex items-center gap-2">
              <Volume2 size={20} /> Audio Devices
            </h3>
            <AudioDeviceSelector />
          </div>

          {/* Instructions */}
          <div className="mt-auto p-4 rounded-xl bg-white/5 text-sm text-muted-foreground space-y-2">
            {role === 'artist' && (
              <>
                <p><strong>Artist Instructions:</strong></p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Click "Start Sharing"</li>
                  <li>Select your DAW window or entire screen</li>
                  <li>Check "Share System Audio"</li>
                  <li>Your engineer will see and hear everything</li>
                </ol>
              </>
            )}
            {role === 'engineer' && (
              <>
                <p><strong>Engineer Instructions:</strong></p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Share the room code with your artist</li>
                  <li>Wait for them to connect and share</li>
                  <li>Click "Start Recording" when ready</li>
                  <li>Download or save to cloud when done</li>
                </ol>
                <div className="mt-3 pt-3 border-t border-white/10">
                  <p className="text-xs text-muted-foreground">
                    <strong>Need full remote control?</strong> Ask the artist to download{' '}
                    <a href="/remote-control" className="text-primary hover:underline">
                      Virtual Studio Agent
                    </a>{' '}
                    and connect to this session.
                  </p>
                </div>
              </>
            )}
            {role === 'producer' && (
              <>
                <p><strong>Producer Controls:</strong></p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Click "Share Audio" to broadcast your beats</li>
                  <li>Check "Share System Audio" when prompted</li>
                  <li>Everyone in the session will hear your audio</li>
                  <li>Click "Stop Sharing" when done</li>
                </ol>
                <div className="mt-3 pt-3 border-t border-white/10">
                  <p className="text-xs text-muted-foreground">
                    <strong>Tip:</strong> Your audio plays alongside the artist's stream so everyone can hear both.
                  </p>
                </div>
              </>
            )}
            {role === 'other' && (
              <>
                <p><strong>Guest View:</strong></p>
                <p className="text-xs">You can watch and listen to the session as a collaborator.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Session() {
  return (
    <SubscriptionGate>
      <SessionContent />
    </SubscriptionGate>
  );
}
