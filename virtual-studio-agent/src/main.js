const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, systemPreferences, screen } = require('electron');
const path = require('path');
const WebSocket = require('ws');
const https = require('https');
const { exec } = require('child_process');
const { monitorScreenInfo, readScreenInfo } = require('./screen-info');
const { getDisplayControlState, mapInputPoint, canControlCapture } = require('./display-control');
const { getAgentPollCadence } = require('./poll-cadence');

let approvedDisplaySignature = null;
let approvedCaptureId = null;
let displayControlGeneration = 0;
let controlStage = 'none';
let robotModule;
const inputMessageTypes = new Set([
  'mouse-move', 'mouse-click', 'mouse-double-click', 'mouse-scroll', 'key-press', 'key-type',
]);

function getRobotModule() {
  if (robotModule !== undefined) return robotModule;
  try {
    robotModule = require('@jitsi/robotjs');
  } catch (error) {
    robotModule = null;
    console.error('Failed to load robotjs:', error.message);
  }
  return robotModule;
}

function getCurrentDisplayControlState() {
  const display = screen.getPrimaryDisplay();
  let inputScreenSize = null;
  if (process.platform !== 'darwin' && display.scaleFactor !== 1) {
    try {
      inputScreenSize = getRobotModule()?.getScreenSize?.() || null;
    } catch (error) {
      console.error('[Agent] Could not inspect native input screen size:', error.message);
    }
  }
  return getDisplayControlState(screen, process.platform, inputScreenSize);
}

async function sendControlResponse(allowed, mode = 'none', captureId = null) {
  const responseMessage = {
    type: 'control-response',
    allowed,
    mode,
    captureId: allowed ? captureId : undefined,
  };
  if (usePolling && currentSession) {
    await httpRequest(`${VIRTUAL_STUDIO_HTTP}/api/agent/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionCode: currentSession,
        token: currentToken,
        message: responseMessage,
      }),
    });
  } else if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ ...responseMessage, sessionCode: currentSession }));
  }
}

function revokeDisplayControl() {
  const wasEnabled = controlEnabled;
  controlEnabled = false;
  controlStage = 'none';
  approvedDisplaySignature = null;
  approvedCaptureId = null;
  mainWindow?.webContents.send('control-status', { enabled: false, mode: 'none' });
  if (wasEnabled && currentSession) {
    void sendControlResponse(false).catch(error =>
      console.error('[Agent] Failed to report stopped control:', error.message));
  }
}

// Use AppleScript for keyboard on macOS (works in fullscreen apps)
function sendKeyWithAppleScript(key, modifiers = []) {
  if (process.platform !== 'darwin') return false;
  
  const keyCodeMap = {
    'space': 49, 'return': 36, 'enter': 36, 'escape': 53, 'tab': 48,
    'backspace': 51, 'delete': 117, 'up': 126, 'down': 125, 'left': 123, 'right': 124,
    'home': 115, 'end': 119, 'pageup': 116, 'pagedown': 121,
    'f1': 122, 'f2': 120, 'f3': 99, 'f4': 118, 'f5': 96, 'f6': 97,
    'f7': 98, 'f8': 100, 'f9': 101, 'f10': 109, 'f11': 103, 'f12': 111,
  };
  
  let script;
  const keyCode = keyCodeMap[key.toLowerCase()];
  
  console.log('[AppleScript] Sending key:', key, 'with modifiers:', modifiers);
  
  if (keyCode !== undefined) {
    const modStr = modifiers.map(m => {
      if (m === 'command' || m === 'cmd') return 'command down';
      if (m === 'control' || m === 'ctrl') return 'control down';
      if (m === 'alt' || m === 'option') return 'option down';
      if (m === 'shift') return 'shift down';
      return '';
    }).filter(m => m).join(', ');
    
    script = modStr 
      ? `tell application "System Events" to key code ${keyCode} using {${modStr}}`
      : `tell application "System Events" to key code ${keyCode}`;
  } else if (key.length === 1) {
    const modStr = modifiers.map(m => {
      if (m === 'command' || m === 'cmd') return 'command down';
      if (m === 'control' || m === 'ctrl') return 'control down';
      if (m === 'alt' || m === 'option') return 'option down';
      if (m === 'shift') return 'shift down';
      return '';
    }).filter(m => m).join(', ');
    
    script = modStr
      ? `tell application "System Events" to keystroke "${key}" using {${modStr}}`
      : `tell application "System Events" to keystroke "${key}"`;
  } else {
    console.log('[AppleScript] Unknown key:', key);
    return false;
  }
  
  // Use double quotes for shell to handle special characters better
  const cmd = `osascript -e "${script.replace(/"/g, '\\"')}"`;
  console.log('[AppleScript] Executing:', cmd);
  
  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error('[AppleScript] Key error:', err.message);
      console.error('[AppleScript] stderr:', stderr);
    } else {
      console.log('[AppleScript] Key success');
    }
  });
  return true;
}

