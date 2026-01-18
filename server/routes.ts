import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + '-' + file.originalname);
    }
  }),
  limits: {
    fileSize: 500 * 1024 * 1024,
  }
});

// Room management for WebRTC signaling
interface RoomParticipant {
  ws: WebSocket;
  role: 'artist' | 'engineer';
  userId: string;
}

const rooms = new Map<string, Map<string, RoomParticipant>>();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Serve uploaded files statically
  app.use('/uploads', express.static(uploadDir));

  // ============ SESSION ROUTES ============
  
  app.post(api.sessions.create.path, async (req, res) => {
    try {
      const { name } = api.sessions.create.input.parse(req.body);
      const session = await storage.createSession(name);
      res.status(201).json(session);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.get(api.sessions.list.path, async (req, res) => {
    const sessionsList = await storage.getSessions();
    res.json(sessionsList);
  });

  app.get(api.sessions.get.path, async (req, res) => {
    const session = await storage.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }
    res.json(session);
  });

  app.post(api.sessions.end.path, async (req, res) => {
    const session = await storage.endSession(req.params.id);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }
    res.json(session);
  });

  // ============ RECORDING ROUTES ============

  app.get(api.recordings.list.path, async (req, res) => {
    const recordingsList = await storage.getRecordings();
    res.json(recordingsList);
  });

  app.get(api.recordings.get.path, async (req, res) => {
    const recording = await storage.getRecording(Number(req.params.id));
    if (!recording) {
      return res.status(404).json({ message: 'Recording not found' });
    }
    res.json(recording);
  });

  app.post(api.recordings.upload.path, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const duration = parseInt(req.body.duration || '0');
      
      const recordingData = {
        title: req.body.title || req.file.originalname,
        description: req.body.description || '',
        filename: req.file.filename,
        fileSize: req.file.size,
        duration: duration,
        mimeType: req.file.mimetype,
        isHighQuality: req.body.isHighQuality === 'true',
        sessionName: req.body.sessionName || null,
        sessionId: req.body.sessionId || null,
      };

      const recording = await storage.createRecording(recordingData);
      res.status(201).json(recording);
    } catch (err) {
      console.error('Upload error:', err);
      res.status(500).json({ message: 'Failed to save recording' });
    }
  });

  app.delete(api.recordings.delete.path, async (req, res) => {
    const id = Number(req.params.id);
    const recording = await storage.getRecording(id);
    
    if (recording) {
      try {
        const filePath = path.join(uploadDir, recording.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        console.error('Error deleting file:', e);
      }
      
      await storage.deleteRecording(id);
      res.status(204).send();
    } else {
      res.status(404).json({ message: 'Recording not found' });
    }
  });

  // ============ WEBSOCKET SIGNALING SERVER ============
  
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    let currentRoom: string | null = null;
    let currentUserId: string | null = null;

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        const { type, roomId, userId, role, payload } = message;

        switch (type) {
          case 'join': {
            currentRoom = roomId.toUpperCase();
            currentUserId = userId;
            
            if (!rooms.has(currentRoom)) {
              rooms.set(currentRoom, new Map());
            }
            
            const room = rooms.get(currentRoom)!;
            room.set(userId, { ws, role, userId });
            
            // Notify others in the room
            room.forEach((participant, pId) => {
              if (pId !== userId && participant.ws.readyState === WebSocket.OPEN) {
                participant.ws.send(JSON.stringify({
                  type: 'user-joined',
                  userId,
                  role,
                  roomId: currentRoom
                }));
              }
            });

            // Send list of existing participants to the new user
            const participants = Array.from(room.entries())
              .filter(([pId]) => pId !== userId)
              .map(([pId, p]) => ({ userId: pId, role: p.role }));
            
            ws.send(JSON.stringify({
              type: 'room-state',
              roomId: currentRoom,
              participants
            }));
            break;
          }

          case 'offer':
          case 'answer':
          case 'ice-candidate': {
            if (!currentRoom) return;
            const room = rooms.get(currentRoom);
            if (!room) return;
            
            // Forward to target user or broadcast
            const targetId = payload?.targetUserId;
            if (targetId && room.has(targetId)) {
              const target = room.get(targetId)!;
              if (target.ws.readyState === WebSocket.OPEN) {
                target.ws.send(JSON.stringify({
                  type,
                  userId: currentUserId,
                  payload
                }));
              }
            } else {
              // Broadcast to all others
              room.forEach((participant, pId) => {
                if (pId !== currentUserId && participant.ws.readyState === WebSocket.OPEN) {
                  participant.ws.send(JSON.stringify({
                    type,
                    userId: currentUserId,
                    payload
                  }));
                }
              });
            }
            break;
          }

          case 'leave': {
            handleLeave();
            break;
          }
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    function handleLeave() {
      if (currentRoom && currentUserId) {
        const room = rooms.get(currentRoom);
        if (room) {
          room.delete(currentUserId);
          
          // Notify others
          room.forEach((participant) => {
            if (participant.ws.readyState === WebSocket.OPEN) {
              participant.ws.send(JSON.stringify({
                type: 'user-left',
                userId: currentUserId,
                roomId: currentRoom
              }));
            }
          });
          
          if (room.size === 0) {
            rooms.delete(currentRoom);
          }
        }
      }
      currentRoom = null;
      currentUserId = null;
    }

    ws.on('close', handleLeave);
    ws.on('error', handleLeave);
  });

  return httpServer;
}
