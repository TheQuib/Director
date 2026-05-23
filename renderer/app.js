let config = null;

async function init() {
  config = await window.director.getConfig();
  document.getElementById('location-label').textContent = config.location || 'Unknown Location';
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
      `<button class="btn btn-input" onclick="sendOne('${display.host}', ${display.port || 5000}, 'input_hdmi${i}')">HDMI ${i}</button>`
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
          <button class="btn btn-on" onclick="sendOne('${display.host}', ${display.port || 5000}, 'on')">&#9679; On</button>
          <button class="btn btn-off" onclick="sendOne('${display.host}', ${display.port || 5000}, 'off')">&#9679; Off</button>
        </div>
        <div class="display-row">${inputs}</div>
      </div>
    `;

    container.appendChild(card);
  });
}

async function sendOne(host, port, command) {
  setStatus(`Sending ${command} to ${host}...`, '');
  const result = await window.director.sendCommand(host, port, command);
  if (result.success) {
    setStatus(`Sent: ${command} → ${host}`, 'success');
    toast(`${command} sent`);
  } else {
    setStatus(`Failed: ${command} → ${host}`, 'error');
    toast(`Error: ${result.error || 'Unknown error'}`);
  }
}

async function allCommand(command) {
  setStatus(`Sending ${command} to all displays...`, '');
  const results = await window.director.sendCommandAll(command);
  const failed = results.filter(r => !r.success);
  if (failed.length === 0) {
    setStatus(`Sent: ${command} → all displays`, 'success');
    toast(`${command} sent to all`);
  } else {
    setStatus(`${failed.length} display(s) failed`, 'error');
    toast(`${failed.length} failed`);
  }
}

async function refreshHealth() {
  const results = await window.director.getHealthAll();
  results.forEach(result => {
    const dot = document.getElementById(`dot-${result.id}`);
    if (!dot) return;
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
  });

  const time = new Date().toLocaleTimeString();
  document.getElementById('status-time').textContent = `Last checked: ${time}`;
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
  renderSettingsDisplays();
  document.getElementById('settings-overlay').classList.add('open');
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
    <div class="field">
      <label>Inputs (comma separated)</label>
      <input type="text" id="s-d-inputs-${index}" value="${(display.inputs || [1,2]).join(', ')}" placeholder="1, 2"/>
    </div>
  `;
  return entry;
}

function addDisplay() {
  const index = (config.displays || []).length;
  config.displays = config.displays || [];
  config.displays.push({ name: '', id: '', host: '', port: 5000, inputs: [1, 2] });
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

    if (name && id && host) {
      displays.push({ name, id, host, port, inputs });
    }
  }

  const newConfig = {
    location: document.getElementById('s-location').value.trim(),
    api_key: document.getElementById('s-api-key').value.trim(),
    displays
  };

  await window.director.saveConfig(newConfig);
  config = newConfig;

  document.getElementById('location-label').textContent = config.location || 'Unknown Location';
  renderDisplays();
  refreshHealth();
  closeSettings();
  toast('Settings saved');
}

init();