function typeTextWithAppleScript(text) {
  if (process.platform !== 'darwin') return false;
  console.log('[AppleScript] Typing text:', text);
  
  // Escape for AppleScript string (inside double quotes)
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  
  const script = `tell application "System Events" to keystroke "${escaped}"`;
  
  // Use double quotes for the shell command to avoid single quote issues
  const cmd = `osascript -e "${script.replace(/"/g, '\\"')}"`;
  console.log('[AppleScript] Executing:', cmd);
  
  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error('[AppleScript] Type error:', err.message);
      console.error('[AppleScript] stderr:', stderr);
    } else {
      console.log('[AppleScript] Type success');
    }
  });
  return true;
}

// AppleScript mouse control for macOS (fallback when robotjs fails)
function moveMouseWithAppleScript(x, y) {
  if (process.platform !== 'darwin') return false;
  // Use cliclick if available, or fallback to Python
  const script = `
    do shell script "python3 -c \\"
import Quartz
Quartz.CGEventPost(Quartz.kCGHIDEventTap, Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (${x}, ${y}), 0))
\\""
  `;
  exec(`osascript -e '${script}'`, (err) => {
    if (err) {
      console.error('[AppleScript] Mouse move error:', err.message);
    }
  });
  return true;
}

function clickMouseWithAppleScript(button = 'left') {
  if (process.platform !== 'darwin') return false;
  const eventDown = button === 'right' ? 'kCGEventRightMouseDown' : 'kCGEventLeftMouseDown';
  const eventUp = button === 'right' ? 'kCGEventRightMouseUp' : 'kCGEventLeftMouseUp';
  const buttonCode = button === 'right' ? 1 : 0;
  
  const script = `
    do shell script "python3 -c \\"
import Quartz
import time
pos = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
Quartz.CGEventPost(Quartz.kCGHIDEventTap, Quartz.CGEventCreateMouseEvent(None, Quartz.${eventDown}, pos, ${buttonCode}))
time.sleep(0.01)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, Quartz.CGEventCreateMouseEvent(None, Quartz.${eventUp}, pos, ${buttonCode}))
\\""
  `;
  exec(`osascript -e '${script}'`, (err) => {
    if (err) console.error('[AppleScript] Click error:', err.message);
  });
  return true;
}

function doubleClickWithAppleScript() {
  if (process.platform !== 'darwin') return false;
  const script = `
    do shell script "python3 -c \\"
import Quartz
import time
pos = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
for i in range(2):
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, pos, 0))
    time.sleep(0.01)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, pos, 0))
    time.sleep(0.05)
\\""
  `;
  exec(`osascript -e '${script}'`, (err) => {
    if (err) console.error('[AppleScript] Double-click error:', err.message);
  });
  return true;
}

function scrollWithAppleScript(deltaY) {
  if (process.platform !== 'darwin') return false;
  const script = `
    do shell script "python3 -c \\"
import Quartz
Quartz.CGEventPost(Quartz.kCGHIDEventTap, Quartz.CGEventCreateScrollWheelEvent(None, Quartz.kCGScrollEventUnitLine, 1, ${Math.round(deltaY)}))
\\""
  `;
  exec(`osascript -e '${script}'`, (err) => {
    if (err) console.error('[AppleScript] Scroll error:', err.message);
  });
  return true;
}

// HTTP request helper for legacy Electron (no fetch API)
function httpRequest(url, options = {}) {
  // Electron's older Node runtime does not keep HTTPS connections alive by
  // default. Reusing TLS connections avoids a fresh handshake for every move.
  if (!httpRequest.keepAliveAgent) {
    httpRequest.keepAliveAgent = new https.Agent({
      keepAlive: true, maxSockets: 4, maxFreeSockets: 2,
    });
  }
  return new Promise((resolve, reject) => {
    let deadline;
    const finish = (callback, value) => {
      clearTimeout(deadline);
      callback(value);
    };
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      agent: httpRequest.keepAliveAgent,
      headers: options.headers || {},
      signal: options.signal
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('error', error => finish(reject, error));
      res.on('aborted', () => finish(reject, new Error('Server closed the response before it finished')));
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        finish(resolve, {
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: async () => {
            try {
              return JSON.parse(data);
            } catch {
              throw new Error(`Server returned an unreadable response (HTTP ${res.statusCode}). Please try again.`);
            }
          },
          text: () => Promise.resolve(data)
        });
      });
    });

    req.on('error', error => finish(reject, error));
    if (options.timeoutMs) {
      // A wall-clock deadline also bounds DNS, TLS, and a response that never
      // finishes. Socket inactivity timeouts alone do not cover all of these.
      deadline = setTimeout(() => {
        const error = new Error('Connection timed out. Check your internet connection and try again.');
        finish(reject, error);
        req.destroy(error);
      }, options.timeoutMs);
    }
    
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// Single instance lock - only allow one window
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit();
}

