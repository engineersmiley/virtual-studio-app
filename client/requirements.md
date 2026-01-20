## Packages
framer-motion | Animations for the recording interface and visualizers
date-fns | Formatting durations and timestamps

## Notes
Browser Permissions: The app requires 'display-capture' and 'microphone' permissions.
Audio Context: We use the Web Audio API to mix system audio (from screen share) and microphone input.
Visualizer: Uses AnalyserNode data drawn to a canvas.
Uploads: Uses FormData to post to /api/recordings/upload.
Tailwind Config: Extended with cyberpunk colors and fonts (Orbitron, Rajdhani).
