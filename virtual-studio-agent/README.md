# Virtual Studio Agent

A desktop application that allows engineers to remotely control an artist's computer during Virtual Studio sessions.

## Download

Download the latest release for your operating system from the [Releases page](https://github.com/YOUR_USERNAME/virtual-studio/releases/latest).

- **Windows**: Download the `.exe` installer
- **macOS**: Download the `.dmg` file
- **Linux**: Download the `.AppImage` file

## Features

- Secure WebSocket connection to Virtual Studio
- Mouse control (move, click, double-click, scroll)
- Keyboard control (key presses, typing)
- Explicit consent required from artist before control is enabled
- System tray integration for background operation
- Cross-platform: Windows, macOS, Linux

## Requirements

- **Windows**: Windows 10 or later
- **macOS**: macOS 10.15 (Catalina) or later - Accessibility permissions required
- **Linux**: Any modern distribution with X11

## How It Works

1. Artist opens Virtual Studio Agent and enters their session code + token
2. Agent connects to Virtual Studio's WebSocket server
3. When the engineer clicks "Request Control" in the browser, the artist sees a prompt
4. If the artist approves, the engineer can control the artist's mouse and keyboard
5. Artist can stop control at any time by pressing Escape or clicking "Stop Control"

## Security

- All connections are encrypted (TLS/WSS)
- Control requires explicit artist consent for each request
- Session tokens are short-lived and tied to specific sessions
- Artist can revoke control at any time
- Single agent connection per session

---

## Development

### Prerequisites

- Node.js 18+
- For building native modules:
  - **Windows**: Visual Studio Build Tools
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libx11-dev`, `libxtst-dev`, `libpng-dev`

### Setup

```bash
cd virtual-studio-agent
npm install
```

### Run in development

```bash
npm start
```

### Building Installers

#### Option 1: GitHub Actions (Recommended)

Push to GitHub and trigger the workflow:

```bash
git add .
git commit -m "Build release"
git tag v1.0.0
git push && git push --tags
```

The GitHub Actions workflow will automatically build installers for Windows, macOS, and Linux.

#### Option 2: Build Locally

```bash
# Build for current platform
npm run build:win   # Windows (requires Windows or Wine)
npm run build:mac   # macOS (requires macOS)
npm run build:linux # Linux

# Build for all platforms (requires cross-compilation tools)
npm run build:all
```

## Troubleshooting

### macOS Accessibility Permissions

On macOS, the app requires Accessibility permissions to control mouse and keyboard:

1. Go to System Preferences > Security & Privacy > Privacy > Accessibility
2. Add Virtual Studio Agent to the list
3. Restart the app

### Linux AppImage

Make the AppImage executable before running:

```bash
chmod +x Virtual.Studio.Agent-*.AppImage
./Virtual.Studio.Agent-*.AppImage
```