let mainWindow = null;
let tray = null;
let ws = null;
let isConnected = false;
let controlEnabled = false;
let currentSession = null;
let currentToken = null;
let pollingInterval = null;
let agentPollInFlight = false;
let agentSocketReconnectTimer = null;
let usePolling = false;
let stopScreenInfoMonitor = null;
let connectionGeneration = 0;
let runtimeShutdownStarted = false;

function stopScreenInfoUpdates() {
  if (stopScreenInfoMonitor) {
    stopScreenInfoMonitor();
    stopScreenInfoMonitor = null;
  }
}

function stopRuntimeForQuit() {
  if (runtimeShutdownStarted) return;
  runtimeShutdownStarted = true;
  app.isQuitting = true;
  ++connectionGeneration;
  stopScreenInfoUpdates();

  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  if (agentSocketReconnectTimer) {
    clearTimeout(agentSocketReconnectTimer);
    agentSocketReconnectTimer = null;
  }
  if (ws) {
    const socket = ws;
    ws = null;
    try {
      socket.terminate();
    } catch (error) {
      console.error('[Agent] WebSocket shutdown error:', error.message);
    }
  }

  agentPollInFlight = false;
  isConnected = false;
  controlEnabled = false;
  controlStage = 'none';
  currentSession = null;
  currentToken = null;
  usePolling = false;

  if (httpRequest.keepAliveAgent) {
    httpRequest.keepAliveAgent.destroy();
    httpRequest.keepAliveAgent = null;
  }
  if (tray) {
    try {
      tray.destroy();
    } catch (error) {
      console.error('[Agent] Tray shutdown error:', error.message);
    }
    tray = null;
  }
}

function quitAgent() {
  stopRuntimeForQuit();
  app.quit();
}

const VIRTUAL_STUDIO_URL = 'wss://virtualstudio.sale';
const VIRTUAL_STUDIO_HTTP = 'https://virtualstudio.sale';

// Handle second instance - focus existing window
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 500,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    show: true
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, '../assets/icon.png'));
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Open Virtual Studio Agent',
      click: () => mainWindow.show() 
    },
    { type: 'separator' },
    { 
      label: isConnected ? 'Connected' : 'Not Connected',
      enabled: false
    },
    { type: 'separator' },
    { 
      label: 'Quit', 
      click: quitAgent
    }
  ]);
  
  tray.setToolTip('Virtual Studio Agent');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    mainWindow.show();
  });
}

async function checkAccessibilityPermissions() {
  if (process.platform === 'darwin') {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    if (!trusted) {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: 'Accessibility Permission Required',
        message: 'Virtual Studio Agent needs Accessibility permissions to control your mouse and keyboard.',
        detail: 'Please grant Accessibility access in System Preferences > Security & Privacy > Privacy > Accessibility',
        buttons: ['Open System Preferences', 'Cancel']
      });
      
      if (result.response === 0) {
        require('child_process').exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
      }
      return false;
    }
  }
  return true;
}

let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 10; // Disconnect after ten consecutive failed polls

function getCurrentAgentScreenInfo() {
  return {
    ...readScreenInfo({ screen, getControlState: getCurrentDisplayControlState }),
    agentVersion: app.getVersion(),
  };
}

function sendCurrentAgentScreenInfo(info = getCurrentAgentScreenInfo()) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !currentSession) return false;
  try {
    ws.send(JSON.stringify({
      type: 'screen-info',
      screenInfo: { ...info, agentVersion: app.getVersion() },
    }));
    return true;
  } catch (error) {
    console.error('[Agent] Failed to send screen info over WebSocket:', error.message);
    return false;
  }
}

