import { useState, useEffect, useRef, useCallback } from 'react';
import { useRoute, Link } from 'wouter';
import { useWebRTC } from '@/hooks/use-webrtc';
import { useUploadRecording } from '@/hooks/use-recordings';
import { Visualizer } from '@/components/Visualizer';
import { motion } from 'framer-motion';
import { 
  Monitor, Mic, Square, Disc, Save, Download, Copy, 
  Users, Radio, ArrowLeft, CheckCircle, AlertTriangle,
  Video, VideoOff
} from 'lucide-react';

function generateUserId() {
  return 'user_' + Math.random().toString(36).substr(2, 9);
}

export default function Session() {
  const [, params] = useRoute('/session/:id/:role');
  const roomId = params?.id || '';
  const role = (params?.role as 'artist' | 'engineer') || 'artist';
  
  const [userId] = useState(() => generateUserId());
  const [isSharing, setIsSharing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [copied, setCopied] = useState(false);
  
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  
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

  const {
    connected,
    participants,
    error,
    localStream,
    connect,
    disconnect,
    startSharing,
    stopSharing,
  } = useWebRTC({
    roomId,
    userId,
    role,
    onRemoteStream: handleRemoteStream,
  });

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

  const handleStartSharing = async () => {
    try {
      await startSharing();
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
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9,opus',
      audioBitsPerSecond: 320000,
    });
    
    chunksRef.current = [];
    
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
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

  const formatTime = (seconds: number) => {
    return new Date(seconds * 1000).toISOString().substr(11, 8);
  };

  const artistCount = participants.filter(p => p.role === 'artist').length + (role === 'artist' ? 1 : 0);
  const engineerCount = participants.filter(p => p.role === 'engineer').length + (role === 'engineer' ? 1 : 0);

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col gap-6 max-w-7xl mx-auto">
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
              You are the <span className={`font-bold ${role === 'artist' ? 'text-secondary' : 'text-primary'}`}>{role.toUpperCase()}</span>
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
          
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5">
            <Users size={16} />
            <span className="text-sm">{artistCount}A / {engineerCount}E</span>
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        {/* Video/Stream Area */}
        <div className="lg:col-span-2 glass-panel rounded-2xl p-6 flex flex-col gap-4 min-h-[500px]">
          <div className="flex-1 rounded-xl overflow-hidden bg-black/50 relative">
            {role === 'artist' ? (
              // Artist sees their own screen share preview
              isSharing ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-4">
                  <Monitor size={64} className="opacity-30" />
                  <p className="font-tech">Click "Start Sharing" to broadcast your screen</p>
                </div>
              )
            ) : (
              // Engineer sees remote stream
              <>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain"
                />
                {participants.filter(p => p.role === 'artist').length === 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-4 bg-black/80">
                    <Radio size={64} className="opacity-30" />
                    <p className="font-tech">Waiting for artist to connect and share...</p>
                    <p className="text-sm opacity-50">Share this room code with the artist: <span className="text-primary font-mono">{roomId}</span></p>
                  </div>
                )}
              </>
            )}
            
            {/* Scanline overlay */}
            <div className="absolute inset-0 pointer-events-none opacity-10 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-10" style={{backgroundSize: "100% 2px, 3px 100%"}} />
          </div>

          {/* Controls */}
          <div className="flex flex-wrap gap-4 items-center justify-between">
            {role === 'artist' ? (
              <div className="flex gap-3">
                {!isSharing ? (
                  <button
                    onClick={handleStartSharing}
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-background font-bold flex items-center gap-2 hover:brightness-110 transition-all"
                  >
                    <Video size={20} /> Start Sharing
                  </button>
                ) : (
                  <button
                    onClick={handleStopSharing}
                    className="px-6 py-3 rounded-xl bg-destructive text-white font-bold flex items-center gap-2 hover:bg-destructive/90 transition-all"
                  >
                    <VideoOff size={20} /> Stop Sharing
                  </button>
                )}
              </div>
            ) : (
              <div className="flex gap-3 items-center">
                {!recordedBlob ? (
                  !isRecording ? (
                    <button
                      onClick={startRecordingSession}
                      disabled={participants.filter(p => p.role === 'artist').length === 0}
                      className="px-6 py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-white font-bold flex items-center gap-2 hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Disc className="animate-pulse" size={20} /> Start Recording
                    </button>
                  ) : (
                    <button
                      onClick={stopRecordingSession}
                      className="px-6 py-3 rounded-xl bg-destructive text-white font-bold flex items-center gap-2 hover:bg-destructive/90 transition-all"
                    >
                      <Square fill="currentColor" size={20} /> Stop Recording
                    </button>
                  )
                ) : (
                  <div className="flex gap-3">
                    <button
                      onClick={handleDownload}
                      className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 flex items-center gap-2 transition-colors"
                    >
                      <Download size={18} /> Download
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={uploadMutation.isPending}
                      className="px-6 py-3 rounded-xl bg-secondary text-white font-bold flex items-center gap-2 hover:bg-secondary/90 transition-all disabled:opacity-50"
                    >
                      {uploadMutation.isPending ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Save size={18} />
                      )}
                      Save to Cloud
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
              <div className={`flex items-center gap-3 p-3 rounded-lg ${role === 'artist' ? 'bg-secondary/20 border border-secondary/30' : 'bg-primary/20 border border-primary/30'}`}>
                <div className={`w-3 h-3 rounded-full ${role === 'artist' ? 'bg-secondary' : 'bg-primary'} shadow-lg`} />
                <span className="font-tech text-sm">You ({role})</span>
                {role === 'artist' && isSharing && (
                  <span className="ml-auto text-xs text-green-400 flex items-center gap-1">
                    <Radio size={12} /> Live
                  </span>
                )}
              </div>
              
              {/* Others */}
              {participants.map(p => (
                <div 
                  key={p.userId}
                  className={`flex items-center gap-3 p-3 rounded-lg ${p.role === 'artist' ? 'bg-secondary/10 border border-secondary/20' : 'bg-primary/10 border border-primary/20'}`}
                >
                  <div className={`w-3 h-3 rounded-full ${p.role === 'artist' ? 'bg-secondary' : 'bg-primary'}`} />
                  <span className="font-tech text-sm">{p.role}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Audio Visualizer (Engineer) */}
          {role === 'engineer' && (
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
            {role === 'artist' ? (
              <>
                <p><strong>Artist Instructions:</strong></p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Click "Start Sharing"</li>
                  <li>Select your DAW window or entire screen</li>
                  <li>Check "Share System Audio"</li>
                  <li>Your engineer will see and hear everything</li>
                </ol>
              </>
            ) : (
              <>
                <p><strong>Engineer Instructions:</strong></p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Share the room code with your artist</li>
                  <li>Wait for them to connect and share</li>
                  <li>Click "Start Recording" when ready</li>
                  <li>Download or save to cloud when done</li>
                </ol>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
