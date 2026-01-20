import { useState, useRef, useCallback, useEffect } from 'react';
import type { SessionRole } from '@shared/schema';

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

interface UseWebRTCOptions {
  roomId: string;
  userId: string;
  role: SessionRole;
  onRemoteStream?: (stream: MediaStream) => void;
  onRemoteControl?: (event: RemoteControlEvent) => void;
}

export function useWebRTC({ roomId, userId, role, onRemoteStream, onRemoteControl }: UseWebRTCOptions) {
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [hasRemoteStream, setHasRemoteStream] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  // Map of peer connections: userId -> RTCPeerConnection
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Map of data channels: userId -> RTCDataChannel
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const onRemoteControlRef = useRef(onRemoteControl);
  const participantsRef = useRef<Participant[]>([]);
  
  // Keep refs updated
  useEffect(() => {
    onRemoteControlRef.current = onRemoteControl;
  }, [onRemoteControl]);
  
  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const createPeerConnection = useCallback((targetUserId: string) => {
    // Close existing connection for this peer if any
    const existingPc = peerConnectionsRef.current.get(targetUserId);
    if (existingPc) {
      existingPc.close();
      peerConnectionsRef.current.delete(targetUserId);
    }

    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
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
      if (onRemoteStream && event.streams[0]) {
        setHasRemoteStream(true);
        onRemoteStream(event.streams[0]);
        
        // Listen for track ending to reset hasRemoteStream
        event.streams[0].getTracks().forEach(track => {
          track.onended = () => {
            setHasRemoteStream(false);
          };
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const states = Array.from(peerConnectionsRef.current.values()).map(p => p.connectionState);
      const hasConnected = states.some(s => s === 'connected');
      setConnected(hasConnected);
      
      // Reset hasRemoteStream if connection is lost for viewers
      if (role !== 'artist' && (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed')) {
        const anyConnected = states.some(s => s === 'connected');
        if (!anyConnected) {
          setHasRemoteStream(false);
        }
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

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'join',
        roomId: roomId.toUpperCase(),
        userId,
        role
      }));
    };

    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'room-state': {
          setParticipants(message.participants || []);
          
          // If we're the artist with a stream and viewers are already in the room
          if (role === 'artist' && localStreamRef.current) {
            const viewers = (message.participants || []).filter((p: Participant) => p.role !== 'artist');
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
          
          // If we're the artist and a viewer joined, create offer
          if (role === 'artist' && message.role !== 'artist' && localStreamRef.current) {
            await sendOfferToViewer(message.userId);
          }
          break;
        }

        case 'user-left': {
          setParticipants(prev => prev.filter(p => p.userId !== message.userId));
          closePeerConnection(message.userId);
          // If the artist left, reset hasRemoteStream for viewers
          if (message.role === 'artist' && role !== 'artist') {
            setHasRemoteStream(false);
          }
          break;
        }

        case 'offer': {
          // All viewers (engineer, producer, other) receive offer from artist
          if (role !== 'artist') {
            const pc = createPeerConnection(message.userId);
            
            // Create data channel for sending control events to artist
            const dataChannel = pc.createDataChannel('control', { ordered: true });
            dataChannel.onopen = () => {
              console.log('Control data channel opened');
            };
            dataChannelsRef.current.set(message.userId, dataChannel);
            
            await pc.setRemoteDescription(new RTCSessionDescription(message.payload.sdp));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            ws.send(JSON.stringify({
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
          // Artist receives answer from engineer
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
      }
    };

    async function sendOfferToViewer(viewerUserId: string) {
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
    }

    ws.onerror = () => setError('WebSocket connection failed');
    ws.onclose = () => {
      closeAllPeerConnections();
      setConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [roomId, userId, role, createPeerConnection, closePeerConnection, closeAllPeerConnections]);

  const startSharing = useCallback(async () => {
    try {
      // Get screen with system audio
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1920, height: 1080, frameRate: 30 },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });

      // Get microphone
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      // Mix audio using Web Audio API
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const dest = audioContext.createMediaStreamDestination();

      // Add system audio if available
      if (displayStream.getAudioTracks().length > 0) {
        const sysSource = audioContext.createMediaStreamSource(displayStream);
        sysSource.connect(dest);
      }

      // Add mic audio
      if (micStream.getAudioTracks().length > 0) {
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(dest);
      }

      // Create combined stream with video + mixed audio
      const videoTrack = displayStream.getVideoTracks()[0];
      const audioTrack = dest.stream.getAudioTracks()[0];
      const combinedStream = new MediaStream([videoTrack, audioTrack]);

      localStreamRef.current = combinedStream;
      setLocalStream(combinedStream);

      // Send offer to all current viewers (engineer, producer, other)
      const viewers = participants.filter(p => p.role !== 'artist');
      for (const viewer of viewers) {
        const pc = createPeerConnection(viewer.userId);
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
            targetUserId: viewer.userId 
          }
        }));
      }

      // Handle stop sharing when screen share ends
      videoTrack.onended = () => {
        stopSharing();
      };

      // Store streams for cleanup
      (combinedStream as any)._originalStreams = [displayStream, micStream];

      return combinedStream;
    } catch (err: any) {
      setError(err.message || 'Failed to start sharing');
      throw err;
    }
  }, [roomId, userId, role, participants, createPeerConnection]);

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

  const disconnect = useCallback(() => {
    // Stop sharing first
    stopSharing();
    
    // Send leave message
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
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
    if (role !== 'engineer') return;
    
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
    dataChannelsRef.current.forEach((channel) => {
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify(event));
      }
    });
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

  return {
    connected,
    participants,
    error,
    localStream,
    hasRemoteStream,
    connect,
    disconnect,
    startSharing,
    stopSharing,
    sendControlEvent,
  };
}

export type { RemoteControlEvent };
