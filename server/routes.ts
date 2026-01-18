import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";

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
    fileSize: 500 * 1024 * 1024, // 500MB limit
  }
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Serve uploaded files statically
  app.use('/uploads', express.static(uploadDir));

  app.get(api.recordings.list.path, async (req, res) => {
    const recordings = await storage.getRecordings();
    res.json(recordings);
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

      // Metadata comes as a JSON string in 'data' field or individual fields
      // For simplicity with standard FormData, we'll extract fields from req.body
      
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
      // Try to delete file
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

  return httpServer;
}
