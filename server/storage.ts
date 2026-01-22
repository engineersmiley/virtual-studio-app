import { db } from "./db";
import crypto from "crypto";
import {
  recordings,
  sessions,
  users,
  promoCodes,
  type Recording,
  type InsertRecording,
  type Session,
  type InsertSession,
  type User,
  type InsertUser,
  type PromoCode,
  type InsertPromoCode
} from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export interface IStorage {
  // Sessions
  createSession(name: string): Promise<Session>;
  getSession(id: string): Promise<Session | undefined>;
  getSessions(): Promise<Session[]>;
  endSession(id: string): Promise<Session | undefined>;
  
  // Recordings
  getRecordings(): Promise<Recording[]>;
  getRecording(id: number): Promise<Recording | undefined>;
  createRecording(recording: InsertRecording): Promise<Recording>;
  deleteRecording(id: number): Promise<void>;
  
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserStripeInfo(userId: string, stripeInfo: { stripeCustomerId?: string; stripeSubscriptionId?: string; subscriptionStatus?: string }): Promise<User | undefined>;
  updateUserPromoCode(email: string, promoCode: string): Promise<User | undefined>;
  
  // Promo Codes
  getPromoCode(code: string): Promise<PromoCode | undefined>;
  createPromoCode(promo: InsertPromoCode): Promise<PromoCode>;
  getAllPromoCodes(): Promise<PromoCode[]>;
  incrementPromoCodeUsage(code: string): Promise<PromoCode | undefined>;
  deactivatePromoCode(code: string): Promise<PromoCode | undefined>;
  
  // Stripe queries
  getSubscription(subscriptionId: string): Promise<any>;
  listProducts(active?: boolean): Promise<any[]>;
  listPrices(active?: boolean): Promise<any[]>;
}

export class DatabaseStorage implements IStorage {
  // Sessions
  async createSession(name: string): Promise<Session> {
    const id = generateRoomCode();
    const [session] = await db.insert(sessions).values({ id, name, isActive: true }).returning();
    return session;
  }

  async getSession(id: string): Promise<Session | undefined> {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, id.toUpperCase()));
    return session;
  }

  async getSessions(): Promise<Session[]> {
    return await db.select().from(sessions).orderBy(desc(sessions.createdAt));
  }

  async endSession(id: string): Promise<Session | undefined> {
    const [session] = await db.update(sessions)
      .set({ isActive: false })
      .where(eq(sessions.id, id.toUpperCase()))
      .returning();
    return session;
  }

  // Recordings
  async getRecordings(): Promise<Recording[]> {
    return await db.select().from(recordings).orderBy(desc(recordings.createdAt));
  }

  async getRecording(id: number): Promise<Recording | undefined> {
    const [recording] = await db.select().from(recordings).where(eq(recordings.id, id));
    return recording;
  }

  async createRecording(insertRecording: InsertRecording): Promise<Recording> {
    const [recording] = await db.insert(recordings).values(insertRecording).returning();
    return recording;
  }

  async deleteRecording(id: number): Promise<void> {
    await db.delete(recordings).where(eq(recordings.id, id));
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  async updateUserStripeInfo(userId: string, stripeInfo: { stripeCustomerId?: string; stripeSubscriptionId?: string; subscriptionStatus?: string }): Promise<User | undefined> {
    const [user] = await db.update(users).set(stripeInfo).where(eq(users.id, userId)).returning();
    return user;
  }

  async updateUserPromoCode(email: string, promoCode: string): Promise<User | undefined> {
    const existing = await this.getUserByEmail(email);
    if (existing) {
      const [user] = await db.update(users)
        .set({ promoCode, promoGrantedAt: new Date() })
        .where(eq(users.email, email))
        .returning();
      return user;
    } else {
      const id = crypto.randomUUID();
      const [user] = await db.insert(users)
        .values({ id, email, promoCode, promoGrantedAt: new Date() })
        .returning();
      return user;
    }
  }

  // Promo Codes
  async getPromoCode(code: string): Promise<PromoCode | undefined> {
    const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.code, code.toUpperCase()));
    return promo;
  }

  async createPromoCode(promo: InsertPromoCode): Promise<PromoCode> {
    const [newPromo] = await db.insert(promoCodes)
      .values({ ...promo, code: promo.code.toUpperCase() })
      .returning();
    return newPromo;
  }

  async getAllPromoCodes(): Promise<PromoCode[]> {
    return await db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt));
  }

  async incrementPromoCodeUsage(code: string): Promise<PromoCode | undefined> {
    const [promo] = await db.update(promoCodes)
      .set({ currentUses: sql`${promoCodes.currentUses} + 1` })
      .where(eq(promoCodes.code, code.toUpperCase()))
      .returning();
    return promo;
  }

  async deactivatePromoCode(code: string): Promise<PromoCode | undefined> {
    const [promo] = await db.update(promoCodes)
      .set({ isActive: false })
      .where(eq(promoCodes.code, code.toUpperCase()))
      .returning();
    return promo;
  }

  // Stripe queries - query from stripe schema (managed by stripe-replit-sync)
  async getSubscription(subscriptionId: string): Promise<any> {
    const result = await db.execute(
      sql`SELECT * FROM stripe.subscriptions WHERE id = ${subscriptionId}`
    );
    return result.rows[0] || null;
  }

  async listProducts(active = true): Promise<any[]> {
    const result = await db.execute(
      sql`SELECT * FROM stripe.products WHERE active = ${active}`
    );
    return result.rows;
  }

  async listPrices(active = true): Promise<any[]> {
    // Only return recurring prices for subscriptions, prefer live mode
    const liveResult = await db.execute(
      sql`SELECT * FROM stripe.prices WHERE active = ${active} AND livemode = true AND type = 'recurring'`
    );
    if (liveResult.rows.length > 0) {
      return liveResult.rows;
    }
    // Fallback to test mode recurring prices for development
    const result = await db.execute(
      sql`SELECT * FROM stripe.prices WHERE active = ${active} AND type = 'recurring'`
    );
    return result.rows;
  }

  async getSubscriptionByCustomerId(customerId: string): Promise<any> {
    const result = await db.execute(
      sql`SELECT * FROM stripe.subscriptions WHERE customer = ${customerId} ORDER BY created DESC LIMIT 1`
    );
    return result.rows[0] || null;
  }
}

export const storage = new DatabaseStorage();
