import { pgTable, text, serial, integer, timestamp, boolean, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users for subscription management
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  createdAt: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// Sessions for remote collaboration
export const sessions = pgTable("sessions", {
  id: varchar("id", { length: 8 }).primaryKey(), // Short room code like "ABC123"
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  isActive: boolean("is_active").default(true),
});

export const insertSessionSchema = createInsertSchema(sessions).omit({ 
  createdAt: true 
});

export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;

// Recordings from sessions
export const recordings = pgTable("recordings", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 8 }),
  title: text("title").notNull(),
  description: text("description"),
  filename: text("filename").notNull(),
  fileSize: integer("file_size").notNull(),
  duration: integer("duration").notNull(),
  mimeType: text("mime_type").notNull(),
  isHighQuality: boolean("is_high_quality").default(false),
  sessionName: text("session_name"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRecordingSchema = createInsertSchema(recordings).omit({ 
  id: true, 
  createdAt: true 
});

export type Recording = typeof recordings.$inferSelect;
export type InsertRecording = z.infer<typeof insertRecordingSchema>;

// WebRTC Signaling message types
export const SignalingMessageType = {
  JOIN: 'join',
  OFFER: 'offer',
  ANSWER: 'answer',
  ICE_CANDIDATE: 'ice-candidate',
  LEAVE: 'leave',
  USER_JOINED: 'user-joined',
  USER_LEFT: 'user-left',
  ERROR: 'error',
} as const;

// Session roles
export const SessionRoles = ['artist', 'engineer', 'producer', 'other'] as const;
export type SessionRole = typeof SessionRoles[number];

export type SignalingMessage = {
  type: keyof typeof SignalingMessageType;
  roomId: string;
  userId: string;
  role: SessionRole;
  payload?: any;
};

// Remote Control Message Types
export const ControlMessageType = {
  CONTROL_REQUEST: 'control-request',
  CONTROL_RESPONSE: 'control-response',
  CONTROL_END: 'control-end',
  MOUSE_MOVE: 'mouse-move',
  MOUSE_CLICK: 'mouse-click',
  MOUSE_DOUBLE_CLICK: 'mouse-double-click',
  MOUSE_SCROLL: 'mouse-scroll',
  KEY_PRESS: 'key-press',
  KEY_TYPE: 'key-type',
  CONTROL_STOPPED: 'control-stopped',
} as const;

export type ControlMessageTypeKey = keyof typeof ControlMessageType;

// Control message schemas
export const controlRequestSchema = z.object({
  type: z.literal('control-request'),
  sessionCode: z.string(),
  fromUserId: z.string(),
  fromName: z.string(),
  fromRole: z.enum(['engineer']),
});

export const controlResponseSchema = z.object({
  type: z.literal('control-response'),
  sessionCode: z.string(),
  allowed: z.boolean(),
});

export const mouseMoveSchema = z.object({
  type: z.literal('mouse-move'),
  x: z.number(),
  y: z.number(),
  timestamp: z.number().optional(),
});

export const mouseClickSchema = z.object({
  type: z.literal('mouse-click'),
  x: z.number(),
  y: z.number(),
  button: z.enum(['left', 'right', 'middle']).default('left'),
});

export const mouseDoubleClickSchema = z.object({
  type: z.literal('mouse-double-click'),
  x: z.number(),
  y: z.number(),
});

export const mouseScrollSchema = z.object({
  type: z.literal('mouse-scroll'),
  deltaX: z.number(),
  deltaY: z.number(),
});

export const keyPressSchema = z.object({
  type: z.literal('key-press'),
  key: z.string(),
  modifiers: z.object({
    ctrl: z.boolean().optional(),
    alt: z.boolean().optional(),
    shift: z.boolean().optional(),
    meta: z.boolean().optional(),
  }).optional(),
});

export const keyTypeSchema = z.object({
  type: z.literal('key-type'),
  text: z.string(),
});

export const controlEndSchema = z.object({
  type: z.literal('control-end'),
  sessionCode: z.string(),
});

// Union of all control messages
export const controlMessageSchema = z.discriminatedUnion('type', [
  controlRequestSchema,
  controlResponseSchema,
  mouseMoveSchema,
  mouseClickSchema,
  mouseDoubleClickSchema,
  mouseScrollSchema,
  keyPressSchema,
  keyTypeSchema,
  controlEndSchema,
]);

export type ControlMessage = z.infer<typeof controlMessageSchema>;
export type ControlRequest = z.infer<typeof controlRequestSchema>;
export type ControlResponse = z.infer<typeof controlResponseSchema>;
export type MouseMove = z.infer<typeof mouseMoveSchema>;
export type MouseClick = z.infer<typeof mouseClickSchema>;
export type MouseScroll = z.infer<typeof mouseScrollSchema>;
export type KeyPress = z.infer<typeof keyPressSchema>;
export type KeyType = z.infer<typeof keyTypeSchema>;

// Agent connection token
export const agentTokenSchema = z.object({
  sessionCode: z.string().length(6),
  userId: z.string(),
  email: z.string().email(),
  role: z.enum(['artist']),
  expiresAt: z.number(),
});

export type AgentToken = z.infer<typeof agentTokenSchema>;
