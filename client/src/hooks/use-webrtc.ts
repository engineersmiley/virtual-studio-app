import { useState, useRef, useCallback, useEffect } from 'react';
import type { SessionRole } from '@shared/schema';
import { PollingTransport } from '@/lib/polling-transport';

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
  const [controlAllowed, setControlAllowed] = useState(false);
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
  useEffect(() => {
    onAgentStatusRef.current?.({
      connected: agentConnected,
      controlAllowed,
      controlPending,
    });
  }, [agentConnected, controlAllowed, controlPending]);

  // Multiple STUN servers for better NAT traversal
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Additional public STUN servers
    { urls: 'stun:stun.stunprotocol.org:3478' },
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
      }
    };

    pc.ontrack = (event) => {
      if (event.streams[0]) {
        const stream = event.streams[0];
        const hasVideo = stream.getVideoTracks().length > 0;
        
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
        
        // Listen for track ending - only remove stream if ALL tracks have ended
        // Use a delay to allow reconnection
        stream.getTracks().forEach(track => {
          track.onended = () => {
            console.log('[WebRTC] Track ended from', targetUserId, '- waiting to verify...');
            
            // Wait a bit before checking - tracks might come back
            setTimeout(() => {
              // Check if all tracks in this stream have ended
              const allEnded = stream.getTracks().every(t => t.readyState === 'ended');
              if (allEnded) {
                // Double-check the connection is actually failed
                const pc = peerConnectionsRef.current.get(targetUserId);
                if (!pc || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                  console.log('[WebRTC] All tracks ended and connection gone for', targetUserId, '- removing stream');
                  setRemoteStreams(prev => {
                    const next = new Map(prev);
                    next.delete(targetUserId);
                    if (next.size === 0) {
                      setHasRemoteStream(false);
                    }
                    return next;
                  });
                } else {
                  console.log('[WebRTC] Tracks ended but connection still active - keeping stream');
                }
              }
            }, 2000); // Wait 2 seconds before removing
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
      
      // Handle disconnected state - try ICE restart to recover
      if (state === 'disconnected') {
        console.log('[WebRTC] Connection disconnected, attempting ICE restart...');
        // Wait 2 seconds, then try ICE restart if still disconnected
        setTimeout(() => {
          const currentPc = peerConnectionsRef.current.get(targetUserId);
          if (currentPc && currentPc.connectionState === 'disconnected') {
            console.log('[WebRTC] Still disconnected, triggering ICE restart');
            try {
              currentPc.restartIce();
            } catch (e) {
              console.log('[WebRTC] ICE restart failed:', e);
            }
          }
        }, 2000);
      }
      
      // Only clean up streams when connection actually fails (not just disconnects)
      if (state === 'failed') {
        console.log('[WebRTC] Connection failed for', targetUserId, '- attempting to recover');
        
        // Try to recover by creating a new connection after a delay
        setTimeout(() => {
          const currentPc = peerConnectionsRef.current.get(targetUserId);
          if (currentPc && currentPc.connectionState === 'failed') {
            console.log('[WebRTC] Connection still failed, will wait for reconnection signal');
            // Don't remove the stream yet - wait for user-left or explicit disconnect
          }
        }, 5000);
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
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    wsRef.current.send(JSON.stringify({
      type: 'offer',
      roomId,
      userId,
      role,
      payload: { 
        sdp: offer,
        targetUserId: viewerUserId 
      }
    }));
  }, [roomId, userId, role, createPeerConnection]);

  const handleSignalingMessage = useCallback(async (data: string) => {
    const message = JSON.parse(data);

    switch (message.type) {
      case 'room-state': {
        setParticipants(message.participants || []);
        
        // Set agent status from room state (WebSocket initial join)
        if (message.agentConnected !== undefined) {
          setAgentConnected(message.agentConnected);
        }
        if (message.controlActive !== undefined) {
          setControlAllowed(message.controlActive);
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
        
        // Don't immediately remove streams - the peer connection might still be alive
        // Wait a bit and check if the user rejoined or if the connection is still active
        setTimeout(() => {
          const pc = peerConnectionsRef.current.get(leftUserId);
          
          // Only remove if the peer connection is dead or not connected
          if (!pc || pc.connectionState === 'closed' || pc.connectionState === 'failed') {
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
            console.log('[WebRTC] User left but peer connection still alive - keeping stream');
          }
        }, 3000); // Wait 3 seconds before removing
        break;
      }

      case 'offer': {
        if (message.userId !== userId) {
          const pc = createPeerConnection(message.userId);
          
          if (role === 'engineer' || role === 'producer' || role === 'other') {
            const dataChannel = pc.createDataChannel('control', { ordered: true });
            dataChannel.onopen = () => {
              console.log('Control data channel opened');
            };
            dataChannelsRef.current.set(message.userId, dataChannel);
          }
          
          await pc.setRemoteDescription(new RTCSessionDescription(message.payload.sdp));
          
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          wsRef.current?.send(JSON.stringify({
            type: 'answer',
            roomId,
            userId,
            role,
            payload: { 
              sdp: answer,
              targetUserId: message.userId 
            }
          }));
        }
        break;
      }

      case 'answer': {
        const pc = peerConnectionsRef.current.get(message.userId);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(message.payload.sdp));
        }
        break;
      }

      case 'ice-candidate': {
        const pc = peerConnectionsRef.current.get(message.userId);
        if (pc && message.payload.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(message.payload.candidate));
          } catch (e) {
            console.error('Error adding ICE candidate:', e);
          }
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
      
      case 'agent-disconnected': {
        setAgentConnected(false);
        setControlAllowed(false);
        setControlPending(false);
        break;
      }
      
      case 'agent-status': {
        // Real-time agent status from polling
        setAgentConnected(message.connected);
        if (message.controlActive) {
          setControlAllowed(true);
          setControlPending(false);
        }
        break;
      }
      
      case 'control-response': {
        setControlPending(false);
        setControlAllowed(message.allowed === true);
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
      handleSignalingMessage(event.data);
    };
    
    transport.onerror = () => {
      console.error('[Polling] Error');
      setError('Connection error. Please refresh.');
    };
    
    transport.onclose = () => {
      console.log('[Polling] Closed');
      closeAllPeerConnections();
      setConnected(false);
    };
    
    transport.connect();
  }, [roomId, userId, role, closeAllPeerConnections, handleSignalingMessage]);

  const connect = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
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

    ws.onopen = () => {
      console.log('[WebSocket] Connected successfully');
      retryCountRef.current = 0;
      setError(null);
      ws.send(JSON.stringify({
        type: 'join',
        roomId: roomId.toUpperCase(),
        userId,
        role
      }));
    };

    ws.onmessage = async (event) => {
      handleSignalingMessage(event.data);
    };

    ws.onerror = (event) => {
      console.error('[WebSocket] Connection error:', event);
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 5000);
        console.log(`[WebSocket] Retrying in ${delay}ms (attempt ${retryCountRef.current}/${maxRetries})`);
        setError(`Connecting... (attempt ${retryCountRef.current}/${maxRetries})`);
        retryTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        console.log('[WebSocket] Max retries reached, switching to HTTP polling fallback');
        connectWithPolling();
      }
    };
    
    ws.onclose = (event) => {
      console.log('[WebSocket] Connection closed:', event.code, event.reason);
      // DON'T close peer connections on WebSocket close - keep video alive
      // The peer connections are direct P2P and don't need WebSocket once established
      setConnected(false);
      
      if (event.code !== 1000 && retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 5000);
        console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${retryCountRef.current}/${maxRetries})`);
        retryTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else if (event.code !== 1000) {
        console.log('[WebSocket] Connection lost, switching to HTTP polling fallback');
        connectWithPolling();
      }
    };

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      ws.close();
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
            width: { ideal: 1920 }, 
            height: { ideal: 1080 }, 
            frameRate: { ideal: 60 }
          },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 48000,
            sampleSize: 16,
            channelCount: 2,
          } as any
        });
        videoTrack = displayStream.getVideoTracks()[0];
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
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedInputDevice ? { exact: selectedInputDevice } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
          sampleSize: 16,
          channelCount: 1,
        } as any
      });

      // Mix audio using Web Audio API with high quality settings
      const audioContext = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = audioContext;
      const dest = audioContext.createMediaStreamDestination();

      // Track what audio sources we have
      const hasSystemAudio = displayStream && displayStream.getAudioTracks().length > 0;
      const hasMicAudio = micStream.getAudioTracks().length > 0;
      
      console.log('[WebRTC] Audio sources - System:', hasSystemAudio, 'Mic:', hasMicAudio);

      // Add system audio if available (from screen share)
      if (hasSystemAudio) {
        const sysSource = audioContext.createMediaStreamSource(displayStream);
        sysSource.connect(dest);
        console.log('[WebRTC] System audio connected to mix');
      }

      // Add mic audio
      if (hasMicAudio) {
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(dest);
        console.log('[WebRTC] Mic audio connected to mix');
      }

      // Create combined stream
      const audioTrack = dest.stream.getAudioTracks()[0];
      let combinedStream: MediaStream;
      
      if (videoTrack && !audioOnly) {
        combinedStream = new MediaStream([videoTrack, audioTrack]);
      } else {
        // Audio-only stream
        combinedStream = new MediaStream([audioTrack]);
      }

      localStreamRef.current = combinedStream;
      setLocalStream(combinedStream);

      // Send offer to all other participants (not ourselves)
      const others = participants.filter(p => p.userId !== userId);
      for (const other of others) {
        const pc = createPeerConnection(other.userId);
        combinedStream.getTracks().forEach(track => {
          pc.addTrack(track, combinedStream);
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        wsRef.current?.send(JSON.stringify({
          type: 'offer',
          roomId,
          userId,
          role,
          payload: { 
            sdp: offer,
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
  }, [roomId, userId, role, participants, createPeerConnection, canBroadcast]);

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
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedInputDevice ? { exact: selectedInputDevice } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
          sampleSize: 16,
          channelCount: 1,
        } as any
      });

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

        // Create and send offer
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          
          if (isTransportOpen(wsRef.current)) {
            wsRef.current!.send(JSON.stringify({
              type: 'offer',
              userId,
              targetUserId: participant.userId,
              payload: {
                targetUserId: participant.userId,
                sdp: offer,
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
  }, []);

  // Request full control from agent
  const requestFullControl = useCallback((name: string = 'Engineer') => {
    console.log('[Control] Request control called, role:', role, 'transport open:', isTransportOpen(wsRef.current));
    
    if (role !== 'engineer') {
      console.log('[Control] Cannot request control - not engineer role');
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
  }, [roomId, userId, role, connect]);
  
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
  const lastMouseMoveRef = useRef<number>(0);
  const pendingMouseMoveRef = useRef<{x: number, y: number} | null>(null);
  const mouseMoveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Send full control command (mouse/keyboard to agent)
  const sendFullControlCommand = useCallback((command: {
    type: 'mouse-move' | 'mouse-click' | 'mouse-double-click' | 'mouse-scroll' | 'key-press' | 'key-type';
    [key: string]: any;
  }) => {
    if (role !== 'engineer') return;
    if (!controlAllowed) return;
    if (!isTransportOpen(wsRef.current)) return;
    
    // Throttle mouse-move to prevent flooding
    if (command.type === 'mouse-move') {
      const now = Date.now();
      const elapsed = now - lastMouseMoveRef.current;
      
      if (elapsed < 16) {
        // Queue this move and send after throttle period
        pendingMouseMoveRef.current = { x: command.x, y: command.y };
        if (!mouseMoveTimeoutRef.current) {
          mouseMoveTimeoutRef.current = setTimeout(() => {
            mouseMoveTimeoutRef.current = null;
            if (pendingMouseMoveRef.current && isTransportOpen(wsRef.current)) {
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
      lastMouseMoveRef.current = now;
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
  }, [roomId, userId, role, controlAllowed]);

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
    controlAllowed,
    controlPending,
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
  };
}

export type { RemoteControlEvent, AgentStatus, RemoteStreamInfo };
