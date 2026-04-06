/**
 * public/app.js
 * WebSocket client cho Dashboard (FE)
 * Kết nối tới ws://<host>/fe
 */

const WS_URL = `ws://${location.host}/fe`;
let ws = null;
let reconnectTimer = null;

// ── DOM references ────────────────────────────────────────────────────────────
const wsDot        = document.getElementById('ws-dot');
const wsStatus     = document.getElementById('ws-status');
const espDot       = document.getElementById('esp-dot');
const espStatus    = document.getElementById('esp-status');
const tempVal      = document.getElementById('temp-val');
const humidVal     = document.getElementById('humid-val');
const motorText    = document.getElementById('motor-state-text');
const logBox       = document.getElementById('log-box');

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg, type = 'info') {
  const p = document.createElement('p');
  const time = new Date().toLocaleTimeString('vi-VN');
  p.className = `log-${type}`;
  p.textContent = `[${time}] ${msg}`;
  logBox.prepend(p);
  // Giới hạn 50 dòng log
  while (logBox.children.length > 50) logBox.removeChild(logBox.lastChild);
}

// ── UI Update ─────────────────────────────────────────────────────────────────
function updateMotorUI(state) {
  motorText.textContent = state;
  motorText.className = `motor-state ${state === 'ON' ? 'on' : 'off'}`;
}

function updateESPStatus(connected) {
  espDot.className = connected ? 'dot connected' : 'dot';
  espStatus.textContent = connected ? 'ESP đã kết nối' : 'ESP chưa kết nối';
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connect() {
  clearTimeout(reconnectTimer);
  log(`Đang kết nối tới server...`, 'info');
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    wsDot.className = 'dot connected';
    wsStatus.textContent = 'WebSocket đã kết nối';
    log('✅ Kết nối server thành công!', 'ok');
  };

  ws.onclose = () => {
    wsDot.className = 'dot';
    wsStatus.textContent = 'Mất kết nối, đang thử lại...';
    log('❌ Mất kết nối. Thử lại sau 5 giây...', 'warn');
    reconnectTimer = setTimeout(connect, 5000);
  };

  ws.onerror = (e) => {
    log('Lỗi WebSocket: ' + (e.message || 'unknown'), 'warn');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'sensor_update') {
        tempVal.innerHTML  = `${msg.temp}<span class="card-unit">C</span>`;
        humidVal.innerHTML = `${msg.humidity}<span class="card-unit">%</span>`;
        log(`Sensor: ${msg.temp}C | ${msg.humidity}%`, 'info');

      } else if (msg.type === 'motor_state') {
        updateMotorUI(msg.state);
        updateESPStatus(msg.esp_connected);
        log(`Motor: ${msg.state} | ESP: ${msg.esp_connected ? 'online' : 'offline'}`, 'ok');

      } else if (msg.type === 'esp_status') {
        updateESPStatus(msg.connected);
        log(`ESP ${msg.connected ? 'da ket noi' : 'da ngat ket noi'}`, msg.connected ? 'ok' : 'warn');
      }
    } catch (e) {
      log('Lỗi parse JSON: ' + e.message, 'warn');
    }
  };
}

// ── Điều khiển ────────────────────────────────────────────────────────────────
function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    log('Chưa kết nối server, không thể gửi lệnh!', 'warn');
  }
}

function toggleMotor() {
  send({ type: 'motor_toggle' });
  log('Gui lenh: Toggle motor', 'info');
}

function setMotor(state) {
  send({ type: 'motor_cmd', state });
  log(`Gui lenh: Motor ${state}`, 'info');
}

// ── Khởi động ─────────────────────────────────────────────────────────────────
connect();
