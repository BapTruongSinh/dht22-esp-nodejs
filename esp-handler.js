// esp-handler.js – Quản lý kết nối ESP và điều khiển thiết bị
//
// ESP -> Server (realtime, mỗi 3s):
//   { temp, humi, fan, alarm, error, app_state, system_state }
//
// ESP -> Server (sự kiện queue):
//   { id: N, data: { event: "ALARM_ON" } }
//   -> Server phải reply: {"ack": N}
//
// Server -> ESP (lệnh điều khiển):
//   { fan: "ON" | "OFF" }
//   { buzzer: "OFF" }

let espClient  = null;
let fanState   = 'OFF';   // trạng thái quạt server đang giữ
let lastData   = null;    // dữ liệu cảm biến mới nhất từ ESP

function registerESP(ws) {
  espClient = ws;
  console.log('[ESP] Kết nối');
  // Đồng bộ trạng thái quạt hiện tại xuống ESP
  sendToESP({ fan: fanState });
}

function unregisterESP() {
  espClient = null;
  console.log('[ESP] Ngắt kết nối');
}

// Gửi JSON xuống ESP
function sendToESP(payload) {
  if (espClient && espClient.readyState === 1) {
    espClient.send(JSON.stringify(payload));
    console.log('[ESP] Gửi:', payload);
  } else {
    console.warn('[ESP] Chưa kết nối, bỏ qua lệnh:', payload);
  }
}

// Xử lý tin nhắn từ ESP
// Trả về { type, data } hoặc null
function handleESPMessage(raw) {
  try {
    const msg = JSON.parse(raw);

    // Queue event: { id, data: { event: "..." } }
    if (typeof msg.id === 'number' && msg.data) {
      sendToESP({ ack: msg.id });
      console.log(`[ESP] Event id=${msg.id} event=${msg.data.event}`);
      return { type: 'event', event: msg.data.event };
    }

    // Realtime data: { temp, humi, fan, alarm, error, app_state, system_state }
    if (typeof msg.temp === 'number' && typeof msg.humi === 'number') {
      lastData = { ...msg, timestamp: new Date().toISOString() };
      console.log(`[ESP] temp=${msg.temp}°C  humi=${msg.humi}%  fan=${msg.fan}  alarm=${msg.alarm}`);
      return { type: 'sensor', data: lastData };
    }

    console.warn('[ESP] Tin nhắn không xác định:', raw);
    return null;
  } catch {
    console.error('[ESP] Parse lỗi:', raw);
    return null;
  }
}

// FE yêu cầu bật/tắt quạt
function setFan(state) {
  if (state !== 'ON' && state !== 'OFF') return;
  fanState = state;
  sendToESP({ fan: fanState });
}

// FE yêu cầu tắt còi
function buzzerOff() {
  sendToESP({ buzzer: 'OFF' });
}

module.exports = {
  registerESP,
  unregisterESP,
  handleESPMessage,
  setFan,
  buzzerOff,
  isConnected: () => espClient !== null && espClient.readyState === 1,
  getFanState:  () => fanState,
  getLastData:  () => lastData,
};
