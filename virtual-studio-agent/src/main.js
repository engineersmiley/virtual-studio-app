const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, systemPreferences, screen } = require('electron');
const path = require('path');
const WebSocket = require('ws');
const https = require('https');
const { exec } = require('child_process');

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
    return false;
  }
  
  exec(`osascript -e '${script}'`, (err) => {
    if (err) console.error('[AppleScript] Error:', err.message);
  });
  return true;
}

function typeTextWithAppleScript(text) {
  if (process.platform !== 'darwin') return false;
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "'\\''");
  const script = `tell application "System Events" to keystroke "${escaped}"`;
  exec(`osascript -e '${script}'`, (err) => {
    if (err) console.error('[AppleScript] Type error:', err.message);
  });
  return true;
}

// Get the actual screen size for accurate mouse positioning
function getScreenSize() {
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    width: primaryDisplay.size.width,
    height: primaryDisplay.size.height,
    scaleFactor: primaryDisplay.scaleFactor
  };
}

// HTTP request helper for legacy Electron (no fetch API)
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: () => Promise.resolve(JSON.parse(data)),
          text: () => Promise.resolve(data)
        });
      });
    });

    req.on('error', reject);
    
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
let usePolling = false;

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
      click: () => {
        app.isQuitting = true;
        if (pollingInterval) clearInterval(pollingInterval);
        app.quit();
        process.exit(0);
      }
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
const MAX_CONSECUTIVE_ERRORS = 10; // Disconnect after 5 seconds of errors

async function connectViaPolling(sessionCode) {
  try {
    // Simple mode - no token needed, just session code
    const response = await httpRequest(`${VIRTUAL_STUDIO_HTTP}/api/agent/simple-connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionCode })
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to connect');
    }
    
    usePolling = true;
    isConnected = true;
    currentSession = sessionCode;
    currentToken = null; // No token needed in simple mode
    consecutiveErrors = 0;
    
    // Get and send screen size to the session
    const screenSize = getScreenSize();
    console.log(`[Agent] Screen size: ${screenSize.width}x${screenSize.height} (scale: ${screenSize.scaleFactor})`);
    
    // Send screen size to server so engineers get accurate coordinates
    try {
      await httpRequest(`${VIRTUAL_STUDIO_HTTP}/api/agent/screen-info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sessionCode, 
          screenWidth: screenSize.width,
          screenHeight: screenSize.height,
          scaleFactor: screenSize.scaleFactor
        })
      });
    } catch (err) {
      console.log('[Agent] Failed to send screen info:', err.message);
    }
    
    mainWindow.webContents.send('connection-status', { connected: true, session: sessionCode, mode: 'polling' });
    updateTrayMenu();
    console.log(`[Agent] Connected to session ${sessionCode} via polling`);
    
    // Start polling for messages
    pollingInterval = setInterval(async () => {
      // Safety check - if already disconnected, stop polling
      if (!currentSession || !isConnected) {
        console.log('[Agent] Polling stopped - no longer connected');
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }
        return;
      }
      
      try {
        // Poll without token - simple mode
        const pollResponse = await httpRequest(`${VIRTUAL_STUDIO_HTTP}/api/agent/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionCode: currentSession })
        });
        
        if (pollResponse.ok) {
          consecutiveErrors = 0; // Reset on success
          const data = await pollResponse.json();
          for (const message of data.messages) {
            console.log(`[Agent] Processing message: ${message.type}`);
            await handleControlMessage(message);
          }
        } else if (pollResponse.status === 404) {
          // Session no longer exists - disconnect
          console.log('[Agent] Session not found (404) - disconnecting');
          await handleControlMessage({ type: 'session-ended', reason: 'Session no longer exists' });
        } else {
          consecutiveErrors++;
          console.log(`[Agent] Poll error (${pollResponse.status}), consecutive: ${consecutiveErrors}`);
        }
      } catch (err) {
        consecutiveErrors++;
        console.error(`[Agent] Polling error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, err.message);
        
        // Auto-disconnect after too many consecutive errors
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.log('[Agent] Too many errors - auto-disconnecting');
          await handleControlMessage({ type: 'session-ended', reason: 'Connection lost' });
        }
      }
    }, 500);
    
  } catch (error) {
    console.error('[Agent] HTTP connection error:', error);
    mainWindow.webContents.send('error', error.message);
  }
}

function connectToServer(sessionCode) {
  // Close any existing connections
  if (ws) {
    ws.close();
    ws = null;
  }
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  
  // Use HTTP polling directly - no token needed, simpler and more reliable
  connectViaPolling(sessionCode);
}