function startAgentPolling(sessionCode, generation) {
  if (pollingInterval || !usePolling) return;
  let lastPollStartedAt = -Infinity;

  const poll = async () => {
    if (generation !== connectionGeneration || !usePolling || agentPollInFlight) return;
    const now = Date.now();
    // Poll only as a fallback; sample at up to 60 fps while control is active.
    if (now - lastPollStartedAt < getAgentPollCadence(controlEnabled).minimumRequestIntervalMs) return;
    if (!currentSession || !isConnected) {
      stopScreenInfoUpdates();
      if (pollingInterval) clearInterval(pollingInterval);
      pollingInterval = null;
      return;
    }

    agentPollInFlight = true;
    lastPollStartedAt = now;
    try {
      const pollResponse = await httpRequest(`${VIRTUAL_STUDIO_HTTP}/api/agent/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: 5000,
        body: JSON.stringify({
          sessionCode,
          token: currentToken,
          screenInfo: getCurrentAgentScreenInfo(),
        }),
      });
      if (generation !== connectionGeneration || !usePolling) return;

      if (pollResponse.ok) {
        consecutiveErrors = 0;
        const data = await pollResponse.json();
        for (const message of data.messages || []) {
          if (generation !== connectionGeneration || !usePolling) break;
          if (message.type !== 'mouse-move') console.log(`[Agent] Processing message: ${message.type}`);
          await handleControlMessage(message);
        }
      } else if (pollResponse.status === 404) {
        console.log('[Agent] Session not found (404) - disconnecting');
        await handleControlMessage({ type: 'session-ended', reason: 'Session no longer exists' });
      } else {
        consecutiveErrors++;
        console.log(`[Agent] Poll error (${pollResponse.status}), consecutive: ${consecutiveErrors}`);
      }
    } catch (err) {
      if (generation !== connectionGeneration || !usePolling) return;
      consecutiveErrors++;
      console.error(`[Agent] Polling error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, err.message);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.log('[Agent] Too many errors - auto-disconnecting');
        await handleControlMessage({ type: 'session-ended', reason: 'Connection lost' });
      }
    } finally {
      agentPollInFlight = false;
    }
  };

  pollingInterval = setInterval(poll, getAgentPollCadence(false).timerIntervalMs);
  void poll();
}

function connectAgentWebSocket(sessionCode, token, generation) {
  if (!token) return Promise.resolve(false);
  return new Promise(resolve => {
    let settled = false;
    let opened = false;
    let timeout;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    let socket;
    try {
      const url = `${VIRTUAL_STUDIO_URL}/agent?session=${encodeURIComponent(sessionCode)}`;
      socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
      ws = socket;
    } catch (error) {
      console.warn('[Agent] WebSocket unavailable; using polling fallback:', error.message);
      finish(false);
      return;
    }

    socket.on('open', () => {
      if (settled && !opened) {
        socket.close();
        return;
      }
      if (generation !== connectionGeneration) {
        socket.close();
        finish(false);
        return;
      }

      opened = true;
      usePolling = false;
      consecutiveErrors = 0;
      if (pollingInterval) clearInterval(pollingInterval);
      pollingInterval = null;
      if (agentSocketReconnectTimer) clearTimeout(agentSocketReconnectTimer);
      agentSocketReconnectTimer = null;
      mainWindow.webContents.send('connection-status', {
        connected: true, session: sessionCode, mode: 'websocket',
      });
      updateTrayMenu();
      sendCurrentAgentScreenInfo();
      console.log(`[Agent] Connected to session ${sessionCode} via WebSocket`);
      finish(true);
    });

    socket.on('message', data => {
      if (generation !== connectionGeneration || ws !== socket) return;
      try {
        const message = JSON.parse(data.toString());
        void handleControlMessage(message);
      } catch (error) {
        console.error('[Agent] Invalid WebSocket message:', error.message);
      }
    });

    socket.on('close', () => {
      if (ws !== socket) {
        if (!opened) finish(false);
        return;
      }
      ws = null;
      if (!opened) {
        finish(false);
        return;
      }
      if (generation !== connectionGeneration || !isConnected) return;
      usePolling = true;
      console.warn('[Agent] WebSocket closed; switching to polling fallback');
      mainWindow.webContents.send('connection-status', {
        connected: true, session: sessionCode, mode: 'polling',
      });
      startAgentPolling(sessionCode, generation);
      scheduleAgentWebSocketReconnect(sessionCode, generation);
    });

    socket.on('error', error => {
      console.warn('[Agent] WebSocket error:', error.message);
      if (!opened) {
        finish(false);
        socket.terminate();
      }
    });

    timeout = setTimeout(() => {
      if (opened) return;
      console.warn('[Agent] WebSocket connect timed out; using polling fallback');
      finish(false);
      socket.terminate();
    }, 5000);
  });
}

