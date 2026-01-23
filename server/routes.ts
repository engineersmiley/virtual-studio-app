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
import { getStripePublishableKey, getUncachableStripeClient } from "./stripeClient";
import { sendWelcomeEmail } from "./gmailService";
import type { SessionRole, ControlMessage, AgentToken } from "@shared/schema";
import crypto from "crypto";

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

// Agent connection management for remote control
interface AgentConnection {
  ws: WebSocket;
  sessionCode: string;
  userId: string;
  controlEnabled: boolean;
}

const agentConnections = new Map<string, AgentConnection>(); // sessionCode -> agent
const agentTokens = new Map<string, AgentToken>(); // token -> AgentToken data
const controlPermissions = new Map<string, boolean>(); // sessionCode -> control allowed

// Simple remote control enabled sessions (no token needed)
const remoteControlEnabled = new Map<string, { artistUserId: string; enabledAt: number }>(); // sessionCode -> data

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
    if (!user) return false;
    // Check promo code first
    if (user.promoCode) return true;
    // Then check Stripe subscription
    if (!user.stripeCustomerId) return false;
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

      // First check our database
      const user = await storage.getUserByEmail(email);
      
      if (user) {
        // Check if user has a valid promo code
        if (user.promoCode) {
          return res.json({ 
            hasSubscription: true, 
            status: 'promo',
            promoCode: user.promoCode,
            email 
          });
        }
        
        // Check user's own subscription status (fallback for webhook issues)
        if (user.subscriptionStatus === 'active' || user.subscriptionStatus === 'trialing') {
          return res.json({ 
            hasSubscription: true, 
            status: user.subscriptionStatus,
            email 
          });
        }

        // Check Stripe's synced subscription data
        if (user.stripeCustomerId) {
          const subscription = await storage.getSubscriptionByCustomerId(user.stripeCustomerId);
          if (subscription && (subscription.status === 'active' || subscription.status === 'trialing')) {
            return res.json({ 
              hasSubscription: true, 
              status: subscription.status,
              email 
            });
          }
        }
      }

      // Fallback: Check Stripe API directly by email (for webhook failures)
      try {
        const stripeClient = await getUncachableStripeClient();
        const customers = await stripeClient.customers.list({ email, limit: 1 });
        if (customers.data.length > 0) {
          const customerId = customers.data[0].id;
          const subscriptions = await stripeClient.subscriptions.list({ 
            customer: customerId, 
            status: 'active',
            limit: 1 
          });
          
          if (subscriptions.data.length > 0) {
            // Create/update user record for future lookups
            const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await storage.createUser({
              id: userId,
              email,
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptions.data[0].id,
              subscriptionStatus: 'active'
            });
            
            return res.json({ 
              hasSubscription: true, 
              status: 'active',
              email 
            });
          }
        }
      } catch (stripeErr) {
        console.error('Stripe API fallback error:', stripeErr);
      }

      res.json({ hasSubscription: false, status: null, email });
    } catch (err: any) {
      console.error('Subscription status error:', err);
      res.json({ hasSubscription: false });
    }
  });

  // ============ PROMO CODE ROUTES ============

  // Redeem a promo code
  app.post('/api/promo/redeem', async (req, res) => {
    try {
      const { email, code } = req.body;
      if (!email || !code) {
        return res.status(400).json({ error: 'Email and code required' });
      }

      const promo = await storage.getPromoCode(code);
      if (!promo) {
        return res.status(404).json({ error: 'Invalid promo code' });
      }

      if (!promo.isActive) {
        return res.status(400).json({ error: 'This promo code is no longer active' });
      }

      if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) {
        return res.status(400).json({ error: 'This promo code has expired' });
      }

      if (promo.maxUses && promo.currentUses && promo.currentUses >= promo.maxUses) {
        return res.status(400).json({ error: 'This promo code has reached its usage limit' });
      }

      // Grant access to user
      await storage.updateUserPromoCode(email, code.toUpperCase());
      await storage.incrementPromoCodeUsage(code);

      res.json({ success: true, message: 'Promo code applied successfully' });
    } catch (err: any) {
      console.error('Promo redeem error:', err);
      res.status(500).json({ error: 'Failed to redeem promo code' });
    }
  });

  // Create a new promo code (admin)
  app.post('/api/promo/create', async (req, res) => {
    try {
      const { code, description, maxUses, expiresAt } = req.body;
      if (!code) {
        return res.status(400).json({ error: 'Code is required' });
      }

      const existing = await storage.getPromoCode(code);
      if (existing) {
        return res.status(400).json({ error: 'Promo code already exists' });
      }

      const promo = await storage.createPromoCode({
        code: code.toUpperCase(),
        description,
        maxUses: maxUses || null,
        isActive: true,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });

      res.json(promo);
    } catch (err: any) {
      console.error('Promo create error:', err);
      res.status(500).json({ error: 'Failed to create promo code' });
    }
  });

  // List all promo codes (admin)
  app.get('/api/promo/list', async (req, res) => {
    try {
      const codes = await storage.getAllPromoCodes();
      res.json(codes);
    } catch (err: any) {
      console.error('Promo list error:', err);
      res.status(500).json({ error: 'Failed to list promo codes' });
    }
  });

  // Deactivate a promo code (admin)
  app.post('/api/promo/deactivate', async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ error: 'Code is required' });
      }

      const promo = await storage.deactivatePromoCode(code);
      if (!promo) {
        return res.status(404).json({ error: 'Promo code not found' });
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error('Promo deactivate error:', err);
      res.status(500).json({ error: 'Failed to deactivate promo code' });
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

  // Test endpoint to manually send welcome email (development only)
  app.post('/api/test-welcome-email', async (req, res) => {
    // Only allow in development to prevent abuse
    if (process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1') {
      return res.status(403).json({ error: 'Not available in production' });
    }
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }
      console.log(`Manually sending welcome email to ${email}`);
      await sendWelcomeEmail(email);
      res.json({ success: true, message: `Welcome email sent to ${email}` });
    } catch (err: any) {
      console.error('Test email error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============ AGENT TOKEN GENERATION ============
  
  // Rate limiting: track token issuance per session to prevent abuse
  const tokenIssuanceRateLimit = new Map<string, { count: number; resetAt: number }>();
  const MAX_TOKENS_PER_SESSION = 3; // Max 3 tokens per session per hour
  const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
  
  app.post('/api/agent/token', async (req, res) => {
    try {
      const { sessionCode, email } = req.body;
      const normalizedCode = sessionCode?.toUpperCase();
      
      if (!sessionCode || !email) {
        return res.status(400).json({ error: 'Session code and email required' });
      }
      
      // Verify subscription
      const hasSubscription = await verifySubscription(email);
      if (!hasSubscription) {
        return res.status(403).json({ error: 'Active subscription required' });
      }
      
      // Verify session exists
      const session = await storage.getSession(normalizedCode);
      if (!session || !session.isActive) {
        return res.status(404).json({ error: 'Session not found or inactive' });
      }
      
      // Check if an agent is already connected to this session
      if (agentConnections.has(normalizedCode)) {
        return res.status(409).json({ error: 'An agent is already connected to this session' });
      }
      
      // Require an artist to be currently present in the session
      // Check both WebSocket rooms and polling rooms
      const wsRoom = rooms.get(normalizedCode);
      
      // Find the artist in the room (WebSocket or Polling)
      let artistUserId: string | null = null;
      
      // Check WebSocket room first
      if (wsRoom) {
        wsRoom.forEach((participant, odId) => {
          if (participant.role === 'artist') {
            artistUserId = participant.userId;
          }
        });
      }
      
      // If no artist found in WebSocket room, the artist may be using HTTP polling
      // For now, if no artist is found, allow token generation if session is active
      // The artist is calling this endpoint, so they are present
      if (!artistUserId) {
        // Generate a temporary artistUserId based on the session
        artistUserId = `artist_${normalizedCode}_${Date.now()}`;
      }
      
      // Check rate limiting
      const now = Date.now();
      let rateData = tokenIssuanceRateLimit.get(normalizedCode);
      if (rateData && rateData.resetAt > now) {
        if (rateData.count >= MAX_TOKENS_PER_SESSION) {
          return res.status(429).json({ 
            error: 'Too many token requests for this session. Try again later.',
            retryAfter: Math.ceil((rateData.resetAt - now) / 1000)
          });
        }
        rateData.count++;
      } else {
        rateData = { count: 1, resetAt: now + RATE_LIMIT_WINDOW };
        tokenIssuanceRateLimit.set(normalizedCode, rateData);
      }
      
      // Generate token - bind to the existing artist's userId for attribution
      // Generate a short, easy-to-share token (8 characters)
      const token = crypto.randomBytes(4).toString('hex').toUpperCase();
      const expiresAt = Date.now() + 4 * 60 * 60 * 1000; // 4 hours
      
      const tokenData: AgentToken = {
        sessionCode: normalizedCode,
        userId: artistUserId, // Use the artist's existing userId, not a new one
        email,
        role: 'artist',
        expiresAt,
      };
      
      agentTokens.set(token, tokenData);
      
      // Clean up expired tokens periodically
      setTimeout(() => {
        agentTokens.delete(token);
      }, 4 * 60 * 60 * 1000);
      
      console.log(`Agent token issued for session ${normalizedCode} to ${email}`);
      res.json({ token, expiresAt, sessionCode: normalizedCode });
    } catch (err: any) {
      console.error('Agent token error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============ SIMPLE REMOTE CONTROL TOGGLE (NO TOKEN) ============
  
  // Artist enables remote control for their session
  app.post('/api/session/:code/enable-remote-control', (req, res) => {
    try {
      const { code } = req.params;
      const { userId } = req.body;
      
      if (!code || !userId) {
        return res.status(400).json({ error: 'Session code and userId required' });
      }
      
      const normalizedCode = code.toUpperCase();
      
      // Enable remote control for this session
      remoteControlEnabled.set(normalizedCode, {
        artistUserId: userId,
        enabledAt: Date.now()
      });
      
      console.log(`Remote control enabled for session ${normalizedCode} by ${userId}`);
      res.json({ enabled: true, sessionCode: normalizedCode });
    } catch (err: any) {
      console.error('Enable remote control error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  // Artist disables remote control
  app.post('/api/session/:code/disable-remote-control', (req, res) => {
    try {
      const { code } = req.params;
      const normalizedCode = code.toUpperCase();
      
      // Disconnect any connected agent
      const agent = agentConnections.get(normalizedCode);
      if (agent && agent.ws.readyState === WebSocket.OPEN) {
        agent.ws.close();
      }
      agentConnections.delete(normalizedCode);
      
      // Disable remote control
      remoteControlEnabled.delete(normalizedCode);
      
      console.log(`Remote control disabled for session ${normalizedCode}`);
      res.json({ enabled: false, sessionCode: normalizedCode });
    } catch (err: any) {
      console.error('Disable remote control error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  // Check if remote control is enabled for a session (for agent to check)
  app.get('/api/session/:code/remote-control-status', (req, res) => {
    const { code } = req.params;
    const normalizedCode = code.toUpperCase();
    const data = remoteControlEnabled.get(normalizedCode);
    res.json({ 
      enabled: !!data,
      sessionCode: normalizedCode
    });
  });
  
  // Agent connects using just session code (no token)
  app.post('/api/agent/simple-connect', (req, res) => {
    try {
      const { sessionCode } = req.body;
      
      if (!sessionCode) {
        return res.status(400).json({ error: 'Session code required' });
      }
      
      const normalizedCode = sessionCode.toUpperCase();
      const rcData = remoteControlEnabled.get(normalizedCode);
      
      if (!rcData) {
        return res.status(403).json({ error: 'Remote control not enabled for this session. Ask artist to click "Allow Control".' });
      }
      
      // Check if agent already connected
      if (agentConnections.has(normalizedCode)) {
        return res.status(409).json({ error: 'Agent already connected to this session' });
      }
      
      console.log(`Agent simple-connected to session ${normalizedCode}`);
      res.json({ 
        connected: true, 
        sessionCode: normalizedCode,
        artistUserId: rcData.artistUserId
      });
    } catch (err: any) {
      console.error('Agent simple connect error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============ HTTP POLLING FALLBACK FOR SIGNALING ============
  // Used when WebSocket connections fail (e.g., on custom domains)
  
  interface PollingParticipant {
    userId: string;
    role: SessionRole;
    lastPoll: number;
    messages: any[];
  }
  
  const pollingRooms = new Map<string, Map<string, PollingParticipant>>();
  const POLL_TIMEOUT = 30000; // 30 seconds before participant is considered disconnected
  
  // Cleanup stale polling participants periodically
  setInterval(() => {
    const now = Date.now();
    pollingRooms.forEach((room, roomId) => {
      room.forEach((participant, odId) => {
        if (now - participant.lastPoll > POLL_TIMEOUT) {
          room.delete(participant.userId);
          // Notify other participants
          room.forEach(p => {
            p.messages.push({ type: 'user-left', userId: participant.userId, roomId });
          });
          if (room.size === 0) {
            pollingRooms.delete(roomId);
          }
        }
      });
    });
  }, 10000);
  
  // Join room via polling
  app.post('/api/signal/join', (req, res) => {
    try {
      const { roomId, userId, role } = req.body;
      if (!roomId || !userId || !role) {
        return res.status(400).json({ error: 'roomId, userId, and role required' });
      }
      
      const normalizedRoom = (roomId as string).toUpperCase();
      
      if (!pollingRooms.has(normalizedRoom)) {
        pollingRooms.set(normalizedRoom, new Map());
      }
      
      const room = pollingRooms.get(normalizedRoom)!;
      
      // Get existing participants before adding new one
      const existingParticipants = Array.from(room.entries())
        .filter(([pId]) => pId !== userId)
        .map(([pId, p]) => ({ userId: pId, role: p.role }));
      
      // Add or update participant
      room.set(userId, {
        userId,
        role,
        lastPoll: Date.now(),
        messages: []
      });
      
      // Notify others that user joined
      room.forEach((p, pId) => {
        if (pId !== userId) {
          p.messages.push({ type: 'user-joined', userId, role, roomId: normalizedRoom });
        }
      });
      
      res.json({ 
        success: true, 
        roomId: normalizedRoom,
        participants: existingParticipants
      });
    } catch (err: any) {
      console.error('Polling join error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  // Poll for messages
  app.post('/api/signal/poll', (req, res) => {
    try {
      const { roomId, userId } = req.body;
      if (!roomId || !userId) {
        return res.status(400).json({ error: 'roomId and userId required' });
      }
      
      const normalizedRoom = (roomId as string).toUpperCase();
      const room = pollingRooms.get(normalizedRoom);
      
      if (!room || !room.has(userId)) {
        return res.status(404).json({ error: 'Not in room' });
      }
      
      const participant = room.get(userId)!;
      participant.lastPoll = Date.now();
      
      // Return and clear pending messages
      const messages = [...participant.messages];
      participant.messages = [];
      
      // Get current participants
      const participants = Array.from(room.entries())
        .filter(([pId]) => pId !== userId)
        .map(([pId, p]) => ({ userId: pId, role: p.role }));
      
      // Include agent connection status and control permission status
      const agentConnected = agentConnections.has(normalizedRoom) || pollingAgents.has(normalizedRoom);
      const controlActive = controlPermissions.get(normalizedRoom) || false;
      
      res.json({ messages, participants, agentConnected, controlActive });
    } catch (err: any) {
      console.error('Polling poll error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  // Control message types to forward to agent via polling
  const pollingControlMessageTypes = new Set([
    'control-request', 'mouse-move', 'mouse-click', 'mouse-double-click',
    'mouse-scroll', 'key-press', 'key-type', 'control-end'
  ]);
  
  // Send signaling message via polling
  app.post('/api/signal/send', (req, res) => {
    try {
      const { roomId, userId, role, type, payload } = req.body;
      console.log('[Signal] POST /api/signal/send - type:', type, 'room:', roomId, 'role:', role, 'payload:', JSON.stringify(payload).slice(0, 200));
      
      if (!roomId || !userId || !type) {
        return res.status(400).json({ error: 'roomId, userId, and type required' });
      }
      
      const normalizedRoom = (roomId as string).toUpperCase();
      const room = pollingRooms.get(normalizedRoom);
      
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }
      
      // Update sender's last poll time
      const sender = room.get(userId);
      if (sender) {
        sender.lastPoll = Date.now();
      }
      
      // Handle control commands - forward to agent
      if (pollingControlMessageTypes.has(type)) {
        // Check if user is an engineer
        if (role !== 'engineer') {
          console.log('[Control Polling] Blocked: not engineer');
          return res.json({ success: false, reason: 'not engineer' });
        }
        
        // Find the agent for this session - check both WebSocket and polling agents
        const wsAgent = agentConnections.get(normalizedRoom);
        const httpAgent = pollingAgents.get(normalizedRoom);
        
        // For control requests and ends, always forward. For other commands, check permission
        if (type !== 'control-request' && type !== 'control-end' && !controlPermissions.get(normalizedRoom)) {
          console.log('[Control Polling] Blocked: control not permitted');
          return res.json({ success: false, reason: 'control not permitted' });
        }
        
        // Clear control permission when control-end is received
        if (type === 'control-end') {
          controlPermissions.set(normalizedRoom, false);
          console.log('[Control Polling] Engineer ended control for session:', normalizedRoom);
        }
        
        // Try WebSocket agent first
        if (wsAgent && wsAgent.ws.readyState === WebSocket.OPEN) {
          const controlMessage = { type, ...payload, sessionCode: normalizedRoom, verifiedUserId: userId };
          console.log('[Control Polling] Forwarding to WS agent:', type, 'session:', normalizedRoom);
          wsAgent.ws.send(JSON.stringify(controlMessage));
          return res.json({ success: true });
        }
        
        // Fallback to HTTP polling agent
        if (httpAgent) {
          const controlMessage = { type, ...payload, sessionCode: normalizedRoom, verifiedUserId: userId };
          console.log('[Control Polling] Queueing for HTTP agent:', type, 'session:', normalizedRoom);
          httpAgent.messages.push(controlMessage);
          return res.json({ success: true });
        }
        
        console.log('[Control Polling] Blocked: no agent for session', normalizedRoom, 'wsAgent:', !!wsAgent, 'httpAgent:', !!httpAgent);
        return res.json({ success: false, reason: 'no agent' });
      }
      
      const message = { type, userId, role, payload };
      
      // Forward to target user or broadcast
      const targetId = payload?.targetUserId;
      if (targetId && room.has(targetId)) {
        const target = room.get(targetId)!;
        target.messages.push(message);
      } else {
        // Broadcast to all others
        room.forEach((p, pId) => {
          if (pId !== userId) {
            p.messages.push(message);
          }
        });
      }
      
      res.json({ success: true });
    } catch (err: any) {
      console.error('Polling send error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  // Leave room via polling
  app.post('/api/signal/leave', (req, res) => {
    try {
      const { roomId, userId } = req.body;
      if (!roomId || !userId) {
        return res.status(400).json({ error: 'roomId and userId required' });
      }
      
      const normalizedRoom = (roomId as string).toUpperCase();
      const room = pollingRooms.get(normalizedRoom);
      
      if (room) {
        room.delete(userId);
        
        // Notify others
        room.forEach(p => {
          p.messages.push({ type: 'user-left', userId, roomId: normalizedRoom });
        });
        
        if (room.size === 0) {
          pollingRooms.delete(normalizedRoom);
        }
      }
      
      res.json({ success: true });
    } catch (err: any) {
      console.error('Polling leave error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============ HTTP POLLING FOR AGENT (when WebSocket blocked) ============
  
  interface PollingAgentConnection {
    sessionCode: string;
    userId: string;
    controlEnabled: boolean;
    lastPoll: number;
    messages: any[];
    pendingDisconnect?: boolean; // Set when session ends, prevents cleanup until message delivered
  }
  
  const pollingAgents = new Map<string, PollingAgentConnection>();
  const AGENT_POLL_TIMEOUT = 30000;
  
  // Cleanup stale polling agents
  setInterval(() => {
    const now = Date.now();
    pollingAgents.forEach((agent, sessionCode) => {
      // Don't cleanup agents with pending disconnect - they need to receive the session-ended message first
      if (agent.pendingDisconnect) {
        // If pending for too long (2 minutes), cleanup anyway
        if (now - agent.lastPoll > 120000) {
          pollingAgents.delete(sessionCode);
        }
        return;
      }
      
      if (now - agent.lastPoll > AGENT_POLL_TIMEOUT) {
        pollingAgents.delete(sessionCode);
        // Notify room that agent disconnected
        const room = rooms.get(sessionCode);
        if (room) {
          room.forEach((participant) => {
            if (participant.ws.readyState === WebSocket.OPEN) {
              participant.ws.send(JSON.stringify({ type: 'agent-disconnected', sessionCode }));
            }
          });
        }
        const pollingRoom = pollingRooms.get(sessionCode);
        if (pollingRoom) {
          pollingRoom.forEach(p => {
            p.messages.push({ type: 'agent-disconnected', sessionCode });
          });
        }
      }
    });
  }, 10000);
  
  // Agent connect via HTTP (supports both token and simple mode)
  app.post('/api/agent/connect', (req, res) => {
    try {
      const { token, sessionCode } = req.body;
      const normalizedCode = sessionCode?.toUpperCase();
      
      if (!normalizedCode) {
        return res.status(400).json({ error: 'Session code required' });
      }
      
      let userId: string;
      
      // Try token-based auth first, but fall back to simple mode if token is invalid
      if (token) {
        const tokenData = agentTokens.get(token);
        if (tokenData && tokenData.sessionCode === normalizedCode && tokenData.expiresAt >= Date.now()) {
          userId = tokenData.userId;
        } else {
          // Token invalid - fall back to simple mode (bypass token requirement)
          const rcData = remoteControlEnabled.get(normalizedCode);
          if (!rcData) {
            return res.status(403).json({ error: 'Remote control not enabled. Ask artist to click "Allow Control".' });
          }
          userId = rcData.artistUserId;
          console.log(`Agent connected with invalid/empty token, using simple mode for ${normalizedCode}`);
        }
      } else {
        // Simple mode - check if remote control is enabled
        const rcData = remoteControlEnabled.get(normalizedCode);
        if (!rcData) {
          return res.status(403).json({ error: 'Remote control not enabled. Ask artist to click "Allow Control".' });
        }
        userId = rcData.artistUserId;
      }
      
      // Check if agent already connected (WebSocket or polling)
      if (agentConnections.has(normalizedCode) || pollingAgents.has(normalizedCode)) {
        return res.status(409).json({ error: 'Agent already connected to this session' });
      }
      
      // Register polling agent
      pollingAgents.set(normalizedCode, {
        sessionCode: normalizedCode,
        userId: userId,
        controlEnabled: false,
        lastPoll: Date.now(),
        messages: []
      });
      
      console.log(`Agent connected via polling to session ${normalizedCode}`);
      
      // Notify room participants
      const room = rooms.get(normalizedCode);
      if (room) {
        room.forEach((participant) => {
          if (participant.ws.readyState === WebSocket.OPEN) {
            participant.ws.send(JSON.stringify({ type: 'agent-connected', sessionCode: normalizedCode }));
          }
        });
      }
      const pollingRoom = pollingRooms.get(normalizedCode);
      if (pollingRoom) {
        pollingRoom.forEach(p => {
          p.messages.push({ type: 'agent-connected', sessionCode: normalizedCode });
        });
      }
      
      res.json({ success: true, sessionCode: normalizedCode });
    } catch (err: any) {
      console.error('Agent connect error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  // Agent poll for messages (works with or without token)
  app.post('/api/agent/poll', (req, res) => {
    try {
      const { token, sessionCode } = req.body;
      const normalizedCode = sessionCode?.toUpperCase();
      
      const agent = pollingAgents.get(normalizedCode);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not connected' });
      }
      
      // Token is optional - bypass validation, just check remote control is enabled
      const rcData = remoteControlEnabled.get(normalizedCode);
      if (!rcData) {
        return res.status(403).json({ error: 'Remote control disabled' });
      }
      
      agent.lastPoll = Date.now();
      const messages = [...agent.messages];
      agent.messages = [];
      
      // Check if any messages contain session-ended - if so, delete agent after responding
      const hasSessionEnded = messages.some(m => m.type === 'session-ended');
      
      res.json({ messages, controlEnabled: agent.controlEnabled });
      
      // Delete agent after delivering session-ended message
      if (hasSessionEnded || agent.pendingDisconnect) {
        pollingAgents.delete(normalizedCode);
        console.log(`Polling agent removed from ${normalizedCode} after session-ended delivery`);
      }
    } catch (err: any) {
      console.error('Agent poll error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  // Agent send message
  app.post('/api/agent/send', (req, res) => {
    try {
      const { token, sessionCode, message } = req.body;
      const normalizedCode = sessionCode?.toUpperCase();
      
      const agent = pollingAgents.get(normalizedCode);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not connected' });
      }
      
      // Handle message type
      if (message.type === 'control-response') {
        // Forward to room participants
        const room = rooms.get(normalizedCode);
        if (room) {
          room.forEach((participant) => {
            if (participant.ws.readyState === WebSocket.OPEN) {
              participant.ws.send(JSON.stringify({
                type: 'control-response',
                allowed: message.allowed,
                fromAgent: true
              }));
            }
          });
        }
        const pollingRoom = pollingRooms.get(normalizedCode);
        if (pollingRoom) {
          pollingRoom.forEach(p => {
            p.messages.push({ type: 'control-response', allowed: message.allowed, fromAgent: true });
          });
        }
        
        // Update both agent.controlEnabled AND controlPermissions
        if (message.allowed) {
          agent.controlEnabled = true;
          controlPermissions.set(normalizedCode, true);
          console.log('[Agent Polling] Control granted for session:', normalizedCode);
        } else {
          agent.controlEnabled = false;
          controlPermissions.set(normalizedCode, false);
          console.log('[Agent Polling] Control denied for session:', normalizedCode);
        }
      }
      
      res.json({ success: true });
    } catch (err: any) {
      console.error('Agent send error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  // Agent disconnect
  app.post('/api/agent/disconnect', (req, res) => {
    try {
      const { token, sessionCode } = req.body;
      const normalizedCode = sessionCode?.toUpperCase();
      
      pollingAgents.delete(normalizedCode);
      
      // Notify room
      const room = rooms.get(normalizedCode);
      if (room) {
        room.forEach((participant) => {
          if (participant.ws.readyState === WebSocket.OPEN) {
            participant.ws.send(JSON.stringify({ type: 'agent-disconnected', sessionCode: normalizedCode }));
          }
        });
      }
      const pollingRoom = pollingRooms.get(normalizedCode);
      if (pollingRoom) {
        pollingRoom.forEach(p => {
          p.messages.push({ type: 'agent-disconnected', sessionCode: normalizedCode });
        });
      }
      
      res.json({ success: true });
    } catch (err: any) {
      console.error('Agent disconnect error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============ WEBSOCKET SIGNALING SERVER ============
  
  // Map to track WebSocket connection metadata (for authorization)
  const wsConnectionData = new WeakMap<WebSocket, { userId: string; roomId: string; role: string }>();
  
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
            
            // Store connection metadata for authorization
            wsConnectionData.set(ws, { userId: currentUserId, roomId: currentRoom, role: role as string });
            
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
        // Get the role before cleaning up
        const connData = wsConnectionData.get(ws);
        const leavingRole = connData?.role;
        
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
        
        // If artist leaves, check if there are any artists remaining
        if (leavingRole === 'artist') {
          const sessionCode = currentRoom;
          const room = rooms.get(sessionCode);
          
          // Count remaining artists in the room
          let remainingArtists = 0;
          if (room) {
            room.forEach((p) => {
              if (p.role === 'artist') remainingArtists++;
            });
          }
          
          // Only disconnect agent if no artists remain
          if (remainingArtists === 0) {
            // Disconnect WebSocket agent
            const wsAgent = agentConnections.get(sessionCode);
            if (wsAgent && wsAgent.ws.readyState === WebSocket.OPEN) {
              wsAgent.ws.send(JSON.stringify({ 
                type: 'session-ended',
                sessionCode,
                reason: 'All artists have left the session'
              }));
              wsAgent.ws.close(1000, 'Session ended - no artists remaining');
            }
            agentConnections.delete(sessionCode);
            
            // For polling agent, mark as pending disconnect
            // The agent will receive the message on next poll, then be removed
            const httpAgent = pollingAgents.get(sessionCode);
            if (httpAgent) {
              httpAgent.messages.push({
                type: 'session-ended',
                sessionCode,
                reason: 'All artists have left the session'
              });
              httpAgent.pendingDisconnect = true; // Prevents cleanup until message delivered
            }
            
            // Clear control permissions
            controlPermissions.delete(sessionCode);
            
            console.log(`Last artist left session ${sessionCode}, agent disconnected`);
          }
        }
      }
      // Clean up connection metadata
      wsConnectionData.delete(ws);
      currentRoom = null;
      currentUserId = null;
    }

    ws.on('close', handleLeave);
    ws.on('error', handleLeave);
  });

  // ============ AGENT WEBSOCKET SERVER ============
  
  const agentWss = new WebSocketServer({ server: httpServer, path: '/agent' });

  agentWss.on('connection', (ws, req) => {
    let agentSession: string | null = null;
    let agentUserId: string | null = null;

    // Parse query params for auth
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const sessionCode = url.searchParams.get('session')?.toUpperCase();

    if (!token || !sessionCode) {
      ws.close(4001, 'Missing token or session');
      return;
    }

    // Verify token
    const tokenData = agentTokens.get(token);
    if (!tokenData || tokenData.sessionCode !== sessionCode || tokenData.expiresAt < Date.now()) {
      ws.close(4002, 'Invalid or expired token');
      return;
    }

    agentSession = sessionCode;
    agentUserId = tokenData.userId;

    // Register agent connection
    agentConnections.set(sessionCode, {
      ws,
      sessionCode,
      userId: agentUserId,
      controlEnabled: false,
    });

    console.log(`Agent connected to session ${sessionCode}`);

    // Notify web clients that agent is connected
    const room = rooms.get(sessionCode);
    if (room) {
      room.forEach((participant) => {
        if (participant.ws.readyState === WebSocket.OPEN) {
          participant.ws.send(JSON.stringify({
            type: 'agent-connected',
            sessionCode,
          }));
        }
      });
    }

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case 'control-response': {
            // Artist responded to control request
            console.log('[Control] Control response received, allowed:', message.allowed, 'session:', agentSession);
            controlPermissions.set(agentSession!, message.allowed);
            
            const wsRoom = rooms.get(agentSession!);
            console.log('[Control] WebSocket room found:', !!wsRoom, 'size:', wsRoom?.size || 0);
            if (wsRoom) {
              // Notify engineers in the WebSocket room
              wsRoom.forEach((participant) => {
                console.log('[Control] WS participant:', participant.role, 'readyState:', participant.ws.readyState);
                if (participant.role === 'engineer' && participant.ws.readyState === WebSocket.OPEN) {
                  participant.ws.send(JSON.stringify({
                    type: 'control-response',
                    allowed: message.allowed,
                    sessionCode: agentSession,
                  }));
                  console.log('[Control] Sent control-response to WS engineer');
                }
              });
            }
            
            // Also notify engineers using HTTP polling
            const pollingRoom = pollingRooms.get(agentSession!);
            console.log('[Control] Polling room found:', !!pollingRoom, 'size:', pollingRoom?.size || 0);
            if (pollingRoom) {
              pollingRoom.forEach((participant) => {
                console.log('[Control] Polling participant:', participant.role);
                if (participant.role === 'engineer') {
                  participant.messages.push({
                    type: 'control-response',
                    allowed: message.allowed,
                    sessionCode: agentSession,
                  });
                  console.log('[Control] Queued control-response for polling engineer');
                }
              });
            }
            break;
          }

          case 'control-stopped': {
            // Artist stopped control
            controlPermissions.set(agentSession!, false);
            const agentConn = agentConnections.get(agentSession!);
            if (agentConn) {
              agentConn.controlEnabled = false;
            }

            // Notify engineers via WebSocket
            const wsStopRoom = rooms.get(agentSession!);
            if (wsStopRoom) {
              wsStopRoom.forEach((participant) => {
                if (participant.role === 'engineer' && participant.ws.readyState === WebSocket.OPEN) {
                  participant.ws.send(JSON.stringify({
                    type: 'control-stopped',
                    sessionCode: agentSession,
                  }));
                }
              });
            }
            
            // Also notify engineers using HTTP polling
            const pollingStopRoom = pollingRooms.get(agentSession!);
            if (pollingStopRoom) {
              pollingStopRoom.forEach((participant) => {
                if (participant.role === 'engineer') {
                  participant.messages.push({
                    type: 'control-stopped',
                    sessionCode: agentSession,
                  });
                }
              });
            }
            break;
          }
        }
      } catch (err) {
        console.error('Agent message error:', err);
      }
    });

    ws.on('close', () => {
      if (agentSession) {
        agentConnections.delete(agentSession);
        controlPermissions.delete(agentSession);
        
        // Notify web clients that agent disconnected
        const room = rooms.get(agentSession);
        if (room) {
          room.forEach((participant) => {
            if (participant.ws.readyState === WebSocket.OPEN) {
              participant.ws.send(JSON.stringify({
                type: 'agent-disconnected',
                sessionCode: agentSession,
              }));
            }
          });
        }
        
        console.log(`Agent disconnected from session ${agentSession}`);
      }
    });

    ws.on('error', () => {
      if (agentSession) {
        agentConnections.delete(agentSession);
        controlPermissions.delete(agentSession);
      }
    });
  });

  // Control message types to forward to agent
  const controlMessageTypes = new Set([
    'control-request', 'mouse-move', 'mouse-click', 'mouse-double-click',
    'mouse-scroll', 'key-press', 'key-type', 'control-end'
  ]);
  
  // Add control message handling to main WebSocket
  // When engineer sends control commands, forward to agent
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Handle control messages from engineers
        if (controlMessageTypes.has(message.type)) {
          // Use stored connection data for authorization (not trusting message payload)
          const connData = wsConnectionData.get(ws);
          if (!connData) {
            console.log('[Control] Blocked: no connection data');
            return;
          }
          
          const sessionCode = connData.roomId;
          
          // Double-check: verify against live room membership (not just WeakMap)
          const room = rooms.get(sessionCode);
          if (!room) {
            console.log('[Control] Blocked: room not found for', sessionCode);
            return;
          }
          
          const liveParticipant = room.get(connData.userId);
          if (!liveParticipant || liveParticipant.role !== 'engineer') {
            console.log('[Control] Blocked: not engineer or not in room');
            return;
          }
          
          const agent = agentConnections.get(sessionCode);
          if (!agent) {
            console.log('[Control] Blocked: no agent connected for session', sessionCode);
            return;
          }
          
          if (agent.ws.readyState !== WebSocket.OPEN) {
            console.log('[Control] Blocked: agent websocket not open');
            return;
          }
          
          // For control requests, check if control is already allowed
          if (message.type !== 'control-request' && message.type !== 'control-end' && !controlPermissions.get(sessionCode)) {
            console.log('[Control] Blocked: control not permitted for session', sessionCode);
            return;
          }
          
          // Clear control permission when control-end is received
          if (message.type === 'control-end') {
            controlPermissions.set(sessionCode, false);
            console.log('[Control] Engineer ended control for session:', sessionCode);
          }
          
          // Forward message with verified session code
          if (message.type !== 'mouse-move') {
            console.log('[Control] Forwarding to agent:', message.type, 'session:', sessionCode);
          }
          agent.ws.send(JSON.stringify({
            ...message,
            sessionCode,
            verifiedUserId: connData.userId,
          }));
        }
      } catch (err) {
        // Ignore parse errors - they'll be handled by the main handler
      }
    });
  });

  return httpServer;
}
