import { db } from "./db";
import {
  recordings,
  sessions,
  type Recording,
  type InsertRecording,
  type Session,
  type InsertSession
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

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
}

export const storage = new DatabaseStorage();
