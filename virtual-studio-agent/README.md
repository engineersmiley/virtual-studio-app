# Virtual Studio Agent

A desktop application that allows engineers to remotely control an artist's computer during Virtual Studio sessions.

## Features

- Secure WebSocket connection to Virtual Studio
- Mouse control (move, click, double-click, scroll)
- Keyboard control (key presses, typing)
- Explicit consent required from artist before control is enabled
- System tray integration for background operation
- Cross-platform: Windows, macOS, Linux

## Requirements

- Node.js 18+
- For macOS: Accessibility permissions must be granted

## Development

```bash
# Install dependencies
npm install

# Run in development
npm start
```

## Building

```bash
# Build for current platform
npm run build:win   # Windows
npm run build:mac   # macOS
npm run build:linux # Linux

# Build for all platforms
npm run build:all
```

## How It Works

1. Artist opens Virtual Studio Agent and enters their session code + token
2. Agent connects to Virtual Studio's WebSocket server
3. When the engineer clicks "Request Control" in the browser, the artist sees a prompt
4. If the artist approves, the engineer can control the artist's mouse and keyboard
5. Artist can stop control at any time by pressing Escape or clicking "Stop Control"

## Security

- All connections are encrypted (TLS/WSS)
- Control requires explicit artist consent
- Session tokens are short-lived and tied to specific sessions
- Artist can revoke control at any time
