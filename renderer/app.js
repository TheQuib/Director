let config = null;
let profiles = [];           // [{location},...] — lightweight list from get-profiles
let activeProfileIndex = 0;
const inputRetryTimers = {};   // keyed by host:port
const displayOnlineState = {}; // keyed by host:port; tracks last-known online state for transition detection
const displayTvIds = {};       // keyed by host:port; populated from health responses
let logEntries = [];

function displayKey(display) {
  return `${display.host}:${display.port || 5000}`;
}
function displayDomId(display) {
  return displayKey(display).replace(/[.:]/g, '-');
}
function displayName(key) {
  return config.displays.find(d => displayKey(d) === key)?.name || key;
}
function formatCommand(command) {
  if (command === 'on')  return 'On';
  if (command === 'off') return 'Off';
  const m = command.match(/^input_hdmi(\d+)$/);
  if (m) return `HDMI ${m[1]}`;
  return command;
}

function log(msg, type = 'info') {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  logEntries.push({ time, msg, type });
  const container = document.getElementById('log-entries');
  if (!container) return;
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${msg}</span>`;
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;
  const countEl = document.getElementById('log-count');
  if (countEl) countEl.textContent = `${logEntries.length} ${logEntries.length === 1 ? 'entry' : 'entries'}`;
}

function toggleLog() {
  const isOpen = document.getElementById('log-panel').classList.toggle('open');
  window.director.setLogVisible(isOpen);
}

function clearLog() {
  logEntries = [];
  document.getElementById('log-entries').innerHTML = '';
  document.getElementById('log-count').textContent = '0 entries';
}

let updateState = 'idle'; // idle | checking | available | downloading | ready | error

function handleUpdateBtn() {
  if (updateState === 'available') {
    window.director.downloadUpdate();
  } else {
    window.director.checkForUpdates();
  }
}

function setupUpdaterUI() {
  window.director.onUpdater(data => {
    updateState = data.type;
    const statusEl  = document.getElementById('s-update-status');
    const checkBtn  = document.getElementById('btn-check-update');
    const installBtn = document.getElementById('btn-install-update');

    switch (data.type) {
      case 'checking':
        if (statusEl)  statusEl.textContent  = 'Checking…';
        if (checkBtn)  checkBtn.disabled     = true;
        break;
      case 'up-to-date':
        if (statusEl)  statusEl.textContent  = 'Up to date';
        if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Check for Updates'; }
        break;
      case 'available':
        if (statusEl)  statusEl.textContent  = `v${data.version} available`;
        if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Download'; }
        log(`Update available: v${data.version}`, 'info');
        toast(`Update available: v${data.version}`);
        break;
      case 'progress':
        if (statusEl)  statusEl.textContent  = `Downloading… ${data.percent}%`;
        if (checkBtn)  checkBtn.disabled     = true;
        break;
      case 'ready':
        if (statusEl)   statusEl.textContent  = 'Ready to install';
        if (checkBtn)   checkBtn.style.display = 'none';
        if (installBtn) installBtn.style.display = '';
        log('Update downloaded — restart to install', 'info');
        toast('Update ready — open Settings to install');
        break;
      case 'error': {
        // "latest.yml not found" just means no release artifacts yet — treat as
        // a soft warning rather than a hard error so it doesn't alarm the user.
        const noArtifacts = data.message && data.message.includes('latest.yml');
        if (statusEl)  statusEl.textContent  = noArtifacts ? 'No update info available' : `Error: ${data.message}`;
        if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = noArtifacts ? 'Check for Updates' : 'Retry'; }
        log(`Update check: ${data.message}`, noArtifacts ? 'warn' : 'error');
        break;
      }
    }
  });
}

// --- Profile management ---

function renderProfileDropdown() {
  const dropdown = document.getElementById('profile-dropdown');
  if (!dropdown) return;
  dropdown.innerHTML = profiles.map((p, i) => `
    <div class="profile-option ${i === activeProfileIndex ? 'current' : ''}"
         onclick="selectProfile(${i})">${p.location || 'Unnamed'}</div>
  `).join('') + `
    <div class="profile-option add-option" onclick="addProfileFromDropdown()">+ New Profile</div>
  `;
}

function toggleProfileDropdown(e) {
  e.stopPropagation();
  document.getElementById('profile-switcher-wrap').classList.toggle('open');
}

function closeProfileDropdown() {
  document.getElementById('profile-switcher-wrap')?.classList.remove('open');
}

document.addEventListener('click', closeProfileDropdown);

async function selectProfile(index) {
  closeProfileDropdown();
  if (index === activeProfileIndex) return;
  await window.director.switchProfile(index);
  await reloadProfileState();
  renderDisplays();
  resetDisplayState();
  refreshHealth();
  log(`Switched to profile: ${config.location || 'Unnamed'}`, 'info');
}

async function addProfileFromDropdown() {
  closeProfileDropdown();
  const result = await window.director.addProfile({});
  if (result.success) {
    await reloadProfileState();
    renderDisplays();
    resetDisplayState();
    refreshHealth();
    openSettings();
    log(`New profile created: ${config.location || 'Unnamed'}`, 'info');
  }
}

async function addProfileAction() {
  const result = await window.director.addProfile({});
  if (result.success) {
    await reloadProfileState();
    renderDisplays();
    resetDisplayState();
    refreshHealth();
    renderSettingsProfiles();
    // Refresh the rest of settings form with the new profile's data
    document.getElementById('s-location').value = config.location || '';
    document.getElementById('s-api-key').value  = config.api_key  || '';
    const retryEnabled = config.input_retry?.enabled || false;
    document.getElementById('s-retry-enabled').checked = retryEnabled;
    document.getElementById('s-retry-interval').value  = config.input_retry?.interval || 30;
    toggleRetryInterval(retryEnabled);
    renderSettingsDisplays();
    log(`New profile created: ${config.location || 'Unnamed'}`, 'info');
  }
}

async function reloadProfileState() {
  config = await window.director.getConfig();
  const profileData = await window.director.getProfiles();
  profiles = profileData.profiles;
  activeProfileIndex = profileData.active;
  document.getElementById('location-label').textContent = config.location || 'Unnamed';
  renderProfileDropdown();
}

function resetDisplayState() {
  Object.keys(inputRetryTimers).forEach(id => { clearInterval(inputRetryTimers[id]); delete inputRetryTimers[id]; });
  Object.keys(displayOnlineState).forEach(k => delete displayOnlineState[k]);
  Object.keys(displayTvIds).forEach(k => delete displayTvIds[k]);
}

function renderSettingsProfiles() {
  const container = document.getElementById('s-profiles');
  if (!container) return;
  container.innerHTML = profiles.map((p, i) => `
    <div class="profile-entry ${i === activeProfileIndex ? 'current' : ''}">
      <span class="profile-entry-name">${p.location || 'Unnamed'}</span>
      ${i === activeProfileIndex
        ? '<span class="profile-active-badge">Active</span>'
        : `<button class="btn-profile-action" onclick="switchProfileFromSettings(${i})">Switch</button>`
      }
      <button class="btn-profile-action" onclick="duplicateProfileAction(${i})">Duplicate</button>
      <button class="btn-profile-action danger" onclick="deleteProfileAction(${i})" ${profiles.length <= 1 ? 'disabled' : ''}>Delete</button>
    </div>
  `).join('');
}

async function switchProfileFromSettings(index) {
  closeSettings();
  await window.director.switchProfile(index);
  await reloadProfileState();
  renderDisplays();
  resetDisplayState();
  refreshHealth();
  openSettings();
  log(`Switched to profile: ${config.location || 'Unnamed'}`, 'info');
}

async function duplicateProfileAction(index) {
  const result = await window.director.addProfile({ duplicateFrom: index });
  if (result.success) {
    await reloadProfileState();
    renderDisplays();
    resetDisplayState();
    refreshHealth();
    renderSettingsProfiles();
    document.getElementById('s-location').value = config.location || '';
    document.getElementById('s-api-key').value  = config.api_key  || '';
    const retryEnabled = config.input_retry?.enabled || false;
    document.getElementById('s-retry-enabled').checked = retryEnabled;
    document.getElementById('s-retry-interval').value  = config.input_retry?.interval || 30;
    toggleRetryInterval(retryEnabled);
    renderSettingsDisplays();
    log(`Duplicated profile: ${config.location || 'Unnamed'}`, 'info');
  }
}

async function deleteProfileAction(index) {
  if (profiles.length <= 1) return;
  if (!confirm(`Delete profile "${profiles[index].location || 'Unnamed'}"?`)) return;
  const result = await window.director.deleteProfile(index);
  if (result.success) {
    await reloadProfileState();
    renderDisplays();
    resetDisplayState();
    refreshHealth();
    renderSettingsProfiles();
    document.getElementById('s-location').value = config.location || '';
    document.getElementById('s-api-key').value  = config.api_key  || '';
    const retryEnabled = config.input_retry?.enabled || false;
    document.getElementById('s-retry-enabled').checked = retryEnabled;
    document.getElementById('s-retry-interval').value  = config.input_retry?.interval || 30;
    toggleRetryInterval(retryEnabled);
    renderSettingsDisplays();
    log(`Profile deleted`, 'info');
  }
}

async function init() {
  config = await window.director.getConfig();
  const profileData = await window.director.getProfiles();
  profiles = profileData.profiles;
  activeProfileIndex = profileData.active;

  document.getElementById('location-label').textContent = config.location || 'Unnamed';
  renderProfileDropdown();

  log(`Director started · ${config.location || 'no location set'}`, 'info');
  log(`Config: ${config.displays.length} display(s) · retry ${config.input_retry?.enabled ? `on (${config.input_retry.interval}s)` : 'off'}`, 'info');

  window.director.getAppVersion().then(v => {
    const el = document.getElementById('s-app-version');
    if (el) el.textContent = `v${v}`;
  });

  setupUpdaterUI();
  renderDisplays();
  refreshHealth();
  setInterval(refreshHealth, 15000);
}

function renderDisplays() {
  const container = document.getElementById('displays');
  container.innerHTML = '';

  config.displays.forEach(display => {
    const key = displayKey(display);
    const domId = displayDomId(display);
    const card = document.createElement('div');
    card.className = 'display-card';
    card.id = `card-${domId}`;

    const inputs = (display.inputs || [1, 2]).map(i =>
      `<button class="btn btn-input" id="hdmi-btn-${domId}-${i}" onclick="sendOne('${display.host}', ${display.port || 5000}, 'input_hdmi${i}', '${key}')">HDMI ${i}</button>`
    ).join('');

    card.innerHTML = `
      <div class="display-header">
        <div>
          <div class="display-name">${display.name}</div>
          <div class="display-meta">
            <span id="tvid-${domId}">${displayTvIds[key] || '—'}</span>
            <span>${display.host}:${display.port || 5000}</span>
          </div>
        </div>
        <div class="status-dot checking" id="dot-${domId}" title="Checking..."></div>
      </div>
      <div class="display-controls">
        <div class="display-row">
          <button class="btn btn-on" onclick="sendOne('${display.host}', ${display.port || 5000}, 'on', '${key}')">&#9679; On</button>
          <button class="btn btn-off" onclick="sendOne('${display.host}', ${display.port || 5000}, 'off', '${key}')">&#9679; Off</button>
        </div>
        <div class="display-row">${inputs}</div>
      </div>
    `;

    container.appendChild(card);
  });
}

async function sendOne(host, port, command, displayId) {
  // Any manual command cancels an active retry for that display
  if (displayId && inputRetryTimers[displayId]) {
    clearInterval(inputRetryTimers[displayId]);
    delete inputRetryTimers[displayId];
  }

  const name = displayName(displayId);
  const cmd  = formatCommand(command);
  setStatus(`Sending ${cmd} to ${name}…`, '');
  const result = await window.director.sendCommand(host, port, command);
  if (result.success) {
    setStatus(`${cmd} → ${name}`, 'success');
    toast(`${cmd} sent`);
    const body = result.body ? `  ${JSON.stringify(result.body)}` : '';
    log(`${host} ← ${command}  HTTP ${result.status}${body}`, 'success');
  } else {
    setStatus(`Failed to send ${cmd} to ${name}`, 'error');
    toast(`Error: ${result.error || 'Unknown error'}`);
    const body = result.body ? `  ${JSON.stringify(result.body)}` : '';
    log(`${host} ← ${command}  ${result.error || `HTTP ${result.status}`}${body}`, 'error');
  }
}

async function allCommand(command) {
  Object.keys(inputRetryTimers).forEach(id => {
    clearInterval(inputRetryTimers[id]);
    delete inputRetryTimers[id];
  });

  const cmd = formatCommand(command);
  setStatus(`Sending ${cmd} to all displays…`, '');
  const results = await window.director.sendCommandAll(command);
  const failed = results.filter(r => !r.success);
  results.forEach(r => {
    const name = displayName(r.key);
    const body = r.body ? `  ${JSON.stringify(r.body)}` : '';
    if (r.success) {
      log(`${name} ← ${command}  HTTP ${r.status}${body}`, 'success');
    } else {
      log(`${name} ← ${command}  ${r.error || `HTTP ${r.status}`}${body}`, 'error');
    }
  });
  if (failed.length === 0) {
    setStatus(`${cmd} → all displays`, 'success');
    toast(`${cmd} sent to all`);
  } else {
    setStatus(`${cmd} failed on ${failed.length} display(s)`, 'error');
    toast(`${failed.length} failed`);
  }
}

async function refreshHealth(manual = false) {
  if (manual) log('Health refresh (manual)', 'info');
  const results = await window.director.getHealthAll();
  results.forEach(result => {
    const key = result.key;
    const domId = key.replace(/[.:]/g, '-');
    const display = config.displays.find(d => displayKey(d) === key);
    const name = display?.name || key;

    // Store and surface tv_id returned by the Pi
    if (result.tv_id) {
      displayTvIds[key] = result.tv_id;
      const tvIdEl = document.getElementById(`tvid-${domId}`);
      if (tvIdEl) tvIdEl.textContent = result.tv_id;
    }

    // Update status dot
    const dot = document.getElementById(`dot-${domId}`);
    if (dot) {
      dot.className = 'status-dot';
      if (!result.online) {
        dot.classList.add('offline');
        dot.title = 'Offline';
      } else if (result.bus_ready) {
        dot.classList.add('online');
        dot.title = `Online · ${result.tv_id || key}${result.phys_addr ? ` · ${result.phys_addr}` : ''}`;
      } else {
        dot.classList.add('checking');
        dot.title = 'Online · bus not ready';
      }
    }

    // Update active input button highlight
    (display?.inputs || []).forEach(i => {
      const btn = document.getElementById(`hdmi-btn-${domId}-${i}`);
      if (btn) btn.classList.toggle('active', i === result.active_input);
    });

    // Log health response
    if (!result.online) {
      log(`${name}: offline`, 'warn');
    } else if (result.bus_ready) {
      const parts = [
        `tv_id=${result.tv_id || '?'}`,
        `bus=ready`,
        result.phys_addr ? `addr=${result.phys_addr}` : null,
        result.active_input != null ? `input=HDMI ${result.active_input}` : null
      ].filter(Boolean);
      log(`${name}: online · ${parts.join(' · ')}`, 'info');
    } else {
      log(`${name}: online · tv_id=${result.tv_id || '?'} · bus=not ready`, 'info');
    }

    const wasOnline = displayOnlineState[key];
    const isNowOnline = result.online && result.bus_ready;

    // Detect power-on: explicit transition from offline → online with bus ready.
    // wasOnline === undefined (first poll) is intentionally ignored so we don't
    // fire on app launch if the display was already on.
    if (wasOnline === false && isNowOnline) {
      log(`⚡ Power-on detected: ${name} (${result.tv_id || key})`, 'info');
      if (config.input_retry?.enabled && display?.content_hdmi_port) {
        startInputRetry(display);
      }
    }

    // Display went offline — log transition and cancel any running retry
    if (wasOnline === true && !isNowOnline) {
      log(`${name}: went offline`, 'warn');
    }

    if (!isNowOnline && inputRetryTimers[key]) {
      clearInterval(inputRetryTimers[key]);
      delete inputRetryTimers[key];
    }

    displayOnlineState[key] = isNowOnline;
  });

  const time = new Date().toLocaleTimeString();
  document.getElementById('status-time').textContent = `Last checked: ${time}`;
}

function startInputRetry(display) {
  const key = displayKey(display);
  if (inputRetryTimers[key]) clearInterval(inputRetryTimers[key]);
  const command = `input_hdmi${display.content_hdmi_port}`;
  const ms = (config.input_retry.interval || 30) * 1000;
  window.director.sendCommand(display.host, display.port || 5000, command);
  log(`Retry started: ${display.name} → ${command} every ${config.input_retry.interval || 30}s`, 'retry');
  inputRetryTimers[key] = setInterval(() => {
    window.director.sendCommand(display.host, display.port || 5000, command);
    log(`Retry: ${display.name} → ${command}`, 'retry');
  }, ms);
}

function setStatus(msg, type) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = `statusbar-msg ${type}`;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// --- Settings ---

function openSettings() {
  document.getElementById('s-location').value = config.location || '';
  document.getElementById('s-api-key').value = config.api_key || '';

  const retryEnabled = config.input_retry?.enabled || false;
  document.getElementById('s-retry-enabled').checked = retryEnabled;
  document.getElementById('s-retry-interval').value = config.input_retry?.interval || 30;
  toggleRetryInterval(retryEnabled);

  renderSettingsProfiles();
  renderSettingsDisplays();
  document.getElementById('settings-overlay').classList.add('open');
}

function toggleRetryInterval(checked) {
  document.getElementById('s-retry-interval').disabled = !checked;
  document.getElementById('s-retry-interval-container').classList.toggle('dimmed', !checked);
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
}

function toggleKeyVisibility() {
  const input = document.getElementById('s-api-key');
  const btn = input.nextElementSibling;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
}

function buildContentPortOptions(inputs, currentPort) {
  const ports = (inputs || [1, 2]).map(Number);
  const current = currentPort ? Number(currentPort) : null;
  let html = '<option value="">— none —</option>';
  // If saved value isn't in the inputs list, surface it so it isn't silently lost
  if (current && !ports.includes(current)) {
    html += `<option value="${current}" selected>HDMI ${current} (custom)</option>`;
  }
  ports.forEach(p => {
    const sel = current === p ? ' selected' : '';
    html += `<option value="${p}"${sel}>HDMI ${p}</option>`;
  });
  return html;
}

function renderSettingsDisplays() {
  const container = document.getElementById('s-displays');
  container.innerHTML = '';

  (config.displays || []).forEach((display, index) => {
    container.appendChild(createDisplayEntry(display, index));
  });
}

function createDisplayEntry(display, index) {
  const entry = document.createElement('div');
  entry.className = 'display-entry';
  entry.id = `s-display-${index}`;
  entry.innerHTML = `
    <div class="display-entry-header">
      <span class="display-entry-num">Display ${index + 1}</span>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn-reorder" onclick="moveDisplay(${index}, -1)" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button class="btn-reorder" onclick="moveDisplay(${index},  1)" ${index === (config.displays.length - 1) ? 'disabled' : ''}>▼</button>
        <button class="btn-remove"  onclick="removeDisplay(${index})">Remove</button>
      </div>
    </div>
    <div class="field">
      <label>Name</label>
      <input type="text" id="s-d-name-${index}" value="${display.name || ''}" placeholder="e.g. Left Screen"/>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Host</label>
        <input type="text" id="s-d-host-${index}" value="${display.host || ''}" placeholder="192.168.1.101"/>
      </div>
      <div class="field">
        <label>Port</label>
        <input type="text" id="s-d-port-${index}" value="${display.port || 5000}" placeholder="5000"/>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Inputs (comma separated)</label>
        <input type="text" id="s-d-inputs-${index}" value="${(display.inputs || [1,2]).join(', ')}" placeholder="1, 2"/>
      </div>
      <div class="field">
        <label>Content Port</label>
        <div class="select-wrap">
          <select id="s-d-content-port-${index}">${buildContentPortOptions(display.inputs, display.content_hdmi_port)}</select>
        </div>
      </div>
    </div>
    <div class="field">
      <label>API Key Override</label>
      <input type="password" id="s-d-api-key-${index}" value="${display.api_key || ''}" placeholder="Leave blank to use global key"/>
    </div>
  `;
  return entry;
}

function addDisplay() {
  const index = (config.displays || []).length;
  config.displays = config.displays || [];
  config.displays.push({ name: '', host: '', port: 5000, inputs: [1, 2], content_hdmi_port: null });
  const container = document.getElementById('s-displays');
  container.appendChild(createDisplayEntry(config.displays[index], index));
}

function syncDisplaysFromDOM() {
  const count = document.querySelectorAll('.display-entry').length;
  for (let i = 0; i < count; i++) {
    const d = config.displays[i];
    if (!d) continue;
    d.name = document.getElementById(`s-d-name-${i}`)?.value.trim() || d.name;
    d.host = document.getElementById(`s-d-host-${i}`)?.value.trim() || d.host;
    d.port = parseInt(document.getElementById(`s-d-port-${i}`)?.value) || d.port;
    const inputsRaw = document.getElementById(`s-d-inputs-${i}`)?.value;
    if (inputsRaw) d.inputs = inputsRaw.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    const contentPort = parseInt(document.getElementById(`s-d-content-port-${i}`)?.value) || null;
    if (contentPort) d.content_hdmi_port = contentPort; else delete d.content_hdmi_port;
    const apiKey = document.getElementById(`s-d-api-key-${i}`)?.value.trim();
    if (apiKey) d.api_key = apiKey; else delete d.api_key;
  }
}

function moveDisplay(index, direction) {
  syncDisplaysFromDOM();
  const target = index + direction;
  if (target < 0 || target >= config.displays.length) return;
  [config.displays[index], config.displays[target]] = [config.displays[target], config.displays[index]];
  renderSettingsDisplays();
}

function removeDisplay(index) {
  config.displays.splice(index, 1);
  renderSettingsDisplays();
}

async function saveSettings() {
  const displayCount = document.querySelectorAll('.display-entry').length;
  const displays = [];

  for (let i = 0; i < displayCount; i++) {
    const name = document.getElementById(`s-d-name-${i}`)?.value.trim();
    const host = document.getElementById(`s-d-host-${i}`)?.value.trim();
    const port = parseInt(document.getElementById(`s-d-port-${i}`)?.value) || 5000;
    const inputsRaw = document.getElementById(`s-d-inputs-${i}`)?.value || '1, 2';
    const inputs = inputsRaw.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    const contentPort = parseInt(document.getElementById(`s-d-content-port-${i}`)?.value) || null;
    const apiKeyOverride = document.getElementById(`s-d-api-key-${i}`)?.value.trim() || null;

    if (name && host) {
      displays.push({
        name, host, port, inputs,
        ...(contentPort    ? { content_hdmi_port: contentPort }  : {}),
        ...(apiKeyOverride ? { api_key: apiKeyOverride }         : {})
      });
    }
  }

  const retryEnabled = document.getElementById('s-retry-enabled').checked;
  const newConfig = {
    location: document.getElementById('s-location').value.trim(),
    api_key: document.getElementById('s-api-key').value.trim(),
    input_retry: {
      enabled: retryEnabled,
      interval: parseInt(document.getElementById('s-retry-interval').value) || 30
    },
    displays
  };

  if (!retryEnabled) {
    Object.keys(inputRetryTimers).forEach(id => {
      clearInterval(inputRetryTimers[id]);
      delete inputRetryTimers[id];
    });
  }

  await window.director.saveConfig(newConfig);
  config = newConfig;

  // Refresh lightweight profile list so the header/dropdown reflects any location rename
  const profileData = await window.director.getProfiles();
  profiles = profileData.profiles;
  activeProfileIndex = profileData.active;

  document.getElementById('location-label').textContent = config.location || 'Unnamed';
  renderProfileDropdown();
  renderDisplays();
  refreshHealth();
  closeSettings();
  toast('Settings saved');
  log('Settings saved', 'info');
}

init();