async function handleControlMessage(message) {
  // Log received control commands (skip mouse-move to avoid spam)
  if (message.type !== 'mouse-move') {
    console.log('[Agent] Received control command:', message.type, JSON.stringify(message));
  }
  
  let robot;
  try {
    robot = require('@jitsi/robotjs');
  } catch (e) {
    console.error('Failed to load robotjs:', e);
    return;
  }
  
  try {
    switch (message.type) {
      case 'control-request':
        // Always process control requests regardless of current state
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          title: 'Remote Control Request',
          message: `${message.fromName || 'An engineer'} wants to control your computer.`,
          detail: 'They will be able to move your mouse and type on your keyboard. You can stop control anytime by pressing Escape.',
          buttons: ['Allow', 'Deny']
        });
        
        controlEnabled = result.response === 0;
        
        // Send response via appropriate channel
        if (usePolling) {
          await httpRequest(`${VIRTUAL_STUDIO_HTTP}/api/agent/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: currentToken,
              sessionCode: currentSession,
              message: { type: 'control-response', allowed: controlEnabled }
            })
          });
        } else if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ 
            type: 'control-response', 
            allowed: controlEnabled,
            sessionCode: currentSession 
          }));
        }
        mainWindow.webContents.send('control-status', { enabled: controlEnabled });
        break;
      
      case 'control-end':
        // Always process control end requests
        controlEnabled = false;
        mainWindow.webContents.send('control-status', { enabled: false });
        break;
      
      case 'session-ended':
        // Session ended (artist left), auto-disconnect
        console.log('Session ended:', message.reason);
        
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
        isConnected = false;
        usePolling = false;
        const endedSession = currentSession;
        currentSession = null;
        currentToken = null;
        
        updateTrayMenu();
        mainWindow.webContents.send('connection-status', { connected: false });
        mainWindow.webContents.send('control-status', { enabled: false });
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
          robot.moveMouse(Math.round(message.x), Math.round(message.y));
        }
        break;
        
      case 'mouse-click':
        if (controlEnabled) {
          const button = message.button === 'right' ? 'right' : 'left';
          robot.mouseClick(button);
        }
        break;
        
      case 'mouse-double-click':
        if (controlEnabled) {
          robot.mouseClick('left', true);
        }
        break;
        
      case 'mouse-scroll':
        if (controlEnabled) {
          robot.scrollMouse(0, Math.round(message.deltaY));
        }
        break;
        
      case 'key-press':
        if (controlEnabled) {
          const key = mapKeyToRobotJs(message.key);
          if (key) {
            // Handle modifier keys with the key press
            const modifiers = [];
            if (message.modifiers) {
              if (message.modifiers.ctrl) modifiers.push('control');
              if (message.modifiers.alt) modifiers.push('alt');
              if (message.modifiers.shift) modifiers.push('shift');
              if (message.modifiers.cmd) modifiers.push('command');
            }
            robot.keyTap(key, modifiers);
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
            robot.keyTap(mainKey, modifiers);
          }
        }
        break;
        
      case 'key-type':
        if (controlEnabled) {
          // Type each character with a small delay for better compatibility
          const text = message.text;
          for (let i = 0; i < text.length; i++) {
            const char = text[i];
            // Use keyTap for letters/numbers which is more reliable than typeString
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
              // For special characters, use typeString as fallback
              robot.typeString(char);
            }
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
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
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

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

ipcMain.handle('connect', async (event, { sessionCode }) => {
  const hasPermissions = await checkAccessibilityPermissions();
  if (!hasPermissions) {
    return { success: false, error: 'Accessibility permissions required' };
  }
  
  connectToServer(sessionCode);
  return { success: true };
});

ipcMain.handle('disconnect', async () => {
  console.log('[Agent] Disconnect requested');
  
  // Stop polling first to prevent any more requests
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('[Agent] Polling stopped');
  }
  
  const sessionToDisconnect = currentSession;
  
  // Notify server of disconnect (don't wait for response)
  if (usePolling && sessionToDisconnect) {
    httpRequest(`${VIRTUAL_STUDIO_HTTP}/api/agent/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionCode: sessionToDisconnect })
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
  currentSession = null;
  currentToken = null;
  usePolling = false;
  consecutiveErrors = 0;
  
  updateTrayMenu();
  
  // Notify UI of disconnection immediately
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('connection-status', { connected: false });
    mainWindow.webContents.send('control-status', { enabled: false });
  }
  
  console.log('[Agent] Disconnected successfully');
  return { success: true };
});

ipcMain.handle('stop-control', () => {
  controlEnabled = false;
  if (ws && isConnected) {
    ws.send(JSON.stringify({ 
      type: 'control-stopped', 
      sessionCode: currentSession 
    }));
  }
  mainWindow.webContents.send('control-status', { enabled: false });
  return { success: true };
});

ipcMain.handle('get-status', () => {
  return {
    connected: isConnected,
    controlEnabled,
    session: currentSession
  };
});
