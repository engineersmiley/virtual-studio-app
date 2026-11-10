import { useState, useEffect, useRef, useCallback } from 'react';
import { useRoute, Link } from 'wouter';
import { useWebRTC, type RemoteControlEvent, type RemoteStreamInfo } from '@/hooks/use-webrtc';
import { useUploadRecording } from '@/hooks/use-recordings';
import { Visualizer } from '@/components/Visualizer';
import { AudioDeviceSelector } from '@/components/AudioDeviceSelector';
import { SubscriptionGate } from '@/components/SubscriptionGate';
import { PhoneControl } from '@/components/PhoneControl';
import { VirtualKeyboard } from '@/components/VirtualKeyboard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { isSyntheticClickAfterTouch, mapVideoPointToScreen } from '@/lib/remote-control-video.js';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Monitor, Mic, Square, Disc, Save, Download, Copy, 
  Users, Radio, ArrowLeft, CheckCircle, AlertTriangle, X,
  Video, VideoOff, Eye, PenTool, Zap, MousePointer2, Move, Maximize, Minimize,
  Volume2, VolumeX, Music, RefreshCw, Keyboard
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
  const [showKeyboardInput, setShowKeyboardInput] = useState(false);
  const [showFullscreenKeyboard, setShowFullscreenKeyboard] = useState(false);
  const keyboardInputRef = useRef<HTMLInputElement>(null);
  
  // Simple remote control toggle (for artists)
  const [remoteControlAllowed, setRemoteControlAllowed] = useState(false);
  const [togglingRemoteControl, setTogglingRemoteControl] = useState(false);
  
  // Mac detection for audio setup warning
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const [macWarningDismissed, setMacWarningDismissed] = useState(false);
  
  // View mode toggle for engineers (regular view vs remote control view)
  const [remoteControlViewMode, setRemoteControlViewMode] = useState(false);
  
  // Main video audio state - track if audio is muted due to autoplay policy
  const [videoAudioMuted, setVideoAudioMuted] = useState(true);
  const [hasAudioTracks, setHasAudioTracks] = useState(false);
  const [audioConfirmed, setAudioConfirmed] = useState(false);
  const [volume, setVolume] = useState(100); // 0-100
  const [isTestingAudio, setIsTestingAudio] = useState(false);
  
  // Agent screen dimensions for accurate mouse positioning
  const [agentScreenSize, setAgentScreenSize] = useState({ width: 1920, height: 1080 });
  
  // Pointer lock for fullscreen cursor confinement
  const virtualCursorRef = useRef({ x: 960, y: 540 }); // Virtual cursor position when pointer is locked
  
  // Producer audio state - track status per user: pending (not tried), playing, blocked
  const [audioStatus, setAudioStatus] = useState<Map<string, 'pending' | 'playing' | 'blocked'>>(new Map());
  const producerAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  
  // Touch guard to prevent double triggers (touch + synthetic click)
  const lastTouchTimeRef = useRef<number>(0);
  const lastRemoteVideoTouchTimeRef = useRef<number>(0);
  const TOUCH_DELAY_MS = 500; // Ignore clicks within 500ms of touch
  const TOUCH_TAP_SLOP_PX = 24;
  const TOUCH_TAP_MAX_DURATION_MS = 600;
  
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
  const fullscreenVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number; identifier: number; moved: boolean } | null>(null);
  const fullscreenTouchRef = useRef<{ x: number; y: number; time: number; moved: boolean } | null>(null);
  
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


  // Fullscreen toggle - iOS requires video element, others use container
  const toggleFullscreen = useCallback(() => {
    const container = videoContainerRef.current;
    const video = remoteVideoRef.current;
    if (!container) return;
    
    // Check if already in fullscreen - use React state for CSS-based fullscreen on mobile
    const isNativeFullscreen = !!(
      document.fullscreenElement || 
      (document as any).webkitFullscreenElement ||
      (video as any)?.webkitDisplayingFullscreen
    );
    const isMobile = /iPad|iPhone|iPod|Android/i.test(navigator.userAgent);
    
    // Use React state for mobile CSS fullscreen, native APIs for desktop
    const isCurrentlyFullscreen = isMobile ? isFullscreen : isNativeFullscreen;
    
    if (!isCurrentlyFullscreen) {
      if (isMobile) {
        // Mobile: Just set state - the overlay component handles the fullscreen UI
        document.body.style.overflow = 'hidden';
        setIsFullscreen(true);
        return;
      }
      
      // Desktop: Use standard fullscreen API
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
        // Request pointer lock for engineers with control enabled to confine cursor
        if (role === 'engineer' && controlEnabled && fullscreenVideoRef.current) {
          setTimeout(() => {
            fullscreenVideoRef.current?.requestPointerLock();
          }, 100); // Small delay to ensure fullscreen is ready
        }
      }).catch((err: any) => {
        console.log('Fullscreen API not available:', err.message);
        // Fallback: maximize in viewport with CSS (works on all devices)
        container.style.cssText = `
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          z-index: 99999 !important;
          background-color: black !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        `;
        if (video) {
          video.style.cssText = `
            width: 100% !important;
            height: 100% !important;
            object-fit: contain !important;
          `;
        }
        setIsFullscreen(true);
      });
    } else {
      // Exit fullscreen - restore body styles
      document.body.style.overflow = '';
      
      // Exit pointer lock first
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
      
      if (isMobile) {
        // Mobile: Just reset state - overlay will unmount
        setIsFullscreen(false);
      } else if (document.exitFullscreen) {
        document.exitFullscreen().then(() => setIsFullscreen(false));
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
        setIsFullscreen(false);
      } else if (video && (video as any).webkitExitFullscreen) {
        (video as any).webkitExitFullscreen();
        setIsFullscreen(false);
      } else {
        // Undo CSS fallback
        container.style.cssText = '';
        if (video) {
          video.style.cssText = '';
        }
        setIsFullscreen(false);
      }
    }
  }, [isFullscreen]);

  // Listen for fullscreen changes (including webkit)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const inFullscreen = !!document.fullscreenElement || !!(document as any).webkitFullscreenElement;
      setIsFullscreen(inFullscreen);
      // Exit pointer lock when exiting fullscreen
      if (!inFullscreen && document.pointerLockElement) {
        document.exitPointerLock();
      }
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
    displayControlSupported,
    agentVersion,
    displayControlReason,
    displayControlCalibrationRequired,
    captureSupported,
    controlAllowed: wsControlAllowed,
    controlPending: wsControlPending,
    controlMode: wsControlMode,
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
    queueFullControlClick,
    cancelPendingControlClicks,
    confirmAudio,
    unconfirmAudio,
  } = useWebRTC({
    roomId,
    userId,
    role,
    onRemoteControl: handleRemoteControl,
    onAgentStatus: (status) => {
      setAgentConnected(status.connected);
      if (status.controlAllowed !== undefined) {
        setFullControlActive(status.controlAllowed);
      }
      if (status.controlPending !== undefined) {
        setControlPending(status.controlPending);
      }
      // Update screen size if provided by agent
      if (status.screenWidth && status.screenHeight) {
        setAgentScreenSize({ width: status.screenWidth, height: status.screenHeight });
        console.log(`[Session] Agent screen size: ${status.screenWidth}x${status.screenHeight}`);
      }
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

  // Sync fullscreen video srcObject when entering fullscreen or stream changes
  useEffect(() => {
    if (isFullscreen && remoteVideoRef.current?.srcObject) {
      // Use requestAnimationFrame to ensure the fullscreen video element is mounted
      const syncVideo = () => {
        if (fullscreenVideoRef.current && remoteVideoRef.current?.srcObject) {
          fullscreenVideoRef.current.srcObject = remoteVideoRef.current.srcObject;
          fullscreenVideoRef.current.play().catch(() => {});
        }
      };
      // Try immediately and after a short delay to handle React render timing
      syncVideo();
      const timer = setTimeout(syncVideo, 50);
      return () => clearTimeout(timer);
    }
  }, [isFullscreen, hasRemoteStream]);

  // Direct screen touch control - touch on video to control computer
  const controlEnabled = fullControlActive || wsControlAllowed;

  useEffect(() => {
    if (wsControlMode === 'alignment') {
      setShowKeyboardInput(false);
      cancelPendingControlClicks();
    }
  }, [wsControlMode, cancelPendingControlClicks]);

  // Cancel the previous view's pending input on view changes and session teardown.
  useEffect(() => {
    return cancelPendingControlClicks;
  }, [isFullscreen, hasRemoteStream, cancelPendingControlClicks]);
  
  const handleVideoTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = null;
    if (!controlEnabled) return;
    const touch = e.touches[0];
    if (e.touches.length !== 1 || !touch) return;
    touchStartRef.current = {
      x: touch.clientX, y: touch.clientY, time: Date.now(),
      identifier: touch.identifier, moved: false,
    };
  }, [controlEnabled]);
  
  const handleVideoTouchMove = useCallback((e: React.TouchEvent) => {
    const gesture = touchStartRef.current;
    const touch = e.touches[0];
    if (!controlEnabled || e.touches.length !== 1 || !touch ||
        touch.identifier !== gesture?.identifier) {
      touchStartRef.current = null;
      return;
    }
    if (!gesture) return;
    e.preventDefault();

    // Track the entire gesture, including moves skipped by the command throttle.
    if (Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) >= TOUCH_TAP_SLOP_PX) {
      gesture.moved = true;
    }
    
    const video = remoteVideoRef.current;
    if (!video) return;
    
    const rect = video.getBoundingClientRect();
    
    const { x, y } = mapVideoPointToScreen(
      touch.clientX,
      touch.clientY,
      rect,
      video.videoWidth,
      video.videoHeight,
      agentScreenSize,
    );
    
    virtualCursorRef.current = { x, y };
    sendFullControlCommand({ type: 'mouse-move', x, y });
  }, [controlEnabled, sendFullControlCommand, agentScreenSize]);
  
  const handleVideoTouchEnd = useCallback((e: React.TouchEvent) => {
    const gesture = touchStartRef.current;
    touchStartRef.current = null;
    // Suppress synthetic clicks for taps, drags, and rejected multi-touch gestures.
    lastRemoteVideoTouchTimeRef.current = Date.now();
    if (!controlEnabled) return;
    e.preventDefault();
    const touch = e.changedTouches[0];
    if (!gesture || gesture.moved || e.touches.length !== 0 ||
        e.changedTouches.length !== 1 || !touch || touch.identifier !== gesture.identifier) return;
    
    const video = remoteVideoRef.current;
    if (!video) return;
    
    const rect = video.getBoundingClientRect();
    const touchDuration = Date.now() - gesture.time;
    const moveDistance = Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y);
    
    // If it was a tap (not much movement), click at that position
    if (moveDistance < TOUCH_TAP_SLOP_PX && touchDuration < TOUCH_TAP_MAX_DURATION_MS) {
      const { x, y } = mapVideoPointToScreen(
        touch.clientX,
        touch.clientY,
        rect,
        video.videoWidth,
        video.videoHeight,
        agentScreenSize,
      );
      
      // Move to position then click
      virtualCursorRef.current = { x, y };
      sendFullControlCommand({ type: 'mouse-move', x, y });
      queueFullControlClick(video);
    }
  }, [controlEnabled, sendFullControlCommand, queueFullControlClick, agentScreenSize]);

  const handleVideoTouchCancel = useCallback(() => {
    touchStartRef.current = null;
    lastRemoteVideoTouchTimeRef.current = Date.now();
  }, []);

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
        
        // Log video track status
        const videoTracks = primaryVideoStream.stream.getVideoTracks();
        console.log('[Video] Attaching stream with', videoTracks.length, 'video tracks:', videoTracks.map(t => ({ label: t.label, readyState: t.readyState })));
        
        // Monitor for track ending
        videoTracks.forEach(track => {
          track.onended = () => {
            console.log('[Video] Video track ended:', track.label, '- this should NOT cause video to disappear');
          };
          track.onmute = () => {
            console.log('[Video] Video track muted:', track.label);
          };
          track.onunmute = () => {
            console.log('[Video] Video track unmuted:', track.label);
          };
        });
        
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
  
  // Periodically check video track health and log status
  useEffect(() => {
    if (!primaryVideoStream) return;
    
    const checkInterval = setInterval(() => {
      const videoTracks = primaryVideoStream.stream.getVideoTracks();
      const liveVideoTracks = videoTracks.filter(t => t.readyState === 'live');
      const endedVideoTracks = videoTracks.filter(t => t.readyState === 'ended');
      
      if (endedVideoTracks.length > 0 && liveVideoTracks.length === 0) {
        console.log('[Video Health] All video tracks ended - connection may need recovery');
      }
      
      // Check if video element is actually playing
      if (remoteVideoRef.current) {
        const video = remoteVideoRef.current;
        const isPlaying = !video.paused && !video.ended && video.readyState > 2;
        if (!isPlaying && videoTracks.length > 0) {
          console.log('[Video Health] Video not playing, trying to restart...');
          video.play().catch(() => {});
        }
      }
    }, 5000);
    
    return () => clearInterval(checkInterval);
  }, [primaryVideoStream]);
  
  // Keyboard capture when control mode is active - send keystrokes to agent
  useEffect(() => {
    if (!fullControlActive || wsControlMode === 'alignment') return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture keys if user is typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      // Prevent default for most keys to avoid browser shortcuts
      if (e.key !== 'F5' && e.key !== 'F12') {
        e.preventDefault();
      }
      
      // Map modifier state
      const modifiers = {
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        cmd: e.metaKey
      };
      
      // Handle printable characters as key-type
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        console.log('[Keyboard] Sending key-type:', e.key);
        sendFullControlCommand({ type: 'key-type', text: e.key });
      } else {
        // Handle special keys and modified keys as key-press
        console.log('[Keyboard] Sending key-press:', e.key, modifiers);
        sendFullControlCommand({ type: 'key-press', key: e.key, modifiers });
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fullControlActive, wsControlMode, sendFullControlCommand]);

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
      const result = await startSharing(audioOnly);
      setIsSharing(true);
      
      // Show feedback about what audio sources were captured
      if (result) {
        const sources = [];
        if (result.hasMicAudio) sources.push("Mic");
        if (result.hasSystemAudio) sources.push("System Audio");
        
        if (sources.length > 0) {
          toast({ 
            title: "Sharing Started", 
            description: sources.join(" + ") 
          });
        } else {
          // Still works - just no audio detected
          toast({ 
            title: "Sharing Started (Video Only)", 
            description: "No audio captured - check mic permissions"
          });
        }
      }
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

  // Touch-safe click handler - ignores clicks that follow touch events
  const handleClickWithTouchGuard = useCallback((handler: () => void) => {
    return () => {
      if (Date.now() - lastTouchTimeRef.current < TOUCH_DELAY_MS) {
        return; // Ignore - this click was triggered by touch
      }
      handler();
    };
  }, []);
  
  // Touch handler - sets guard and executes synchronously for iOS audio gesture
  // NOTE: Do NOT call e.preventDefault() as it breaks iOS Safari's user gesture for audio
  const handleTouchWithGuard = useCallback((handler: () => void) => {
    return (e: React.TouchEvent) => {
      lastTouchTimeRef.current = Date.now();
      // Execute handler synchronously within user gesture context
      handler();
    };
  }, []);
  
  // Synchronous audio enable - for iOS user gesture requirement
  // iOS Safari requires play() to be called synchronously in the user gesture handler
  const enableAudioSync = useCallback(() => {
    if (!videoAudioMuted) return;
    
    const video = remoteVideoRef.current;
    if (!video) return;
    
    // Set volume and unmute synchronously
    video.volume = volume / 100;
    video.muted = false;
    
    // Call play() - the promise will resolve/reject but the call itself is synchronous
    const playPromise = video.play();
    
    // Handle the promise result
    if (playPromise) {
      playPromise
        .then(() => {
          setVideoAudioMuted(false);
          toast({ title: "Audio On", description: "Session audio enabled" });
          // Confirm audio to all broadcasters
          remoteStreams.forEach(stream => {
            if (stream.fromUserId) confirmAudio(stream.fromUserId);
          });
          setAudioConfirmed(true);
        })
        .catch((err) => {
          console.error('Audio play failed:', err);
          // Re-mute on failure
          video.muted = true;
          toast({ title: "Audio Failed", description: "Could not enable audio. Try tapping again.", variant: "destructive" });
        });
    }
    
    // Also enable blocked audio-only streams
    const blockedUsers = Array.from(audioStatus.entries())
      .filter(([, status]) => status === 'blocked')
      .map(([userId]) => userId);
    
    blockedUsers.forEach(blockedUserId => {
      const audio = producerAudioRefs.current.get(blockedUserId);
      if (audio) {
        audio.play().then(() => markAudioPlaying(blockedUserId)).catch(() => {});
      }
    });
  }, [videoAudioMuted, volume, remoteStreams, audioStatus, confirmAudio, toast, markAudioPlaying]);
  
  // Touch-specific audio handler - uses sync for enable, async for mute
  const handleAudioTouch = useCallback((e: React.TouchEvent) => {
    lastTouchTimeRef.current = Date.now();
    if (videoAudioMuted) {
      enableAudioSync(); // Synchronous for iOS user gesture
    } else {
      handleToggleMuteAudio(); // Just muting, no gesture needed
    }
  }, [videoAudioMuted, enableAudioSync]);
  
  // Simple mute handler (no user gesture needed)
  const handleToggleMuteAudio = useCallback(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = true;
      setVideoAudioMuted(true);
    }
    Array.from(producerAudioRefs.current.values()).forEach(audio => {
      audio.pause();
    });
    // Unconfirm audio to all broadcasters
    remoteStreams.forEach(stream => {
      if (stream.fromUserId) unconfirmAudio(stream.fromUserId);
    });
    setAudioConfirmed(false);
    toast({ title: "Audio Off", description: "Session audio muted" });
  }, [remoteStreams, unconfirmAudio, toast]);
  
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
          
          // Simple unmute and play - don't pause first as it breaks iOS user gesture
          video.muted = false;
          
          // Only call play if not already playing (iOS requires user gesture)
          if (video.paused) {
            await video.play();
          }
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
        remoteStreams.forEach(stream => {
          if (stream.fromUserId) confirmAudio(stream.fromUserId);
        });
        setAudioConfirmed(true);
      }
    } else {
      // Mute audio
      if (remoteVideoRef.current) {
        remoteVideoRef.current.muted = true;
        setVideoAudioMuted(true);
      }
      Array.from(producerAudioRefs.current.values()).forEach(audio => {
        audio.pause();
      });
      // Unconfirm audio to all broadcasters
      remoteStreams.forEach(stream => {
        if (stream.fromUserId) unconfirmAudio(stream.fromUserId);
      });
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
    Array.from(producerAudioRefs.current.values()).forEach(audio => {
      audio.volume = normalizedVolume;
    });
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
  const djCount = participants.filter(p => p.role === 'dj').length + (role === 'dj' ? 1 : 0);
  const writerCount = participants.filter(p => p.role === 'writer').length + (role === 'writer' ? 1 : 0);
  const isDJ = role === 'dj';
  const isWriter = role === 'writer';
  const isProducerDJOrWriter = role === 'producer' || isDJ || isWriter;

  // Helper to get role color
  const getRoleColor = (r: SessionRole) => {
    switch (r) {
      case 'artist': return 'text-secondary';
      case 'engineer': return 'text-primary';
      case 'producer': return 'text-purple-400';
      case 'other': return 'text-amber-400';
      case 'dj': return 'text-pink-400';
      case 'writer': return 'text-emerald-400';
    }
  };

  const getRoleBgColor = (r: SessionRole) => {
    switch (r) {
      case 'artist': return 'bg-secondary/20 border-secondary/30';
      case 'engineer': return 'bg-primary/20 border-primary/30';
      case 'producer': return 'bg-purple-500/20 border-purple-500/30';
      case 'other': return 'bg-amber-500/20 border-amber-500/30';
      case 'dj': return 'bg-pink-500/20 border-pink-500/30';
      case 'writer': return 'bg-emerald-500/20 border-emerald-500/30';
    }
  };

  const getRoleDotColor = (r: SessionRole) => {
    switch (r) {
      case 'artist': return 'bg-secondary';
      case 'engineer': return 'bg-primary';
      case 'producer': return 'bg-purple-500';
      case 'other': return 'bg-amber-500';
      case 'dj': return 'bg-pink-500';
      case 'writer': return 'bg-emerald-500';
    }
  };

  const getRoleIcon = (r: SessionRole) => {
    switch (r) {
      case 'artist': return <Mic size={14} />;
      case 'engineer': return <Zap size={14} />;
      case 'producer': return <Eye size={14} />;
      case 'other': return <Users size={14} />;
      case 'dj': return <Disc size={14} />;
      case 'writer': return <PenTool size={14} />;
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
            {djCount > 0 && (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="text-pink-400">{djCount}DJ</span>
              </>
            )}
            {writerCount > 0 && (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="text-emerald-400">{writerCount}W</span>
              </>
            )}
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

      {/* Mac Audio Setup Warning Banner - for sharing roles on Mac */}
      {isMac && (role === 'artist' || isProducerDJOrWriter) && !macWarningDismissed && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xl">🍎</span>
            <div className="text-sm">
              <strong>Mac Audio Setup Required:</strong>{' '}
              Chrome on Mac needs{' '}
              <a 
                href="https://existential.audio/blackhole/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline font-medium"
              >
                BlackHole (free)
              </a>{' '}
              to share DAW audio. See instructions in the right panel.
            </div>
          </div>
          <button 
            onClick={() => setMacWarningDismissed(true)}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            data-testid="button-dismiss-mac-warning"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} />
            {error}
          </div>
          <div className="flex items-center gap-2">
            {(role === 'artist' || role === 'engineer' || isProducerDJOrWriter) && !isSharing && (
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

      {/* Fullscreen Overlay - works for both mobile and desktop */}
      {isFullscreen && (
        <div 
          className={`fixed inset-0 z-[99999] bg-black flex items-center justify-center touch-none ${
            role === 'engineer' && controlEnabled ? '[&_*]:cursor-none cursor-none' : ''
          }`}
          style={{ touchAction: 'none' }}
        >
          {/* Top controls bar */}
          <div className="absolute top-4 left-4 right-4 z-[100000] flex items-center justify-between">
            {/* Left side controls for engineer */}
            {role === 'engineer' && controlEnabled && (
              <div className="flex items-center gap-2">
                {/* Keyboard button - toggles virtual keyboard */}
                <button
                  onClick={() => setShowFullscreenKeyboard(!showFullscreenKeyboard)}
                  className={`p-3 rounded-full text-white transition-colors ${
                    showFullscreenKeyboard ? 'bg-cyan-500/50' : 'bg-white/20 hover:bg-white/30'
                  }`}
                  data-testid="button-keyboard-fullscreen"
                >
                  <Keyboard size={24} />
                </button>
                {/* Left-click button */}
                <button
                  onClick={() => {
                    sendFullControlCommand({ type: 'mouse-click', button: 'left' });
                  }}
                  className="px-3 py-2 rounded-full bg-cyan-500/40 text-white hover:bg-cyan-500/60 transition-colors text-sm font-medium"
                  data-testid="button-leftclick-fullscreen"
                >
                  L-Click
                </button>
                {/* Right-click button */}
                <button
                  onClick={() => {
                    sendFullControlCommand({ type: 'mouse-click', button: 'right' });
                  }}
                  className="px-3 py-2 rounded-full bg-purple-500/40 text-white hover:bg-purple-500/60 transition-colors text-sm font-medium"
                  data-testid="button-rightclick-fullscreen"
                >
                  R-Click
                </button>
              </div>
            )}
            <div className="flex-1" />
            {/* Exit button */}
            <button
              onClick={handleClickWithTouchGuard(toggleFullscreen)}
              onTouchEnd={handleTouchWithGuard(toggleFullscreen)}
              className="p-3 rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors"
              data-testid="button-exit-fullscreen-overlay"
            >
              <Minimize size={24} />
            </button>
          </div>
          
          {/* Virtual Keyboard in fullscreen */}
          {role === 'engineer' && controlEnabled && showFullscreenKeyboard && (
            <div className="absolute top-20 left-4 right-4 z-[100000] max-w-4xl mx-auto">
              <VirtualKeyboard
                onKeyPress={(key, modifiers) => {
                  sendFullControlCommand({ type: 'key-press', key, modifiers: modifiers || {} });
                }}
                onType={(text) => {
                  sendFullControlCommand({ type: 'key-type', text });
                }}
                onClose={() => setShowFullscreenKeyboard(false)}
              />
            </div>
          )}
          
          {/* Fullscreen video with click handling for remote control */}
          <video
            ref={fullscreenVideoRef}
            autoPlay
            playsInline
            muted={videoAudioMuted}
            className="w-full h-full object-contain touch-none"
            onClick={(e) => {
              if (role === 'engineer' && controlEnabled) {
                if (isSyntheticClickAfterTouch(
                  lastRemoteVideoTouchTimeRef.current,
                  Date.now(),
                  TOUCH_DELAY_MS,
                )) {
                  return;
                }

                const video = e.currentTarget;
                // Locked client coordinates can stay fixed while the remote cursor moves.
                const locked = document.pointerLockElement === video;
                const { x, y } = locked
                  ? virtualCursorRef.current
                  : mapVideoPointToScreen(
                    e.clientX,
                    e.clientY,
                    video.getBoundingClientRect(),
                    video.videoWidth,
                    video.videoHeight,
                    agentScreenSize,
                  );
                virtualCursorRef.current = { x, y };

                // Seed the cursor before acquisition; lock changes must not reset it.
                if (!document.pointerLockElement && typeof video.requestPointerLock === 'function') {
                  try {
                    // Capture is optional; keep absolute input working if acquisition fails.
                    video.requestPointerLock()?.catch(() => {});
                  } catch {
                    // Some browsers throw synchronously instead of returning a rejected promise.
                  }
                }

                sendFullControlCommand({ type: 'mouse-move', x, y });
                queueFullControlClick(video);
              }
            }}
            onMouseMove={(e) => {
              // Send mouse position on desktop
              if (role === 'engineer' && controlEnabled) {
                let x: number, y: number;
                
                if (document.pointerLockElement === e.currentTarget) {
                  // Use relative movement when pointer is locked
                  const sensitivity = 1.5; // Adjust cursor speed
                  // Allow cursor to go slightly beyond bounds to reach dock/edges
                  const overreach = 100; // Extra pixels to ensure dock/edge access
                  virtualCursorRef.current.x = Math.max(-overreach, Math.min(agentScreenSize.width + overreach, 
                    virtualCursorRef.current.x + e.movementX * sensitivity));
                  virtualCursorRef.current.y = Math.max(-overreach, Math.min(agentScreenSize.height + overreach, 
                    virtualCursorRef.current.y + e.movementY * sensitivity));
                  // The agent will clamp to actual screen bounds
                  x = virtualCursorRef.current.x;
                  y = virtualCursorRef.current.y;
                } else {
                  // Use absolute position when not locked
                  const video = e.currentTarget;
                  const rect = video.getBoundingClientRect();
                  ({ x, y } = mapVideoPointToScreen(
                    e.clientX,
                    e.clientY,
                    rect,
                    video.videoWidth,
                    video.videoHeight,
                    agentScreenSize,
                  ));
                }
                
                virtualCursorRef.current = { x, y };
                sendFullControlCommand({ type: 'mouse-move', x, y });
              }
            }}
            onTouchStart={(e) => {
              // Prevent scrolling when engineer is controlling
              fullscreenTouchRef.current = null;
              if (role === 'engineer' && controlEnabled) {
                e.preventDefault();
                const touch = e.touches[0];
                if (e.touches.length !== 1 || !touch) return;
                fullscreenTouchRef.current = {
                  x: touch.clientX, y: touch.clientY, time: Date.now(), moved: false,
                };
              }
            }}
            onTouchMove={(e) => {
              // Prevent scrolling and send mouse move commands
              if (role === 'engineer' && controlEnabled) {
                e.preventDefault();
                const touch = e.touches[0];
                if (!touch) return;
                const gesture = fullscreenTouchRef.current;
                if (gesture && (e.touches.length !== 1 ||
                    Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) >= TOUCH_TAP_SLOP_PX)) {
                  gesture.moved = true;
                }
                const video = e.currentTarget;
                const rect = video.getBoundingClientRect();
                const { x, y } = mapVideoPointToScreen(
                  touch.clientX,
                  touch.clientY,
                  rect,
                  video.videoWidth,
                  video.videoHeight,
                  agentScreenSize,
                );
                virtualCursorRef.current = { x, y };
                sendFullControlCommand({ type: 'mouse-move', x, y });
              }
            }}
            onTouchEnd={(e) => {
              const gesture = fullscreenTouchRef.current;
              fullscreenTouchRef.current = null;
              if (role === 'engineer' && controlEnabled) {
                e.preventDefault();
                // Suppress the browser's synthetic click after taps AND drags.
                lastRemoteVideoTouchTimeRef.current = Date.now();
                const touch = e.changedTouches[0];
                if (!touch || !gesture || gesture.moved || e.touches.length !== 0 ||
                    Date.now() - gesture.time >= TOUCH_TAP_MAX_DURATION_MS ||
                    Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) >= TOUCH_TAP_SLOP_PX) return;
                const video = e.currentTarget;
                const rect = video.getBoundingClientRect();
                const { x, y } = mapVideoPointToScreen(
                  touch.clientX,
                  touch.clientY,
                  rect,
                  video.videoWidth,
                  video.videoHeight,
                  agentScreenSize,
                );
                virtualCursorRef.current = { x, y };
                sendFullControlCommand({ type: 'mouse-move', x, y });
                queueFullControlClick(video);
              }
            }}
            onTouchCancel={() => {
              fullscreenTouchRef.current = null;
              lastRemoteVideoTouchTimeRef.current = Date.now();
            }}
            style={{ cursor: 'none' }}
          />
          
          {/* Audio enable prompt in fullscreen */}
          {videoAudioMuted && hasRemoteStream && (
            <button 
              onClick={handleClickWithTouchGuard(handleToggleAudio)}
              onTouchEnd={handleAudioTouch}
              className="absolute bottom-20 left-1/2 transform -translate-x-1/2 flex items-center gap-3 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-purple-600 text-white font-bold shadow-lg hover:scale-105 transition-all animate-pulse"
              data-testid="button-enable-audio-fullscreen"
            >
              <Volume2 size={24} />
              <span className="text-lg">Tap to Enable Audio</span>
            </button>
          )}
          
          {/* Prominent Exit Fullscreen button at bottom for mobile - only show when audio prompt is not visible */}
          {!(videoAudioMuted && hasRemoteStream) && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 md:hidden">
              <Button
                variant="outline"
                onClick={handleClickWithTouchGuard(toggleFullscreen)}
                onTouchEnd={handleTouchWithGuard(toggleFullscreen)}
                className="gap-2"
                data-testid="button-exit-fullscreen-bottom"
              >
                <Minimize size={18} />
                Exit Fullscreen
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        {/* Video/Stream Area */}
        <div className="lg:col-span-2 glass-panel rounded-2xl p-3 lg:p-6 flex flex-col gap-4">
          <div 
            ref={videoContainerRef}
            className={`rounded-xl overflow-hidden bg-black/50 relative min-h-[200px] lg:min-h-[400px] ${
              role === 'engineer' && controlEnabled ? '[&_*]:cursor-none cursor-none' : ''
            }`}
            onClick={(e) => {
              // A touch ending outside the video can target this shared ancestor.
              if (isSyntheticClickAfterTouch(
                lastRemoteVideoTouchTimeRef.current,
                Date.now(),
                TOUCH_DELAY_MS,
              )) {
                return;
              }
              if (role === 'engineer' && hasRemoteStream && remoteVideoRef.current) {
                const video = remoteVideoRef.current;
                const { x, y } = mapVideoPointToScreen(
                  e.clientX,
                  e.clientY,
                  video.getBoundingClientRect(),
                  video.videoWidth,
                  video.videoHeight,
                  agentScreenSize,
                );
                
                // Full control mode - send mouse commands to agent
                if (controlEnabled) {
                  virtualCursorRef.current = { x, y };
                  sendFullControlCommand({ type: 'mouse-move', x, y });
                  queueFullControlClick(video);
                } else if (controlMode) {
                  // Pointer mode - show pointer on artist's screen
                  sendControlEvent('click', x / agentScreenSize.width, y / agentScreenSize.height);
                }
              }
            }}
            onMouseMove={(e) => {
              if (role === 'engineer' && hasRemoteStream && remoteVideoRef.current) {
                const video = remoteVideoRef.current;
                const { x, y } = mapVideoPointToScreen(
                  e.clientX,
                  e.clientY,
                  video.getBoundingClientRect(),
                  video.videoWidth,
                  video.videoHeight,
                  agentScreenSize,
                );
                
                // Full control mode - send mouse move to agent
                if (controlEnabled) {
                  virtualCursorRef.current = { x, y };
                  sendFullControlCommand({ type: 'mouse-move', x, y });
                } else if (controlMode) {
                  // Pointer mode - show pointer on artist's screen
                  sendControlEvent('pointer', x / agentScreenSize.width, y / agentScreenSize.height);
                }
              }
            }}
          >
            {((role === 'artist' || role === 'engineer' || isProducerDJOrWriter) && isSharing && localStream?.getVideoTracks().length) ? (
              // Sharing roles show status instead of preview to avoid a mirror effect.
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
                      <p className="text-2xl font-bold text-cyan-400 font-tech">{connected ? 'Broadcasting Live' : 'Screen captured — connecting…'}</p>
                      <p className="text-muted-foreground mt-2">{connected
                        ? 'Your screen is being shared with participants'
                        : 'Your screen is captured locally. Waiting for a viewer connection.'}</p>
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
                  onTouchCancel={handleVideoTouchCancel}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isSyntheticClickAfterTouch(
                      lastRemoteVideoTouchTimeRef.current,
                      Date.now(),
                      TOUCH_DELAY_MS,
                    )) {
                      return;
                    }

                    if (role === 'engineer' && controlEnabled && remoteVideoRef.current) {
                      const video = remoteVideoRef.current;
                      const rect = video.getBoundingClientRect();
                      const { x, y } = mapVideoPointToScreen(
                        e.clientX,
                        e.clientY,
                        rect,
                        video.videoWidth,
                        video.videoHeight,
                        agentScreenSize,
                      );
                      virtualCursorRef.current = { x, y };
                      sendFullControlCommand({ type: 'mouse-move', x, y });
                      queueFullControlClick(video);
                    }
                  }}
                  style={{ cursor: hasRemoteStream ? 'none' : 'default' }}
                />
                {!hasRemoteStream && !isSharing && !remoteVideoRef.current?.srcObject && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-4 bg-black/80">
                    <Radio size={64} className="opacity-30 animate-pulse" />
                    {participants.filter(p => p.role === 'artist' || p.role === 'producer' || p.role === 'engineer' || p.role === 'dj' || p.role === 'writer').length === 0 ? (
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
                
                {/* Audio prompt for engineer when video is playing but audio is muted */}
                {isViewer && hasRemoteStream && videoAudioMuted && (
                  <button 
                    onClick={handleClickWithTouchGuard(handleToggleAudio)}
                    onTouchEnd={handleAudioTouch}
                    className="absolute bottom-16 left-1/2 transform -translate-x-1/2 z-30 flex items-center gap-3 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-purple-600 text-white font-bold shadow-lg hover:scale-105 transition-all animate-pulse"
                    data-testid="button-enable-audio-prompt"
                  >
                    <Volume2 size={24} />
                    <span className="text-lg">Tap to Enable Audio</span>
                  </button>
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

          {/* Status Indicator Bar - compact studio-style lights */}
          <div className="flex items-center justify-between gap-2 p-2 bg-black/40 rounded-lg border border-white/10">
            {/* Status Lights */}
            <div className="flex items-center gap-3">
              {/* Connection Status */}
              <div className="flex items-center gap-1.5" title={connected ? 'Connected' : 'Connecting...'}>
                <div className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]' : 'bg-yellow-400 animate-pulse'}`} />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Link</span>
              </div>
              
              {/* Sharing Status */}
              <div className="flex items-center gap-1.5" title={isSharing ? 'Broadcasting' : 'Not sharing'}>
                <div className={`w-2.5 h-2.5 rounded-full ${isSharing ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)] animate-pulse' : 'bg-gray-500'}`} />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Video</span>
              </div>
              
              {/* Mic Status */}
              <button 
                onClick={handleToggleMic}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                title={isMicActive ? 'Mic On - click to mute' : 'Mic Off - click to enable'}
                data-testid="button-artist-toggle-mic"
              >
                <div className={`w-2.5 h-2.5 rounded-full ${isMicActive ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)] animate-pulse' : 'bg-gray-500'}`} />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Mic</span>
              </button>
              
              {role === 'artist' && (
                <button 
                  onClick={toggleRemoteControl}
                  disabled={togglingRemoteControl}
                  className="flex items-center gap-1.5 hover:opacity-80 transition-opacity disabled:opacity-50"
                  title={remoteControlAllowed ? 'Remote control allowed' : 'Remote control off'}
                  data-testid="button-allow-control"
                >
                  <div className={`w-2.5 h-2.5 rounded-full ${remoteControlAllowed ? 'bg-purple-400 shadow-[0_0_8px_rgba(192,132,252,0.6)] animate-pulse' : 'bg-gray-500'}`} />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Ctrl</span>
                </button>
              )}
            </div>
            
            {/* Action Buttons - Artist */}
            {role === 'artist' && (
              <div className="flex items-center gap-2">
                {isMobile || !screenShareSupported ? (
                  <span className="text-[10px] text-amber-400">Use computer to share</span>
                ) : !isSharing ? (
                  <button
                    onClick={() => handleStartSharing(false)}
                    data-testid="button-start-sharing"
                    className="px-2 py-1 rounded text-xs font-medium bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 hover:bg-cyan-500/30 transition-colors flex items-center gap-1"
                  >
                    <Video size={12} /> Share
                  </button>
                ) : (
                  <button
                    onClick={handleStopSharing}
                    data-testid="button-stop-sharing"
                    className="px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30 transition-colors flex items-center gap-1"
                  >
                    <VideoOff size={12} /> Stop
                  </button>
                )}
              </div>
            )}
            
            {/* Engineer Status Lights */}
            {canRecord && (
              <>
                <button 
                  onClick={handleClickWithTouchGuard(handleToggleAudio)}
                  onTouchEnd={handleAudioTouch}
                  disabled={!hasRemoteStream}
                  className="flex items-center gap-1.5 hover:opacity-80 transition-opacity disabled:opacity-50"
                  title={!hasRemoteStream ? 'No stream' : !hasAudioTracks ? 'No audio in stream' : videoAudioMuted ? 'Audio muted - tap to enable' : 'Audio on - tap to mute'}
                  data-testid="button-toggle-stream-audio"
                >
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    !hasRemoteStream ? 'bg-gray-500' : 
                    !hasAudioTracks ? 'bg-yellow-400' : 
                    videoAudioMuted ? 'bg-red-400' : 
                    'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)] animate-pulse'
                  }`} />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Audio</span>
                </button>
                
                {/* Recording Status */}
                {isRecording && (
                  <div className="flex items-center gap-1.5" title="Recording">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] animate-pulse" />
                    <span className="text-[10px] uppercase tracking-wider font-mono text-red-400">{formatTime(recordingDuration)}</span>
                  </div>
                )}
              </>
            )}
            
            {/* Broadcast collaborator status lights */}
            {isProducerDJOrWriter && (
              <button 
                onClick={handleClickWithTouchGuard(handleToggleAudio)}
                onTouchEnd={handleAudioTouch}
                disabled={!hasRemoteStream}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity disabled:opacity-50"
                title={!hasRemoteStream ? 'No stream' : videoAudioMuted ? 'Audio muted' : 'Audio on'}
                data-testid={isDJ ? 'button-dj-toggle-audio' : isWriter ? 'button-writer-toggle-audio' : 'button-producer-toggle-audio'}
              >
                <div className={`w-2.5 h-2.5 rounded-full ${
                  !hasRemoteStream ? 'bg-gray-500' : videoAudioMuted ? 'bg-red-400' : 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)] animate-pulse'
                }`} />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Audio</span>
              </button>
            )}
            
            {/* Other role Status Lights */}
            {role === 'other' && (
              <button 
                onClick={handleClickWithTouchGuard(handleToggleAudio)}
                onTouchEnd={handleAudioTouch}
                disabled={!hasRemoteStream}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity disabled:opacity-50"
                title={!hasRemoteStream ? 'No stream' : videoAudioMuted ? 'Audio muted' : 'Audio on'}
                data-testid="button-other-toggle-audio"
              >
                <div className={`w-2.5 h-2.5 rounded-full ${
                  !hasRemoteStream ? 'bg-gray-500' : videoAudioMuted ? 'bg-red-400' : 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)] animate-pulse'
                }`} />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Audio</span>
              </button>
            )}
          </div>
          
          {/* Action Buttons Row - separate from status bar */}
          <div className="flex flex-wrap gap-2 items-center justify-center">
            {/* Engineer Action Buttons */}
            {canRecord && (
              <>
                {/* Volume Slider */}
                {!videoAudioMuted && hasRemoteStream && (
                  <div className="flex items-center gap-2 px-2 py-1 rounded bg-black/30 border border-white/10">
                    <VolumeX size={12} className="text-muted-foreground" />
                    <Slider value={[volume]} onValueChange={handleVolumeChange} max={100} min={0} step={5} className="w-16" data-testid="slider-volume" />
                    <Volume2 size={12} className="text-muted-foreground" />
                  </div>
                )}
                
                {/* Share Screen */}
                {!isSharing ? (
                  <button onClick={() => handleStartSharing(false)} data-testid="button-engineer-share-screen"
                    className="px-2 py-1 rounded text-xs font-medium bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 hover:bg-cyan-500/30 transition-colors flex items-center gap-1">
                    <Video size={12} /> Share
                  </button>
                ) : (
                  <button onClick={handleStopSharing} data-testid="button-engineer-stop-sharing"
                    className="px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30 transition-colors flex items-center gap-1">
                    <VideoOff size={12} /> Stop
                  </button>
                )}
                
                {/* Remote Control - always show for engineer, but disabled if no agent */}
                {fullControlActive ? (
                  <>
                    <button onClick={endFullControl} data-testid="button-end-control"
                      className="px-2 py-1 rounded text-xs font-medium bg-purple-500/20 text-purple-400 border border-purple-500/50 hover:bg-purple-500/30 transition-colors flex items-center gap-1">
                      <MousePointer2 size={12} /> End Control
                    </button>
                    {wsControlMode === 'alignment' ? (
                      <span className="px-2 py-1 text-[10px] text-amber-300" data-testid="control-alignment-status">
                        Cursor test only — artist: open the desktop Agent and click “Enable Mouse &amp; Keyboard”
                      </span>
                    ) : (
                      <>
                    {/* Keyboard toggle button - desktop only (mobile uses fullscreen controls) */}
                    <button 
                      onClick={() => {
                        setShowKeyboardInput(!showKeyboardInput);
                        if (!showKeyboardInput) {
                          setTimeout(() => keyboardInputRef.current?.focus(), 100);
                        }
                      }}
                      data-testid="button-toggle-keyboard"
                      className={`hidden md:flex px-2 py-1 rounded text-xs font-medium border transition-colors items-center gap-1 ${
                        showKeyboardInput 
                          ? 'bg-cyan-500/30 text-cyan-300 border-cyan-500/50' 
                          : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50 hover:bg-cyan-500/30'
                      }`}
                      title="Type text to send to artist's computer"
                    >
                      <Keyboard size={12} /> Type
                    </button>
                    {/* Left Click - desktop only (mobile uses fullscreen controls) */}
                    <button 
                      onClick={() => sendFullControlCommand({ type: 'mouse-click', button: 'left' })}
                      data-testid="button-left-click"
                      className="hidden md:flex px-2 py-1 rounded text-xs font-medium bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 hover:bg-cyan-500/30 transition-colors items-center gap-1"
                      title="Left click"
                    >
                      L-Click
                    </button>
                    {/* Right Click - desktop only (mobile uses fullscreen controls) */}
                    <button 
                      onClick={() => sendFullControlCommand({ type: 'mouse-click', button: 'right' })}
                      data-testid="button-right-click"
                      className="hidden md:flex px-2 py-1 rounded text-xs font-medium bg-purple-500/20 text-purple-400 border border-purple-500/50 hover:bg-purple-500/30 transition-colors items-center gap-1"
                      title="Right click"
                    >
                      R-Click
                    </button>
                      </>
                    )}
                  </>
                ) : (
                  <button 
                    onClick={() => agentConnected && requestFullControl('Engineer')} 
                    disabled={controlPending || !agentConnected || !displayControlSupported || !captureSupported}
                    data-testid="button-request-control"
                    className={`px-2 py-1 rounded text-xs font-medium border transition-colors flex items-center gap-1 disabled:opacity-50 ${
                      agentConnected 
                        ? 'bg-purple-500/20 text-purple-400 border-purple-500/50 hover:bg-purple-500/30'
                        : 'bg-gray-500/20 text-gray-400 border-gray-500/50 cursor-not-allowed'
                    }`}
                    title={displayControlReason || (agentConnected ? "Share the entire screen on a single-display computer before requesting control" : "Artist must run Virtual Studio Agent first")}>
                    <MousePointer2 size={12} /> {controlPending ? 'Waiting...' : agentConnected ? 'Control' : 'No Agent'}
                  </button>
                )}
                
                {/* Fullscreen */}
                {hasRemoteStream && (
                  <button 
                    onClick={handleClickWithTouchGuard(toggleFullscreen)}
                    onTouchEnd={handleTouchWithGuard(toggleFullscreen)}
                    data-testid="button-fullscreen"
                    className="px-2 py-1 rounded text-xs font-medium bg-slate-500/20 text-slate-300 border border-slate-500/50 hover:bg-slate-500/30 transition-colors">
                    {isFullscreen ? <Minimize size={12} /> : <Maximize size={12} />}
                  </button>
                )}
                
                {/* Recording */}
                {!recordedBlob ? (
                  !isRecording ? (
                    <button onClick={startRecordingSession} disabled={!hasRemoteStream} data-testid="button-start-recording"
                      className="px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30 transition-colors flex items-center gap-1 disabled:opacity-50">
                      <Disc size={12} /> Rec
                    </button>
                  ) : (
                    <button onClick={stopRecordingSession} data-testid="button-stop-recording"
                      className="px-2 py-1 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-500 transition-colors flex items-center gap-1">
                      <Square size={12} fill="currentColor" /> Stop
                    </button>
                  )
                ) : (
                  <>
                    <button onClick={handleDownload} data-testid="button-download-recording"
                      className="px-2 py-1 rounded text-xs font-medium bg-white/10 border border-white/20 hover:bg-white/20 transition-colors flex items-center gap-1">
                      <Download size={12} /> DL
                    </button>
                    <button onClick={handleSave} disabled={uploadMutation.isPending} data-testid="button-save-recording"
                      className="px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/50 hover:bg-green-500/30 transition-colors flex items-center gap-1 disabled:opacity-50">
                      {uploadMutation.isPending ? <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={12} />} Save
                    </button>
                  </>
                )}
              </>
            )}
            
            {/* Virtual Keyboard for Engineer - desktop only (mobile uses fullscreen controls) */}
            {canRecord && fullControlActive && showKeyboardInput && (
              <div className="hidden md:block w-full mt-2">
                <VirtualKeyboard
                  onKeyPress={(key, modifiers) => {
                    sendFullControlCommand({ type: 'key-press', key, modifiers: modifiers || {} });
                  }}
                  onType={(text) => {
                    sendFullControlCommand({ type: 'key-type', text });
                  }}
                  onClose={() => setShowKeyboardInput(false)}
                />
              </div>
            )}
            
            {/* Producer, DJ, and Writer action buttons */}
            {isProducerDJOrWriter && (
              // Producers, DJs, and writers can share their screen or broadcast audio only.
              <div className="flex items-center gap-2 flex-wrap">
                {!isSharing ? (
                  <>
                    <button
                      onClick={() => handleStartSharing(false)}
                      data-testid={isDJ ? 'button-dj-share-screen' : isWriter ? 'button-writer-share-screen' : 'button-producer-share-screen'}
                      className={`px-3 py-2 rounded-lg text-white font-medium text-sm flex items-center gap-2 hover:brightness-110 transition-all ${isDJ ? 'bg-pink-600' : isWriter ? 'bg-emerald-600' : 'bg-purple-600'}`}
                    >
                      <Monitor size={16} /> Screen
                    </button>
                    <button
                      onClick={() => handleStartSharing(true)}
                      data-testid={isDJ ? 'button-dj-share-audio' : isWriter ? 'button-writer-share-audio' : 'button-producer-share-audio'}
                      className={`px-3 py-2 rounded-lg text-white font-medium text-sm flex items-center gap-2 hover:brightness-110 transition-all ${isDJ ? 'bg-pink-700' : isWriter ? 'bg-emerald-700' : 'bg-purple-700'}`}
                    >
                      <Volume2 size={16} /> Audio
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleStopSharing}
                    data-testid={isDJ ? 'button-dj-stop-sharing' : isWriter ? 'button-writer-stop-sharing' : 'button-producer-stop-sharing'}
                    className="px-3 py-2 rounded-lg bg-destructive text-white font-medium text-sm flex items-center gap-2 hover:bg-destructive/90 transition-all"
                  >
                    <VolumeX size={16} /> Stop
                  </button>
                )}
                {/* Audio indicator for sharing collaborators */}
                <button
                  onClick={handleClickWithTouchGuard(handleToggleAudio)}
                  onTouchEnd={handleAudioTouch}
                  data-testid={isDJ ? 'button-dj-toggle-audio' : isWriter ? 'button-writer-toggle-audio' : 'button-producer-toggle-audio'}
                  className={`px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border ${
                    !hasRemoteStream
                      ? 'bg-gray-500/20 border-gray-500/50 text-gray-400'
                      : !hasAudioTracks 
                        ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' 
                        : videoAudioMuted 
                          ? 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30' 
                          : 'bg-green-500/20 border-green-500/50 text-green-400 hover:bg-green-500/30'
                  }`}
                  title={!hasRemoteStream ? 'Waiting for stream' : !hasAudioTracks ? 'No audio available' : videoAudioMuted ? 'Tap to enable audio' : 'Tap to mute'}
                  disabled={!hasRemoteStream}
                >
                  <div className={`w-2 h-2 rounded-full ${
                    !hasRemoteStream ? 'bg-gray-400' : !hasAudioTracks ? 'bg-yellow-400' : videoAudioMuted ? 'bg-red-400' : 'bg-green-400 animate-pulse'
                  }`} />
                  {!hasRemoteStream ? 'No Stream' : !hasAudioTracks ? 'No Audio' : videoAudioMuted ? 'Audio Off' : 'Audio On'}
                </button>
                
                {/* Volume slider for received audio */}
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
                      data-testid={isDJ ? 'slider-volume-dj' : isWriter ? 'slider-volume-writer' : 'slider-volume-producer'}
                    />
                    <Volume2 size={14} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground w-8">{volume}%</span>
                  </div>
                )}
                
                {/* Microphone toggle for sharing collaborators */}
                <button
                  onClick={handleToggleMic}
                  data-testid={isDJ ? 'button-dj-toggle-mic' : isWriter ? 'button-writer-toggle-mic' : 'button-producer-toggle-mic'}
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

                {/* Test audio for sharing collaborators */}
                <button
                  onClick={playTestAudio}
                  data-testid={isDJ ? 'button-dj-test-audio' : isWriter ? 'button-writer-test-audio' : 'button-producer-test-audio'}
                  disabled={isTestingAudio}
                  className="px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all border bg-blue-500/20 border-blue-500/50 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50"
                  title="Play a test tone to confirm audio is working on this device"
                >
                  <Volume2 size={16} />
                  Test Audio
                </button>
                
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${isDJ ? 'bg-pink-500/20 border-pink-500/50' : isWriter ? 'bg-emerald-500/20 border-emerald-500/50' : 'bg-purple-500/20 border-purple-500/50'}`}>
                  <Music size={14} className={isDJ ? 'text-pink-400' : isWriter ? 'text-emerald-400' : 'text-purple-400'} />
                  <span className={`text-xs ${isDJ ? 'text-pink-300' : isWriter ? 'text-emerald-300' : 'text-purple-300'}`}>{isDJ ? 'DJ' : isWriter ? 'Writer' : 'Producer'}</span>
                </div>
              </div>
            )}
            
            {/* Other role Action Buttons */}
            {role === 'other' && (
              <div className="flex gap-2 items-center flex-wrap">
                {/* Audio button for guests - always visible */}
                <button
                  onClick={handleClickWithTouchGuard(handleToggleAudio)}
                  onTouchEnd={handleAudioTouch}
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
                  title={!hasRemoteStream ? 'Waiting for stream' : !hasAudioTracks ? 'No audio available' : videoAudioMuted ? 'Tap to enable audio' : 'Tap to mute'}
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
            <h3 className="font-display font-bold text-lg mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Users size={20} /> Participants
              </span>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={async () => {
                  toast({ title: "Refreshing...", description: "Reconnecting to session" });
                  disconnect();
                  // Wait for disconnect to complete
                  await new Promise(r => setTimeout(r, 1000));
                  // Force reconnect
                  connect();
                }}
                title="Refresh participants"
                data-testid="button-refresh-participants"
              >
                <RefreshCw size={16} />
              </Button>
            </h3>
            <div className="space-y-2">
              {/* Self */}
              <div className={`flex items-center gap-3 p-3 rounded-lg border ${getRoleBgColor(role)}`}>
                <div className={`w-3 h-3 rounded-full ${getRoleDotColor(role)} shadow-lg`} />
                <span className="font-tech text-sm flex items-center gap-2">
                  {getRoleIcon(role)} You ({isDJ ? 'DJ' : isWriter ? 'Writer' : role})
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
                  {(role === 'artist' || isProducerDJOrWriter) && isSharing && (
                    <span className="text-xs text-green-400 flex items-center gap-1">
                      <Radio size={12} /> {role === 'artist' ? 'Live' : isDJ ? 'DJ Live' : isWriter ? 'Writer Live' : 'Audio'}
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
                      {getRoleIcon(p.role as SessionRole)} {p.role === 'dj' ? 'DJ' : p.role === 'writer' ? 'Writer' : p.role}
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
            
            {/* Agent Status Indicator */}
            <div className={`mt-3 p-2 rounded-lg border text-xs ${
              agentConnected 
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-300' 
                : 'bg-gray-500/10 border-gray-500/30 text-gray-400'
            }`}>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${agentConnected ? 'bg-purple-400 animate-pulse' : 'bg-gray-500'}`} />
                <span>Agent: {agentConnected ? 'Connected' : 'Not Connected'}{agentConnected && agentVersion ? ` · ${agentVersion}` : ''}</span>
              </div>
              {(role === 'artist' || role === 'engineer') && (
                <p className="mt-2">
                  {displayControlReason || (displayControlCalibrationRequired
                    ? 'Scaled displays start with cursor movement only. The artist must confirm the cursor is aligned in the Agent before clicks and keyboard input unlock.'
                    : 'Full remote control requires one connected display and an entire-screen share. Window, tab, audio-only, and unidentified shares are view-only.')}
                  {agentConnected && !displayControlSupported && !displayControlReason && ' The running Agent has not confirmed display compatibility. Completely quit and reopen the current Agent version; installing it without restarting may leave an older process running.'}
                  {agentConnected && displayControlSupported && !captureSupported && ' Waiting for an identified entire-screen share from the artist.'}
                </p>
              )}
              {!agentConnected && role === 'artist' && (
                <p className="mt-1 text-[10px] opacity-70">Click Ctrl button above, then run agent on your computer</p>
              )}
              {!agentConnected && role === 'engineer' && (
                <p className="mt-1 text-[10px] opacity-70">Artist must enable control and run agent</p>
              )}
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
                  <li>Click "Share" button</li>
                  <li>Select your DAW window or entire screen</li>
                  <li>Check "Share audio" checkbox</li>
                  <li>Your engineer will see and hear everything</li>
                </ol>
                
                {/* Mac Audio Setup */}
                <div className="mt-3 pt-3 border-t border-white/10">
                  <p className="text-xs font-semibold text-amber-400 flex items-center gap-1">
                    <span>🍎</span> Mac Users - Audio Setup Required
                  </p>
                  <p className="text-xs mt-1 opacity-80">
                    Chrome on Mac cannot capture DAW audio directly. You need BlackHole (free):
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-xs mt-2 opacity-80">
                    <li>
                      <a 
                        href="https://existential.audio/blackhole/" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:underline"
                      >
                        Download BlackHole
                      </a> (click "Download BlackHole 2ch")
                    </li>
                    <li>Run the installer, then open <strong>Audio MIDI Setup</strong> (Spotlight search)</li>
                  </ol>
                  
                  <p className="text-xs font-semibold mt-3 text-cyan-400">Use an Audio Interface</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs mt-1 opacity-80">
                    <li>Click "+" → <strong>Create Aggregate Device</strong></li>
                    <li>Check your interface (e.g., Scarlett) AND BlackHole 2ch</li>
                    <li>Set <strong>Clock Source</strong> to your interface (Scarlett)</li>
                    <li>Enable <strong>Drift Correction</strong> on BlackHole only</li>
                    <li>In Pro Tools: Setup → Playback Engine → select Aggregate Device</li>
                  </ol>
                  
                  <p className="text-xs font-semibold mt-3 text-cyan-400">For Audio Output to Chrome:</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs mt-1 opacity-80">
                    <li>Click "+" → <strong>Create Multi-Output Device</strong></li>
                    <li>Check your interface AND BlackHole 2ch</li>
                    <li>Set Mac system output to Multi-Output Device</li>
                    <li>Now share screen with audio - it will work!</li>
                  </ol>
                  
                  <p className="text-xs mt-2 text-green-400">
                    Windows users: Audio sharing works automatically!
                  </p>
                </div>
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
            {isProducerDJOrWriter && (
              <>
                <p><strong>{isDJ ? 'DJ Controls:' : isWriter ? 'Writer Controls:' : 'Producer Controls:'}</strong></p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  {isWriter ? (
                    <li>Use "Screen" to share lyrics or notes, or "Audio" to share your writing-session audio</li>
                  ) : (
                    <li>Click "Audio" to broadcast your {isDJ ? 'DJ mix' : 'beats'}</li>
                  )}
                  <li>Check "Share audio" checkbox when prompted</li>
                  <li>Everyone in the session will hear your audio</li>
                  <li>Click "Stop" when done</li>
                </ol>
                
                {/* Mac audio setup for sharing collaborators */}
                <div className="mt-3 pt-3 border-t border-white/10">
                  <p className="text-xs font-semibold text-amber-400 flex items-center gap-1">
                    <span>🍎</span> Mac Users - Audio Setup Required
                  </p>
                  <p className="text-xs mt-1 opacity-80">
                    Chrome on Mac cannot capture system audio directly. Install{' '}
                    <a 
                      href="https://existential.audio/blackhole/" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:underline"
                    >
                      BlackHole (free)
                    </a>
                  </p>
                  
                  <p className="text-xs font-semibold mt-2 text-cyan-400">Use an Audio Interface</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs mt-1 opacity-80">
                    <li>Open <strong>Audio MIDI Setup</strong> (Spotlight search)</li>
                    <li>Click "+" → <strong>Create Aggregate Device</strong></li>
                    <li>Check your interface AND BlackHole 2ch</li>
                    <li>Set <strong>Clock Source</strong> to your interface</li>
                    <li>Enable <strong>Drift Correction</strong> on BlackHole only</li>
                    <li>Click "+" → <strong>Create Multi-Output Device</strong></li>
                    <li>Check your interface AND BlackHole 2ch</li>
                    <li>Set Mac output to Multi-Output Device</li>
                  </ol>
                  
                  <p className="text-xs mt-2 text-green-400">
                    Windows users: Audio sharing works automatically!
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
  // Bypass subscription gate for now to debug black screen issue
  return <SessionContent />;
}