function scheduleAgentWebSocketReconnect(sessionCode, generation, delay = 5000) {
  if (agentSocketReconnectTimer || !currentToken || !usePolling || !isConnected) return;
  agentSocketReconnectTimer = setTimeout(async () => {
    agentSocketReconnectTimer = null;
    if (generation !== connectionGeneration || !isConnected || !usePolling) return;
    if (agentPollInFlight) {
      scheduleAgentWebSocketReconnect(sessionCode, generation, 500);
      return;
    }

    // Pause polling only between requests so queued controls are either
    // delivered by that poll or replayed over the WebSocket, never lost.
    usePolling = false;
    const connected = await connectAgentWebSocket(sessionCode, currentToken, generation);
    if (generation !== connectionGeneration || !isConnected) return;
    if (!connected) {
      usePolling = true;
      scheduleAgentWebSocketReconnect(sessionCode, generation, 10000);
    }
  }, delay);
}

async function connectViaPolling(sessionCode, generation) {
  try {
    const response = await httpRequest(`${VIRTUAL_STUDIO_HTTP}/api/agent/simple-connect`, {
      method: 'POST',
      timeoutMs: 10000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionCode })
    });
    if (generation !== connectionGeneration) return { success: false, error: 'Connection cancelled' };
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to connect');
    }

    const connectionData = await response.json();
    if (generation !== connectionGeneration) return { success: false, error: 'Connection cancelled' };
    
    usePolling = true;
    isConnected = true;
    currentSession = sessionCode;
    currentToken = connectionData.websocketToken || null;
    consecutiveErrors = 0;
    
    // Watch topology locally so approval is revoked immediately on changes.
    stopScreenInfoMonitor = monitorScreenInfo({
      screen,
      getControlState: getCurrentDisplayControlState,
      onChange: (state) => {
        ++displayControlGeneration;
        if (approvedDisplaySignature && approvedDisplaySignature !== state.signature) {
          revokeDisplayControl();
        }
      },
      publish: async info => {
        if (usePolling) return { ok: true };
        return sendCurrentAgentScreenInfo(info)
          ? { ok: true }
          : { ok: false, status: 503 };
      },
      onError: (err) => console.error('[Agent] Failed to inspect display; will retry:', err.message)
    });
    
    const websocketConnected = await connectAgentWebSocket(
      sessionCode, connectionData.websocketToken, generation,
    );
    if (generation !== connectionGeneration) {
      if (ws) ws.close();
      return { success: false, error: 'Connection cancelled' };
    }

    if (!websocketConnected) {
      usePolling = true;
      mainWindow.webContents.send('connection-status', {
        connected: true, session: sessionCode, mode: 'polling',
      });
      updateTrayMenu();
      console.log(`[Agent] Connected to session ${sessionCode} via polling fallback`);
      startAgentPolling(sessionCode, generation);
      scheduleAgentWebSocketReconnect(sessionCode, generation);
    }
    return { success: true };
  } catch (error) {
    if (generation !== connectionGeneration) return { success: false, error: 'Connection cancelled' };
    stopScreenInfoUpdates();
    isConnected = false;
    currentSession = null;
    currentToken = null;
    usePolling = false;
    updateTrayMenu();
    console.error('[Agent] HTTP connection error:', error);
    mainWindow.webContents.send('connection-status', { connected: false });
    mainWindow.webContents.send('error', error.message);
    return { success: false, error: error.message };
  }
}

function connectToServer(sessionCode) {
  const generation = ++connectionGeneration;
  revokeDisplayControl();
  isConnected = false;
  currentSession = null;
  currentToken = null;
  usePolling = false;
  stopScreenInfoUpdates();
  // Close any existing connections
  if (ws) {
    ws.close();
    ws = null;
  }
  if (agentSocketReconnectTimer) {
    clearTimeout(agentSocketReconnectTimer);
    agentSocketReconnectTimer = null;
  }
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  
  // Use HTTP polling directly - no token needed, simpler and more reliable
  return connectViaPolling(sessionCode, generation);
}

