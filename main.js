const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const http = require('http');

app.setName('Director');

function getDefaultConfigPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'config.yml');
  }
  return path.join(__dirname, 'config.yml');
}

function getUserConfigPath() {
  return path.join(app.getPath('userData'), 'config.yml');
}

function loadConfig() {
  const userPath = getUserConfigPath();
  const defaultPath = getDefaultConfigPath();

  if (fs.existsSync(userPath)) {
    return yaml.load(fs.readFileSync(userPath, 'utf8'));
  }
  return yaml.load(fs.readFileSync(defaultPath, 'utf8'));
}

function saveConfig(config) {
  const userPath = getUserConfigPath();
  fs.writeFileSync(userPath, yaml.dump(config), 'utf8');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Director'
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.setMenuBarVisibility(false);

  if (process.platform === 'darwin') {
    const { Menu } = require('electron');
    const template = [
      {
        label: 'Director',
        submenu: [
          { role: 'about', label: 'About Director' },
          { type: 'separator' },
          { role: 'quit', label: 'Quit Director' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('web-contents-created', (event, contents) => {
  contents.on('context-menu', (e, params) => {
    if (!params.isEditable) return;
    const { Menu, MenuItem } = require('electron');
    const menu = new Menu();
    menu.append(new MenuItem({ role: 'cut',   enabled: params.editFlags.canCut   }));
    menu.append(new MenuItem({ role: 'copy',  enabled: params.editFlags.canCopy  }));
    menu.append(new MenuItem({ role: 'paste', enabled: params.editFlags.canPaste }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ role: 'selectAll' }));
    menu.popup();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function sendCommand(host, port, apiKey, command) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ command });
    const options = {
      hostname: host,
      port: port || 5000,
      path: '/command',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      resolve({ success: res.statusCode === 200, status: res.statusCode });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

async function getHealth(host, port, apiKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: host,
      port: port || 5000,
      path: '/health',
      method: 'GET',
      headers: { 'X-API-Key': apiKey },
      timeout: 3000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ online: true, ...JSON.parse(data) });
        } catch {
          resolve({ online: false });
        }
      });
    });

    req.on('error', () => resolve({ online: false }));
    req.on('timeout', () => { req.destroy(); resolve({ online: false }); });
    req.end();
  });
}

ipcMain.handle('get-config', () => loadConfig());

ipcMain.handle('save-config', (event, config) => {
  saveConfig(config);
  return { success: true };
});

ipcMain.handle('send-command', async (event, { host, port, command }) => {
  const config = loadConfig();
  try {
    const result = await sendCommand(host, port, config.api_key, command);
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('send-command-all', async (event, { command }) => {
  const config = loadConfig();
  const results = await Promise.all(
    config.displays.map(async (display) => {
      try {
        const result = await sendCommand(display.host, display.port, config.api_key, command);
        return { id: display.id, ...result };
      } catch (e) {
        return { id: display.id, success: false, error: e.message };
      }
    })
  );
  return results;
});

ipcMain.handle('get-health-all', async () => {
  const config = loadConfig();
  const results = await Promise.all(
    config.displays.map(async (display) => {
      const health = await getHealth(display.host, display.port, config.api_key);
      return { id: display.id, ...health };
    })
  );
  return results;
});

const { shell } = require('electron');

ipcMain.handle('open-config-file', () => {
  const userPath = getUserConfigPath();
  if (!fs.existsSync(userPath)) saveConfig(loadConfig());
  shell.openPath(userPath);
});

ipcMain.handle('open-config-dir', () => {
  shell.openPath(app.getPath('userData'));
});

ipcMain.handle('set-log-visible', (event, visible) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.setSize(960, visible ? 852 : 640);
});