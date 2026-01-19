# Virtual Studio - Remote Recording Studio

## Overview

Virtual Studio is a real-time remote recording studio application that enables artists, engineers, producers, and collaborators to work together remotely. The platform supports WebRTC-based audio/video streaming, session-based recording with room codes, and a library for managing saved recordings. Built with a React frontend and Express backend, it uses PostgreSQL for persistence and WebSocket for real-time signaling.

The app is PWA-enabled and can be installed on mobile and desktop devices.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight alternative to React Router)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with a cyberpunk-themed design system (neon cyan, magenta, electric purple)
- **UI Components**: shadcn/ui component library (Radix UI primitives)
- **Animations**: Framer Motion for smooth transitions
- **Build Tool**: Vite with HMR support

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Pattern**: RESTful endpoints defined in shared route contracts
- **Real-time**: WebSocket server for WebRTC signaling (room-based peer connections)
- **File Handling**: Multer for recording uploads (stored in /uploads directory)

### Data Layer
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with Zod schema validation
- **Schema Location**: `shared/schema.ts` (sessions, recordings tables)
- **Migrations**: Drizzle Kit (`npm run db:push`)

### Key Features
1. **Session Management**: Create/join rooms via 6-character codes (e.g., "ABC123")
2. **Role-Based Access**: Four roles - Artist (broadcaster), Engineer (recorder), Producer (view-only supervisor), Other (guest/collaborator)
3. **WebRTC Streaming**: Peer-to-peer audio/video with STUN servers for NAT traversal, supports multiple simultaneous viewers
4. **Recording**: Browser-based MediaRecorder with Web Audio API mixing (engineer only)
5. **Audio Visualization**: Real-time frequency analysis rendered to canvas
6. **PWA Support**: Installable as an app on desktop and mobile, with iOS install instructions
7. **Stripe Subscription**: Monthly Pro subscription at $9.99/month with checkout, customer portal, and webhook handling

### Shared Code Pattern
The `shared/` directory contains:
- `schema.ts`: Database table definitions and Zod insert schemas
- `routes.ts`: API route contracts with input/output type definitions

This allows type-safe API calls between frontend and backend.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store (connection via `DATABASE_URL` environment variable)
- **connect-pg-simple**: Session storage (available but sessions may use memory store)

### Third-Party Services
- **Google STUN Servers**: Used for WebRTC NAT traversal (`stun.l.google.com:19302`)
- **Stripe**: Payment processing for subscriptions (managed via Replit connector)
  - Webhook endpoint: `/api/stripe/webhook`
  - Checkout: `/api/stripe/checkout`
  - Customer portal: `/api/stripe/portal`
  - Product: "Virtual Studio Pro" at $9.99/month

### Browser APIs Required
- **MediaDevices API**: Screen capture and microphone access
- **Web Audio API**: Audio mixing and visualization
- **MediaRecorder API**: Recording captured streams

### Key NPM Packages
- `drizzle-orm` / `drizzle-kit`: Database ORM and migrations
- `ws`: WebSocket server for signaling
- `multer`: File upload handling
- `@tanstack/react-query`: Data fetching and caching
- `framer-motion`: UI animations
- `date-fns`: Date formatting