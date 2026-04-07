#include <WiFi.h>
#include <WebSocketsClient.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>
#include <Wire.h>
#include <ArduinoJson.h>

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
#define RELAY_PIN 18
#define BUZZER_PIN 19
#define BTN_BUZZER_PIN 23   // Nút bấm vật lý tắt còi (INPUT_PULLUP: LOW = bấm)
#define BUZZER_ON LOW
#define BUZZER_OFF HIGH

// ================= LIMIT =================
#define TEMP_LIMIT 28
#define HUMI_LIMIT 85
#define TEMP_ALARM 32
#define HUMI_ALARM 95

DHT dht(DHTPIN, DHTTYPE);
LiquidCrystal_I2C lcd(0x27,16,2);

// ================= STATE =================
enum SystemState { SYS_INIT, SYS_WIFI, SYS_WS, SYS_RUNNING, SYS_ERROR };
enum AppState { NORMAL, WARNING, ALARM, ERROR_STATE };

SystemState sysState = SYS_INIT;
AppState appState = NORMAL;
AppState lastState = NORMAL;

// ================= DATA =================
float temp = 0, humi = 0;
bool errorSensor = false;
int errorSensorCount = 0;

// ================= CONTROL =================
bool buzzerOn   = false;
bool buzzerMuted = false;     // true = đã bị tắt thủ công (vật lý hoặc FE)
bool btnPrevState = HIGH;     // trạng thái trước của nút bấm vật lý
unsigned long buzzer_time = 0;

// ================= TIMER =================
unsigned long lastSensor = 0;
unsigned long lastLCD = 0;
unsigned long lastReconnectWiFi = 0;
unsigned long lastReconnectWS = 0;
unsigned long lastSend = 0;
unsigned long lastHeartbeat = 0;

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
bool waitingAck = false;
unsigned long sendTime = 0;

// ================= LOG =================
const char* appStateName(AppState state) {
  switch(state) {
    case NORMAL: return "NORMAL";
    case WARNING: return "WARNING";
    case ALARM: return "ALARM";
    case ERROR_STATE: return "ERROR";
  }

  return "UNKNOWN";
}

const char* systemStateName(SystemState state) {
  switch(state) {
    case SYS_INIT: return "INIT";
    case SYS_WIFI: return "WAIT_WIFI";
    case SYS_WS: return "WAIT_WS";
    case SYS_RUNNING: return "RUNNING";
    case SYS_ERROR: return "ERROR";
  }

  return "UNKNOWN";
}

void logLine(const char* tag, const String& message) {
  Serial.print('[');
  Serial.print(millis());
  Serial.print(" ms]");
  Serial.print('[');
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
  SystemState previousState = sysState;

  switch(sysState) {
    case SYS_INIT:
      sysState = SYS_WIFI;
      break;

    case SYS_WIFI:
      if(WiFi.status() == WL_CONNECTED)
        sysState = SYS_WS;
      break;

    case SYS_WS:
      if(wsConnected)
        sysState = SYS_RUNNING;
      break;

    case SYS_RUNNING:
      if(WiFi.status() != WL_CONNECTED)
        sysState = SYS_ERROR;
      break;

    case SYS_ERROR:
      break;
  }

  if(sysState != previousState) {
    logLine("SYSTEM", String(systemStateName(previousState)) + " -> " + systemStateName(sysState));
  }
}

// ================= HANDLE SYSTEM =================
void handleSystemState() {

  switch(sysState) {

    case SYS_WIFI:
      if (WiFi.status() != WL_CONNECTED) {
        if (millis() - lastReconnectWiFi > 5000) {
          lastReconnectWiFi = millis();
          connectWiFi();
        }
      }
      break;

    case SYS_WS:
      if (!wsConnected) {
        if (millis() - lastReconnectWS > 5000) {
          lastReconnectWS = millis();
          logLine("WS", "Opening socket to " + String(host) + ":" + String(port));
          webSocket.begin(host, port, "/");
          webSocket.onEvent(webSocketEvent);
        }
      }
      break;

    case SYS_ERROR:
      if (millis() - lastReconnectWiFi > 5000) {
        lastReconnectWiFi = millis();
        connectWiFi();
      }
      break;
  }
}

