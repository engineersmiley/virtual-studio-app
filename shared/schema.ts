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
