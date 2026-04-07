// public/app.js – WebSocket client cho Dashboard
// Kết nối: ws://<host>/fe
//
// Nhận từ server:
//   { type: "sensor_update", temp, humi, fan, alarm, error, app_state, system_state, timestamp }
//   { type: "fan_state",     state: "ON"|"OFF" }
//   { type: "event",         event: "ALARM_ON"|"NORMAL"|... }
//   { type: "esp_status",    connected: bool }
//
// Gửi lên server:
//   { type: "fan", state: "ON"|"OFF" }
//   { type: "buzzer_off" }

const WS_URL = `ws://${location.host}/fe`;
let ws = null;
let reconnectTimer = null;

// ── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const wsDot       = $('ws-dot');
const wsStatus    = $('ws-status');
const espDot      = $('esp-dot');
const espStatus   = $('esp-status');
const tempVal     = $('temp-val');
const humiVal     = $('humi-val');
const appStateBadge = $('app-state-badge');
const fanText     = $('fan-state-text');
const logBox      = $('log-box');

// ── Log ─────────────────────────────────────────────────────────────────────
function log(msg, type = 'info') {
  const p = document.createElement('p');
  p.className = `log-${type}`;
  p.textContent = `[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`;
  logBox.prepend(p);
  if (logBox.children.length > 60) logBox.removeChild(logBox.lastChild);
}

// ── UI ───────────────────────────────────────────────────────────────────────
const STATE_CLASS = {
  NORMAL:      'badge-normal',
  WARNING:     'badge-warning',
  ALARM:       'badge-alarm',
  ERROR_STATE: 'badge-error',
  ERROR:       'badge-error',
};

function updateSensor(data) {
  tempVal.innerHTML = `${data.temp}<span class="card-unit">°C</span>`;
  humiVal.innerHTML = `${data.humi}<span class="card-unit">%</span>`;

  const state = data.app_state || 'NORMAL';
  appStateBadge.textContent = state;
  appStateBadge.className   = `badge ${STATE_CLASS[state] || 'badge-normal'}`;
}

function updateFan(state) {
  fanText.textContent = state;
  fanText.className   = state === 'ON' ? 'on' : 'off';
}

function updateESP(connected) {
  espDot.className   = connected ? 'dot on' : 'dot';
  espStatus.textContent = connected ? 'ESP đã kết nối' : 'ESP chưa kết nối';
}

// ── WebSocket ────────────────────────────────────────────────────────────────
function connect() {
  clearTimeout(reconnectTimer);
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    wsDot.className   = 'dot on';
    wsStatus.textContent = 'Đã kết nối server';
    log('✅ Kết nối server thành công', 'ok');
  };

  ws.onclose = () => {
    wsDot.className   = 'dot';
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
          log(`🌡 ${msg.temp}°C | 💧 ${msg.humi}% | Quạt: ${msg.fan ? 'ON' : 'OFF'} | ${msg.app_state}`, 'info');
          break;

        case 'fan_state':
          updateFan(msg.state);
          log(`🌀 Quạt: ${msg.state}`, 'ok');
          break;

        case 'event':
          log(`🔔 Sự kiện: ${msg.event}`, msg.event === 'ALARM_ON' ? 'err' : 'warn');
          break;

        case 'esp_status':
          updateESP(msg.connected);
          log(`ESP ${msg.connected ? '🟢 kết nối' : '🔴 ngắt kết nối'}`, msg.connected ? 'ok' : 'warn');
          break;

        default:
          log(`[?] Nhận: ${data}`, 'warn');
      }
    } catch {
      log('Parse lỗi: ' + data, 'warn');
    }
  };
}

// ── Gửi lệnh ────────────────────────────────────────────────────────────────
function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    log('⚠️ Chưa kết nối server!', 'warn');
  }
}

function setFan(state) {
  send({ type: 'fan', state });
  log(`📤 Gửi: Quạt ${state}`, 'info');
}

function buzzerOff() {
  send({ type: 'buzzer_off' });
  log('📤 Gửi: Tắt còi', 'info');
}

// ── Khởi động ────────────────────────────────────────────────────────────────
connect();
