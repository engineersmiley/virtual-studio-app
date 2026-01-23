const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, systemPreferences } = require('electron');
const path = require('path');
const WebSocket = require('ws');
const https = require('https');

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
    mainWindow.webContents.send('connection-status', { connected: true, session: sessionCode, mode: 'polling' });
    updateTrayMenu();
    
    // Start polling for messages
    pollingInterval = setInterval(async () => {
      try {
        // Poll without token - simple mode
        const pollResponse = await httpRequest(`${VIRTUAL_STUDIO_HTTP}/api/agent/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionCode: currentSession })
        });
        
        if (pollResponse.ok) {
          const data = await pollResponse.json();
          for (const message of data.messages) {
            await handleControlMessage(message);
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 500);
    
  } catch (error) {
    console.error('HTTP connection error:', error);
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
            robot.keyTap(key);
          }
        }
        break;
        
      case 'key-type':
        if (controlEnabled) {
          robot.typeString(message.text);
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
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  
  if (usePolling && currentSession) {
    try {
      await httpRequest(`${VIRTUAL_STUDIO_HTTP}/api/agent/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode: currentSession })
      });
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  }
  
  if (ws) {
    ws.close();
    ws = null;
  }
  
  isConnected = false;
  controlEnabled = false;
  currentSession = null;
  currentToken = null;
  usePolling = false;
  updateTrayMenu();
  
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
