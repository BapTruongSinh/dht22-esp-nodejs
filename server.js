/**
 * server.js
 * Node.js WebSocket Server cho hệ thống IoT DHT22 + điều khiển động cơ.
 *
 * Cổng:
 *   - ws://localhost:3000/esp  -> Dành riêng cho ESP kết nối
 *   - ws://localhost:3000/fe   -> Dành cho Frontend/Dashboard
 *   - http://localhost:3000    -> Phục vụ giao diện web tĩnh
 *
 * Giao thức JSON (ESP -> Server):
 *   { "type": "sensor", "temp": 28.5, "humidity": 65.2 }
 *
 * Giao thức JSON (Server -> ESP):
 *   { "type": "motor", "state": "ON" }   hoặc "OFF"
 *
 * Giao thức JSON (FE -> Server):
 *   { "type": "motor_cmd", "state": "ON" }  hoặc "OFF"
 *   { "type": "motor_toggle" }
 *
 * Giao thức JSON (Server -> FE):
 *   { "type": "sensor_update", "temp": 28.5, "humidity": 65.2, "timestamp": "..." }
 *   { "type": "motor_state",   "state": "ON", "esp_connected": true }
 *   { "type": "esp_status",    "connected": true/false }
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const espHandler = require('./esp-handler');

const PORT = process.env.PORT || 3000;

// ─── HTTP Server (phục vụ file tĩnh) ──────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  // Chỉ phục vụ trang giao diện điều khiển
  const filePath = path.join(__dirname, 'public', 'index.html');
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Không tìm thấy trang. Hãy tạo file public/index.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else if (req.url === '/style.css') {
    const cssPath = path.join(__dirname, 'public', 'style.css');
    fs.readFile(cssPath, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(data);
    });
  } else if (req.url === '/app.js') {
    const jsPath = path.join(__dirname, 'public', 'app.js');
    fs.readFile(jsPath, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// ─── WebSocket Server ──────────────────────────────────────────────────────────
// Dùng chung 1 WSS, phân loại client bằng URL path
const wss = new WebSocketServer({ server: httpServer });

// Lưu tập hợp các FE client đang kết nối
const feClients = new Set();

/**
 * Phát dữ liệu đến tất cả FE client đang mở.
 * @param {object} payload
 */
function broadcastToFE(payload) {
  const msg = JSON.stringify(payload);
  for (const client of feClients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(msg);
    }
  }
}

wss.on('connection', (ws, req) => {
  const urlPath = req.url || '/';

  // ── Xử lý kết nối từ ESP ──────────────────────────────────────────────────
  if (urlPath === '/esp') {
    espHandler.registerESP(ws);

    // Thông báo cho tất cả FE rằng ESP đã kết nối
    broadcastToFE({
      type: 'esp_status',
      connected: true,
      timestamp: new Date().toISOString(),
    });

    ws.on('message', (rawMsg) => {
      const sensorData = espHandler.handleESPMessage(rawMsg.toString());
      if (sensorData) {
        // Chuyển tiếp dữ liệu cảm biến đến tất cả FE
        broadcastToFE({
          type: 'sensor_update',
          temp: sensorData.temp,
          humidity: sensorData.humidity,
          timestamp: sensorData.timestamp,
        });
      }
    });

    ws.on('close', () => {
      espHandler.unregisterESP();
      broadcastToFE({
        type: 'esp_status',
        connected: false,
        timestamp: new Date().toISOString(),
      });
    });

    ws.on('error', (err) => {
      console.error('[SERVER] Lỗi WebSocket ESP:', err.message);
    });

    return; // Kết thúc xử lý cho ESP
  }

  // ── Xử lý kết nối từ Frontend ─────────────────────────────────────────────
  if (urlPath === '/fe') {
    feClients.add(ws);
    console.log(`[SERVER] FE client kết nối. Tổng: ${feClients.size}`);

    // Gửi trạng thái hiện tại ngay khi FE kết nối
    ws.send(JSON.stringify({
      type: 'motor_state',
      state: espHandler.getMotorState(),
      esp_connected: espHandler.isESPConnected(),
    }));

    // Gửi dữ liệu cảm biến gần nhất nếu có
    const lastSensor = espHandler.getLastSensorData();
    if (lastSensor) {
      ws.send(JSON.stringify({
        type: 'sensor_update',
        temp: lastSensor.temp,
        humidity: lastSensor.humidity,
        timestamp: lastSensor.timestamp,
      }));
    }

    ws.on('message', (rawMsg) => {
      try {
        const data = JSON.parse(rawMsg.toString());

        if (data.type === 'motor_cmd') {
          // FE yêu cầu set trạng thái cụ thể
          const success = espHandler.sendMotorCommand(data.state);
          console.log(`[SERVER] FE yêu cầu motor=${data.state}, gửi ESP: ${success}`);

          // Phát trạng thái mới cho tất cả FE
          broadcastToFE({
            type: 'motor_state',
            state: espHandler.getMotorState(),
            esp_connected: espHandler.isESPConnected(),
          });

        } else if (data.type === 'motor_toggle') {
          // FE yêu cầu toggle
          const newState = espHandler.toggleMotor();
          console.log(`[SERVER] FE toggle motor -> ${newState}`);

          broadcastToFE({
            type: 'motor_state',
            state: newState,
            esp_connected: espHandler.isESPConnected(),
          });

        } else {
          console.warn('[SERVER] FE gửi loại lệnh không xác định:', data.type);
        }
      } catch (err) {
        console.error('[SERVER] Lỗi parse JSON từ FE:', err.message);
      }
    });

    ws.on('close', () => {
      feClients.delete(ws);
      console.log(`[SERVER] FE client ngắt kết nối. Còn: ${feClients.size}`);
    });

    ws.on('error', (err) => {
      console.error('[SERVER] Lỗi WebSocket FE:', err.message);
      feClients.delete(ws);
    });

    return;
  }

  // ── URL không hợp lệ ───────────────────────────────────────────────────────
  console.warn(`[SERVER] Kết nối bị từ chối từ path không hợp lệ: ${urlPath}`);
  ws.close(1008, 'Path không hợp lệ. Dùng /esp hoặc /fe');
});

// ─── Khởi động Server ─────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log('------------------------------------------------');
  console.log('      IoT DHT22 + Motor Control Server          ');
  console.log('------------------------------------------------');
  console.log(`  HTTP Dashboard : http://localhost:${PORT}       `);
  console.log(`  ESP WebSocket  : ws://localhost:${PORT}/esp    `);
  console.log(`  FE  WebSocket  : ws://localhost:${PORT}/fe     `);
  console.log('------------------------------------------------');
});

httpServer.on('error', (err) => {
  console.error('[SERVER] Lỗi HTTP Server:', err.message);
  process.exit(1);
});
