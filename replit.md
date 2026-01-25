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
- **Real-time**: WebSocket server for WebRTC signaling with HTTP polling fallback
- **File Handling**: Multer for recording uploads (stored in /uploads directory)

### Signaling Transport
The app uses WebSocket for real-time signaling with automatic HTTP polling fallback:
- **WebSocket Primary**: Attempts connection with 3 retries and exponential backoff (max 5s)
- **HTTP Polling Fallback**: If WebSocket fails, switches to HTTP polling (500ms interval)
- **Polling Endpoints**: `/api/signal/join`, `/api/signal/poll`, `/api/signal/send`, `/api/signal/leave`
- **Transport Helper**: `isTransportOpen()` function handles both WebSocket and PollingTransport states
- **Use Case**: Custom domains that return 502 for WebSocket still work via HTTP polling

### Data Layer
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with Zod schema validation
- **Schema Location**: `shared/schema.ts` (sessions, recordings tables)
- **Migrations**: Drizzle Kit (`npm run db:push`)

### Key Features
1. **Session Management**: Create/join rooms via 6-character codes (e.g., "ABC123")
2. **Role-Based Access**: Four roles - Artist (broadcaster), Engineer (recorder + can broadcast for teaching), Producer (can broadcast for beat-making), Other (guest/collaborator viewer)
3. **WebRTC Streaming**: Peer-to-peer audio/video with STUN servers for NAT traversal, supports multiple simultaneous viewers
4. **Recording**: Browser-based MediaRecorder with Web Audio API mixing (engineer only)
5. **Audio Visualization**: Real-time frequency analysis rendered to canvas
10. **Promo Codes**: Special access codes for free subscriptions without payment
    - Create codes via API: `POST /api/promo/create` with `{code, description, maxUses, expiresAt}`
    - Users redeem on subscription page via "Enter Promo Code" button
    - Codes can have usage limits and expiration dates
    - Manage codes via: `GET /api/promo/list`, `POST /api/promo/deactivate`
6. **PWA Support**: Installable as an app on desktop and mobile, with iOS install instructions
7. **Stripe Subscription**: Monthly Pro subscription at $9.99/month with checkout, customer portal, and webhook handling
8. **Remote Control**: 
   - **Pointer Overlay**: Engineers can show click position on artist's screen via WebRTC data channels
   - **Virtual Studio Agent**: Electron desktop app for full mouse/keyboard control with consent flow (download at /remote-control)
   - **Phone Control**: Mobile-friendly touch controls for engineers on any device, featuring touchpad for mouse movement, tap/swipe gestures, virtual keyboard with modifier keys, and quick shortcuts
9. **Producer Audio Sharing**: Producers can share their computer audio so all participants can hear beats/music being made live. Audio streams are auto-mixed with artist's stream via hidden audio elements.

### Remote Control Security Model
The Virtual Studio Agent uses a multi-layered security approach:
1. **Token Binding**: Agent tokens are only issued when an artist is actively in the session, bound to their userId
2. **Rate Limiting**: Max 3 tokens per session per hour to prevent abuse
3. **Single Agent**: Only one agent can connect to a session at a time
4. **Explicit Consent**: Artist must click "Allow" in a dialog for each control request
5. **Live Authorization**: Control commands verified against live room membership (engineer role required)
6. **WebSocket-Bound**: Authorization uses connection metadata, not client-supplied payload

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

## Mobile Touch Handling

The app uses a touch guard pattern to prevent double-trigger issues on iOS Safari:
- **Problem**: iOS fires both `touchend` and a synthetic `click` event, causing buttons to trigger twice
- **Solution**: 500ms global suppression window after any touch event
- **Implementation**: `handleTouchWithGuard()` and `handleClickWithTouchGuard()` helper functions in Session.tsx
- **Affected buttons**: All audio toggle buttons, fullscreen button
- **Important**: Do NOT call `e.preventDefault()` in touch handlers for audio buttons - it breaks iOS user gesture requirements for audio playback
- **Audio Enable**: Audio toggle uses dedicated `handleAudioTouch` and `enableAudioSync` functions that call `play()` synchronously within the user gesture context - this is critical for iOS Safari which requires the play() call to be in the same synchronous call stack as the user gesture

## Desktop Keyboard Capture

When the engineer has remote control active (`fullControlActive`):
- Keyboard events are captured via `keydown` listener
- Printable characters (single chars without Ctrl/Alt/Cmd) sent as `key-type` messages
- Special keys and modified keys sent as `key-press` with modifiers object
- Events are suppressed for input/textarea elements
- Browser shortcuts (F5, F12) are not prevented

## Virtual Studio Agent (Desktop App)

### Location
`virtual-studio-agent/` - Electron desktop application for remote control

### Agent Features
- **Keyboard Shortcuts**: Uses AppleScript on macOS for fullscreen app compatibility (Pro Tools, Logic, etc.)
- **Right-Click Menu**: Simulates secondary click with proper event handling
- **Typing**: Sends keystrokes via AppleScript `keystroke` command on macOS

### Building Installers - Full Steps

The agent requires native compilation on each target platform. GitHub Actions handles this automatically.

#### Prerequisites
1. GitHub repository: `engineersmiley/virtual-studio-app`
2. Replit connected to GitHub (Git panel → Sign in with GitHub)
3. Code pushed to the repository

#### Building Regular Installers (Windows, macOS, Linux)

1. **Make your code changes** in `virtual-studio-agent/`

2. **Update version** in `virtual-studio-agent/package.json`:
   ```json
   "version": "1.0.1"
   ```

3. **Commit and push** to GitHub:
   ```bash
   git add .
   git commit -m "Agent v1.0.1 - description of changes"
   git push origin main
   ```

4. **Create and push a version tag**:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

5. **GitHub Actions builds automatically**:
   - Workflow: `.github/workflows/build-agent.yml`
   - Outputs: Windows (.exe), macOS (.dmg), Linux (.AppImage)
   - Find builds at: `https://github.com/engineersmiley/virtual-studio-app/releases`

#### Building Legacy macOS Installer (for macOS 10.11-10.14)

1. **Update version** in `virtual-studio-agent/package-legacy.json`:
   ```json
   "version": "1.0.1"
   ```

2. **Commit and push** to GitHub

3. **Create and push a LEGACY version tag** (note the `legacy-` prefix):
   ```bash
   git tag legacy-v1.0.1
   git push origin legacy-v1.0.1
   ```

4. **GitHub Actions builds automatically**:
   - Workflow: `.github/workflows/build-legacy.yml`
   - Output: macOS Legacy (.zip) for macOS 10.11+
   - Uses Electron 19.x (EOL - security note applies)

#### After Building

1. **Download page** (`/remote-control`) automatically shows GitHub release links
2. **Legacy macOS**: Upload .zip to Google Drive and update `DOWNLOAD_URLS.macLegacy` in `client/src/pages/RemoteControl.tsx`

### GitHub Repository Setup
- **Repository Name:** `virtual-studio-app`
- **GitHub Username:** `engineersmiley`
- **Environment Variable:** `VITE_GITHUB_REPO=engineersmiley/virtual-studio-app`

### Download Page
- Route: `/remote-control`
- Links to GitHub releases for Windows, macOS, and Linux downloads
- Legacy macOS links to Google Drive (manual upload required)