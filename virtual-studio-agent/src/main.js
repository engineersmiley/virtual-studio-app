const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, systemPreferences } = require('electron');
const path = require('path');
const WebSocket = require('ws');

let mainWindow = null;
let tray = null;
let ws = null;
let isConnected = false;
let controlEnabled = false;
let currentSession = null;

const VIRTUAL_STUDIO_URL = 'wss://virtualstudio.sale';

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

function connectToServer(sessionCode, sessionToken) {
  if (ws) {
    ws.close();
  }

  const wsUrl = `${VIRTUAL_STUDIO_URL}/agent?session=${sessionCode}&token=${sessionToken}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.on('open', () => {
    isConnected = true;
    currentSession = sessionCode;
    mainWindow.webContents.send('connection-status', { connected: true, session: sessionCode });
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
    isConnected = false;
    controlEnabled = false;
    currentSession = null;
    mainWindow.webContents.send('connection-status', { connected: false });
    updateTrayMenu();
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    mainWindow.webContents.send('error', error.message);
  });
}

async function handleControlMessage(message) {
  const { mouse, keyboard } = require('@nut-tree/nut-js');
  
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
        ws.send(JSON.stringify({ 
          type: 'control-response', 
          allowed: controlEnabled,
          sessionCode: currentSession 
        }));
        mainWindow.webContents.send('control-status', { enabled: controlEnabled });
        break;
      
      case 'control-end':
        // Always process control end requests
        controlEnabled = false;
        mainWindow.webContents.send('control-status', { enabled: false });
        break;
        
      case 'mouse-move':
        if (controlEnabled) {
          await mouse.setPosition({ x: message.x, y: message.y });
        }
        break;
        
      case 'mouse-click':
        if (controlEnabled) {
          const { Button } = require('@nut-tree/nut-js');
          const button = message.button === 'right' ? Button.RIGHT : Button.LEFT;
          await mouse.click(button);
        }
        break;
        
      case 'mouse-double-click':
        if (controlEnabled) {
          const { Button } = require('@nut-tree/nut-js');
          await mouse.doubleClick(Button.LEFT);
        }
        break;
        
      case 'mouse-scroll':
        if (controlEnabled) {
          await mouse.scrollDown(message.deltaY > 0 ? message.deltaY : 0);
          await mouse.scrollUp(message.deltaY < 0 ? -message.deltaY : 0);
        }
        break;
        
      case 'key-press':
        if (controlEnabled) {
          const { Key } = require('@nut-tree/nut-js');
          const key = mapKeyToNutJs(message.key);
          if (key) {
            await keyboard.pressKey(key);
            await keyboard.releaseKey(key);
          }
        }
        break;
        
      case 'key-type':
        if (controlEnabled) {
          await keyboard.type(message.text);
        }
        break;
    }
  } catch (error) {
    console.error('Error executing control command:', error);
  }
}

function mapKeyToNutJs(key) {
  const { Key } = require('@nut-tree/nut-js');
  
  const keyMap = {
    'Enter': Key.Enter,
    'Escape': Key.Escape,
    'Backspace': Key.Backspace,
    'Tab': Key.Tab,
    'Space': Key.Space,
    'ArrowUp': Key.Up,
    'ArrowDown': Key.Down,
    'ArrowLeft': Key.Left,
    'ArrowRight': Key.Right,
    'Delete': Key.Delete,
    'Home': Key.Home,
    'End': Key.End,
    'PageUp': Key.PageUp,
    'PageDown': Key.PageDown,
    'Control': Key.LeftControl,
    'Alt': Key.LeftAlt,
    'Shift': Key.LeftShift,
    'Meta': Key.LeftSuper,
    'F1': Key.F1,
    'F2': Key.F2,
    'F3': Key.F3,
    'F4': Key.F4,
    'F5': Key.F5,
    'F6': Key.F6,
    'F7': Key.F7,
    'F8': Key.F8,
    'F9': Key.F9,
    'F10': Key.F10,
    'F11': Key.F11,
    'F12': Key.F12,
  };
  
  if (keyMap[key]) {
    return keyMap[key];
  }
  
  if (key.length === 1) {
    const char = key.toUpperCase();
    if (Key[char]) {
      return Key[char];
    }
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

ipcMain.handle('connect', async (event, { sessionCode, sessionToken }) => {
  const hasPermissions = await checkAccessibilityPermissions();
  if (!hasPermissions) {
    return { success: false, error: 'Accessibility permissions required' };
  }
  
  connectToServer(sessionCode, sessionToken);
  return { success: true };
});

ipcMain.handle('disconnect', () => {
  if (ws) {
    ws.close();
  }
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
