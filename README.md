# IoT DHT22 & Điều khiển Động cơ - Hướng dẫn

Dự án này bao gồm một Node.js WebSocket server để nhận dữ liệu từ cảm biến DHT22 và điều khiển động cơ thông qua ESP8266/ESP32.

## Danh sách các tệp tin

- **server.js**: Server Node.js chính, sử dụng thư viện `ws`. Quản lý kết nối từ ESP và Frontend.
- **esp-handler.js**: Logic xử lý dữ liệu từ ESP, lưu trữ trạng thái tạm thời và điều khiển động cơ.
- **mock-esp.js**: Script giả lập ESP để kiểm tra server mà không cần phần cứng.
- **esp_dht22_ws.ino**: Firmware Arduino cho ESP8266/ESP32 để đọc cảm biến và kết nối WebSocket.
- **public/index.html**: Giao diện điều khiển (Dashboard) trên trình duyệt.
- **public/app.js**: Logic phía trình duyệt để kết nối WebSocket và cập nhật giao diện.
- **package.json**: Quản lý thư viện và các script Start/Mock.

## Hướng dẫn chạy

### 1. Cài đặt thư viện Node.js
Mở Terminal tại thư mục dự án và chạy:
```bash
npm install
```

### 2. Chạy Server
```bash
npm start
```
Server sẽ chạy tại `http://localhost:3000`.

### 3. Mô phỏng ESP (Để kiểm tra)
Nếu bạn chưa có phần cứng, hãy chạy script mô phỏng:
```bash
npm run mock
```
Script này sẽ gửi dữ liệu nhiệt độ/độ ẩm giả lập và nhận lệnh điều khiển từ Dashboard.

### 4. Nạp code cho ESP (Phần cứng thật)
- Mở file `esp_dht22_ws.ino` bằng Arduino IDE.
- Cài đặt các thư viện: `DHT sensor library`, `WebSockets`, `ArduinoJson`.
- Sửa `WIFI_SSID`, `WIFI_PASSWORD` và `SERVER_HOST` (IP máy tính của bạn).
- Nạp code vào ESP.

## Giao thức WebSocket
- **ESP-Server**: Kết nối qua `ws://<IP>:3000/esp`
- **Dashboard-Server**: Kết nối qua `ws://<IP>:3000/fe`
