const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, systemPreferences } = require('electron');
const path = require('path');
const WebSocket = require('ws');

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
        app.quit();
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

async function connectViaPolling(sessionCode, sessionToken) {
  try {
    const response = await fetch(`${VIRTUAL_STUDIO_HTTP}/api/agent/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: sessionToken, sessionCode })
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to connect');
    }
    
    usePolling = true;
    isConnected = true;
    currentSession = sessionCode;
    currentToken = sessionToken;
    mainWindow.webContents.send('connection-status', { connected: true, session: sessionCode, mode: 'polling' });
    updateTrayMenu();
    
    pollingInterval = setInterval(async () => {
      try {
        const pollResponse = await fetch(`${VIRTUAL_STUDIO_HTTP}/api/agent/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: currentToken, sessionCode: currentSession })
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

function connectToServer(sessionCode, sessionToken) {
  if (ws) {
    ws.close();
  }
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  
  currentToken = sessionToken;
  usePolling = false;

  const wsUrl = `${VIRTUAL_STUDIO_URL}/agent?session=${sessionCode}&token=${sessionToken}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.on('open', () => {
    isConnected = true;
    currentSession = sessionCode;
    mainWindow.webContents.send('connection-status', { connected: true, session: sessionCode, mode: 'websocket' });
    updateTrayMenu();
  });
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleControlMessage(message);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });
  
  ws.on('close', () => {
    if (!usePolling) {
      isConnected = false;
      controlEnabled = false;
      currentSession = null;
      mainWindow.webContents.send('connection-status', { connected: false });
      updateTrayMenu();
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    console.log('Falling back to HTTP polling...');
    mainWindow.webContents.send('status-message', 'WebSocket blocked, using HTTP polling...');
    connectViaPolling(sessionCode, sessionToken);
  });
}

async function handleControlMessage(message) {
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
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          title: 'Remote Control Request',
          message: `${message.fromName || 'An engineer'} wants to control your computer.`,
          detail: 'They will be able to move your mouse and type on your keyboard. You can stop control anytime by pressing Escape.',
          buttons: ['Allow', 'Deny']
        });
        
        controlEnabled = result.response === 0;
        
        if (usePolling) {
          await fetch(`${VIRTUAL_STUDIO_HTTP}/api/agent/send`, {
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
    'F1': 'f1', 'F2': 'f2', 'F3': 'f3', 'F4': 'f4',
    'F5': 'f5', 'F6': 'f6', 'F7': 'f7', 'F8': 'f8',
    'F9': 'f9', 'F10': 'f10', 'F11': 'f11', 'F12': 'f12',
  };
  
  if (keyMap[key]) return keyMap[key];
  if (key.length === 1) return key.toLowerCase();
  return null;
}

function updateTrayMenu() {
  if (tray) {
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open Virtual Studio Agent', click: () => mainWindow.show() },
      { type: 'separator' },
      { label: isConnected ? `Connected to ${currentSession}` : 'Not Connected', enabled: false },
      { label: controlEnabled ? 'Control: Active' : 'Control: Inactive', enabled: false },
      { type: 'separator' },
      { label: 'Disconnect', enabled: isConnected, click: () => { if (ws) ws.close(); } },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
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
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow.show();
});

ipcMain.handle('connect', async (event, { sessionCode, sessionToken }) => {
  const hasPermissions = await checkAccessibilityPermissions();
  if (!hasPermissions) return { success: false, error: 'Accessibility permissions required' };
  connectToServer(sessionCode, sessionToken);
  return { success: true };
});

ipcMain.handle('disconnect', async () => {
  if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
  if (usePolling && currentSession && currentToken) {
    try {
      await fetch(`${VIRTUAL_STUDIO_HTTP}/api/agent/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: currentToken, sessionCode: currentSession })
      });
    } catch (err) { console.error('Disconnect error:', err); }
  }
  if (ws) ws.close();
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
    ws.send(JSON.stringify({ type: 'control-stopped', sessionCode: currentSession }));
  }
  mainWindow.webContents.send('control-status', { enabled: false });
  return { success: true };
});

ipcMain.handle('get-status', () => {
  return { connected: isConnected, controlEnabled, session: currentSession };
});
