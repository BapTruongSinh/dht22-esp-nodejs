// server.js – WebSocket server IoT DHT22
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const esp  = require('./esp-handler');

const PORT = process.env.PORT || 3000;

// ── HTTP: phục vụ file tĩnh ──────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
};

const httpServer = http.createServer((req, res) => {
  const url  = req.url === '/' ? '/index.html' : req.url;
  const file = path.join(__dirname, 'public', url);
  const ext  = path.extname(file);

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

// ── WebSocket ────────────────────────────────────────────────────────────────
const wss       = new WebSocketServer({ server: httpServer });
const feClients = new Set();

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of feClients)
    if (ws.readyState === 1) ws.send(msg);
}

wss.on('connection', (ws, req) => {
  const url = req.url;

  // ─ ESP ─────────────────────────────────────────────────────────────────────
  if (url === '/esp') {
    esp.registerESP(ws);
    broadcast({ type: 'esp_status', connected: true });

    ws.on('message', raw => {
      const result = esp.handleESPMessage(raw.toString());
      if (!result) return;

      if (result.type === 'sensor') {
        // Broadcast nguyên bản dữ liệu cảm biến (tên biến, giá trị y hệt payload từ ESP)
        broadcast({ type: 'sensor_update', ...result.data });
      } else if (result.type === 'event') {
        broadcast({ type: 'event', event: result.event });
      }
    });

    ws.on('close', () => {
      esp.unregisterESP();
      broadcast({ type: 'esp_status', connected: false });
      broadcast({ type: 'offline', message: 'ESP đã ngắt kết nối (offline)' });
    });

    ws.on('error', err => console.error('[ESP]', err.message));
    return;
  }

  // ─ Frontend ────────────────────────────────────────────────────────────────
  if (url === '/fe') {
    feClients.add(ws);
    console.log(`[FE] Kết nối (${feClients.size} client)`);

    ws.send(JSON.stringify({ type: 'esp_status', connected: esp.isConnected() }));
    const last = esp.getLastData();
    if (last) ws.send(JSON.stringify({ type: 'sensor_update', ...last }));

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString());

        // ── Chuyển mode ───────────────────────────────────────────────────────
        if (msg.type === 'mode') {
          esp.setMode(msg.value);

        // ── Điều khiển quạt ───────────────────────────────────────────────────
        } else if (msg.type === 'fan') {
          const ok = esp.setFan(msg.state);
          if (!ok) ws.send(JSON.stringify({ type: 'error', reason: 'AUTO_MODE' }));

        // ── Tắt còi ───────────────────────────────────────────────────────────
        } else if (msg.type === 'buzzer_off') {
          const ok = esp.buzzerOff();
          if (!ok) ws.send(JSON.stringify({ type: 'error', reason: 'AUTO_MODE' }));

        } else {
          console.warn('[FE] Lệnh không xác định:', msg.type);
        }
      } catch {
        console.error('[FE] Parse lỗi:', raw.toString());
      }
    });

    ws.on('close', () => {
      feClients.delete(ws);
      console.log(`[FE] Ngắt kết nối (${feClients.size} client)`);
    });

    ws.on('error', err => {
      console.error('[FE]', err.message);
      feClients.delete(ws);
    });

    return;
  }

  // ─ URL không hợp lệ ───────────────────────────────────────────────────────
  ws.close(1008, 'Dùng /esp hoặc /fe');
});

// ── Khởi động ────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`  ESP: ws://localhost:${PORT}/esp`);
  console.log(`  FE:  ws://localhost:${PORT}/fe`);
});

httpServer.on('error', err => { console.error(err.message); process.exit(1); });
