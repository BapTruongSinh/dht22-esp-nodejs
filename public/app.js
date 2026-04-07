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
const MAX_POINTS = 20;

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
const fanSwitch   = $('fanSwitch');
const alarmSwitch = $('alarmSwitch');
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
  if (tempVal) tempVal.innerHTML = `${data.temp}<span class="card-unit">°C</span>`;
  if (humiVal) humiVal.innerHTML = `${data.humi}<span class="card-unit">%</span>`;

  const state = data.app_state || 'NORMAL';
  if (appStateBadge) {
    appStateBadge.textContent = state;
    appStateBadge.className   = `badge ${STATE_CLASS[state] || 'badge-normal'}`;
  }
}

function updateFan(state) {
  const isOn = state === 'ON';
  if (fanText) {
    fanText.textContent = state;
    fanText.className   = isOn ? 'on' : 'off';
  }
  if (fanSwitch) fanSwitch.checked = isOn;
  
  const fanBadge = $('fanBadge');
  if (fanBadge) {
    fanBadge.textContent = isOn ? 'On' : 'Off';
    fanBadge.className = `status-badge ${isOn ? 'on' : 'off'}`;
  }
}

function updateESP(connected) {
  if (wsDot) wsDot.className = connected ? 'dot on' : 'dot';
  if (espDot) espDot.className = connected ? 'dot on' : 'dot';
  if (espStatus) espStatus.textContent = connected ? 'ESP đã kết nối' : 'ESP chưa kết nối';
}

// Cập nhật trạng thái còi trên UI
function updateBuzzer(active) {
  // Cập nhật badge trong card điều khiển thiết bị
  const alarmBadge = $('alarmBadge');
  if (alarmBadge) {
    alarmBadge.textContent = active ? 'On' : 'Off';
    alarmBadge.className   = `status-badge ${active ? 'on' : 'off'}`;
  }
  // Cập nhật switch (read-only từ server)
  if (alarmSwitch) {
    alarmSwitch._updating = true;   // cờ để không trigger onChange
    alarmSwitch.checked = active;
    alarmSwitch._updating = false;
  }
}

// ── WebSocket ────────────────────────────────────────────────────────────────
function connect() {
  clearTimeout(reconnectTimer);
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    if (wsDot) wsDot.className = 'dot on';
    if (wsStatus) wsStatus.textContent = 'Đã kết nối server';
    log('✅ Kết nối server thành công', 'ok');
  };

  ws.onclose = () => {
    if (wsDot) wsDot.className = 'dot';
    if (wsStatus) wsStatus.textContent = 'Mất kết nối, thử lại sau 5s...';
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
          log(`🌡 ${msg.temp}°C | 💧 ${msg.humi}% | Quạt: ${msg.fan ? 'ON' : 'OFF'} | Còi: ${msg.buzzer ? 'ON' : 'OFF'} | ${msg.app_state}`, 'info');
          break;

        case 'fan_state':
          updateFan(msg.state);
          log(`🌀 Quạt: ${msg.state}`, 'ok');
          break;

        case 'buzzer_state':
          updateBuzzer(msg.active);
          log(`🔔 Còi: ${msg.active ? 'Đang kêu' : 'Tắt'}`, msg.active ? 'err' : 'ok');
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

// ── Wire sự kiện UI ──────────────────────────────────────────────────────────
if (fanSwitch) {
  fanSwitch.addEventListener('change', () => {
    setFan(fanSwitch.checked ? 'ON' : 'OFF');
  });
}

// Switch còi: chỉ cho tắt từ FE (không cho bật tay)
if (alarmSwitch) {
  alarmSwitch.addEventListener('change', () => {
    if (alarmSwitch._updating) return; // bỏ qua nếu do server cập nhật
    if (!alarmSwitch.checked) {
      buzzerOff(); // Người dùng kéo sang tắt → gửi lệnh tắt còi
    } else {
      // Không cho bật từ FE, reset lại
      alarmSwitch._updating = true;
      alarmSwitch.checked = false;
      alarmSwitch._updating = false;
      log('⚠️ Chỉ có thể tắt còi từ FE, không bật được', 'warn');
    }
  });
}

// ── Khởi động ────────────────────────────────────────────────────────────────
connect();
