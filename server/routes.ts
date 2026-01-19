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
import { stripeService } from "./stripeService";
import { getStripePublishableKey } from "./stripeClient";
import type { SessionRole } from "@shared/schema";

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
  role: SessionRole;
  userId: string;
}

const rooms = new Map<string, Map<string, RoomParticipant>>();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Serve uploaded files statically
  app.use('/uploads', express.static(uploadDir));

  // ============ SUBSCRIPTION VERIFICATION HELPER ============
  
  async function verifySubscription(emailHeader: string | string[] | undefined): Promise<boolean> {
    const email = Array.isArray(emailHeader) ? emailHeader[0] : emailHeader;
    if (!email) return false;
    const user = await storage.getUserByEmail(email);
    if (!user?.stripeCustomerId) return false;
    const subscription = await storage.getSubscriptionByCustomerId(user.stripeCustomerId);
    return subscription && (subscription.status === 'active' || subscription.status === 'trialing');
  }

  // ============ SESSION ROUTES ============
  
  app.post(api.sessions.create.path, async (req, res) => {
    try {
      const subscriberEmail = req.headers['x-subscriber-email'] as string;
      const hasSubscription = await verifySubscription(subscriberEmail);
      
      if (!hasSubscription) {
        return res.status(403).json({ message: 'Active subscription required' });
      }

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
    const id = req.params.id as string;
    const session = await storage.getSession(id);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }
    res.json(session);
  });

  app.post(api.sessions.end.path, async (req, res) => {
    const id = req.params.id as string;
    const session = await storage.endSession(id);
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

  // ============ STRIPE ROUTES ============

  app.get('/api/stripe/config', async (req, res) => {
    try {
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (err) {
      console.error('Error getting Stripe config:', err);
      res.status(500).json({ error: 'Stripe not configured' });
    }
  });

  app.post('/api/stripe/checkout', async (req, res) => {
    try {
      const { email, priceId } = req.body;
      if (!email || !priceId) {
        return res.status(400).json({ error: 'Email and priceId required' });
      }

      let user = await storage.getUserByEmail(email);
      let customerId = user?.stripeCustomerId;

      if (!user) {
        const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        user = await storage.createUser({ id: userId, email });
      }

      // Verify customer exists in current Stripe mode, create new if not
      if (customerId) {
        try {
          await stripeService.getCustomer(customerId);
        } catch (err: any) {
          // Customer doesn't exist (likely from test mode), create new one
          console.log('Customer not found in Stripe, creating new one');
          customerId = null;
        }
      }

      if (!customerId) {
        const customer = await stripeService.createCustomer(email, user.id);
        await storage.updateUserStripeInfo(user.id, { stripeCustomerId: customer.id });
        customerId = customer.id;
      }

      // Use custom domain in production, fallback to Replit domain
      const customDomain = 'virtualstudio.sale';
      const replitDomain = process.env.REPLIT_DOMAINS?.split(',')[0];
      const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
      const baseUrl = `https://${isProduction ? customDomain : replitDomain}`;
      const session = await stripeService.createCheckoutSession(
        customerId,
        priceId,
        `${baseUrl}/?subscribed=true`,
        `${baseUrl}/?cancelled=true`
      );

      res.json({ url: session.url });
    } catch (err: any) {
      console.error('Checkout error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/stripe/portal', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: 'Email required' });
      }

      const user = await storage.getUserByEmail(email);
      if (!user?.stripeCustomerId) {
        return res.status(404).json({ error: 'No subscription found' });
      }

      // Use custom domain in production
      const customDomain = 'virtualstudio.sale';
      const replitDomain = process.env.REPLIT_DOMAINS?.split(',')[0];
      const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
      const baseUrl = `https://${isProduction ? customDomain : replitDomain}`;
      const portalSession = await stripeService.createCustomerPortalSession(
        user.stripeCustomerId,
        baseUrl || '/'
      );

      res.json({ url: portalSession.url });
    } catch (err: any) {
      console.error('Portal error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/subscription-status', async (req, res) => {
    try {
      const email = req.query.email as string;
      if (!email) {
        return res.json({ hasSubscription: false });
      }

      const user = await storage.getUserByEmail(email);
      if (!user?.stripeCustomerId) {
        return res.json({ hasSubscription: false });
      }

      const subscription = await storage.getSubscriptionByCustomerId(user.stripeCustomerId);
      const hasSubscription = subscription && 
        (subscription.status === 'active' || subscription.status === 'trialing');

      res.json({ 
        hasSubscription, 
        status: subscription?.status || null,
        email 
      });
    } catch (err: any) {
      console.error('Subscription status error:', err);
      res.json({ hasSubscription: false });
    }
  });

  app.get('/api/stripe/prices', async (req, res) => {
    try {
      let prices = await storage.listPrices(true);
      
      // Fallback to known live recurring price if database sync is incomplete
      if (prices.length === 0) {
        console.log('No prices in database, using fallback price');
        prices = [{
          id: 'price_1SrMmqQ1s5vL0wPuGs4qng2H',
          type: 'recurring',
          unit_amount: 999,
          currency: 'usd',
          livemode: true,
          active: true,
          recurring: { interval: 'month', interval_count: 1 }
        }];
      }
      
      res.json({ prices });
    } catch (err: any) {
      console.error('Prices error:', err);
      res.status(500).json({ error: err.message });
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
            currentRoom = (roomId as string).toUpperCase();
            currentUserId = userId as string;
            
            if (!rooms.has(currentRoom)) {
              rooms.set(currentRoom, new Map());
            }
            
            const room = rooms.get(currentRoom)!;
            room.set(currentUserId, { ws, role, userId: currentUserId });
            
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
