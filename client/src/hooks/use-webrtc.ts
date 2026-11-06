import { useState, useRef, useCallback, useEffect } from 'react';
import type { SessionRole } from '@shared/schema';
import { PollingTransport } from '@/lib/polling-transport';
import { createRemoteControlLifetime } from '@/lib/remote-control-lifetime.js';
import { getIdentifiedCaptureSurface, shouldPublishCaptureState } from '@/lib/capture-state.js';

type SignalingTransport = WebSocket | PollingTransport;

// Storage key for audio device selection (must match AudioDeviceSelector)
const STORAGE_KEY_INPUT = 'virtualstudio-audio-input';

// Get the selected input device from localStorage
function getSelectedInputDevice(): string | undefined {
  const saved = localStorage.getItem(STORAGE_KEY_INPUT);
  return saved || undefined;
}

function isTransportOpen(transport: SignalingTransport | null): boolean {
  if (!transport) return false;
  return transport.readyState === WebSocket.OPEN || transport.readyState === PollingTransport.OPEN;
}

// Enhance audio quality in SDP by setting maximum Opus bitrate for studio recording
// This modifies the SDP to request maximum-quality audio
function enhanceAudioQuality(sdp: string): string {
  // Find the Opus codec line and add maximum quality parameters
  // maxaveragebitrate: 510000 (510kbps - maximum for Opus stereo)
  // stereo: 1 (enable stereo)
  // sprop-stereo: 1 (sender supports stereo)
  // maxplaybackrate: 48000 (48kHz sample rate - CD quality)
  // cbr: 1 (CONSTANT bitrate - prevents quality drops)
  // useinbandfec: 1 (forward error correction)
  const lines = sdp.split('\r\n');
  const enhancedLines = lines.map(line => {
    if (line.startsWith('a=fmtp:') && line.includes('opus')) {
      // Add maximum quality parameters to existing Opus fmtp line
      if (!line.includes('maxaveragebitrate')) {
        return line + ';maxaveragebitrate=510000;stereo=1;sprop-stereo=1;maxplaybackrate=48000;cbr=1;useinbandfec=1';
      }
    }
    return line;
  });
  return enhancedLines.join('\r\n');
}

// Optimize senders for low latency streaming
async function optimizeSendersForLowLatency(pc: RTCPeerConnection): Promise<void> {
  const senders = pc.getSenders();
  for (const sender of senders) {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    
    if (sender.track?.kind === 'video') {
      // Desktop text needs resolution more than high frame rates. Under congestion
      // let the browser reduce frame rate before making controls unreadable.
      params.degradationPreference = 'maintain-resolution';
      params.encodings[0].maxBitrate = 16000000; // Upper bound, not reserved bandwidth
      (params.encodings[0] as any).priority = 'high';
      (params.encodings[0] as any).networkPriority = 'high';
      try {
        await sender.setParameters(params);
        console.log('[WebRTC] Video sender optimized for low latency');
      } catch (e) {
        console.warn('[WebRTC] Could not optimize video sender:', e);
      }
    } else if (sender.track?.kind === 'audio') {
      // Audio optimizations
      params.encodings[0].maxBitrate = 510000;
      (params.encodings[0] as any).minBitrate = 256000;
      (params.encodings[0] as any).priority = 'high';
      (params.encodings[0] as any).networkPriority = 'high';
      try {
        await sender.setParameters(params);
        console.log('[WebRTC] Audio sender optimized for low latency');
      } catch (e) {
        console.warn('[WebRTC] Could not optimize audio sender:', e);
      }
    }
  }
}

// Lock audio sender bitrate to prevent WebRTC adaptive quality reduction
async function lockAudioBitrate(pc: RTCPeerConnection): Promise<void> {
  const senders = pc.getSenders();
  for (const sender of senders) {
    if (sender.track?.kind === 'audio') {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      // Set min and max bitrate to same value for constant quality
      // 510kbps is maximum for Opus stereo
      params.encodings[0].maxBitrate = 510000;
      // Some browsers support minBitrate (non-standard but helps)
      (params.encodings[0] as any).minBitrate = 256000;
      // Disable network adaptation
      (params.encodings[0] as any).networkPriority = 'high';
      (params.encodings[0] as any).priority = 'high';
      try {
        await sender.setParameters(params);
        console.log('[WebRTC] Audio bitrate locked at 510kbps');
      } catch (e) {
        console.warn('[WebRTC] Could not lock audio bitrate:', e);
      }
    }
  }
}

interface Participant {
  userId: string;
  role: SessionRole;
}

interface RemoteControlEvent {
  type: 'click' | 'move' | 'pointer';
  x: number; // 0-1 normalized coordinates
  y: number;
  fromUserId: string;
  fromRole: SessionRole;
}

interface AgentStatus {
  connected: boolean;
  controlAllowed: boolean;
  controlPending: boolean;
  controlMode?: 'alignment' | 'full' | null;
  screenWidth?: number;
  screenHeight?: number;
  scaleFactor?: number;
  displayControlSupported?: boolean;
  displayControlReason?: string | null;
  controlCalibrationRequired?: boolean;
  agentVersion?: string | null;
}

interface RemoteStreamInfo {
  stream: MediaStream;
  fromUserId: string;
  fromRole: SessionRole;
  hasVideo: boolean;
}

interface UseWebRTCOptions {
  roomId: string;
  userId: string;
  role: SessionRole;
  onRemoteStream?: (stream: MediaStream) => void;
  onRemoteStreamWithInfo?: (info: RemoteStreamInfo) => void;
  onRemoteControl?: (event: RemoteControlEvent) => void;
  onAgentStatus?: (status: AgentStatus) => void;
}

