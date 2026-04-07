#include <WiFi.h>
#include <WebSocketsClient.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>
#include <Wire.h>

// ================= WIFI =================
const char* ssid = "Khu H";
const char* password = "khuh1234";

// ================= WS =================
WebSocketsClient webSocket;
const char* host = "10.85.7.197";
const int port = 3000;

// ================= SENSOR =================
#define DHTPIN 15
#define DHTTYPE DHT22

// ================= HARDWARE =================
#define RELAY_PIN   18
#define BUZZER_PIN  19
#define BUZZER_ON   LOW
#define BUZZER_OFF  HIGH

// ================= BUTTON PINS =================
#define BTN_MODE_PIN   25   // Chuyển AUTO <-> MANUAL
#define BTN_FAN_PIN    26   // Bật/Tắt quạt (chỉ hoạt động ở MANUAL)
#define BTN_BUZZER_PIN 27   // Tắt còi (chỉ hoạt động ở MANUAL)

// ================= LIMIT =================
#define TEMP_LIMIT 28
#define HUMI_LIMIT 85
#define TEMP_ALARM 32
#define HUMI_ALARM 95

DHT dht(DHTPIN, DHTTYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ================= STATE =================
enum SystemState { SYS_INIT, SYS_WIFI, SYS_WS, SYS_RUNNING, SYS_ERROR };
enum AppState    { NORMAL, WARNING, ALARM, ERROR_STATE };

SystemState sysState = SYS_INIT;
AppState    appState = NORMAL;
AppState    lastState = NORMAL;

// ================= DATA =================
float temp = 0, humi = 0;
bool errorSensor = false;
int  errorSensorCount = 0;

// ================= CONTROL =================
bool isAutoMode = true;    // true = AUTO, false = MANUAL
bool fanOn      = false;   // trạng thái quạt
bool buzzerOn   = false;   // trạng thái còi

unsigned long buzzer_time = 0;   // dùng để nhấp nháy còi ở AUTO/ALARM

// ================= BUTTON DEBOUNCE =================
unsigned long lastBtnMode   = 0;
unsigned long lastBtnFan    = 0;
unsigned long lastBtnBuzzer = 0;
#define DEBOUNCE_MS 200

// ================= TIMER =================
unsigned long lastSensor       = 0;
unsigned long lastLCD          = 0;
unsigned long lastReconnectWiFi= 0;
unsigned long lastReconnectWS  = 0;
unsigned long lastSend         = 0;
unsigned long lastHeartbeat    = 0;

// ================= WS =================
bool wsConnected = false;

// ================= QUEUE =================
struct Message {
  int id;
  String data;
};

#define MAX_QUEUE 5
Message queue[MAX_QUEUE];
int queueSize = 0;

int currentMsgId = 0;
bool waitingAck  = false;
unsigned long sendTime = 0;

// ================= LOG =================
const char* appStateName(AppState state) {
  switch (state) {
    case NORMAL:      return "NORMAL";
    case WARNING:     return "WARNING";
    case ALARM:       return "ALARM";
    case ERROR_STATE: return "ERROR";
  }
  return "UNKNOWN";
}

const char* systemStateName(SystemState state) {
  switch (state) {
    case SYS_INIT:    return "INIT";
    case SYS_WIFI:    return "WAIT_WIFI";
    case SYS_WS:      return "WAIT_WS";
    case SYS_RUNNING: return "RUNNING";
    case SYS_ERROR:   return "ERROR";
  }
  return "UNKNOWN";
}

void logLine(const char* tag, const String& message) {
  Serial.print('[');
  Serial.print(millis());
  Serial.print(" ms][");
  Serial.print(tag);
  Serial.print("] ");
  Serial.println(message);
}

// ================= WIFI =================
void connectWiFi() {
  logLine("WIFI", "Connecting to SSID: " + String(ssid));
  WiFi.begin(ssid, password);
}

// ================= SYSTEM STATE =================
void updateSystemState() {
  SystemState prev = sysState;
  switch (sysState) {
    case SYS_INIT:    sysState = SYS_WIFI;    break;
    case SYS_WIFI:    if (WiFi.status() == WL_CONNECTED) sysState = SYS_WS;      break;
    case SYS_WS:      if (wsConnected)                   sysState = SYS_RUNNING;  break;
    case SYS_RUNNING: if (WiFi.status() != WL_CONNECTED) sysState = SYS_ERROR;   break;
    case SYS_ERROR:   break;
  }
  if (sysState != prev)
    logLine("SYSTEM", String(systemStateName(prev)) + " -> " + systemStateName(sysState));
}

void handleSystemState() {
  switch (sysState) {
    case SYS_WIFI:
      if (WiFi.status() != WL_CONNECTED && millis() - lastReconnectWiFi > 5000) {
        lastReconnectWiFi = millis();
        connectWiFi();
      }
      break;
    case SYS_WS:
      if (!wsConnected && millis() - lastReconnectWS > 5000) {
        lastReconnectWS = millis();
        logLine("WS", "Opening socket to " + String(host) + ":" + String(port));
        webSocket.begin(host, port, "/");
        webSocket.onEvent(webSocketEvent);
      }
      break;
    case SYS_ERROR:
      if (millis() - lastReconnectWiFi > 5000) {
        lastReconnectWiFi = millis();
        connectWiFi();
      }
      break;
    default: break;
  }
}

// ================= APPLY RELAY & BUZZER =================
void applyFan() {
  digitalWrite(RELAY_PIN, fanOn ? HIGH : LOW);
}

void applyBuzzer() {
  digitalWrite(BUZZER_PIN, buzzerOn ? BUZZER_ON : BUZZER_OFF);
}

// ================= WS COMMAND HANDLER =================
void handleCommand(const String& raw) {
  // Tìm key "mode"
  if (raw.indexOf("\"mode\"") >= 0) {
    bool newAuto = raw.indexOf("\"AUTO\"") >= 0;
    if (newAuto != isAutoMode) {
      isAutoMode = newAuto;
      // Giữ nguyên trạng thái quạt và còi khi đổi mode
      logLine("MODE", isAutoMode ? "Switched to AUTO" : "Switched to MANUAL");
    }
    return;
  }

  // Lệnh quạt — chỉ chấp nhận ở MANUAL
  if (raw.indexOf("\"fan\"") >= 0) {
    if (isAutoMode) {
      logLine("CMD", "Ignored fan command (AUTO mode)");
      return;
    }
    fanOn = raw.indexOf("\"ON\"") >= 0;
    applyFan();
    logLine("CMD", fanOn ? "Fan ON (manual cmd)" : "Fan OFF (manual cmd)");
    return;
  }

  // Lệnh tắt còi — chỉ chấp nhận ở MANUAL
  if (raw.indexOf("\"buzzer\"") >= 0 && raw.indexOf("\"OFF\"") >= 0) {
    if (isAutoMode) {
      logLine("CMD", "Ignored buzzer_off command (AUTO mode)");
      return;
    }
    buzzerOn = false;
    applyBuzzer();
    logLine("CMD", "Buzzer OFF (manual cmd)");
    return;
  }
}

// ================= WS EVENT =================
void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      logLine("WS", "Connected to " + String(host) + ":" + String(port));
      wsConnected = true;
      break;

    case WStype_DISCONNECTED:
      logLine("WS", "Disconnected");
      wsConnected = false;
      break;

    case WStype_TEXT: {
      String msg = String((char*)payload);
      logLine("WS RX", msg);

      // ACK từ server
      if ((msg == "ACK" || msg.startsWith("{\"ack\":")) && waitingAck) {
        waitingAck = false;
        int ackedId = queue[0].id;
        removeQueue();
        logLine("ACK", "id=" + String(ackedId) + ", pending=" + String(queueSize));
        break;
      }

      // Lệnh điều khiển từ BE
      handleCommand(msg);
      break;
    }
  }
}

