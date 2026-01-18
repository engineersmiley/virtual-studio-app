import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const recordings = pgTable("recordings", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  filename: text("filename").notNull(),
  fileSize: integer("file_size").notNull(),
  duration: integer("duration").notNull(), // in seconds
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
