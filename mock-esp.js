/**
 * mock-esp.js
 * Mô phỏng một ESP8266/ESP32 thật để kiểm tra server.
 *
 * Cách dùng:
 *   node mock-esp.js
 *
 * Hành vi:
 *   - Kết nối tới ws://localhost:3000/esp
 *   - Gửi dữ liệu DHT22 giả lập mỗi 3 giây
 *   - In ra lệnh điều khiển động cơ nhận được từ server
 *   - Tự động reconnect sau 5 giây nếu mất kết nối
 */

const { WebSocket } = require('ws');

const SERVER_URL = 'ws://localhost:3000/esp';
const SEND_INTERVAL_MS = 3000;   // Gửi dữ liệu mỗi 3 giây
const RECONNECT_DELAY_MS = 5000; // Thử kết nối lại sau 5 giây

let sendTimer = null;

/**
 * Tạo dữ liệu cảm biến giả lập trong khoảng thực tế.
 * Nhiệt độ: 20 - 35°C  |  Độ ẩm: 40 - 90%
 */
function fakeSensorData() {
  const temp = parseFloat((20 + Math.random() * 15).toFixed(1));
  const humidity = parseFloat((40 + Math.random() * 50).toFixed(1));
  return { type: 'sensor', temp, humidity };
}

function connect() {
  console.log(`[MOCK-ESP] Đang kết nối tới ${SERVER_URL} ...`);
  const ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    console.log('[MOCK-ESP] Da ket noi toi server!');

    // Bắt đầu gửi dữ liệu cảm biến định kỳ
    sendTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const data = fakeSensorData();
      ws.send(JSON.stringify(data));
      console.log(`[MOCK-ESP] Gui: Nhiet do=${data.temp}C, Do am=${data.humidity}%`);
    }, SEND_INTERVAL_MS);
  });

  ws.on('message', (rawMsg) => {
    try {
      const msg = JSON.parse(rawMsg.toString());

      if (msg.type === 'motor') {
        console.log(`[MOCK-ESP] Nhan lenh: MOTOR = ${msg.state}`);
        // Ở đây, ESP thật sẽ bật/tắt chân GPIO điều khiển relay/driver động cơ
      } else {
        console.log('[MOCK-ESP] Nhan tin nhan khong xac dinh:', msg);
      }
    } catch (err) {
      console.error('[MOCK-ESP] Lỗi parse JSON:', err.message);
    }
  });

  ws.on('close', (code, reason) => {
    clearInterval(sendTimer);
    console.log(`[MOCK-ESP] Mat ket noi (code=${code}). Thu lai sau ${RECONNECT_DELAY_MS / 1000}s...`);
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.on('error', (err) => {
    console.error('[MOCK-ESP] Lỗi WebSocket:', err.message);
    // Sự kiện 'close' sẽ kích hoạt reconnect
  });
}

// Bắt đầu
connect();
