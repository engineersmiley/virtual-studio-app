import { db } from "./db";
import {
  recordings,
  type Recording,
  type InsertRecording
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getRecordings(): Promise<Recording[]>;
  getRecording(id: number): Promise<Recording | undefined>;
  createRecording(recording: InsertRecording): Promise<Recording>;
  deleteRecording(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
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