// ================= SENSOR =================
void readSensor() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  if (isnan(t) || isnan(h)) {
    delay(50);
    t = dht.readTemperature();
    h = dht.readHumidity();
  }

  if (isnan(t) || isnan(h)) {
    errorSensorCount++;
    if (errorSensorCount >= 5) errorSensor = true;
    logLine("SENSOR", "Read failed, retryCount=" + String(errorSensorCount));
    return;
  }

  temp = t;
  humi = h;
  errorSensor = false;
  errorSensorCount = 0;
  logLine("SENSOR", "temp=" + String(temp, 1) + "C, humi=" + String(humi, 1) + "%");
}

// ================= APP STATE =================
void updateAppState() {
  if (errorSensor)                            appState = ERROR_STATE;
  else if (temp > TEMP_ALARM || humi > HUMI_ALARM) appState = ALARM;
  else if (temp > TEMP_LIMIT || humi > HUMI_LIMIT) appState = WARNING;
  else                                         appState = NORMAL;
}

// ================= CONTROL LOGIC =================
void handleAppState() {
  if (isAutoMode) {
    // ── AUTO: ESP tự điều khiển theo appState ──
    switch (appState) {
      case NORMAL:
        fanOn    = false;
        buzzerOn = false;
        applyFan();
        applyBuzzer();
        break;

      case WARNING:
        fanOn    = true;
        buzzerOn = false;
        applyFan();
        applyBuzzer();
        break;

      case ALARM:
        fanOn = true;
        applyFan();
        // Nhấp nháy còi mỗi 500ms
        if (millis() - buzzer_time > 500) {
          buzzer_time = millis();
          buzzerOn = !buzzerOn;
          applyBuzzer();
        }
        break;

      case ERROR_STATE:
        fanOn    = true;
        buzzerOn = true;
        applyFan();
        applyBuzzer();
        break;
    }
  }
  // ── MANUAL: không tự điều khiển, chỉ giữ trạng thái hiện tại ──
  // (quạt và còi được điều khiển bởi nút vật lý hoặc lệnh từ BE)
}