export function useWebRTC({ roomId, userId, role, onRemoteStream, onRemoteStreamWithInfo, onRemoteControl, onAgentStatus }: UseWebRTCOptions) {
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, RemoteStreamInfo>>(new Map());
  const [agentConnected, setAgentConnected] = useState(false);
  const [controlAllowed, setControlAllowedState] = useState(false);
  const [controlMode, setControlMode] = useState<'alignment' | 'full' | null>(null);
  const controlLifetimeRef = useRef<ReturnType<typeof createRemoteControlLifetime> | null>(null);
  if (!controlLifetimeRef.current) controlLifetimeRef.current = createRemoteControlLifetime();
  const controlLifetime = controlLifetimeRef.current;
  const lastMouseMoveRef = useRef<number>(0);
  const pendingMouseMoveRef = useRef<{x: number, y: number} | null>(null);
  const mouseMoveQueuedRef = useRef(false);
  // Update authorization synchronously, before React renders or effects run.
  const setControlAllowed = useCallback((allowed: boolean) => {
    controlLifetime.setAllowed(allowed);
    if (!allowed) {
      pendingMouseMoveRef.current = null;
      mouseMoveQueuedRef.current = false;
      lastMouseMoveRef.current = 0;
    }
    setControlAllowedState(allowed);
    if (!allowed) setControlMode(null);
  }, [controlLifetime]);
  const [controlPending, setControlPending] = useState(false);
  // Audio confirmations: Map of broadcasterUserId -> Set of confirming userIds
  const [audioConfirmations, setAudioConfirmations] = useState<Map<string, Set<string>>>(new Map());

  const wsRef = useRef<SignalingTransport | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const maxRetries = 3; // Reduced retries before fallback
  const usingPollingRef = useRef(false);
  // Map of peer connections: userId -> RTCPeerConnection
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Map of data channels: userId -> RTCDataChannel
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());
  // Queue for ICE candidates that arrive before remote description is set
  const iceCandidateQueueRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const onRemoteControlRef = useRef(onRemoteControl);
  const onRemoteStreamWithInfoRef = useRef(onRemoteStreamWithInfo);
  const participantsRef = useRef<Participant[]>([]);
  
  const onAgentStatusRef = useRef(onAgentStatus);
  
  // Keep refs updated
  useEffect(() => {
    onRemoteControlRef.current = onRemoteControl;
  }, [onRemoteControl]);
  
  useEffect(() => {
    onRemoteStreamWithInfoRef.current = onRemoteStreamWithInfo;
  }, [onRemoteStreamWithInfo]);
  
  useEffect(() => {
    onAgentStatusRef.current = onAgentStatus;
  }, [onAgentStatus]);
  
  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);
  
  // Notify parent of agent status changes
  const [agentScreenInfo, setAgentScreenInfo] = useState<Pick<AgentStatus,
    'screenWidth' | 'screenHeight' | 'scaleFactor' | 'displayControlSupported' |
    'displayControlReason' | 'controlCalibrationRequired' | 'agentVersion'>>({});
  const [captureSupported, setCaptureSupported] = useState(false);
  const [signalingJoined, setSignalingJoined] = useState(false);
  useEffect(() => {
    onAgentStatusRef.current?.({
      connected: agentConnected,
      controlAllowed,
      controlPending,
      controlMode,
      ...agentScreenInfo,
    });
  }, [agentConnected, controlAllowed, controlPending, controlMode, agentScreenInfo]);

  // Only an identified, live entire-screen capture can enable desktop input.
  // Never infer the selected display from its label or encoded video dimensions.
  const captureIdsRef = useRef(new WeakMap<MediaStreamTrack, string>());
  const captureSequenceRef = useRef(0);
  useEffect(() => {
    const transport = wsRef.current;
    if (!transport || !shouldPublishCaptureState({
      role,
      signalingJoined,
      transportOpen: isTransportOpen(transport),
    })) return;
    const track = localStream?.getVideoTracks()[0];
    if (track && !captureIdsRef.current.has(track)) {
      captureIdsRef.current.set(track, crypto.randomUUID());
    }
    const publish = (stopped = false) => {
      if (isTransportOpen(transport)) {
        transport.send(JSON.stringify({
          type: 'capture-state', roomId, userId, role,
          payload: {
            surface: getIdentifiedCaptureSurface(track, stopped),
            captureId: track ? captureIdsRef.current.get(track) : null,
            sequence: ++captureSequenceRef.current,
          },
        }));
      }
    };
    const onChange = () => publish();
    publish();
    track?.addEventListener('ended', onChange);
    track?.addEventListener('mute', onChange);
    track?.addEventListener('unmute', onChange);
    return () => {
      publish(true);
      track?.removeEventListener('ended', onChange);
      track?.removeEventListener('mute', onChange);
      track?.removeEventListener('unmute', onChange);
    };
  }, [localStream, signalingJoined, agentConnected, role, roomId, userId]);

  // Multiple STUN and TURN servers for NAT traversal
  // TURN servers are required when both parties are behind symmetric NAT
  const iceServers = [
    // Google STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // Free TURN servers from Open Relay Project (metered.ca)
    {
      urls: 'turn:a.relay.metered.ca:80',
      username: 'e8dd65d92ae1c65e22aadb74',
      credential: 'kAJMvLMx8DgYKvhR',
    },
    {
      urls: 'turn:a.relay.metered.ca:80?transport=tcp',
      username: 'e8dd65d92ae1c65e22aadb74',
      credential: 'kAJMvLMx8DgYKvhR',
    },
    {
      urls: 'turn:a.relay.metered.ca:443',
      username: 'e8dd65d92ae1c65e22aadb74',
      credential: 'kAJMvLMx8DgYKvhR',
    },
    {
      urls: 'turns:a.relay.metered.ca:443',
      username: 'e8dd65d92ae1c65e22aadb74',
      credential: 'kAJMvLMx8DgYKvhR',
    },
  ];

  const createPeerConnection = useCallback((targetUserId: string) => {
    // Close existing connection for this peer if any
    const existingPc = peerConnectionsRef.current.get(targetUserId);
    if (existingPc) {
      existingPc.close();
      peerConnectionsRef.current.delete(targetUserId);
    }

    const pc = new RTCPeerConnection({ 
      iceServers,
      iceCandidatePoolSize: 10,
      // Bundle all media onto a single connection for faster setup
      bundlePolicy: 'max-bundle',
      // Require RTCP multiplexing to reduce ports and connection time
      rtcpMuxPolicy: 'require',
    });

    // Monitor ICE connection state for stability
    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE connection state for', targetUserId, ':', pc.iceConnectionState);
      
      // If ICE fails, try to restart it
      if (pc.iceConnectionState === 'failed') {
        console.log('[WebRTC] ICE failed, attempting restart...');
        pc.restartIce();
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && isTransportOpen(wsRef.current)) {
        console.log('[WebRTC] Sending ICE candidate to', targetUserId, ':', event.candidate.candidate?.substring(0, 50) + '...');
        wsRef.current!.send(JSON.stringify({
          type: 'ice-candidate',
          roomId,
          userId,
          role,
          payload: { 
            candidate: event.candidate,
            targetUserId 
          }
        }));
      } else if (event.candidate === null) {
        console.log('[WebRTC] ICE gathering complete for', targetUserId);
      }
    };
    
    pc.onicegatheringstatechange = () => {
      console.log('[WebRTC] ICE gathering state for', targetUserId, ':', pc.iceGatheringState);
    };

    pc.ontrack = (event) => {
      console.log('[WebRTC] ontrack event received from', targetUserId, 'tracks:', event.track.kind, 'streams:', event.streams.length);
      if (event.streams[0]) {
        const stream = event.streams[0];
        const hasVideo = stream.getVideoTracks().length > 0;
        console.log('[WebRTC] Stream received from', targetUserId, '- video tracks:', stream.getVideoTracks().length, ', audio tracks:', stream.getAudioTracks().length);
        
        // Find the sender's role from participants
        const senderParticipant = participantsRef.current.find(p => p.userId === targetUserId);
        const senderRole = senderParticipant?.role || 'other';
        
        // Create stream info
        const streamInfo: RemoteStreamInfo = {
          stream,
          fromUserId: targetUserId,
          fromRole: senderRole,
          hasVideo,
        };
        
        // Add to remote streams map
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.set(targetUserId, streamInfo);
          return next;
        });
        setHasRemoteStream(true);
        
        // Call legacy callback for backwards compatibility (artist stream)
        if (onRemoteStream && senderRole === 'artist') {
          onRemoteStream(stream);
        }
        
        // Call new callback with full info
        if (onRemoteStreamWithInfoRef.current) {
          onRemoteStreamWithInfoRef.current(streamInfo);
        }
        
        // Listen for track ending - VERY conservative about removing streams
        // Only remove if we're absolutely certain the artist stopped sharing
        stream.getTracks().forEach(track => {
          track.onended = () => {
            console.log('[WebRTC] Track ended from', targetUserId, '- waiting extended time to verify...');
            
            // Wait a LONG time before checking - tracks might come back after network issues
            setTimeout(() => {
              // Check if all tracks in this stream have ended
              const allEnded = stream.getTracks().every(t => t.readyState === 'ended');
              if (allEnded) {
                // Triple-check: connection must be completely dead for a while
                const pc = peerConnectionsRef.current.get(targetUserId);
                const connectionDead = !pc || pc.connectionState === 'closed';
                
                // Only remove if connection is completely closed (not just failed/disconnected)
                if (connectionDead) {
                  console.log('[WebRTC] All tracks ended and connection closed for', targetUserId, '- removing stream');
                  setRemoteStreams(prev => {
                    const next = new Map(prev);
                    next.delete(targetUserId);
                    if (next.size === 0) {
                      setHasRemoteStream(false);
                    }
                    return next;
                  });
                } else {
                  console.log('[WebRTC] Tracks ended but connection still exists - keeping stream, will retry ICE');
                  // Try one more ICE restart
                  try {
                    pc?.restartIce();
                  } catch (e) {
                    console.log('[WebRTC] ICE restart attempt failed:', e);
                  }
                }
              }
            }, 15000); // Wait 15 seconds before removing - maximum patience
          };
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('[WebRTC] Connection state changed for', targetUserId, ':', state);
      
      const states = Array.from(peerConnectionsRef.current.values()).map(p => p.connectionState);
      const hasConnected = states.some(s => s === 'connected');
      setConnected(hasConnected);
      
      // Handle disconnected state - aggressively try ICE restart to recover
      if (state === 'disconnected') {
        console.log('[WebRTC] Connection disconnected, attempting ICE restart...');
        // Try ICE restart immediately
        try {
          pc.restartIce();
        } catch (e) {
          console.log('[WebRTC] Immediate ICE restart failed:', e);
        }
        
        // Also try again after delay if still disconnected
        setTimeout(() => {
          const currentPc = peerConnectionsRef.current.get(targetUserId);
          if (currentPc && (currentPc.connectionState === 'disconnected' || currentPc.connectionState === 'failed')) {
            console.log('[WebRTC] Still disconnected after 3s, retrying ICE restart');
            try {
              currentPc.restartIce();
            } catch (e) {
              console.log('[WebRTC] ICE restart retry failed:', e);
            }
          }
        }, 3000);
        
        // Third attempt after longer delay
        setTimeout(() => {
          const currentPc = peerConnectionsRef.current.get(targetUserId);
          if (currentPc && (currentPc.connectionState === 'disconnected' || currentPc.connectionState === 'failed')) {
            console.log('[WebRTC] Still disconnected after 10s, final ICE restart attempt');
            try {
              currentPc.restartIce();
            } catch (e) {
              console.log('[WebRTC] Final ICE restart failed:', e);
            }
          }
        }, 10000);
      }
      
      // Connection failed - try multiple recovery attempts, NEVER auto-remove streams
      if (state === 'failed') {
        console.log('[WebRTC] Connection failed for', targetUserId, '- attempting aggressive recovery');
        
        // Try ICE restart immediately
        try {
          pc.restartIce();
        } catch (e) {
          console.log('[WebRTC] ICE restart on failure failed:', e);
        }
        
        // Keep trying every 5 seconds for up to 30 seconds
        [5000, 10000, 15000, 20000, 25000, 30000].forEach(delay => {
          setTimeout(() => {
            const currentPc = peerConnectionsRef.current.get(targetUserId);
            if (currentPc && currentPc.connectionState === 'failed') {
              console.log(`[WebRTC] Connection still failed after ${delay}ms, attempting ICE restart`);
              try {
                currentPc.restartIce();
              } catch (e) {
                console.log('[WebRTC] ICE restart attempt failed:', e);
              }
            }
          }, delay);
        });
        
        // NEVER auto-remove streams on connection failure
        // Only remove when we receive explicit user-left from server
        console.log('[WebRTC] Keeping stream despite connection failure - waiting for explicit disconnect');
      }
    };

    // Handle incoming data channel (for artist receiving control events)
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      // Store the userId this channel is associated with for validation
      (channel as any)._senderUserId = targetUserId;
      
      channel.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as RemoteControlEvent;
          const senderUserId = (channel as any)._senderUserId;
          
          // Validate sender role against known participants (use ref for current state)
          const currentParticipants = participantsRef.current;
          const senderParticipant = currentParticipants.find(p => p.userId === senderUserId);
          
          // Only accept control events from engineers - prioritize known participant role
          const isEngineer = senderParticipant?.role === 'engineer';
          
          if (isEngineer && onRemoteControlRef.current) {
            onRemoteControlRef.current(data);
          }
        } catch (err) {
          console.error('Error parsing data channel message:', err);
        }
      };
      dataChannelsRef.current.set(targetUserId, channel);
    };

    peerConnectionsRef.current.set(targetUserId, pc);
    return pc;
  }, [roomId, userId, role, onRemoteStream]);

  const closePeerConnection = useCallback((targetUserId: string) => {
    const pc = peerConnectionsRef.current.get(targetUserId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(targetUserId);
    }
  }, []);

  const closeAllPeerConnections = useCallback(() => {
    peerConnectionsRef.current.forEach((pc) => {
      pc.close();
    });
    peerConnectionsRef.current.clear();
    setConnected(false);
    setHasRemoteStream(false);
  }, []);

  const sendOfferToViewer = useCallback(async (viewerUserId: string) => {
    if (!localStreamRef.current || !wsRef.current) return;
    
    const pc = createPeerConnection(viewerUserId);
    localStreamRef.current.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current!);
    });
    
    // Optimize for low latency (both audio and video)
    await optimizeSendersForLowLatency(pc);
    
    const offer = await pc.createOffer();
    // Enhance audio quality in the offer
    const enhancedOffer = new RTCSessionDescription({
      type: offer.type,
      sdp: enhanceAudioQuality(offer.sdp || '')
    });
    await pc.setLocalDescription(enhancedOffer);
    
    wsRef.current.send(JSON.stringify({
      type: 'offer',
      roomId,
      userId,
      role,
      payload: { 
        sdp: { type: enhancedOffer.type, sdp: enhancedOffer.sdp },
        targetUserId: viewerUserId 
      }
    }));
  }, [roomId, userId, role, createPeerConnection]);

  const handleSignalingMessage = useCallback(async (data: string) => {
    const message = JSON.parse(data);
    console.log('[WebRTC] Received signaling message:', message.type, 'from:', message.userId || 'server');

    switch (message.type) {
      case 'room-state': {
        setSignalingJoined(true);
        setParticipants(message.participants || []);
        
        // Set agent status from room state (WebSocket initial join)
        if (message.agentConnected !== undefined) {
          setAgentConnected(message.agentConnected);
        }
        if (message.controlActive !== undefined) {
          setControlAllowed(message.controlActive);
          setControlMode(message.controlActive
            ? (message.controlMode === 'alignment' ? 'alignment' : 'full')
            : null);
        }
        
        const canBroadcast = role === 'artist' || role === 'engineer' || role === 'producer';
        if (canBroadcast && localStreamRef.current) {
          const viewers = (message.participants || []).filter((p: Participant) => p.userId !== userId);
          for (const viewer of viewers) {
            await sendOfferToViewer(viewer.userId);
          }
        }
        break;
      }

      case 'user-joined': {
        setParticipants(prev => {
          if (prev.some(p => p.userId === message.userId)) return prev;
          return [...prev, { userId: message.userId, role: message.role }];
        });
        
        const canBroadcast = role === 'artist' || role === 'engineer' || role === 'producer';
        if (canBroadcast && message.userId !== userId && localStreamRef.current) {
          await sendOfferToViewer(message.userId);
        }
        break;
      }

      case 'user-left': {
        const leftUserId = message.userId;
        setParticipants(prev => prev.filter(p => p.userId !== leftUserId));
        
        // MAXIMUM PATIENCE: Don't remove streams quickly - user might reconnect
        // Wait a very long time and verify multiple times before removing
        console.log('[WebRTC] User left signal for', leftUserId, '- waiting extended time before cleanup');
        
        // First check after 10 seconds
        setTimeout(() => {
          const pc = peerConnectionsRef.current.get(leftUserId);
          
          // Check if user rejoined (would be in participants list)
          const userRejoined = participantsRef.current.some(p => p.userId === leftUserId);
          if (userRejoined) {
            console.log('[WebRTC] User', leftUserId, 'rejoined - keeping stream');
            return;
          }
          
          // Only close if connection is completely closed
          if (!pc || pc.connectionState === 'closed') {
            console.log('[WebRTC] User', leftUserId, 'confirmed gone after 10s - cleaning up');
            closePeerConnection(leftUserId);
            setRemoteStreams(prev => {
              const next = new Map(prev);
              next.delete(leftUserId);
              if (next.size === 0) {
                setHasRemoteStream(false);
              }
              return next;
            });
          } else {
            console.log('[WebRTC] User left but peer connection still active (state:', pc.connectionState, ') - keeping stream');
            
            // Final check after 30 seconds total
            setTimeout(() => {
              const finalPc = peerConnectionsRef.current.get(leftUserId);
              const stillRejoined = participantsRef.current.some(p => p.userId === leftUserId);
              
              if (stillRejoined) {
                console.log('[WebRTC] User', leftUserId, 'confirmed active - keeping stream');
                return;
              }
              
              if (!finalPc || finalPc.connectionState === 'closed' || finalPc.connectionState === 'failed') {
                console.log('[WebRTC] Final check: user', leftUserId, 'gone - cleaning up');
                closePeerConnection(leftUserId);
                setRemoteStreams(prev => {
                  const next = new Map(prev);
                  next.delete(leftUserId);
                  if (next.size === 0) {
                    setHasRemoteStream(false);
                  }
                  return next;
                });
              } else {
                console.log('[WebRTC] Connection still alive after 30s - stream preserved');
              }
            }, 20000); // Additional 20 seconds (30s total)
          }
        }, 10000); // Wait 10 seconds before first check
        break;
      }

      case 'offer': {
        console.log('[WebRTC] Received offer from', message.userId, '- my role:', role, 'my userId:', userId);
        console.log('[WebRTC] Offer payload:', message.payload ? 'present' : 'missing', 'sdp type:', message.payload?.sdp?.type);
        if (message.userId !== userId) {
          const pc = createPeerConnection(message.userId);
          
          if (role === 'engineer' || role === 'producer' || role === 'other') {
            const dataChannel = pc.createDataChannel('control', { ordered: true });
            dataChannel.onopen = () => {
              console.log('[WebRTC] Control data channel opened');
            };
            dataChannelsRef.current.set(message.userId, dataChannel);
          }
          
          console.log('[WebRTC] Setting remote description from offer...');
          await pc.setRemoteDescription(new RTCSessionDescription(message.payload.sdp));
          
          // Process any queued ICE candidates for this peer
          const queuedCandidates = iceCandidateQueueRef.current.get(message.userId) || [];
          if (queuedCandidates.length > 0) {
            console.log('[WebRTC] Processing', queuedCandidates.length, 'queued ICE candidates for', message.userId);
            for (const candidate of queuedCandidates) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {
                console.error('[WebRTC] Error adding queued ICE candidate:', e);
              }
            }
            iceCandidateQueueRef.current.delete(message.userId);
          }
          
          console.log('[WebRTC] Creating answer...');
          const answer = await pc.createAnswer();
          // Enhance audio quality in the answer
          const enhancedAnswer = new RTCSessionDescription({
            type: answer.type,
            sdp: enhanceAudioQuality(answer.sdp || '')
          });
          await pc.setLocalDescription(enhancedAnswer);
          console.log('[WebRTC] Answer created and set as local description');
          
          wsRef.current?.send(JSON.stringify({
            type: 'answer',
            roomId,
            userId,
            role,
            payload: { 
              sdp: { type: enhancedAnswer.type, sdp: enhancedAnswer.sdp },
              targetUserId: message.userId 
            }
          }));
        }
        break;
      }

      case 'answer': {
        console.log('[WebRTC] Received answer from', message.userId);
        const pc = peerConnectionsRef.current.get(message.userId);
        if (pc) {
          console.log('[WebRTC] Setting remote description from answer...');
          await pc.setRemoteDescription(new RTCSessionDescription(message.payload.sdp));
          console.log('[WebRTC] Remote description set from answer');
          
          // Process any queued ICE candidates
          const queuedCandidates = iceCandidateQueueRef.current.get(message.userId) || [];
          if (queuedCandidates.length > 0) {
            console.log('[WebRTC] Processing', queuedCandidates.length, 'queued ICE candidates for', message.userId);
            for (const candidate of queuedCandidates) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {
                console.error('[WebRTC] Error adding queued ICE candidate:', e);
              }
            }
            iceCandidateQueueRef.current.delete(message.userId);
          }
        } else {
          console.log('[WebRTC] No peer connection found for answer from', message.userId);
        }
        break;
      }

      case 'ice-candidate': {
        console.log('[WebRTC] Received ICE candidate from', message.userId);
        const pc = peerConnectionsRef.current.get(message.userId);
        if (pc && message.payload.candidate) {
          // Check if remote description is set
          if (pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(message.payload.candidate));
              console.log('[WebRTC] Added ICE candidate from', message.userId);
            } catch (e) {
              console.error('[WebRTC] Error adding ICE candidate:', e);
            }
          } else {
            // Queue the candidate for later
            console.log('[WebRTC] Queuing ICE candidate (no remote description yet) from', message.userId);
            const queue = iceCandidateQueueRef.current.get(message.userId) || [];
            queue.push(message.payload.candidate);
            iceCandidateQueueRef.current.set(message.userId, queue);
          }
        } else {
          console.log('[WebRTC] Skipped ICE candidate - no peer connection for', message.userId);
        }
        break;
      }

      case 'error': {
        setError(message.payload?.message || 'Connection error');
        break;
      }
      
      case 'agent-connected': {
        setAgentConnected(true);
        break;
      }
      case 'capture-status': {
        setCaptureSupported(message.supported === true);
        if (message.supported !== true) {
          setControlAllowed(false);
          setControlPending(false);
        }
        break;
      }
      
      case 'agent-screen-info': {
        // Use the status effect so a geometry update retains current control state.
        setAgentScreenInfo({
          screenWidth: message.screenWidth,
          screenHeight: message.screenHeight,
          scaleFactor: message.scaleFactor,
          displayControlSupported: message.displayControlSupported === true,
          displayControlReason: message.displayControlReason,
          controlCalibrationRequired: message.controlCalibrationRequired === true,
          agentVersion: message.agentVersion,
        });
        break;
      }
      
      case 'agent-disconnected': {
        setAgentConnected(false);
        setControlAllowed(false);
        setControlPending(false);
        break;
      }
      
      case 'agent-status': {
        // Real-time agent status from polling
        setAgentConnected(message.connected);
        if (message.controlActive !== undefined || !message.connected) {
          setControlAllowed(message.connected === true && message.controlActive === true);
          setControlMode(message.connected === true && message.controlActive === true
            ? (message.controlMode === 'alignment' ? 'alignment' : 'full')
            : null);
        }
        if (message.controlActive || !message.connected) {
          setControlPending(false);
        }
        break;
      }
      
      case 'control-response': {
        setControlPending(false);
        setControlAllowed(message.allowed === true);
        setControlMode(message.allowed === true
          ? (message.mode === 'alignment' ? 'alignment' : 'full')
          : null);
        break;
      }
      
      case 'control-stopped': {
        setControlAllowed(false);
        break;
      }
      
      case 'audio-confirmed': {
        // Someone confirmed they can hear a broadcaster's audio
        const { confirmerId, confirmerRole, broadcasterId } = message.payload;
        setAudioConfirmations(prev => {
          const next = new Map(prev);
          const confirmers = next.get(broadcasterId) || new Set();
          confirmers.add(confirmerId);
          next.set(broadcasterId, confirmers);
          return next;
        });
        break;
      }
      
      case 'audio-unconfirmed': {
        // Someone muted or left - remove their confirmation
        const { confirmerId, broadcasterId } = message.payload;
        setAudioConfirmations(prev => {
          const next = new Map(prev);
          const confirmers = next.get(broadcasterId);
          if (confirmers) {
            confirmers.delete(confirmerId);
            if (confirmers.size === 0) {
              next.delete(broadcasterId);
            } else {
              next.set(broadcasterId, confirmers);
            }
          }
          return next;
        });
        break;
      }
    }
  }, [roomId, userId, role, createPeerConnection, closePeerConnection, sendOfferToViewer]);

  const connectWithPolling = useCallback(() => {
    setControlAllowed(false);
    setSignalingJoined(false);
    console.log('[Polling] Switching to HTTP polling fallback');
    usingPollingRef.current = true;
    setError('Using backup connection...');
    
    const transport = new PollingTransport();
    wsRef.current = transport;
    
    transport.onopen = () => {
      console.log('[Polling] Connected successfully');
      retryCountRef.current = 0;
      setError(null);
      transport.send(JSON.stringify({
        type: 'join',
        roomId: roomId.toUpperCase(),
        userId,
        role
      }));
    };
    
    transport.onmessage = async (event) => {
      if (wsRef.current !== transport || !isTransportOpen(transport)) return;
      handleSignalingMessage(event.data);
    };
    
    transport.onerror = () => {
      console.error('[Polling] Error');
      setError('Connection error. Please refresh.');
    };
    
    transport.onclose = () => {
      if (wsRef.current !== transport) return;
      setControlAllowed(false);
      setSignalingJoined(false);
      console.log('[Polling] Closed');
      closeAllPeerConnections();
      setConnected(false);
    };
    
    transport.connect();
  }, [roomId, userId, role, closeAllPeerConnections, handleSignalingMessage]);

  const connect = useCallback(() => {
    setControlAllowed(false);
    setSignalingJoined(false);
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    // Retire a previous signaling transport without closing live P2P media.
    const previous = wsRef.current;
    wsRef.current = null;
    previous?.close();
    
    // If already using polling, continue with it
    if (usingPollingRef.current) {
      connectWithPolling();
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    console.log('[WebSocket] Connecting to:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    let failed = false;
    let joined = false;
    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    let joinTimer: ReturnType<typeof setTimeout> | null = null;
    const clearSocketTimers = () => {
      if (joinTimer) clearTimeout(joinTimer);
      if (stableTimer) clearTimeout(stableTimer);
      joinTimer = stableTimer = null;
    };
    const retireSocket = () => {
      clearSocketTimers();
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      if (wsRef.current === ws) wsRef.current = null;
      ws.close();
    };
    const retryOrFallback = () => {
      if (wsRef.current !== ws || failed) return;
      failed = true; // error and close represent one failed attempt, not two.
      setControlAllowed(false);
      setSignalingJoined(false);
      setConnected(false);
      retireSocket();
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 5000);
        setError(`Connecting... (attempt ${retryCountRef.current}/${maxRetries})`);
        retryTimeoutRef.current = setTimeout(() => connect(), delay);
      } else {
        console.log('[WebSocket] Connection could not stay joined; switching to HTTP polling');
        connectWithPolling();
      }
    };
    // A TCP/WebSocket open without a room-state response is not a joined room.
    joinTimer = setTimeout(retryOrFallback, 8000);

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      console.log('[WebSocket] Open; joining room');
      ws.send(JSON.stringify({
        type: 'join',
        roomId: roomId.toUpperCase(),
        userId,
        role
      }));
    };

    ws.onmessage = async (event) => {
      if (wsRef.current !== ws || !isTransportOpen(ws)) return;
      const message = JSON.parse(event.data);
      if (message.type === 'room-state' && !joined) {
        joined = true;
        if (joinTimer) clearTimeout(joinTimer);
        joinTimer = null;
        setError(null);
        // A briefly open (or briefly joined) socket must not reset the failure
        // budget forever. Reset only after a stable joined connection.
        stableTimer = setTimeout(() => {
          if (wsRef.current === ws && isTransportOpen(ws)) retryCountRef.current = 0;
        }, 5000);
      }
      await handleSignalingMessage(event.data);
    };

    ws.onerror = (event) => {
      if (wsRef.current !== ws) return;
      console.error('[WebSocket] Connection error:', event);
      retryOrFallback();
    };
    
    ws.onclose = (event) => {
      if (wsRef.current !== ws) return;
      clearSocketTimers();
      setControlAllowed(false);
      setSignalingJoined(false);
      console.log('[WebSocket] Connection closed:', event.code, event.reason);
      // DON'T close peer connections on WebSocket close - keep video alive
      // The peer connections are direct P2P and don't need WebSocket once established
      setConnected(false);
      
      if (event.code !== 1000) retryOrFallback();
    };

    return () => {
      if (wsRef.current === ws && retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      retireSocket();
    };
  }, [roomId, userId, role, createPeerConnection, closePeerConnection, closeAllPeerConnections, connectWithPolling, handleSignalingMessage]);

  // Check if role can broadcast (artist, engineer, or producer)
  const canBroadcast = role === 'artist' || role === 'engineer' || role === 'producer';

  const startSharing = useCallback(async (audioOnly: boolean = false): Promise<{ hasSystemAudio: boolean; hasMicAudio: boolean }> => {
    // Only artist, engineer, and producer can share
    if (!canBroadcast) {
      setError('Only artists, engineers, and producers can share');
      return { hasSystemAudio: false, hasMicAudio: false };
    }

    try {
      let displayStream: MediaStream | null = null;
      let videoTrack: MediaStreamTrack | null = null;

      // Get screen with system audio - maximum quality settings
      if (!audioOnly) {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { 
            width: { ideal: 3840 },
            height: { ideal: 2160 },
            frameRate: { ideal: 30, max: 30 }
          },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 48000,
            sampleSize: 16,
            channelCount: 2,
          } as any,
          // An in-picker surface switch can change monitors without a new track.
          // Browsers that ignore this hint still cannot control multi-display setups.
          surfaceSwitching: 'exclude',
        } as DisplayMediaStreamOptions);
        videoTrack = displayStream.getVideoTracks()[0];
        if (videoTrack) videoTrack.contentHint = 'detail';
      } else {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 48000,
            sampleSize: 16,
            channelCount: 2,
          } as any
        });
        displayStream.getVideoTracks().forEach(t => t.stop());
      }

      // Get microphone with high quality - use selected device if available
      const selectedInputDevice = getSelectedInputDevice();
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedInputDevice ? { exact: selectedInputDevice } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 48000,
            sampleSize: 16,
            channelCount: 1,
          } as any
        });
      } catch (micErr) {
        console.log('[WebRTC] Selected mic failed, trying default:', micErr);
        // Fallback to any available mic
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
            }
          });
        } catch (fallbackErr) {
          console.log('[WebRTC] All mic access failed - continuing without mic:', fallbackErr);
          // Continue without mic - video still works
        }
      }

      // Mix audio using Web Audio API with high quality settings
      const audioContext = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = audioContext;
      const dest = audioContext.createMediaStreamDestination();

      // Track what audio sources we have
      const hasSystemAudio = displayStream && displayStream.getAudioTracks().length > 0;
      const hasMicAudio = micStream ? micStream.getAudioTracks().length > 0 : false;
      
      console.log('[WebRTC] Audio sources - System:', hasSystemAudio, 'Mic:', hasMicAudio);

      // Add system audio if available (from screen share)
      if (hasSystemAudio) {
        const sysSource = audioContext.createMediaStreamSource(displayStream);
        sysSource.connect(dest);
        console.log('[WebRTC] System audio connected to mix');
      }

      // Add mic audio
      if (hasMicAudio && micStream) {
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(dest);
        console.log('[WebRTC] Mic audio connected to mix');
      }

      // Create combined stream
      const audioTrack = dest.stream.getAudioTracks()[0];
      let combinedStream: MediaStream;
      
      if (videoTrack && !audioOnly) {
        // Video + audio (audio may be empty but that's ok)
        const tracks = [videoTrack];
        if (audioTrack) tracks.push(audioTrack);
        combinedStream = new MediaStream(tracks);
      } else if (audioTrack) {
        // Audio-only stream
        combinedStream = new MediaStream([audioTrack]);
      } else {
        // No audio and no video - this shouldn't happen but handle gracefully
        console.error('[WebRTC] No tracks available for stream');
        return { hasSystemAudio: false, hasMicAudio: false };
      }

      localStreamRef.current = combinedStream;
      setLocalStream(combinedStream);

      // Send offer to all other participants (not ourselves)
      // Use participantsRef.current to get the latest participants (avoid stale closure)
      const others = participantsRef.current.filter(p => p.userId !== userId);
      console.log('[WebRTC] Sending offers to', others.length, 'participants:', others.map(p => p.userId));
      for (const other of others) {
        const pc = createPeerConnection(other.userId);
        combinedStream.getTracks().forEach(track => {
          pc.addTrack(track, combinedStream);
        });
        
        // Optimize for low latency (both audio and video)
        await optimizeSendersForLowLatency(pc);

        const offer = await pc.createOffer();
        // Enhance audio quality in the offer
        const enhancedOffer = new RTCSessionDescription({
          type: offer.type,
          sdp: enhanceAudioQuality(offer.sdp || '')
        });
        await pc.setLocalDescription(enhancedOffer);
        
        wsRef.current?.send(JSON.stringify({
          type: 'offer',
          roomId,
          userId,
          role,
          payload: { 
            sdp: { type: enhancedOffer.type, sdp: enhancedOffer.sdp },
            targetUserId: other.userId 
          }
        }));
      }

      // Handle stop sharing when screen share ends
      if (videoTrack) {
        videoTrack.onended = () => {
          stopSharing();
        };
      }

      // Store streams for cleanup
      (combinedStream as any)._originalStreams = [displayStream, micStream].filter(Boolean);

      return { hasSystemAudio, hasMicAudio };
    } catch (err: any) {
      // Handle common screen share errors with friendly messages
      const errorMsg = err.message || '';
      if (errorMsg.includes('Permission denied') || errorMsg.includes('NotAllowedError')) {
        // User cancelled or system denied - don't show error, just silently fail
        console.log('Screen share cancelled or denied');
        return { hasSystemAudio: false, hasMicAudio: false };
      } else if (errorMsg.includes('NotFoundError') || errorMsg.includes('not found')) {
        setError('No screen or window available to share');
      } else if (errorMsg.includes('NotReadableError')) {
        setError('Screen is being used by another app - please close and try again');
      } else {
        setError(err.message || 'Failed to start sharing');
      }
      
      // Auto-clear error after 5 seconds
      setTimeout(() => setError(null), 5000);
      throw err;
    }
  }, [roomId, userId, role, createPeerConnection, canBroadcast]);

  const stopSharing = useCallback(() => {
    // Stop all tracks on local stream
    if (localStreamRef.current) {
      // Stop the combined stream tracks
      localStreamRef.current.getTracks().forEach(track => track.stop());
      
      // Stop original streams if stored
      const originalStreams = (localStreamRef.current as any)._originalStreams;
      if (originalStreams) {
        originalStreams.forEach((stream: MediaStream) => {
          stream.getTracks().forEach(track => track.stop());
        });
      }
      
      localStreamRef.current = null;
      setLocalStream(null);
    }
    
    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    // Close all peer connections
    closeAllPeerConnections();
  }, [closeAllPeerConnections]);

  // Mic-only streaming refs
  const micStreamRef = useRef<MediaStream | null>(null);
  const [isMicActive, setIsMicActive] = useState(false);

  // Start mic-only streaming (no screen share needed)
  const startMic = useCallback(async () => {
    try {
      // Get microphone with high quality - use selected device if available
      const selectedInputDevice = getSelectedInputDevice();
      let micStream: MediaStream;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedInputDevice ? { exact: selectedInputDevice } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 48000,
            sampleSize: 16,
            channelCount: 1,
          } as any
        });
      } catch (micErr) {
        console.log('[WebRTC] Selected mic failed, trying default:', micErr);
        // Fallback to any available mic
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          }
        });
      }

      micStreamRef.current = micStream;
      setIsMicActive(true);

      // If already sharing screen, add mic to existing connections
      if (localStreamRef.current) {
        // Mix mic into existing audio context
        if (audioContextRef.current) {
          const dest = audioContextRef.current.createMediaStreamDestination();
          const micSource = audioContextRef.current.createMediaStreamSource(micStream);
          micSource.connect(dest);
        }
        return micStream;
      }

      // If not sharing, create audio-only stream and share it
      setLocalStream(micStream);
      localStreamRef.current = micStream;

      // Create peer connections for all current participants
      for (const participant of participants) {
        const pc = await createPeerConnection(participant.userId);
        if (!pc) continue;

        // Add mic track to connection
        micStream.getTracks().forEach(track => {
          pc.addTrack(track, micStream);
        });
        
        // Optimize for low latency
        await optimizeSendersForLowLatency(pc);

        // Create and send offer
        try {
          const offer = await pc.createOffer();
          // Enhance audio quality in the offer
          const enhancedOffer = new RTCSessionDescription({
            type: offer.type,
            sdp: enhanceAudioQuality(offer.sdp || '')
          });
          await pc.setLocalDescription(enhancedOffer);
          
          if (isTransportOpen(wsRef.current)) {
            wsRef.current!.send(JSON.stringify({
              type: 'offer',
              userId,
              targetUserId: participant.userId,
              payload: {
                targetUserId: participant.userId,
                sdp: { type: enhancedOffer.type, sdp: enhancedOffer.sdp },
                hasVideo: false,
                fromRole: role
              }
            }));
          }
        } catch (err) {
          console.error('Failed to send mic offer:', err);
        }
      }

      return micStream;
    } catch (err: any) {
      const errorMsg = err.message || '';
      if (errorMsg.includes('Permission denied') || errorMsg.includes('NotAllowedError')) {
        console.log('Mic access denied');
        setError('Microphone access denied');
      } else {
        setError('Failed to access microphone');
      }
      setTimeout(() => setError(null), 5000);
      throw err;
    }
  }, [userId, role, participants, createPeerConnection]);

  // Stop mic-only streaming
  const stopMic = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    setIsMicActive(false);

    // If not sharing screen, also clear local stream and close connections
    if (!localStreamRef.current?.getVideoTracks().length) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
        setLocalStream(null);
      }
      closeAllPeerConnections();
    }
  }, [closeAllPeerConnections]);

  const disconnect = useCallback(() => {
    setControlAllowed(false);
    setControlPending(false);
    setSignalingJoined(false);
    // Stop sharing first
    stopSharing();
    
    // Send leave message
    if (isTransportOpen(wsRef.current)) {
      wsRef.current!.send(JSON.stringify({
        type: 'leave',
        roomId,
        userId,
        role
      }));
    }
    
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Close data channels
    dataChannelsRef.current.forEach(dc => dc.close());
    dataChannelsRef.current.clear();
    
    setParticipants([]);
    setConnected(false);
  }, [roomId, userId, role, stopSharing]);

  // Throttle ref for pointer events
  const lastPointerSendRef = useRef<number>(0);
  const POINTER_THROTTLE_MS = 50; // ~20 updates per second

  // Send a control event to artist (for engineers only)
  const sendControlEvent = useCallback((type: 'click' | 'move' | 'pointer', x: number, y: number) => {
    // Only engineers can send control events
    if (role !== 'engineer') {
      console.log('[Control] Not engineer, ignoring event');
      return;
    }
    
    // Throttle pointer events to avoid flooding the channel
    if (type === 'pointer') {
      const now = Date.now();
      if (now - lastPointerSendRef.current < POINTER_THROTTLE_MS) {
        return;
      }
      lastPointerSendRef.current = now;
    }
    
    const event: RemoteControlEvent = {
      type,
      x,
      y,
      fromUserId: userId,
      fromRole: role,
    };
    
    // Send to all open data channels (typically just the artist)
    const channelCount = dataChannelsRef.current.size;
    console.log(`[Control] Sending ${type} event to ${channelCount} channels, coords: (${x.toFixed(2)}, ${y.toFixed(2)})`);
    
    let sentCount = 0;
    dataChannelsRef.current.forEach((channel, peerId) => {
      console.log(`[Control] Channel to ${peerId}: state=${channel.readyState}`);
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify(event));
        sentCount++;
      }
    });
    console.log(`[Control] Sent to ${sentCount} open channels`);
  }, [userId, role]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setControlAllowed(false);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      peerConnectionsRef.current.forEach(pc => pc.close());
      peerConnectionsRef.current.clear();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [roomId, userId, role, setControlAllowed]);

  // Request full control from agent
  const requestFullControl = useCallback((name: string = 'Engineer') => {
    console.log('[Control] Request control called, role:', role, 'transport open:', isTransportOpen(wsRef.current));
    
    if (role !== 'engineer') {
      console.log('[Control] Cannot request control - not engineer role');
      return;
    }
    if (!captureSupported || agentScreenInfo.displayControlSupported !== true) {
      setError(agentScreenInfo.displayControlReason ||
        'The artist must share an entire screen with one supported display connected. Window, tab, audio-only, and unidentified shares are view-only.');
      return;
    }
    
    if (!isTransportOpen(wsRef.current)) {
      console.log('[Control] Cannot request control - transport not connected');
      // Try to reconnect
      connect();
      return;
    }
    
    setControlPending(true);
    const message = {
      type: 'control-request',
      sessionCode: roomId,
      userId,
      fromUserId: userId,
      fromName: name,
      fromRole: 'engineer',
    };
    console.log('[Control] Sending control request:', message);
    wsRef.current!.send(JSON.stringify(message));
    console.log('[Control] Sent control request successfully');
  }, [roomId, userId, role, connect, captureSupported, agentScreenInfo]);
  
  // End full control
  const endFullControl = useCallback(() => {
    if (role !== 'engineer') {
      return;
    }
    
    // Always update local state first
    setControlAllowed(false);
    setControlPending(false);
    console.log('[Control] Ended control');
    
    // Also notify server if connection is open
    if (isTransportOpen(wsRef.current)) {
      wsRef.current!.send(JSON.stringify({
        type: 'control-end',
        sessionCode: roomId,
        userId,
      }));
    }
  }, [roomId, userId, role]);
  
  // Throttle mouse moves to reduce lag (send max every 16ms = ~60fps)
  
  // Send full control command (mouse/keyboard to agent)
  const sendFullControlCommand = useCallback((command: {
    type: 'mouse-move' | 'mouse-click' | 'mouse-double-click' | 'mouse-scroll' | 'key-press' | 'key-type';
    [key: string]: any;
  }) => {
    if (role !== 'engineer') return;
    if (!controlLifetime.isAllowed()) return;
    if (controlMode === 'alignment' && command.type !== 'mouse-move') return;
    if (!isTransportOpen(wsRef.current)) return;
    
    // Throttle mouse-move to prevent flooding
    if (command.type === 'mouse-move') {
      const now = Date.now();
      const elapsed = now - lastMouseMoveRef.current;
      
      if (elapsed < 16) {
        // Queue this move and send after throttle period
        pendingMouseMoveRef.current = { x: command.x, y: command.y };
        if (!mouseMoveQueuedRef.current) {
          mouseMoveQueuedRef.current = true;
          const transport = wsRef.current;
          controlLifetime.schedule('move', () => {
            mouseMoveQueuedRef.current = false;
            if (pendingMouseMoveRef.current && wsRef.current === transport && isTransportOpen(transport)) {
              const payload = {
                type: 'mouse-move',
                ...pendingMouseMoveRef.current,
                sessionCode: roomId,
                userId,
              };
              wsRef.current!.send(JSON.stringify(payload));
              lastMouseMoveRef.current = Date.now();
              pendingMouseMoveRef.current = null;
            }
          }, 16 - elapsed);
        }
        return;
      }
      // A newer immediate move supersedes any older trailing move.
      controlLifetime.cancel('move');
      pendingMouseMoveRef.current = null;
      mouseMoveQueuedRef.current = false;
      lastMouseMoveRef.current = now;
    } else if (pendingMouseMoveRef.current) {
      // Clicks have no coordinates of their own. Flush the latest pointer
      // position first instead of clicking where the previous frame landed.
      const point = pendingMouseMoveRef.current;
      controlLifetime.cancel('move');
      pendingMouseMoveRef.current = null;
      mouseMoveQueuedRef.current = false;
      wsRef.current!.send(JSON.stringify({
        type: 'mouse-move', ...point, sessionCode: roomId, userId,
      }));
      lastMouseMoveRef.current = Date.now();
    }
    
    const payload = {
      ...command,
      sessionCode: roomId,
      userId,
    };
    
    if (command.type !== 'mouse-move') {
      console.log('[Control] Sending command:', command.type);
    }
    
    wsRef.current!.send(JSON.stringify(payload));
  }, [roomId, userId, role, controlLifetime, controlMode]);

  const cancelPendingControlClicks = useCallback(() => {
    controlLifetime.cancel('click');
  }, [controlLifetime]);

  const queueFullControlClick = useCallback((video: HTMLVideoElement) => {
    if (role !== 'engineer' || !isTransportOpen(wsRef.current)) return;
    const transport = wsRef.current;
    controlLifetime.schedule('click', () => {
      if (video.isConnected && wsRef.current === transport) {
        sendFullControlCommand({ type: 'mouse-click', button: 'left' });
      }
    }, 50);
  }, [role, controlLifetime, sendFullControlCommand]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Send audio confirmation - call when you can hear a broadcaster
  const confirmAudio = useCallback((broadcasterId: string) => {
    if (!isTransportOpen(wsRef.current)) return;
    wsRef.current!.send(JSON.stringify({
      type: 'audio-confirmed',
      roomId,
      userId,
      role,
      payload: {
        confirmerId: userId,
        confirmerRole: role,
        broadcasterId
      }
    }));
  }, [roomId, userId, role]);

  // Remove audio confirmation - call when you mute or lose audio
  const unconfirmAudio = useCallback((broadcasterId: string) => {
    if (!isTransportOpen(wsRef.current)) return;
    wsRef.current!.send(JSON.stringify({
      type: 'audio-unconfirmed',
      roomId,
      userId,
      role,
      payload: {
        confirmerId: userId,
        broadcasterId
      }
    }));
  }, [roomId, userId, role]);

  return {
    connected,
    participants,
    error,
    clearError,
    localStream,
    hasRemoteStream,
    remoteStreams,
    agentConnected,
    displayControlSupported: agentScreenInfo.displayControlSupported === true,
    agentVersion: agentScreenInfo.agentVersion,
    displayControlReason: agentScreenInfo.displayControlReason,
    displayControlCalibrationRequired: agentScreenInfo.controlCalibrationRequired === true,
    captureSupported,
    controlAllowed,
    controlPending,
    controlMode,
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
  };
}

export type { RemoteControlEvent, AgentStatus, RemoteStreamInfo };
