/**
 * esp-handler.js
 * Quản lý trạng thái kết nối ESP và dữ liệu cảm biến.
 */

let espClient = null;         // Đối tượng WebSocket của ESP đang kết nối
let motorState = 'OFF';       // Trạng thái động cơ hiện tại ('ON' / 'OFF')
let lastSensorData = null;    // Dữ liệu cảm biến mới nhất

/**
 * Đăng ký một ESP client mới.
 * @param {WebSocket} ws - Đối tượng WebSocket từ thư viện `ws`.
 */
function registerESP(ws) {
  espClient = ws;
  console.log('[ESP-HANDLER] ESP đã kết nối.');

  // Ngay khi kết nối, đồng bộ trạng thái động cơ hiện tại xuống ESP
  sendMotorCommand(motorState);
}

/**
 * Xóa đăng ký ESP khi nó ngắt kết nối.
 */
function unregisterESP() {
  espClient = null;
  console.log('[ESP-HANDLER] ESP đã ngắt kết nối.');
}

/**
 * Xử lý tin nhắn JSON nhận được từ ESP.
 * Expected format: { "type": "sensor", "temp": 28.5, "humidity": 65.2 }
 * @param {string} rawMessage - Chuỗi JSON thô từ ESP.
 * @returns {object|null} Dữ liệu đã parse, hoặc null nếu không hợp lệ.
 */
function handleESPMessage(rawMessage) {
  try {
    const data = JSON.parse(rawMessage);

    if (data.type === 'sensor') {
      if (typeof data.temp !== 'number' || typeof data.humidity !== 'number') {
        console.warn('[ESP-HANDLER] Dữ liệu cảm biến không hợp lệ:', data);
        return null;
      }
      lastSensorData = {
        temp: data.temp,
        humidity: data.humidity,
        timestamp: new Date().toISOString(),
      };
      console.log(`[ESP-HANDLER] Sensor data: Nhiệt độ=${data.temp}°C, Độ ẩm=${data.humidity}%`);
      return lastSensorData;
    }

    console.warn('[ESP-HANDLER] Loại tin nhắn không xác định:', data.type);
    return null;
  } catch (err) {
    console.error('[ESP-HANDLER] Lỗi parse JSON từ ESP:', err.message);
    return null;
  }
}

/**
 * Gửi lệnh điều khiển động cơ đến ESP.
 * @param {string} command - 'ON' hoặc 'OFF'
 * @returns {boolean} true nếu gửi thành công, false nếu ESP chưa kết nối.
 */
function sendMotorCommand(command) {
  const validCommands = ['ON', 'OFF'];
  if (!validCommands.includes(command)) {
    console.error(`[ESP-HANDLER] Lệnh không hợp lệ: ${command}`);
    return false;
  }

  motorState = command;

  if (espClient && espClient.readyState === 1 /* WebSocket.OPEN */) {
    const payload = JSON.stringify({ type: 'motor', state: motorState });
    espClient.send(payload);
    console.log(`[ESP-HANDLER] Đã gửi lệnh đến ESP: motor=${motorState}`);
    return true;
  } else {
    console.warn('[ESP-HANDLER] ESP chưa kết nối. Lệnh sẽ được gửi khi ESP kết nối lại.');
    return false;
  }
}

/**
 * Toggle trạng thái động cơ (ON -> OFF, OFF -> ON).
 * @returns {string} Trạng thái mới của động cơ.
 */
function toggleMotor() {
  const newState = motorState === 'ON' ? 'OFF' : 'ON';
  sendMotorCommand(newState);
  return motorState;
}

/**
 * Kiểm tra ESP có đang kết nối không.
 * @returns {boolean}
 */
function isESPConnected() {
  return espClient !== null && espClient.readyState === 1;
}

module.exports = {
  registerESP,
  unregisterESP,
  handleESPMessage,
  sendMotorCommand,
  toggleMotor,
  isESPConnected,
  getMotorState: () => motorState,
  getLastSensorData: () => lastSensorData,
};