// ================= BUTTONS =================
void handleButtons() {
  unsigned long now = millis();

  // Nút MODE — hoạt động ở cả 2 chế độ
  if (digitalRead(BTN_MODE_PIN) == LOW && now - lastBtnMode > DEBOUNCE_MS) {
    lastBtnMode = now;
    isAutoMode  = !isAutoMode;
    // Giữ nguyên trạng thái quạt và còi khi đổi mode
    logLine("BTN", isAutoMode ? "Mode -> AUTO" : "Mode -> MANUAL");
  }

  // Nút QUẠT — chỉ hoạt động ở MANUAL
  if (digitalRead(BTN_FAN_PIN) == LOW && now - lastBtnFan > DEBOUNCE_MS) {
    lastBtnFan = now;
    if (!isAutoMode) {
      fanOn = !fanOn;
      applyFan();
      logLine("BTN", fanOn ? "Fan toggled ON" : "Fan toggled OFF");
    } else {
      logLine("BTN", "Fan button ignored (AUTO mode)");
    }
  }

  // Nút TẮT CÒI — chỉ hoạt động ở MANUAL (chỉ tắt, không bật)
  if (digitalRead(BTN_BUZZER_PIN) == LOW && now - lastBtnBuzzer > DEBOUNCE_MS) {
    lastBtnBuzzer = now;
    if (!isAutoMode) {
      if (buzzerOn) {
        buzzerOn = false;
        applyBuzzer();
        logLine("BTN", "Buzzer OFF");
      }
    } else {
      logLine("BTN", "Buzzer button ignored (AUTO mode)");
    }
  }
}

// ================= QUEUE =================
void pushEvent(String event) {
  if (queueSize >= MAX_QUEUE) {
    logLine("QUEUE", "Drop event=" + event + " (queue full)");
    return;
  }
  String data = "{\"event\":\"" + event + "\"}";
  queue[queueSize].id   = currentMsgId++;
  queue[queueSize].data = data;
  queueSize++;
  logLine("QUEUE", "Push id=" + String(queue[queueSize - 1].id) + ", size=" + String(queueSize));
}

void removeQueue() {
  if (queueSize <= 0) return;
  for (int i = 1; i < queueSize; i++) queue[i - 1] = queue[i];
  queueSize--;
  logLine("QUEUE", "Pop success, pending=" + String(queueSize));
}

void sendMessage(Message msg) {
  if (!wsConnected) return;
  String packet = "{\"id\":" + String(msg.id) + ",\"data\":" + msg.data + "}";
  webSocket.sendTXT(packet);
  logLine("WS TX", "id=" + String(msg.id) + ", payload=" + packet);
  waitingAck = true;
  sendTime   = millis();
}

void processQueue() {
  if (queueSize <= 0 || waitingAck) return;
  sendMessage(queue[0]);
}

