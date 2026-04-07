// esp-handler.js – Quản lý kết nối ESP và điều khiển thiết bị
//
// ESP -> Server (realtime, mỗi 3s):
//   { temp, humi, fan, buzzer, mode, alarm, error, app_state }
//
// Server -> ESP (lệnh điều khiển):
//   { fan: "ON" | "OFF" }        — chỉ có tác dụng khi ESP ở MANUAL
//   { buzzer: "OFF" }            — chỉ có tác dụng khi ESP ở MANUAL
//   { mode: "AUTO" | "MANUAL" }  — chuyển chế độ

let espClient  = null;
let fanState   = 'OFF';    // trạng thái quạt server theo dõi
let buzzerState= 'OFF';    // trạng thái còi server theo dõi
let currentMode= 'AUTO';   // mode hiện tại đồng bộ từ ESP
let lastData   = null;     // dữ liệu sensor mới nhất
let lastSeenAt = 0;        // thời điểm cuối cùng server nhận dữ liệu từ ESP

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'on' || v === 'blink' || v === 'blinking';
  }
  return false;
}

// ── Kết nối / Ngắt kết nối ───────────────────────────────────────────────────
function registerESP(ws) {
  espClient = ws;
  lastSeenAt = Date.now();
  console.log('[ESP] Kết nối');
  // Đồng bộ mode hiện tại xuống ESP ngay khi nối
  sendToESP({ mode: currentMode });
}

function unregisterESP() {
  espClient = null;
  lastSeenAt = 0;
  console.log('[ESP] Ngắt kết nối');
}

// ── Gửi JSON xuống ESP ───────────────────────────────────────────────────────
function sendToESP(payload) {
  if (espClient && espClient.readyState === 1) {
    espClient.send(JSON.stringify(payload));
    console.log('[ESP] Gửi:', payload);
  } else {
    console.warn('[ESP] Chưa kết nối, bỏ qua lệnh:', payload);
  }
}

// ── Xử lý tin nhắn từ ESP ────────────────────────────────────────────────────
// Trả về { type, data } hoặc null
function handleESPMessage(raw) {
  try {
    lastSeenAt = Date.now();
    console.log('[ESP] Raw:', raw);
    const msg = JSON.parse(raw);

// Realtime data: { temp, humi, fan, buzzer_state, mode, app_state }
    if (typeof msg.temp === 'number' && typeof msg.humi === 'number') {
      // Đồng bộ trạng thái từ ESP về server
      currentMode  = msg.mode   || 'AUTO';
      fanState     = toBool(msg.fan) ? 'ON' : 'OFF';
      buzzerState  = toBool(msg.buzzer_state) ? 'ON' : 'OFF';

      lastData = {
        ...msg,
        fan: fanState === 'ON',
        buzzer: buzzerState === 'ON',
        timestamp: new Date().toISOString()
      };
      console.log(`[ESP] temp=${msg.temp}°C  humi=${msg.humi}%  fan=${fanState}  buzzer=${buzzerState}  mode=${currentMode}  app_state=${msg.app_state}`);
      return { type: 'sensor', data: lastData };
    }

    // Heartbeat ping
    if (msg.topic === 'ping') return null;

    console.warn('[ESP] Tin nhắn không xác định:', raw);
    return null;
  } catch {
    console.error('[ESP] Parse lỗi:', raw);
    return null;
  }
}

// ── Lệnh từ FE: Bật/Tắt quạt ────────────────────────────────────────────────
// Trả về true nếu lệnh được chấp nhận, false nếu bị chặn (đang AUTO)
function setFan(state) {
  if (state !== 'ON' && state !== 'OFF') return false;

  if (currentMode === 'AUTO') {
    console.warn('[ESP] Chặn lệnh quạt — đang ở chế độ AUTO');
    return false;
  }

  fanState = state;
  sendToESP({ fan: fanState });
  return true;
}

// ── Lệnh từ FE: Tắt còi ─────────────────────────────────────────────────────
// Trả về true nếu lệnh được chấp nhận, false nếu bị chặn (đang AUTO)
function buzzerOff() {
  if (currentMode === 'AUTO') {
    console.warn('[ESP] Chặn lệnh tắt còi — đang ở chế độ AUTO');
    return false;
  }

  sendToESP({ buzzer: 'OFF' });
  return true;
}

// ── Lệnh từ FE: Chuyển mode ─────────────────────────────────────────────────
function setMode(mode) {
  if (mode !== 'AUTO' && mode !== 'MANUAL') return;
  currentMode = mode;
  sendToESP({ mode });
  console.log(`[ESP] Mode -> ${mode}`);
}

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  registerESP,
  unregisterESP,
  handleESPMessage,
  setFan,
  buzzerOff,
  setMode,
  isConnected:    () => espClient !== null && espClient.readyState === 1,
  getFanState:    () => fanState,
  getBuzzerState: () => buzzerState,
  getMode:        () => currentMode,
  getLastData:    () => lastData,
  getLastSeenAt:  () => lastSeenAt,
};