// ================= WS EVENT =================
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {

  switch(type) {
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

      // Kiểm tra ACK trước
      if((msg == "ACK" || msg.startsWith("{\"ack\":")) && waitingAck) {
        waitingAck = false;
        int ackedId = queue[0].id;
        removeQueue();
        logLine("ACK", "Confirmed message id=" + String(ackedId) + ", pending=" + String(queueSize));
        break;
      }

      // Parse JSON lệnh điều khiển từ server
      StaticJsonDocument<128> doc;
      DeserializationError err = deserializeJson(doc, msg);
      if (!err) {
        // Lệnh tắt còi từ FE
        if (doc.containsKey("buzzer") && String(doc["buzzer"].as<const char*>()) == "OFF") {
          buzzerMuted = true;
          buzzerOn = false;
          digitalWrite(BUZZER_PIN, BUZZER_OFF);
          logLine("WS CMD", "Buzzer OFF (remote)");
        }
        // Lệnh điều khiển quạt từ FE
        if (doc.containsKey("fan")) {
          String fanCmd = doc["fan"].as<String>();
          digitalWrite(RELAY_PIN, fanCmd == "ON" ? HIGH : LOW);
          logLine("WS CMD", "Fan " + fanCmd);
        }
      }
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
    if(errorSensorCount >= 5) errorSensor = true;
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
  if(errorSensor) appState = ERROR_STATE;
  else if(temp > TEMP_ALARM || humi > HUMI_ALARM) appState = ALARM;
  else if(temp > TEMP_LIMIT || humi > HUMI_LIMIT) appState = WARNING;
  else appState = NORMAL;
}

// ================= CONTROL =================
void handleAppState() {

  switch(appState) {

    case NORMAL:
      digitalWrite(RELAY_PIN, LOW);
      buzzerOn = false;
      digitalWrite(BUZZER_PIN, BUZZER_OFF);
      break;

    case WARNING:
      digitalWrite(RELAY_PIN, HIGH);
      buzzerOn = false;
      digitalWrite(BUZZER_PIN, BUZZER_OFF);
      break;

    case ALARM:
      digitalWrite(RELAY_PIN, HIGH);
      if (!buzzerMuted) {
        // Còi chưa bị tắt thủ công → blink mỗi 500ms
        if(millis() - buzzer_time > 500) {
          buzzer_time = millis();
          buzzerOn = !buzzerOn;
          digitalWrite(BUZZER_PIN, buzzerOn ? BUZZER_ON : BUZZER_OFF);
        }
      } else {
        // Đã tắt thủ công → giữ tắt
        buzzerOn = false;
        digitalWrite(BUZZER_PIN, BUZZER_OFF);
      }
      break;

    case ERROR_STATE:
      digitalWrite(RELAY_PIN, HIGH);
      digitalWrite(BUZZER_PIN, BUZZER_ON);
      buzzerOn = true;
      break;
  }
}

// ================= NÚT BẤM VẬT LÝ =================
void handleBuzzerButton() {
  bool curState = digitalRead(BTN_BUZZER_PIN);
  // Phát hiện cạnh xuống (HIGH → LOW): nút vừa được bấm
  if (btnPrevState == HIGH && curState == LOW) {
    buzzerMuted = true;
    buzzerOn    = false;
    digitalWrite(BUZZER_PIN, BUZZER_OFF);
    logLine("BTN", "Buzzer OFF (physical button)");
  }
  btnPrevState = curState;
}

// ================= EVENT =================
void pushEvent(String event) {
  if(queueSize < MAX_QUEUE) {

    String data = "{";
    data += "\"event\":\"" + event + "\"";
    data += "}";

    queue[queueSize].id = currentMsgId++;
    queue[queueSize].data = data;
    queueSize++;

    logLine("QUEUE", "Push id=" + String(queue[queueSize - 1].id) + ", size=" + String(queueSize) + ", data=" + data);
  } else {
    logLine("QUEUE", "Drop event=" + event + " because queue is full");
  }
}

void removeQueue() {
  if(queueSize <= 0) return;

  for(int i=1;i<queueSize;i++) {
    queue[i-1] = queue[i];
  }

  queueSize--;
  logLine("QUEUE", "Pop success, pending=" + String(queueSize));
}

// ================= SEND EVENT =================
void sendMessage(Message msg) {
  if(!wsConnected) return;

  String packet = "{";
  packet += "\"id\":" + String(msg.id) + ",";
  packet += "\"data\":" + msg.data;
  packet += "}";

  webSocket.sendTXT(packet);

  logLine("WS TX", "id=" + String(msg.id) + ", payload=" + packet);

  waitingAck = true;
  sendTime = millis();
}

void processQueue() {
  if(queueSize <= 0) return;

  if(!waitingAck) {
    sendMessage(queue[0]);
  }
}

void checkTimeout() {
  if(queueSize <= 0) return;

  if(waitingAck && millis() - sendTime > 3000) {
    logLine("RESEND", "Timeout for id=" + String(queue[0].id) + ", retrying");
    sendMessage(queue[0]);
  }
}

// ================= REALTIME =================
void sendRealtime() {
  if(wsConnected && millis() - lastSend > 3000) {
    lastSend = millis();

    String data = "{";
    data += "\"temp\":" + String(temp) + ",";
    data += "\"humi\":" + String(humi) + ",";
    data += "\"fan\":" + String(digitalRead(RELAY_PIN)) + ",";
    data += "\"buzzer\":" + String(buzzerOn ? 1 : 0) + ",";  // <-- trạng thái còi
    data += "\"alarm\":" + String(appState == ALARM) + ",";
    data += "\"error\":" + String(appState == ERROR_STATE) + ",";
    data += "\"app_state\":\"" + String(appStateName(appState)) + "\",";
    data += "\"system_state\":\"" + String(systemStateName(sysState)) + "\"";
    data += "}";

    webSocket.sendTXT(data);

    logLine("REALTIME", data);
  }
}

// ================= HEARTBEAT =================
void heartbeat() {
  if(millis() - lastHeartbeat > 10000) {
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

  lcd.setCursor(0,0);
  lcd.print(line1);

  lcd.setCursor(0,1);

  switch(appState) {
    case NORMAL: lcd.print(line2); lcd.print(" NOR"); break;
    case WARNING: lcd.print(line2); lcd.print(" WAR"); break;
    case ALARM: lcd.print(line2); lcd.print(" ALM"); break;
    case ERROR_STATE: lcd.print("SENSOR ERROR   "); break;
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);

  Wire.begin(21,22);

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BTN_BUZZER_PIN, INPUT_PULLUP);  // Nút bấm nội trở kéo lên

  digitalWrite(RELAY_PIN, LOW);
  digitalWrite(BUZZER_PIN, BUZZER_OFF);

  lcd.init();
  lcd.backlight();

  dht.begin();

  logLine("BOOT", "System starting");
  connectWiFi();
}

// ================= LOOP =================
void loop() {

  webSocket.loop();

  updateSystemState();
  handleSystemState();

  if(millis() - lastSensor > 2000) {
    lastSensor = millis();
    readSensor();
    updateAppState();
  }

  handleAppState();

  if(appState != lastState) {
    logLine("STATE", String(appStateName(lastState)) + " -> " + appStateName(appState));

    if(appState == ALARM) {
      // Vào ALARM mới → reset mute, bắt đầu kêu
      buzzerMuted = false;
      buzzerOn = true;
      buzzer_time = millis();
      digitalWrite(BUZZER_PIN, BUZZER_ON);
    } else {
      // Thoát khỏi ALARM → reset mute để lần sau kêu bình thường
      buzzerMuted = false;
    }

    if(appState == ALARM) pushEvent("ALARM_ON");
    if(appState == NORMAL) pushEvent("NORMAL");
    if(appState == WARNING) pushEvent("WARNING");
    if(appState == ERROR_STATE) pushEvent("ERROR");

    lastState = appState;
  }

  if(millis() - lastLCD > 1000) {
    lastLCD = millis();
    displayLCD();
  }

  handleBuzzerButton();  // Đọc nút bấm vật lý tắt còi

  sendRealtime();
  processQueue();
  checkTimeout();
  heartbeat();
}
