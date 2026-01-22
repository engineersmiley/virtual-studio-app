import { useState, useEffect, useRef, useCallback } from 'react';
import { useRoute, Link } from 'wouter';
import { useWebRTC, type RemoteControlEvent, type RemoteStreamInfo } from '@/hooks/use-webrtc';
import { useUploadRecording } from '@/hooks/use-recordings';
import { Visualizer } from '@/components/Visualizer';
import { SubscriptionGate } from '@/components/SubscriptionGate';
import { PhoneControl } from '@/components/PhoneControl';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Monitor, Mic, Square, Disc, Save, Download, Copy, 
  Users, Radio, ArrowLeft, CheckCircle, AlertTriangle,
  Video, VideoOff, Eye, PenTool, Zap, MousePointer2, Move, Maximize, Minimize,
  Volume2, VolumeX, Music
} from 'lucide-react';
import type { SessionRole } from '@shared/schema';

function generateUserId() {
  return 'user_' + Math.random().toString(36).substr(2, 9);
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
  
  
  // Producer audio state - track status per user: pending (not tried), playing, blocked
  const [audioStatus, setAudioStatus] = useState<Map<string, 'pending' | 'playing' | 'blocked'>>(new Map());
  const producerAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  
  const { toast } = useToast();
  
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
  
  const uploadMutation = useUploadRecording();

  const handleRemoteStream = useCallback((stream: MediaStream) => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
    }
    
    // Setup analyser for visualizer
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;
  }, []);

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

  // Fullscreen toggle - try video element first (works on iOS), then container
  const toggleFullscreen = useCallback(() => {
    const container = videoContainerRef.current;
    if (!container) return;
    
    // Find the video element inside the container
    const video = container.querySelector('video');
    
    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      // Try video element first (better iOS support)
      const enterFullscreen = (el: any) => {
        if (el.requestFullscreen) {
          return el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          return el.webkitRequestFullscreen();
        } else if (el.webkitEnterFullscreen) {
          // iOS Safari video-specific
          el.webkitEnterFullscreen();
          return Promise.resolve();
        }
        return Promise.reject(new Error('Fullscreen not supported'));
      };
      
      // Try video first on mobile, container on desktop
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const targetElement = isMobile && video ? video : container;
      
      enterFullscreen(targetElement).then(() => {
        setIsFullscreen(true);
      }).catch((err: any) => {
        console.log('Fullscreen not available:', err.message);
        // Fallback: maximize in viewport with CSS
        if (container) {
          container.style.position = 'fixed';
          container.style.top = '0';
          container.style.left = '0';
          container.style.width = '100vw';
          container.style.height = '100vh';
          container.style.zIndex = '9999';
          setIsFullscreen(true);
        }
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
        if (container) {
          container.style.position = '';
          container.style.top = '';
          container.style.left = '';
          container.style.width = '';
          container.style.height = '';
          container.style.zIndex = '';
          setIsFullscreen(false);
        }
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
    localStream,
    hasRemoteStream,
    remoteStreams,
    agentConnected: wsAgentConnected,
    controlAllowed: wsControlAllowed,
    controlPending: wsControlPending,
    connect,
    disconnect,
    startSharing,
    stopSharing,
    sendControlEvent,
    requestFullControl,
    endFullControl,
    sendFullControlCommand,
  } = useWebRTC({
    roomId,
    userId,
    role,
    onRemoteStream: handleRemoteStream,
    onRemoteControl: handleRemoteControl,
    onAgentStatus: (status) => {
      setAgentConnected(status.connected);
      setFullControlActive(status.controlAllowed);
      setControlPending(status.controlPending);
    },
  });

  // Direct screen touch control - touch on video to control computer
  const handleVideoTouchStart = useCallback((e: React.TouchEvent) => {
    if (!fullControlActive || !wsControlAllowed) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    lastTouchRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, [fullControlActive, wsControlAllowed]);
  
  const handleVideoTouchMove = useCallback((e: React.TouchEvent) => {
    if (!fullControlActive || !wsControlAllowed || !lastTouchRef.current) return;
    e.preventDefault();
    
    const video = remoteVideoRef.current;
    if (!video) return;
    
    const touch = e.touches[0];
    const rect = video.getBoundingClientRect();
    
    // Calculate position relative to video
    const x = Math.max(0, Math.min(1920, ((touch.clientX - rect.left) / rect.width) * 1920));
    const y = Math.max(0, Math.min(1080, ((touch.clientY - rect.top) / rect.height) * 1080));
    
    sendFullControlCommand({ type: 'mouse-move', x, y });
    lastTouchRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, [fullControlActive, wsControlAllowed, sendFullControlCommand]);
  
  const handleVideoTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!fullControlActive || !wsControlAllowed || !touchStartRef.current) return;
    
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
  }, [fullControlActive, wsControlAllowed, sendFullControlCommand]);

  // Get producer audio streams (audio-only streams from producers)
  const producerAudioStreams = Array.from(remoteStreams.values()).filter(
    info => info.fromRole === 'producer' && !info.hasVideo
  );

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
        </div>
      </header>

      {error && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive flex items-center gap-3">
          <AlertTriangle size={20} />
          {error}
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        {/* Video/Stream Area */}
        <div className="lg:col-span-2 glass-panel rounded-2xl p-3 lg:p-6 flex flex-col gap-4">
          <div 
            ref={videoContainerRef}
            className={`rounded-xl overflow-hidden bg-black/50 relative min-h-[200px] lg:min-h-[400px] ${(controlMode || fullControlActive || wsControlAllowed) && role === 'engineer' ? 'cursor-crosshair' : ''}`}
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
                if (fullControlActive || wsControlAllowed) {
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
                if (fullControlActive || wsControlAllowed) {
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
              // Artist, Engineer, or Producer (broadcasting) sees their own screen share preview
              isSharing ? (
                <>
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-contain"
                  />
                  {/* Remote pointer from engineer - positioned relative to video content accounting for letterboxing */}
                  <AnimatePresence>
                    {remotePointer.visible && localVideoRef.current && videoContainerRef.current && (() => {
                      const video = localVideoRef.current;
                      const container = videoContainerRef.current;
                      const containerRect = container.getBoundingClientRect();
                      
                      // Calculate video display area with object-contain letterboxing
                      const videoRatio = video.videoWidth / video.videoHeight || 16/9;
                      const containerRatio = containerRect.width / containerRect.height;
                      
                      let videoDisplayWidth, videoDisplayHeight, offsetX, offsetY;
                      
                      if (videoRatio > containerRatio) {
                        videoDisplayWidth = containerRect.width;
                        videoDisplayHeight = containerRect.width / videoRatio;
                        offsetX = 0;
                        offsetY = (containerRect.height - videoDisplayHeight) / 2;
                      } else {
                        videoDisplayHeight = containerRect.height;
                        videoDisplayWidth = containerRect.height * videoRatio;
                        offsetX = (containerRect.width - videoDisplayWidth) / 2;
                        offsetY = 0;
                      }
                      
                      // Convert normalized 0-1 coords to pixel position within container
                      const pixelX = offsetX + (remotePointer.x / 100) * videoDisplayWidth;
                      const pixelY = offsetY + (remotePointer.y / 100) * videoDisplayHeight;
                      
                      // Convert to percentage of container
                      const leftPct = (pixelX / containerRect.width) * 100;
                      const topPct = (pixelY / containerRect.height) * 100;
                      
                      return (
                        <motion.div
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                          className="absolute z-20 pointer-events-none"
                          style={{
                            left: `${leftPct}%`,
                            top: `${topPct}%`,
                            transform: 'translate(-50%, -50%)',
                          }}
                        >
                          <div className="relative">
                            {/* Large glowing pointer */}
                            <MousePointer2 className="w-10 h-10 text-cyan-400 drop-shadow-lg" style={{ filter: 'drop-shadow(0 0 8px #00ffff) drop-shadow(0 0 16px #00ffff)' }} />
                            {/* Label */}
                            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-bold bg-cyan-500 text-black px-3 py-1 rounded-full shadow-lg">
                              Engineer pointing here
                            </div>
                            {/* Ping animation */}
                            <div className="absolute inset-0 w-12 h-12 -m-1 rounded-full bg-cyan-400/40 animate-ping" />
                            {/* Static glow ring */}
                            <div className="absolute inset-0 w-16 h-16 -m-3 rounded-full bg-cyan-400/20 animate-pulse" />
                          </div>
                        </motion.div>
                      );
                    })()}
                  </AnimatePresence>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-4 p-8">
                  <Monitor size={64} className="opacity-30" />
                  <p className="font-tech text-center">Click "Start Sharing" to broadcast your screen</p>
                  <div className="mt-4 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 max-w-md text-center">
                    <AlertTriangle className="w-5 h-5 text-yellow-500 mx-auto mb-2" />
                    <p className="text-sm text-yellow-200/80">
                      <strong>Tip:</strong> Share your DAW or a specific application window - not the browser running Virtual Studio, or you'll see a mirror effect.
                    </p>
                  </div>
                </div>
              )
            ) : (
              // Non-broadcasting participants see remote stream or their own placeholder
              <>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className={`w-full h-full object-contain ${(fullControlActive || wsControlAllowed) ? 'touch-none' : ''}`}
                  onTouchStart={handleVideoTouchStart}
                  onTouchMove={handleVideoTouchMove}
                  onTouchEnd={handleVideoTouchEnd}
                  style={{ cursor: (fullControlActive || wsControlAllowed) ? 'crosshair' : 'default' }}
                />
                {!hasRemoteStream && !isSharing && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-4 bg-black/80">
                    <Radio size={64} className="opacity-30 animate-pulse" />
                    {participants.filter(p => p.role === 'artist' || p.role === 'producer' || p.role === 'engineer').length === 0 ? (
                      <>
                        <p className="font-tech">Waiting for someone to share their screen...</p>
                        <p className="text-sm opacity-50">Room code: <span className="text-primary font-mono">{roomId}</span></p>
                        {(role === 'engineer' || role === 'producer') && (
                          <p className="text-sm text-primary mt-2">Or click "Share Screen" above to broadcast yourself!</p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="font-tech">Participants connected! Waiting for screen share...</p>
                        <p className="text-sm opacity-50">Someone needs to click "Share Screen" to start broadcasting</p>
                        {(role === 'engineer' || role === 'producer') && (
                          <p className="text-sm text-primary mt-2">Or click "Share Screen" above to broadcast yourself!</p>
                        )}
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
                
                {/* Fullscreen button for engineers viewing stream */}
                {role === 'engineer' && hasRemoteStream && (
                  <button
                    onClick={toggleFullscreen}
                    data-testid="button-fullscreen"
                    className="absolute top-3 right-3 z-20 p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white transition-colors"
                    title={isFullscreen ? 'Exit Fullscreen' : 'View Fullscreen'}
                  >
                    {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                  </button>
                )}
              </>
            )}
            
            {/* Scanline overlay */}
            <div className="absolute inset-0 pointer-events-none opacity-10 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-10" style={{backgroundSize: "100% 2px, 3px 100%"}} />
            
            {/* Producer audio elements - hidden, just for playback */}
            {producerAudioStreams.map((info) => (
              <ProducerAudio 
                key={info.fromUserId} 
                stream={info.stream} 
                userId={info.fromUserId}
                onPlayBlocked={markAudioBlocked}
                onPlaySuccess={markAudioPlaying}
                registerRef={registerAudioRef}
              />
            ))}
            
            {/* Enable audio button - appears when any producer audio is blocked */}
            {hasBlockedAudio && producerAudioStreams.length > 0 && (
              <Button
                onClick={async () => {
                  // Get all currently blocked users from the status map
                  const blockedUsers = Array.from(audioStatus.entries())
                    .filter(([, status]) => status === 'blocked')
                    .map(([userId]) => userId);
                  
                  // Directly play all blocked audio elements in this user gesture
                  const results = await Promise.allSettled(
                    blockedUsers.map(async (userId) => {
                      const audio = producerAudioRefs.current.get(userId);
                      if (audio) {
                        await audio.play();
                        markAudioPlaying(userId);
                        return 'success';
                      }
                      throw new Error('No audio element');
                    })
                  );
                  
                  const successCount = results.filter(r => r.status === 'fulfilled').length;
                  const failCount = results.filter(r => r.status === 'rejected').length;
                  
                  if (failCount === 0 && successCount > 0) {
                    toast({
                      title: "Producer Audio Enabled",
                      description: "You can now hear beats from producers",
                    });
                  } else if (failCount > 0) {
                    toast({
                      title: "Audio Issue",
                      description: `${failCount} stream${failCount > 1 ? 's' : ''} still blocked. Try again.`,
                      variant: "destructive",
                    });
                  }
                }}
                data-testid="button-enable-audio"
                className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20"
              >
                <Volume2 size={16} />
                Enable Producer Audio ({blockedCount} stream{blockedCount > 1 ? 's' : ''})
              </Button>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap gap-4 items-center justify-between">
            {role === 'artist' ? (
              // Artist controls - share screen and generate token for engineer
              <div className="flex gap-3 items-center flex-wrap">
                {isMobile || !screenShareSupported ? (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 text-sm">
                    <p className="font-bold mb-1">Screen sharing requires a computer</p>
                    <p className="text-xs">Open this session on your computer to share your screen. Your engineer can still watch from their phone.</p>
                  </div>
                ) : !isSharing ? (
                  <button
                    onClick={() => handleStartSharing(false)}
                    data-testid="button-start-sharing"
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-background font-bold flex items-center gap-2 hover:brightness-110 transition-all"
                  >
                    <Video size={20} /> Start Sharing
                  </button>
                ) : (
                  <button
                    onClick={handleStopSharing}
                    data-testid="button-stop-sharing"
                    className="px-6 py-3 rounded-xl bg-destructive text-white font-bold flex items-center gap-2 hover:bg-destructive/90 transition-all"
                  >
                    <VideoOff size={20} /> Stop Sharing
                  </button>
                )}
                
                {/* Simple Allow Control Toggle - no token needed */}
                <button
                  onClick={toggleRemoteControl}
                  disabled={togglingRemoteControl}
                  data-testid="button-allow-control"
                  className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all disabled:opacity-50 ${
                    remoteControlAllowed
                      ? 'bg-green-600 text-white shadow-lg shadow-green-500/30 animate-pulse'
                      : 'bg-gradient-to-r from-amber-600 to-amber-500 text-white hover:brightness-110'
                  }`}
                >
                  <MousePointer2 size={20} />
                  {togglingRemoteControl ? 'Updating...' : remoteControlAllowed ? 'Control Allowed' : 'Allow Control'}
                </button>
                
                {/* Status message when control is allowed */}
                {remoteControlAllowed && (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/20 border border-green-500/50">
                    <span className="text-green-400 text-sm">Engineer can connect with just the room code: <span className="font-mono font-bold">{roomId}</span></span>
                  </div>
                )}
              </div>
            ) : canRecord ? (
              // Engineer controls - can share screen, record, and control
              <>
              <div className="flex gap-3 items-center flex-wrap">
                {/* Share Screen for teaching */}
                {!isSharing ? (
                  <button
                    onClick={() => handleStartSharing(false)}
                    data-testid="button-engineer-share-screen"
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-background font-bold flex items-center gap-2 hover:brightness-110 transition-all"
                  >
                    <Video size={20} /> Share Screen
                  </button>
                ) : (
                  <button
                    onClick={handleStopSharing}
                    data-testid="button-engineer-stop-sharing"
                    className="px-6 py-3 rounded-xl bg-destructive text-white font-bold flex items-center gap-2 hover:bg-destructive/90 transition-all"
                  >
                    <VideoOff size={20} /> Stop Sharing
                  </button>
                )}
                
                {/* Control Mode Toggle - Pointer overlay */}
                <div className="relative group">
                  <button
                    onClick={() => setControlMode(!controlMode)}
                    data-testid="button-toggle-control"
                    className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all ${
                      !hasRemoteStream ? 'opacity-60 cursor-not-allowed' : ''
                    } ${
                      controlMode 
                        ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30 animate-pulse' 
                        : 'bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:brightness-110'
                    }`}
                  >
                    <MousePointer2 size={20} />
                    {controlMode ? 'Pointer ON - Move mouse over video!' : 'Show Pointer'}
                    {!hasRemoteStream && <span className="text-xs ml-1">(waiting)</span>}
                  </button>
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-black/90 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    Click to show your pointer on artist's screen - no app needed!
                  </div>
                </div>
                
                {/* Download Agent - When agent is not connected */}
                {!agentConnected && (
                  <a
                    href="/remote-control"
                    target="_blank"
                    data-testid="link-download-agent"
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 text-white font-bold flex items-center gap-2 hover:brightness-110 transition-all"
                  >
                    <Monitor size={20} />
                    Get Desktop Agent
                  </a>
                )}
                
                {/* Full Control - When agent is connected */}
                {agentConnected && (
                  fullControlActive ? (
                    <button
                      onClick={endFullControl}
                      data-testid="button-end-full-control"
                      className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white font-bold flex items-center gap-2 hover:brightness-110 transition-all shadow-lg shadow-purple-500/30"
                    >
                      <Monitor size={20} />
                      End Control
                    </button>
                  ) : (
                    <button
                      onClick={() => requestFullControl('Engineer')}
                      disabled={controlPending}
                      data-testid="button-request-full-control"
                      className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white font-bold flex items-center gap-2 hover:brightness-110 transition-all disabled:opacity-50"
                    >
                      <Monitor size={20} />
                      {controlPending ? 'Requesting...' : 'Full Control'}
                    </button>
                  )
                )}

                {!recordedBlob ? (
                  !isRecording ? (
                    <button
                      onClick={startRecordingSession}
                      disabled={!hasRemoteStream}
                      data-testid="button-start-recording"
                      className="px-6 py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-white font-bold flex items-center gap-2 hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Disc className="animate-pulse" size={20} /> Record
                    </button>
                  ) : (
                    <button
                      onClick={stopRecordingSession}
                      data-testid="button-stop-recording"
                      className="px-6 py-3 rounded-xl bg-destructive text-white font-bold flex items-center gap-2 hover:bg-destructive/90 transition-all"
                    >
                      <Square fill="currentColor" size={20} /> Stop
                    </button>
                  )
                ) : (
                  <div className="flex gap-3">
                    <button
                      onClick={handleDownload}
                      data-testid="button-download-recording"
                      className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 flex items-center gap-2 transition-colors"
                    >
                      <Download size={18} /> Download
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={uploadMutation.isPending}
                      data-testid="button-save-recording"
                      className="px-6 py-3 rounded-xl bg-secondary text-white font-bold flex items-center gap-2 hover:bg-secondary/90 transition-all disabled:opacity-50"
                    >
                      {uploadMutation.isPending ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Save size={18} />
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
              
              {/* Control Status Panel - shows what's happening */}
              <div className="w-full mt-4 p-4 rounded-xl bg-card border border-white/10">
                <h3 className="text-sm font-bold mb-3 text-primary flex items-center gap-2">
                  <Zap size={16} />
                  Control Status
                </h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span>Session: {connected ? 'Connected' : 'Disconnected'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${agentConnected ? 'bg-green-500' : 'bg-yellow-500'}`} />
                    <span>Agent: {agentConnected ? 'Online' : 'Not Connected'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${fullControlActive ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
                    <span>Control: {fullControlActive ? 'ACTIVE' : 'Not Active'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${controlPending ? 'bg-yellow-500 animate-pulse' : 'bg-gray-500'}`} />
                    <span>Request: {controlPending ? 'Pending...' : 'None'}</span>
                  </div>
                </div>
                {!agentConnected && (
                  <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs text-yellow-400">
                    <strong>Waiting for Artist:</strong> The artist needs to download and run the Desktop Agent on their computer.
                    <a href="/remote-control" target="_blank" className="text-primary underline ml-1">Share this link with artist</a>
                  </div>
                )}
                {agentConnected && !fullControlActive && (
                  <div className="mt-3 p-2 bg-primary/10 border border-primary/30 rounded text-xs text-primary">
                    Click "Request Control" below. The artist will see a popup asking for permission.
                  </div>
                )}
                {fullControlActive && (
                  <div className="mt-3 p-2 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-400">
                    Control is ACTIVE! Use the touchpad below or move your mouse over the video.
                  </div>
                )}
              </div>

              {/* Phone/Touch Control for engineers - available on all devices */}
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
            </> 
            ) : role === 'producer' ? (
              // Producer - can share screen for beat-making or audio only
              <div className="flex items-center gap-3 flex-wrap">
                {!isSharing ? (
                  <>
                    <button
                      onClick={() => handleStartSharing(false)}
                      data-testid="button-producer-share-screen"
                      className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white font-bold flex items-center gap-2 hover:brightness-110 transition-all shadow-lg shadow-purple-500/30"
                    >
                      <Monitor size={20} /> Share Screen
                    </button>
                    <button
                      onClick={() => handleStartSharing(true)}
                      data-testid="button-producer-share-audio"
                      className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-purple-700 text-white font-bold flex items-center gap-2 hover:brightness-110 transition-all"
                    >
                      <Volume2 size={20} /> Audio Only
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleStopSharing}
                    data-testid="button-producer-stop-sharing"
                    className="px-6 py-3 rounded-xl bg-destructive text-white font-bold flex items-center gap-2 hover:bg-destructive/90 transition-all"
                  >
                    <VolumeX size={20} /> Stop Sharing
                  </button>
                )}
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/20 border border-purple-500/50">
                  <Music size={18} className="text-purple-400" />
                  <span className="text-sm text-purple-300 font-tech">Producer</span>
                </div>
              </div>
            ) : (
              // Other - view only, no controls
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10">
                <Eye size={18} className="text-muted-foreground" />
                <span className="text-sm text-muted-foreground font-tech">Viewing as Guest</span>
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
                {(role === 'artist' || role === 'producer') && isSharing && (
                  <span className="ml-auto text-xs text-green-400 flex items-center gap-1">
                    <Radio size={12} /> {role === 'producer' ? 'Audio' : 'Live'}
                  </span>
                )}
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
