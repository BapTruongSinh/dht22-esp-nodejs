// esp-handler.js – Quản lý kết nối ESP và điều khiển thiết bị

let espClient  = null;
let currentMode= 'AUTO';   // mode hiện tại đồng bộ từ ESP
let lastData   = null;     // dữ liệu sensor mới nhất

// ── Kết nối / Ngắt kết nối ───────────────────────────────────────────────────
function registerESP(ws) {
  espClient = ws;
  console.log('[ESP] Kết nối');
  // Đồng bộ mode hiện tại xuống ESP ngay khi nối
  sendToESP({ mode: currentMode });
}

function unregisterESP() {
  espClient = null;
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
function handleESPMessage(raw) {
  try {
    const msg = JSON.parse(raw);

    // Queue event: { id, data: { event: "..." } }
    if (typeof msg.id === 'number' && msg.data) {
      sendToESP({ ack: msg.id });
      console.log(`[ESP] Event id=${msg.id} event=${msg.data.event}`);
      return { type: 'event', event: msg.data.event };
    }

    // Realtime data từ ESP
    // Dữ liệu giữ nguyên bản gửi lên FE (không chuyển đổi gì ở đây)
    if (msg.temp !== undefined && msg.humi !== undefined) {
      currentMode  = msg.mode || 'AUTO';
      lastData = { ...msg, timestamp: new Date().toISOString() };
      console.log(`[ESP] Data:`, msg);
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
function setFan(state) {
  if (currentMode === 'AUTO') {
    console.warn('[ESP] Chặn lệnh quạt — đang ở chế độ AUTO');
    return false;
  }
  sendToESP({ fan: state });
  return true;
}

// ── Lệnh từ FE: Tắt còi ─────────────────────────────────────────────────────
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
  getMode:        () => currentMode,
  getLastData:    () => lastData,
};