async function handleControlMessage(message) {
  if (inputMessageTypes.has(message.type)) {
    const display = getCurrentDisplayControlState();
    if (!controlEnabled || !display.supported || display.signature !== approvedDisplaySignature ||
        !canControlCapture(message) || message.captureId !== approvedCaptureId) {
      revokeDisplayControl();
      return;
    }
    // Scaled displays start in a move-only alignment stage. The Agent enforces
    // this independently of the browser and server permission checks.
    if (controlStage === 'alignment' && message.type !== 'mouse-move') return;
    if (message.type === 'mouse-move') {
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
      const mapped = mapInputPoint(message.x, message.y, display);
      message.x = mapped.x;
      message.y = mapped.y;
    }
  }
  // Log received control commands (skip mouse-move to avoid spam)
  if (message.type !== 'mouse-move') {
    console.log('[Agent] Received control command:', message.type, JSON.stringify(message));
  }
  
  let robot = null;
  let robotFailed = false;
  // Session cleanup must work even if the native input dependency is unavailable.
  if (message.type !== 'session-ended') {
    robot = getRobotModule();
    if (!robot) {
      console.error('Failed to load robotjs, will use AppleScript fallback on macOS');
      robotFailed = true;
      // Don't return - continue to try AppleScript on macOS
      if (process.platform !== 'darwin') {
        console.error('No fallback available on non-macOS platforms');
        return;
      }
    }
  }
  
  try {
    switch (message.type) {
      case 'control-request':
        const requestedDisplay = getCurrentDisplayControlState();
        const requestedGeneration = displayControlGeneration;
        if (!requestedDisplay.supported || !canControlCapture(message)) {
          revokeDisplayControl();
          await sendControlResponse(false);
          await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Screen sharing cannot be controlled',
            message: requestedDisplay.reason || 'Share your entire screen before requesting control. Window, tab, audio-only, and unidentified captures are view-only.',
            buttons: ['OK'],
          });
          break;
        }
        // Always process control requests regardless of current state
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          title: 'Remote Control Request',
          message: `${message.fromName || 'An engineer'} wants to control your computer.`,
          detail: requestedDisplay.calibrationRequired
            ? 'This scaled display needs a cursor alignment check. Allowing now lets the engineer move the cursor only. Clicks and keyboard remain blocked until you verify the cursor and enable full control in this Agent window.'
            : 'They will be able to move your mouse and type on your keyboard. You can stop control anytime by pressing Escape.',
          buttons: requestedDisplay.calibrationRequired
            ? ['Allow Cursor Test', 'Deny']
            : ['Allow', 'Deny']
        });
        
        const currentDisplay = getCurrentDisplayControlState();
        controlEnabled = result.response === 0 && currentDisplay.supported &&
          requestedGeneration === displayControlGeneration &&
          currentDisplay.signature === requestedDisplay.signature;
        controlStage = controlEnabled
          ? (currentDisplay.calibrationRequired ? 'alignment' : 'full')
          : 'none';
        approvedDisplaySignature = controlEnabled ? currentDisplay.signature : null;
        approvedCaptureId = controlEnabled ? message.captureId : null;
        
        await sendControlResponse(controlEnabled, controlStage, approvedCaptureId);
        mainWindow.webContents.send('control-status', { enabled: controlEnabled, mode: controlStage });
        updateTrayMenu();
        break;
      
      case 'control-end':
        // Always process control end requests
        ++displayControlGeneration;
        revokeDisplayControl();
        break;
      
      case 'session-ended':
        // Session ended (artist left), auto-disconnect
        console.log('Session ended:', message.reason);
        ++connectionGeneration;
        stopScreenInfoUpdates();
        if (agentSocketReconnectTimer) {
          clearTimeout(agentSocketReconnectTimer);
          agentSocketReconnectTimer = null;
        }
        const sessionToCleanup = currentSession;
        if (sessionToCleanup) {
          httpRequest(`${VIRTUAL_STUDIO_HTTP}/api/agent/disconnect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionCode: sessionToCleanup }),
            timeoutMs: 3000,
          }).catch(error =>
            console.error('[Agent] Server cleanup after session end failed:', error.message));
        }
        
        // CRITICAL: Stop polling immediately to prevent further requests
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }
        if (ws) {
          ws.close();
          ws = null;
        }
        
        // Reset all connection state
        controlEnabled = false;
        controlStage = 'none';
        isConnected = false;
        usePolling = false;
        const endedSession = currentSession;
        currentSession = null;
        currentToken = null;
        
        updateTrayMenu();
        mainWindow.webContents.send('connection-status', { connected: false });
        mainWindow.webContents.send('control-status', { enabled: false, mode: 'none' });
        mainWindow.webContents.send('session-ended', { reason: message.reason || 'Session ended' });
        
        // Show notification to user (non-blocking)
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Session Ended',
          message: 'The recording session has ended.',
          detail: message.reason || 'The artist has left the session.'
        }).catch(() => {});
        
        console.log(`Agent fully disconnected from session ${endedSession}`);
        break;
        
      case 'mouse-move':
        if (controlEnabled) {
          if (robot && !robotFailed) {
            robot.moveMouse(Math.round(message.x), Math.round(message.y));
          } else if (process.platform === 'darwin') {
            moveMouseWithAppleScript(Math.round(message.x), Math.round(message.y));
          }
        }
        break;
        
      case 'mouse-click':
        if (controlEnabled) {
          const button = message.button === 'right' ? 'right' : 'left';
          if (robot && !robotFailed) {
            robot.mouseClick(button);
          } else if (process.platform === 'darwin') {
            clickMouseWithAppleScript(button);
          }
        }
        break;
        
      case 'mouse-double-click':
        if (controlEnabled) {
          if (robot && !robotFailed) {
            robot.mouseClick('left', true);
          } else if (process.platform === 'darwin') {
            doubleClickWithAppleScript();
          }
        }
        break;
        
      case 'mouse-scroll':
        if (controlEnabled) {
          if (robot && !robotFailed) {
            robot.scrollMouse(0, Math.round(message.deltaY));
          } else if (process.platform === 'darwin') {
            scrollWithAppleScript(Math.round(message.deltaY));
          }
        }
        break;
        
      case 'key-press':
        console.log('[Agent] Received key-press:', message.key, 'controlEnabled:', controlEnabled);
        if (controlEnabled) {
          const key = mapKeyToRobotJs(message.key);
          console.log('[Agent] Mapped key:', key);
          if (key) {
            // Build modifiers array
            const modifiers = [];
            if (message.modifiers) {
              if (message.modifiers.ctrl) modifiers.push('control');
              if (message.modifiers.alt) modifiers.push('alt');
              if (message.modifiers.shift) modifiers.push('shift');
              if (message.modifiers.cmd) modifiers.push('command');
            }
            
            // Use AppleScript on macOS (works in fullscreen), robotjs elsewhere
            if (process.platform === 'darwin') {
              sendKeyWithAppleScript(key, modifiers);
            } else if (robot && !robotFailed) {
              robot.keyTap(key, modifiers);
            }
          }
        }
        break;
        
      case 'key-combo':
        // Handle keyboard shortcuts like Cmd+C, Cmd+V
        if (controlEnabled && message.keys && Array.isArray(message.keys)) {
          const mappedKeys = message.keys.map(k => mapKeyToRobotJs(k)).filter(k => k);
          if (mappedKeys.length > 0) {
            // Last key is the main key, others are modifiers
            const mainKey = mappedKeys[mappedKeys.length - 1];
            const modifiers = mappedKeys.slice(0, -1);
            
            // Use AppleScript on macOS (works in fullscreen), robotjs elsewhere
            if (process.platform === 'darwin') {
              sendKeyWithAppleScript(mainKey, modifiers);
            } else if (robot && !robotFailed) {
              robot.keyTap(mainKey, modifiers);
            }
          }
        }
        break;
        
      case 'key-type':
        console.log('[Agent] Received key-type:', message.text, 'controlEnabled:', controlEnabled);
        if (controlEnabled) {
          const text = message.text;
          
          // Use AppleScript on macOS (works in fullscreen), robotjs elsewhere
          if (process.platform === 'darwin') {
            typeTextWithAppleScript(text);
          } else if (robot && !robotFailed) {
            // Windows/Linux: type character by character for reliability
            for (let i = 0; i < text.length; i++) {
              const char = text[i];
              if (/[a-zA-Z0-9]/.test(char)) {
                const isUpperCase = char === char.toUpperCase() && /[A-Z]/.test(char);
                if (isUpperCase) {
                  robot.keyTap(char.toLowerCase(), ['shift']);
                } else {
                  robot.keyTap(char.toLowerCase());
                }
              } else if (char === ' ') {
                robot.keyTap('space');
              } else {
                // For special characters, use typeString
                robot.typeString(char);
              }
            }
          } else {
            console.log('[Agent] Cannot type - robotjs not available');
          }
        }
        break;
    }
  } catch (error) {
    console.error('Error executing control command:', error);
  }
}

function mapKeyToRobotJs(key) {
  const keyMap = {
    'Enter': 'enter',
    'Escape': 'escape',
    'Backspace': 'backspace',
    'Tab': 'tab',
    'Space': 'space',
    'ArrowUp': 'up',
    'ArrowDown': 'down',
    'ArrowLeft': 'left',
    'ArrowRight': 'right',
    'Delete': 'delete',
    'Home': 'home',
    'End': 'end',
    'PageUp': 'pageup',
    'PageDown': 'pagedown',
    'Control': 'control',
    'Alt': 'alt',
    'Shift': 'shift',
    'Meta': 'command',
    'F1': 'f1',
    'F2': 'f2',
    'F3': 'f3',
    'F4': 'f4',
    'F5': 'f5',
    'F6': 'f6',
    'F7': 'f7',
    'F8': 'f8',
    'F9': 'f9',
    'F10': 'f10',
    'F11': 'f11',
    'F12': 'f12',
  };
  
  if (keyMap[key]) {
    return keyMap[key];
  }
  
  // For single character keys, return lowercase
  if (key.length === 1) {
    return key.toLowerCase();
  }
  
  return null;
}

function updateTrayMenu() {
  if (tray) {
    const contextMenu = Menu.buildFromTemplate([
      { 
        label: 'Open Virtual Studio Agent',
        click: () => mainWindow.show() 
      },
      { type: 'separator' },
      { 
        label: isConnected ? `Connected to ${currentSession}` : 'Not Connected',
        enabled: false
      },
      { 
        label: controlEnabled ? 'Control: Active' : 'Control: Inactive',
        enabled: false
      },
      { type: 'separator' },
      { 
        label: 'Disconnect',
        enabled: isConnected,
        click: () => {
          if (ws) ws.close();
        }
      },
      { 
        label: 'Quit', 
        click: quitAgent
      }
    ]);
    tray.setContextMenu(contextMenu);
  }
}

app.whenReady().then(async () => {
  await checkAccessibilityPermissions();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', stopRuntimeForQuit);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

ipcMain.handle('connect', async (event, { sessionCode }) => {
  if (typeof sessionCode !== 'string' || !/^[A-Z0-9]{6}$/.test(sessionCode)) {
    return { success: false, error: 'Please enter a valid 6-character session code' };
  }
  const hasPermissions = await checkAccessibilityPermissions();
  if (!hasPermissions) {
    return { success: false, error: 'Accessibility permissions required' };
  }
  
  return await connectToServer(sessionCode);
});

ipcMain.handle('disconnect', async () => {
  console.log('[Agent] Disconnect requested');
  ++connectionGeneration;
  stopScreenInfoUpdates();
  if (agentSocketReconnectTimer) {
    clearTimeout(agentSocketReconnectTimer);
    agentSocketReconnectTimer = null;
  }
  
  // Stop polling first to prevent any more requests
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('[Agent] Polling stopped');
  }
  
  const sessionToDisconnect = currentSession;
  
  // Notify server of disconnect regardless of transport.
  if (sessionToDisconnect) {
    httpRequest(`${VIRTUAL_STUDIO_HTTP}/api/agent/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionCode: sessionToDisconnect }),
      timeoutMs: 3000,
    }).catch(err => {
      console.error('[Agent] Server disconnect notification error:', err.message);
    });
  }
  
  // Close WebSocket if open
  if (ws) {
    try {
      ws.close();
    } catch (err) {
      console.error('[Agent] WebSocket close error:', err.message);
    }
    ws = null;
  }
  
  // Reset all state
  isConnected = false;
  controlEnabled = false;
  controlStage = 'none';
  currentSession = null;
  currentToken = null;
  usePolling = false;
  consecutiveErrors = 0;
  
  updateTrayMenu();
  
  // Notify UI of disconnection immediately
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('connection-status', { connected: false });
    mainWindow.webContents.send('control-status', { enabled: false, mode: 'none' });
  }
  
  console.log('[Agent] Disconnected successfully');
  return { success: true };
});

