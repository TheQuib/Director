let config = null;
const inputRetryTimers = {};   // keyed by display.id
const displayOnlineState = {}; // keyed by display.id; tracks last-known online state for transition detection
let logEntries = [];

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

async function init() {
  config = await window.director.getConfig();
  document.getElementById('location-label').textContent = config.location || 'Unknown Location';
  log(`Director started · ${config.location || 'no location set'}`, 'info');
  log(`Config: ${config.displays.length} display(s) · retry ${config.input_retry?.enabled ? `on (${config.input_retry.interval}s)` : 'off'}`, 'info');
  renderDisplays();
  refreshHealth();
  setInterval(refreshHealth, 15000);
}

function renderDisplays() {
  const container = document.getElementById('displays');
  container.innerHTML = '';

  config.displays.forEach(display => {
    const card = document.createElement('div');
    card.className = 'display-card';
    card.id = `card-${display.id}`;

    const inputs = (display.inputs || [1, 2]).map(i =>
      `<button class="btn btn-input" onclick="sendOne('${display.host}', ${display.port || 5000}, 'input_hdmi${i}', '${display.id}')">HDMI ${i}</button>`
    ).join('');

    card.innerHTML = `
      <div class="display-header">
        <div>
          <div class="display-name">${display.name}</div>
          <div class="display-meta">
            <span>${display.id}</span>
            <span>${display.host}:${display.port || 5000}</span>
          </div>
        </div>
        <div class="status-dot checking" id="dot-${display.id}" title="Checking..."></div>
      </div>
      <div class="display-controls">
        <div class="display-row">
          <button class="btn btn-on" onclick="sendOne('${display.host}', ${display.port || 5000}, 'on', '${display.id}')">&#9679; On</button>
          <button class="btn btn-off" onclick="sendOne('${display.host}', ${display.port || 5000}, 'off', '${display.id}')">&#9679; Off</button>
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

  setStatus(`Sending ${command} to ${host}...`, '');
  const result = await window.director.sendCommand(host, port, command);
  if (result.success) {
    setStatus(`Sent: ${command} → ${host}`, 'success');
    toast(`${command} sent`);
    log(`${host} ← ${command}  HTTP ${result.status}`, 'success');
  } else {
    setStatus(`Failed: ${command} → ${host}`, 'error');
    toast(`Error: ${result.error || 'Unknown error'}`);
    log(`${host} ← ${command}  ${result.error ? result.error : `HTTP ${result.status}`}`, 'error');
  }
}

async function allCommand(command) {
  Object.keys(inputRetryTimers).forEach(id => {
    clearInterval(inputRetryTimers[id]);
    delete inputRetryTimers[id];
  });

  setStatus(`Sending ${command} to all displays...`, '');
  const results = await window.director.sendCommandAll(command);
  const failed = results.filter(r => !r.success);
  results.forEach(r => {
    const display = config.displays.find(d => d.id === r.id);
    const name = display?.name || r.id;
    if (r.success) {
      log(`${name} ← ${command}  HTTP ${r.status}`, 'success');
    } else {
      log(`${name} ← ${command}  ${r.error ? r.error : `HTTP ${r.status}`}`, 'error');
    }
  });
  if (failed.length === 0) {
    setStatus(`Sent: ${command} → all displays`, 'success');
    toast(`${command} sent to all`);
  } else {
    setStatus(`${failed.length} display(s) failed`, 'error');
    toast(`${failed.length} failed`);
  }
}

async function refreshHealth(manual = false) {
  if (manual) log('Health refresh (manual)', 'info');
  const results = await window.director.getHealthAll();
  results.forEach(result => {
    const display = config.displays.find(d => d.id === result.id);
    const name = display?.name || result.id;

    // Update status dot
    const dot = document.getElementById(`dot-${result.id}`);
    if (dot) {
      dot.className = 'status-dot';
      if (!result.online) {
        dot.classList.add('offline');
        dot.title = 'Offline';
      } else if (result.bus_ready) {
        dot.classList.add('online');
        dot.title = `Online - ${result.phys_addr}`;
      } else {
        dot.classList.add('checking');
        dot.title = 'Online - bus not ready';
      }
    }

    // Log health response
    if (!result.online) {
      log(`${name}: offline`, 'warn');
    } else if (result.bus_ready) {
      log(`${name}: online · bus ready${result.phys_addr ? ` · ${result.phys_addr}` : ''}`, 'info');
    } else {
      log(`${name}: online · bus not ready`, 'info');
    }

    const wasOnline = displayOnlineState[result.id];
    const isNowOnline = result.online && result.bus_ready;

    // Detect power-on: explicit transition from offline → online with bus ready.
    // wasOnline === undefined (first poll) is intentionally ignored so we don't
    // fire on app launch if the display was already on.
    if (wasOnline === false && isNowOnline) {
      log(`⚡ Power-on detected: ${name}`, 'info');
      if (config.input_retry?.enabled && display?.content_hdmi_port) {
        startInputRetry(display);
      }
    }

    // Display went offline — log transition and cancel any running retry
    if (wasOnline === true && !isNowOnline) {
      log(`${name}: went offline`, 'warn');
    }

    if (!isNowOnline && inputRetryTimers[result.id]) {
      clearInterval(inputRetryTimers[result.id]);
      delete inputRetryTimers[result.id];
    }

    displayOnlineState[result.id] = isNowOnline;
  });

  const time = new Date().toLocaleTimeString();
  document.getElementById('status-time').textContent = `Last checked: ${time}`;
}

function startInputRetry(display) {
  if (inputRetryTimers[display.id]) clearInterval(inputRetryTimers[display.id]);
  const command = `input_hdmi${display.content_hdmi_port}`;
  const ms = (config.input_retry.interval || 30) * 1000;
  window.director.sendCommand(display.host, display.port || 5000, command);
  log(`Retry started: ${display.name} → ${command} every ${config.input_retry.interval || 30}s`, 'retry');
  inputRetryTimers[display.id] = setInterval(() => {
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
      <button class="btn-remove" onclick="removeDisplay(${index})">Remove</button>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Name</label>
        <input type="text" id="s-d-name-${index}" value="${display.name || ''}" placeholder="e.g. Left"/>
      </div>
      <div class="field">
        <label>ID</label>
        <input type="text" id="s-d-id-${index}" value="${display.id || ''}" placeholder="e.g. tv-left"/>
      </div>
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
  `;
  return entry;
}

function addDisplay() {
  const index = (config.displays || []).length;
  config.displays = config.displays || [];
  config.displays.push({ name: '', id: '', host: '', port: 5000, inputs: [1, 2], content_hdmi_port: null });
  const container = document.getElementById('s-displays');
  container.appendChild(createDisplayEntry(config.displays[index], index));
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
    const id = document.getElementById(`s-d-id-${i}`)?.value.trim();
    const host = document.getElementById(`s-d-host-${i}`)?.value.trim();
    const port = parseInt(document.getElementById(`s-d-port-${i}`)?.value) || 5000;
    const inputsRaw = document.getElementById(`s-d-inputs-${i}`)?.value || '1, 2';
    const inputs = inputsRaw.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));

    const contentPort = parseInt(document.getElementById(`s-d-content-port-${i}`)?.value) || null;

    if (name && id && host) {
      displays.push({ name, id, host, port, inputs, ...(contentPort ? { content_hdmi_port: contentPort } : {}) });
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

  document.getElementById('location-label').textContent = config.location || 'Unknown Location';
  renderDisplays();
  refreshHealth();
  closeSettings();
  toast('Settings saved');
  log('Settings saved', 'info');
}

init();