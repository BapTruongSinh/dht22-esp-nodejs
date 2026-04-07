// public/app.js – WebSocket client cho Dashboard
// Kết nối: ws://<host>/fe
//
// Nhận từ server:
//   { type: "sensor_update", temp, humi, fan, buzzer, mode, alarm, error, app_state, system_state, timestamp }
//   { type: "fan_state",    state: "ON"|"OFF" }
//   { type: "buzzer_state", state: "ON"|"OFF" }
//   { type: "mode_state",   mode:  "AUTO"|"MANUAL" }
//   { type: "event",        event: "ALARM"|"NORMAL"|... }
//   { type: "esp_status",   connected: bool }
//   { type: "error",        reason: "AUTO_MODE" }
//
// Gửi lên server:
//   { type: "fan",       state: "ON"|"OFF" }
//   { type: "buzzer_off" }
//   { type: "mode",      value: "AUTO"|"MANUAL" }

const WS_URL = `ws://${location.host}/fe`;

let ws = null;
let reconnectTimer = null;
let currentMode = 'AUTO';   // theo dõi mode hiện tại

// ── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const wsDot        = $('ws-dot');
const wsStatus     = $('ws-status');
const espDot       = $('esp-dot');
const espStatus    = $('esp-status');
const tempVal      = $('temp-val');
const humiVal      = $('humi-val');
const appStateBadge= $('app-state-badge');
const fanText      = $('fan-state-text');
const buzzerText   = $('buzzer-state-text');
const modeBadge    = $('mode-badge');
const logBox       = $('log-box');

const btnFanOn     = $('btn-fan-on');
const btnFanOff    = $('btn-fan-off');
const btnBuzzerOff = $('btn-buzzer-off');
const btnModeAuto  = $('btn-mode-auto');
const btnModeManual= $('btn-mode-manual');

// ── Log ──────────────────────────────────────────────────────────────────────
function log(msg, type = 'info') {
  const p = document.createElement('p');
  p.className = `log-${type}`;
  p.textContent = `[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`;
  logBox.prepend(p);
  if (logBox.children.length > 60) logBox.removeChild(logBox.lastChild);
}

// ── UI Updates ───────────────────────────────────────────────────────────────
const STATE_CLASS = {
  NORMAL:      'badge-normal',
  WARNING:     'badge-warning',
  ALARM:       'badge-alarm',
  ERROR_STATE: 'badge-error',
  ERROR:       'badge-error',
};

function updateSensor(data) {
  tempVal.innerHTML = `${parseFloat(data.temp).toFixed(1)}<span class="card-unit">°C</span>`;
  humiVal.innerHTML = `${parseFloat(data.humi).toFixed(1)}<span class="card-unit">%</span>`;

  const state = data.app_state || 'NORMAL';
  appStateBadge.textContent = state;
  appStateBadge.className   = `badge ${STATE_CLASS[state] || 'badge-normal'}`;
}

function updateFan(state) {
  fanText.textContent = state;
  fanText.className   = state === 'ON' ? 'on' : 'off';
}

function updateBuzzer(state) {
  buzzerText.textContent = state;
  buzzerText.className   = state === 'ON' ? 'on' : 'off';
}

function updateESP(connected) {
  espDot.className      = connected ? 'dot on' : 'dot';
  espStatus.textContent = connected ? 'ESP đã kết nối' : 'ESP chưa kết nối';
}

function updateMode(mode) {
  currentMode = mode;
  const isAuto = mode === 'AUTO';

  // Cập nhật badge
  modeBadge.textContent = isAuto ? '🤖 AUTO' : '🕹️ MANUAL';
  modeBadge.className   = isAuto ? 'badge badge-mode-auto' : 'badge badge-mode-manual';

  // Disable nút điều khiển khi đang AUTO
  btnFanOn.disabled     = isAuto;
  btnFanOff.disabled    = isAuto;
  btnBuzzerOff.disabled = isAuto;

  // Highlight nút mode đang active
  btnModeAuto.classList.toggle('active', isAuto);
  btnModeManual.classList.toggle('active', !isAuto);

  log(`🔄 Chế độ: ${mode}`, 'info');
}

// ── WebSocket ────────────────────────────────────────────────────────────────
function connect() {
  clearTimeout(reconnectTimer);
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    wsDot.className      = 'dot on';
    wsStatus.textContent = 'Đã kết nối server';
    log('✅ Kết nối server thành công', 'ok');
  };

  ws.onclose = () => {
    wsDot.className      = 'dot';
    wsStatus.textContent = 'Mất kết nối, thử lại sau 5s...';
    log('❌ Mất kết nối server', 'warn');
    reconnectTimer = setTimeout(connect, 5000);
  };

  ws.onerror = () => log('⚠️ Lỗi WebSocket', 'warn');

  ws.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data);
      switch (msg.type) {

        case 'sensor_update':
          updateSensor(msg);
          if (msg.mode)   updateMode(msg.mode);
          if (msg.fan   !== undefined) updateFan(msg.fan    ? 'ON' : 'OFF');
          if (msg.buzzer !== undefined) updateBuzzer(msg.buzzer ? 'ON' : 'OFF');
          log(`🌡 ${parseFloat(msg.temp).toFixed(1)}°C | 💧 ${parseFloat(msg.humi).toFixed(1)}% | Quạt: ${msg.fan ? 'ON' : 'OFF'} | Còi: ${msg.buzzer ? 'ON' : 'OFF'} | ${msg.app_state}`, 'info');
          break;

        case 'fan_state':
          updateFan(msg.state);
          log(`🌀 Quạt: ${msg.state}`, 'ok');
          break;

        case 'buzzer_state':
          updateBuzzer(msg.state);
          log(`🔔 Còi: ${msg.state}`, msg.state === 'ON' ? 'err' : 'ok');
          break;

        case 'mode_state':
          updateMode(msg.mode);
          break;

        case 'event':
          log(`📣 Sự kiện: ${msg.event}`, msg.event === 'ALARM' ? 'err' : 'warn');
          break;

        case 'esp_status':
          updateESP(msg.connected);
          log(`ESP ${msg.connected ? '🟢 kết nối' : '🔴 ngắt kết nối'}`, msg.connected ? 'ok' : 'warn');
          break;

        case 'error':
          if (msg.reason === 'AUTO_MODE')
            log('⚠️ Không thể điều khiển khi đang ở chế độ AUTO!', 'warn');
          break;

        default:
          log(`[?] Nhận: ${data}`, 'warn');
      }
    } catch {
      log('Parse lỗi: ' + data, 'warn');
    }
  };
}

// ── Gửi lệnh ─────────────────────────────────────────────────────────────────
function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    log('⚠️ Chưa kết nối server!', 'warn');
  }
}

function setFan(state) {
  if (currentMode === 'AUTO') {
    log('⛔ Không thể điều khiển quạt ở chế độ AUTO', 'warn');
    return;
  }
  send({ type: 'fan', state });
  log(`📤 Gửi: Quạt ${state}`, 'info');
}

function buzzerOff() {
  if (currentMode === 'AUTO') {
    log('⛔ Không thể tắt còi ở chế độ AUTO', 'warn');
    return;
  }
  send({ type: 'buzzer_off' });
  log('📤 Gửi: Tắt còi', 'info');
}

function setMode(mode) {
  send({ type: 'mode', value: mode });
  log(`📤 Gửi: Chuyển chế độ ${mode}`, 'info');
}

// ── Khởi động ────────────────────────────────────────────────────────────────
connect();