ipcMain.handle('quit', () => {
  quitAgent();
  return { success: true };
});

ipcMain.handle('stop-control', () => {
  revokeDisplayControl();
  updateTrayMenu();
  return { success: true };
});

ipcMain.handle('enable-full-control', async () => {
  if (!controlEnabled || controlStage !== 'alignment') {
    return { success: false, error: 'No cursor alignment test is active.' };
  }
  const display = getCurrentDisplayControlState();
  if (!display.supported || display.signature !== approvedDisplaySignature) {
    revokeDisplayControl();
    updateTrayMenu();
    return { success: false, error: 'Display settings changed. Start a new control request.' };
  }
  controlStage = 'full';
  mainWindow?.webContents.send('control-status', { enabled: true, mode: 'full' });
  updateTrayMenu();
  try {
    await sendControlResponse(true, 'full', approvedCaptureId);
  } catch (error) {
    // Keep the local Agent in the more restrictive mode if the server did not
    // confirm the upgrade.
    controlStage = 'alignment';
    mainWindow?.webContents.send('control-status', { enabled: true, mode: 'alignment' });
    updateTrayMenu();
    return { success: false, error: error.message };
  }
  return { success: true };
});

ipcMain.handle('get-status', () => {
  return {
    agentVersion: app.getVersion(),
    connected: isConnected,
    controlEnabled,
    controlStage,
    session: currentSession
  };
});
