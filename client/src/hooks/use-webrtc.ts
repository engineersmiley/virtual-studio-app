import { useState, useRef, useCallback, useEffect } from 'react';

interface Participant {
  userId: string;
  role: 'artist' | 'engineer';
}

interface UseWebRTCOptions {
  roomId: string;
  userId: string;
  role: 'artist' | 'engineer';
  onRemoteStream?: (stream: MediaStream) => void;
}

export function useWebRTC({ roomId, userId, role, onRemoteStream }: UseWebRTCOptions) {
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          roomId,
          userId,
          role,
          payload: { candidate: event.candidate }
        }));
      }
    };

    pc.ontrack = (event) => {
      if (onRemoteStream && event.streams[0]) {
        onRemoteStream(event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setConnected(true);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setConnected(false);
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  }, [roomId, userId, role, onRemoteStream]);

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
          break;
        }

        case 'user-joined': {
          setParticipants(prev => [...prev, { userId: message.userId, role: message.role }]);
          
          // If we're the artist and an engineer joined, create offer
          if (role === 'artist' && message.role === 'engineer' && localStreamRef.current) {
            const pc = createPeerConnection();
            localStreamRef.current.getTracks().forEach(track => {
              pc.addTrack(track, localStreamRef.current!);
            });
            
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            ws.send(JSON.stringify({
              type: 'offer',
              roomId,
              userId,
              role,
              payload: { 
                sdp: offer,
                targetUserId: message.userId 
              }
            }));
          }
          break;
        }

        case 'user-left': {
          setParticipants(prev => prev.filter(p => p.userId !== message.userId));
          break;
        }

        case 'offer': {
          // Engineer receives offer from artist
          if (role === 'engineer') {
            const pc = createPeerConnection();
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
          if (peerConnectionRef.current) {
            await peerConnectionRef.current.setRemoteDescription(
              new RTCSessionDescription(message.payload.sdp)
            );
          }
          break;
        }

        case 'ice-candidate': {
          if (peerConnectionRef.current && message.payload.candidate) {
            try {
              await peerConnectionRef.current.addIceCandidate(
                new RTCIceCandidate(message.payload.candidate)
              );
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

    ws.onerror = () => setError('WebSocket connection failed');
    ws.onclose = () => setConnected(false);

    return () => {
      ws.close();
    };
  }, [roomId, userId, role, createPeerConnection]);

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

      // If there are already engineers in the room, send offer
      const engineers = participants.filter(p => p.role === 'engineer');
      if (engineers.length > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        const pc = createPeerConnection();
        combinedStream.getTracks().forEach(track => {
          pc.addTrack(track, combinedStream);
        });

        for (const engineer of engineers) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          
          wsRef.current.send(JSON.stringify({
            type: 'offer',
            roomId,
            userId,
            role,
            payload: { 
              sdp: offer,
              targetUserId: engineer.userId 
            }
          }));
        }
      }

      // Handle stop sharing
      videoTrack.onended = () => {
        stopSharing();
      };

      return combinedStream;
    } catch (err: any) {
      setError(err.message || 'Failed to start sharing');
      throw err;
    }
  }, [roomId, userId, role, participants, createPeerConnection]);

  const stopSharing = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    stopSharing();
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'leave',
        roomId,
        userId,
        role
      }));
      wsRef.current.close();
      wsRef.current = null;
    }
    setParticipants([]);
    setConnected(false);
  }, [roomId, userId, role, stopSharing]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  return {
    connected,
    participants,
    error,
    localStream,
    connect,
    disconnect,
    startSharing,
    stopSharing,
  };
}