void checkTimeout() {
  if (queueSize <= 0) return;
  if (waitingAck && millis() - sendTime > 3000) {
    logLine("RESEND", "Timeout id=" + String(queue[0].id) + ", retrying");
    sendMessage(queue[0]);
  }
}

// ================= REALTIME =================
void sendRealtime() {
  if (!wsConnected || millis() - lastSend <= 3000) return;
  lastSend = millis();

  String data = "{";
  data += "\"temp\":"         + String(temp, 1)        + ",";
  data += "\"humi\":"         + String(humi, 1)        + ",";
  data += "\"fan\":"          + String(fanOn ? 1 : 0)  + ",";
  data += "\"buzzer\":"       + String(buzzerOn ? 1 : 0) + ",";
  data += "\"mode\":\""       + String(isAutoMode ? "AUTO" : "MANUAL") + "\",";
  data += "\"alarm\":"        + String(appState == ALARM ? 1 : 0) + ",";
  data += "\"error\":"        + String(appState == ERROR_STATE ? 1 : 0) + ",";
  data += "\"app_state\":\"" + String(appStateName(appState)) + "\",";
  data += "\"system_state\":\"" + String(systemStateName(sysState)) + "\"";
  data += "}";

  webSocket.sendTXT(data);
  logLine("REALTIME", data);
}

// ================= HEARTBEAT =================
void heartbeat() {
  if (millis() - lastHeartbeat > 10000) {
    lastHeartbeat = millis();
    webSocket.sendTXT("{\"topic\":\"ping\"}");
    logLine("PING", "Heartbeat sent");
  }
}

// ================= LCD =================
char line1[17];
char line2[17];

void displayLCD() {
  snprintf(line1, sizeof(line1), "T:%5.1fC", temp);
  snprintf(line2, sizeof(line2), "H:%5.1f%%", humi);

  lcd.setCursor(0, 0);
  lcd.print(line1);

  lcd.setCursor(0, 1);
  switch (appState) {
    case NORMAL:      lcd.print(line2); lcd.print(isAutoMode ? " AUT" : " MAN"); break;
    case WARNING:     lcd.print(line2); lcd.print(isAutoMode ? " A!W" : " M!W"); break;
    case ALARM:       lcd.print(line2); lcd.print(isAutoMode ? " ALM" : " !AL"); break;
    case ERROR_STATE: lcd.print("SENSOR ERROR   "); break;
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);

  Wire.begin(21, 22);

  pinMode(RELAY_PIN,   OUTPUT);
  pinMode(BUZZER_PIN,  OUTPUT);
  pinMode(BTN_MODE_PIN,   INPUT_PULLUP);
  pinMode(BTN_FAN_PIN,    INPUT_PULLUP);
  pinMode(BTN_BUZZER_PIN, INPUT_PULLUP);

  digitalWrite(RELAY_PIN,  LOW);
  digitalWrite(BUZZER_PIN, BUZZER_OFF);

  lcd.init();
  lcd.backlight();
  dht.begin();

  logLine("BOOT", "System starting — mode=AUTO");
  connectWiFi();
}

// ================= LOOP =================
void loop() {
  webSocket.loop();

  updateSystemState();
  handleSystemState();

  if (millis() - lastSensor > 2000) {
    lastSensor = millis();
    readSensor();
    updateAppState();
  }

  handleAppState();
  handleButtons();

  // Phát sự kiện khi appState thay đổi
  if (appState != lastState) {
    logLine("STATE", String(appStateName(lastState)) + " -> " + appStateName(appState));

    // Khi vào ALARM ở AUTO: còi bắt đầu ngay lập tức
    if (isAutoMode && appState == ALARM) {
      buzzerOn   = true;
      buzzer_time = millis();
      applyBuzzer();
    }

    // Khi thoát ALARM ở AUTO: tắt còi
    if (isAutoMode && lastState == ALARM && appState != ALARM) {
      buzzerOn = false;
      applyBuzzer();
    }

    pushEvent(appStateName(appState));
    lastState = appState;
  }

  if (millis() - lastLCD > 1000) {
    lastLCD = millis();
    displayLCD();
  }

  sendRealtime();
  processQueue();
  checkTimeout();
  heartbeat();
}
