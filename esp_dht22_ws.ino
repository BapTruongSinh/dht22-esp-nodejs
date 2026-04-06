/*
 * esp_dht22_ws.ino
 * ─────────────────────────────────────────────────────────
 * Firmware cho ESP8266 (hoặc ESP32 - xem ghi chú bên dưới)
 * Kết nối WiFi -> Kết nối WebSocket Server -> Gửi DHT22 -> Điều khiển Động cơ
 *
 * Thư viện cần cài (Arduino Library Manager):
 *   1. DHT sensor library  (by Adafruit)
 *   2. Adafruit Unified Sensor
 *   3. WebSockets           (by Markus Sattler) - tìm "WebSockets" by Links2004
 *   4. ArduinoJson          (by Benoit Blanchon) - phiên bản 6.x
 *
 * Sơ đồ nối dây DHT22:
 *   DHT22 VCC  -> 3.3V
 *   DHT22 GND  -> GND
 *   DHT22 DATA -> D4 (GPIO 2)  + điện trở 10kΩ lên 3.3V
 *
 * Relay / Driver động cơ:
 *   IN         -> D1 (GPIO 5)
 *   VCC, GND   -> cấp nguồn riêng phù hợp với động cơ
 * ─────────────────────────────────────────────────────────
 * Để dùng với ESP32, thay:
 *   #include <ESP8266WiFi.h>   ->  #include <WiFi.h>
 *   #include <ESP8266HTTPClient.h> (nếu có) -> <HTTPClient.h>
 *   WebSocketsClient đồng nhất cho cả 2.
 */

#include <Arduino.h>
#include <ESP8266WiFi.h>          // ESP32: <WiFi.h>
#include <WebSocketsClient.h>     // thư viện WebSockets by Links2004
#include <ArduinoJson.h>
#include <DHT.h>

// ── Cấu hình WiFi ─────────────────────────────────────────
#define WIFI_SSID     "TEN_WIFI_CUA_BAN"
#define WIFI_PASSWORD "MAT_KHAU_WIFI"

// ── Cấu hình Server ───────────────────────────────────────
// Thay bằng IP hoặc domain thật của server Node.js
#define SERVER_HOST   "192.168.1.100"
#define SERVER_PORT   3000
#define SERVER_PATH   "/esp"       // path dành cho ESP

// ── Phần cứng ─────────────────────────────────────────────
#define DHT_PIN       2            // D4 trên NodeMCU (GPIO 2)
#define DHT_TYPE      DHT22
#define MOTOR_PIN     5            // D1 trên NodeMCU (GPIO 5)

// ── Thời gian ─────────────────────────────────────────────
#define SEND_INTERVAL 3000         // Gửi dữ liệu mỗi 3 giây (ms)

// ── Khởi tạo đối tượng ────────────────────────────────────
DHT dht(DHT_PIN, DHT_TYPE);
WebSocketsClient wsClient;

bool motorState = false;           // false = OFF, true = ON
unsigned long lastSendTime = 0;

// ═══════════════════════════════════════════════════════════
//  Callback sự kiện WebSocket
// ═══════════════════════════════════════════════════════════
void onWebSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {

    case WStype_CONNECTED:
      Serial.println("[WS] Da ket noi toi Server!");
      break;

    case WStype_DISCONNECTED:
      Serial.println("[WS] Mat ket noi. Dang thu ket noi lai...");
      break;

    case WStype_TEXT: {
      // Phân tích JSON nhận được từ server
      StaticJsonDocument<128> doc;
      DeserializationError err = deserializeJson(doc, payload, length);
      if (err) {
        Serial.print("[WS] Lỗi parse JSON: ");
        Serial.println(err.c_str());
        break;
      }

      const char *type_str = doc["type"];
      if (strcmp(type_str, "motor") == 0) {
        const char *state = doc["state"];
        if (strcmp(state, "ON") == 0) {
          motorState = true;
          digitalWrite(MOTOR_PIN, HIGH);
          Serial.println("[MOTOR] Bat dong co");
        } else {
          motorState = false;
          digitalWrite(MOTOR_PIN, LOW);
          Serial.println("[MOTOR] Tat dong co");
        }
      }
      break;
    }

    case WStype_ERROR:
      Serial.println("[WS] Lỗi WebSocket!");
      break;

    default:
      break;
  }
}

// ═══════════════════════════════════════════════════════════
//  Kết nối WiFi
// ═══════════════════════════════════════════════════════════
void connectWiFi() {
  Serial.print("[WiFi] Đang kết nối tới ");
  Serial.print(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("[WiFi] Da ket noi! IP: ");
  Serial.println(WiFi.localIP());
}

// ═══════════════════════════════════════════════════════════
//  setup()
// ═══════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  pinMode(MOTOR_PIN, OUTPUT);
  digitalWrite(MOTOR_PIN, LOW);   // Motor OFF khi khởi động

  dht.begin();
  connectWiFi();

  // Cấu hình WebSocket client
  // Nếu server có SSL (wss://): dùng wsClient.beginSSL(...)
  wsClient.begin(SERVER_HOST, SERVER_PORT, SERVER_PATH);
  wsClient.onEvent(onWebSocketEvent);
  wsClient.setReconnectInterval(5000);   // Tự reconnect sau 5 giây
}

// ═══════════════════════════════════════════════════════════
//  loop()
// ═══════════════════════════════════════════════════════════
void loop() {
  wsClient.loop();   // Xử lý sự kiện WebSocket - PHẢI gọi mỗi vòng lặp

  unsigned long now = millis();
  if (now - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = now;

    // Đọc cảm biến DHT22
    float humidity    = dht.readHumidity();
    float temperature = dht.readTemperature();   // Celsius

    if (isnan(humidity) || isnan(temperature)) {
      Serial.println("[DHT22] Loi doc cam bien!");
      return;
    }

    // Dong goi JSON va gui qua WebSocket
    StaticJsonDocument<128> doc;
    doc["type"]     = "sensor";
    doc["temp"]     = temperature;
    doc["humidity"] = humidity;

    String output;
    serializeJson(doc, output);
    wsClient.sendTXT(output);

    Serial.print("[DHT22] Gui: ");
    Serial.println(output);
  }
}
