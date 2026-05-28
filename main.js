const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const http = require('http');

app.setName('Director');

let mainWindow = null;

function setupUpdater() {
  if (process.platform === 'darwin') return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (type, data = {}) => {
    if (mainWindow) mainWindow.webContents.send('updater', { type, ...data });
  };

  autoUpdater.on('checking-for-update',  ()     => send('checking'));
  autoUpdater.on('update-not-available', ()     => send('up-to-date'));
  autoUpdater.on('update-available',     (info) => send('available', { version: info.version }));
  autoUpdater.on('download-progress',    (p)    => send('progress',  { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded',    ()     => send('ready'));
  autoUpdater.on('error',                (err)  => send('error',     { message: err.message }));

  autoUpdater.checkForUpdates();
}

function getDefaultProfilesPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'profiles.yml');
  }
  return path.join(__dirname, 'profiles.yml');
}

function getProfilesPath() {
  return path.join(app.getPath('userData'), 'profiles.yml');
}

function loadProfiles() {
  const profilesPath = getProfilesPath();
  if (fs.existsSync(profilesPath)) {
    return yaml.load(fs.readFileSync(profilesPath, 'utf8'));
  }
  // Migrate from legacy single config.yml if one exists in userData
  const legacyUserPath = path.join(app.getPath('userData'), 'config.yml');
  if (fs.existsSync(legacyUserPath)) {
    const legacy = yaml.load(fs.readFileSync(legacyUserPath, 'utf8'));
    return { active: 0, profiles: [legacy] };
  }
  // Fresh install — load bundled default profiles.yml
  return yaml.load(fs.readFileSync(getDefaultProfilesPath(), 'utf8'));
}

function saveProfiles(profiles) {
  fs.writeFileSync(getProfilesPath(), yaml.dump(profiles), 'utf8');
}

function loadConfig() {
  const stored = loadProfiles();
  return stored.profiles[stored.active] || stored.profiles[0];
}

function saveConfig(config) {
  const stored = loadProfiles();
  stored.profiles[stored.active] = config;
  saveProfiles(stored);
}

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on('did-finish-load', setupUpdater);

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
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(data); } catch { body = data || null; }
        resolve({ success: res.statusCode === 200, status: res.statusCode, body });
      });
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
    const display = config.displays.find(d => d.host === host && (d.port || 5000) === (port || 5000));
    const apiKey = display?.api_key || config.api_key;
    const result = await sendCommand(host, port, apiKey, command);
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
        const apiKey = display.api_key || config.api_key;
        const result = await sendCommand(display.host, display.port, apiKey, command);
        return { key: `${display.host}:${display.port || 5000}`, ...result };
      } catch (e) {
        return { key: `${display.host}:${display.port || 5000}`, success: false, error: e.message };
      }
    })
  );
  return results;
});

ipcMain.handle('get-health-all', async () => {
  const config = loadConfig();
  const results = await Promise.all(
    config.displays.map(async (display) => {
      const apiKey = display.api_key || config.api_key;
      const health = await getHealth(display.host, display.port, apiKey);
      return { key: `${display.host}:${display.port || 5000}`, ...health };
    })
  );
  return results;
});

const { shell } = require('electron');

ipcMain.handle('open-config-file', () => {
  const profilesPath = getProfilesPath();
  // Ensure profiles.yml exists (triggers migration if needed)
  if (!fs.existsSync(profilesPath)) saveProfiles(loadProfiles());
  shell.openPath(profilesPath);
});

ipcMain.handle('open-config-dir', () => {
  shell.openPath(app.getPath('userData'));
});

ipcMain.handle('get-app-version',  () => app.getVersion());
ipcMain.handle('check-for-updates', () => { if (process.platform !== 'darwin') autoUpdater.checkForUpdates(); });
ipcMain.handle('download-update',   () => { if (process.platform !== 'darwin') autoUpdater.downloadUpdate(); });
ipcMain.handle('install-update',    () => autoUpdater.quitAndInstall());

ipcMain.handle('set-log-visible', (event, visible) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.setSize(960, visible ? 852 : 640);
});

ipcMain.handle('get-profiles', () => {
  const stored = loadProfiles();
  return {
    profiles: stored.profiles.map(p => ({ location: p.location || 'Unnamed' })),
    active: stored.active
  };
});

ipcMain.handle('switch-profile', (event, index) => {
  const stored = loadProfiles();
  if (index < 0 || index >= stored.profiles.length) return { success: false };
  stored.active = index;
  saveProfiles(stored);
  return { success: true };
});

ipcMain.handle('add-profile', (event, { duplicateFrom }) => {
  const stored = loadProfiles();
  let newProfile;
  if (duplicateFrom != null && stored.profiles[duplicateFrom]) {
    newProfile = JSON.parse(JSON.stringify(stored.profiles[duplicateFrom]));
    newProfile.location = (newProfile.location || 'Profile') + ' (copy)';
  } else {
    const defaults = yaml.load(fs.readFileSync(getDefaultProfilesPath(), 'utf8'));
    newProfile = defaults.profiles[0];
    newProfile.location = 'New Profile';
  }
  stored.profiles.push(newProfile);
  stored.active = stored.profiles.length - 1;
  saveProfiles(stored);
  return { success: true, active: stored.active };
});

ipcMain.handle('delete-profile', (event, index) => {
  const stored = loadProfiles();
  if (stored.profiles.length <= 1) return { success: false, error: 'Cannot delete the only profile' };
  stored.profiles.splice(index, 1);
  if (stored.active >= stored.profiles.length) stored.active = stored.profiles.length - 1;
  saveProfiles(stored);
  return { success: true, active: stored.active };
});