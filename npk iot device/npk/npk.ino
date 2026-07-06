/*
 * Soil Nutrient Monitoring System — ESP32 firmware
 * ------------------------------------------------------------
 * Sensor : RS485 3-in-1 NPK soil sensor (Modbus RTU)
 *          Reports Nitrogen (N), Phosphorus (P), Potassium (K) in mg/kg.
 * Link   : ESP32  ->  MAX485 (TTL<->RS485)  ->  NPK sensor
 * Flow   : Read N/P/K over Modbus  ->  connect WiFi  ->  POST JSON to Django
 *
 * Wiring (ESP32 DevKit) — auto-direction RS485 module (no DE/RE pin):
 *   Module RXD -> ESP32 GPIO26 (UART2 TX, remapped)
 *   Module TXD -> ESP32 GPIO25 (UART2 RX, remapped)
 *   Module VCC -> 5V , GND -> GND
 *   Module A/B -> sensor A/B (yellow=A, blue=B on most modules)
 *   Sensor brown -> 5V-12V (check your sensor's spec), black -> GND
 *   (If instead you use a MAX485 module WITH DE/RE, set RS485_AUTO_DIR false
 *    below and wire DE+RE tied together to ESP32 GPIO4.)
 *
 *   20x4 I2C LCD (HD44780 + PCF8574 backpack):
 *     LCD VCC -> 5V , GND -> GND
 *     LCD SDA -> ESP32 GPIO21
 *     LCD SCL -> ESP32 GPIO22
 *   (I2C is separate from the RS485 pins, so there is no conflict.)
 *
 * Libraries: ESP32 core (WiFi.h, HTTPClient.h) + "LiquidCrystal I2C" by
 *   Frank de Brabander — install it from Arduino IDE > Library Manager.
 * Board    : select an "ESP32 Dev Module" in the Arduino IDE.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ----------------------- CONFIG: edit these ------------------------
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// The PC running the Django backend. Use its LAN IP, NOT 127.0.0.1.
// Find it on Windows with `ipconfig` (IPv4 Address), e.g. 192.168.1.50.
// Start Django with:  python manage.py runserver 0.0.0.0:8000
const char* SERVER_URL = "http://192.168.202.160:8000/api/reading/";

// Unique id for THIS sensor. Set a Field's "device_id" to the same string in
// the app (Admin > Fields) and every reading auto-attaches to that field —
// this is how one backend supports multiple fields/sensors.
const char* DEVICE_ID = "esp32-field-1";

const unsigned long POST_INTERVAL_MS = 5000;   // how often to read + send

// 20x4 I2C LCD. If the screen stays blank or shows only boxes, try the other
// common address 0x3F (run an I2C scanner sketch if unsure).
#define LCD_ADDR 0x27
#define LCD_COLS 20
#define LCD_ROWS 4
#define LCD_SDA  21
#define LCD_SCL  22
// -------------------------------------------------------------------

// RS485 wiring. UART2 is remapped off the default 16/17 pins (those clash with
// PSRAM on ESP32-WROVER boards). Any safe output-capable GPIO works here.
#define RS485_RX_PIN 25   // ESP32 UART2 RX  <- module TXD (or MAX485 RO)
#define RS485_TX_PIN 26   // ESP32 UART2 TX  -> module RXD (or MAX485 DI)
#define RS485_BAUD   4800 // most NPK sensors default to 4800 8N1

// Direction control. Auto-direction modules (only VCC/GND/RXD/TXD/A/B, NO DE/RE
// pin) switch by themselves — leave this true. Set false only for a MAX485
// module whose DE+RE pins are wired to RS485_DE_RE.
#define RS485_AUTO_DIR true
#define RS485_DE_RE     4    // used only when RS485_AUTO_DIR is false

HardwareSerial RS485(2);  // use UART2
LiquidCrystal_I2C lcd(LCD_ADDR, LCD_COLS, LCD_ROWS);

// Modbus: read 3 holding registers (N, P, K) starting at 0x001E from slave 1.
// If your sensor returns zeros, try start register 0x0000 instead (see README).
const uint8_t  SENSOR_ADDR     = 0x01;
const uint16_t NPK_START_REG   = 0x001E;
const uint16_t NPK_REG_COUNT   = 0x0003;

unsigned long lastPost = 0;

// ---- Modbus CRC16 (little-endian, appended low byte first) ----
uint16_t modbusCRC(const uint8_t* buf, uint8_t len) {
  uint16_t crc = 0xFFFF;
  for (uint8_t i = 0; i < len; i++) {
    crc ^= buf[i];
    for (uint8_t b = 0; b < 8; b++) {
      if (crc & 0x0001) {
        crc >>= 1;
        crc ^= 0xA001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc;
}

// Write a whole 20-char row, padded/truncated so old characters are cleared.
void lcdLine(uint8_t row, const char* msg) {
  char buf[LCD_COLS + 1];
  snprintf(buf, sizeof(buf), "%-20.20s", msg);
  lcd.setCursor(0, row);
  lcd.print(buf);
}

// Row 1: latest N/P/K reading (fits exactly in 20 columns).
void lcdShowNPK(uint16_t n, uint16_t p, uint16_t k) {
  char line[LCD_COLS + 1];
  snprintf(line, sizeof(line), "N:%4u P:%4u K:%4u", n, p, k);
  lcdLine(1, line);
}

void rs485TransmitMode(bool tx) {
#if !RS485_AUTO_DIR
  digitalWrite(RS485_DE_RE, tx ? HIGH : LOW);
  delayMicroseconds(50);
#endif
}

// Reads N, P, K into out[3]. Returns true on a valid response.
bool readNPK(uint16_t out[3]) {
  uint8_t req[8];
  req[0] = SENSOR_ADDR;
  req[1] = 0x03;                       // function: read holding registers
  req[2] = NPK_START_REG >> 8;
  req[3] = NPK_START_REG & 0xFF;
  req[4] = NPK_REG_COUNT >> 8;
  req[5] = NPK_REG_COUNT & 0xFF;
  uint16_t crc = modbusCRC(req, 6);
  req[6] = crc & 0xFF;                 // CRC low byte first
  req[7] = crc >> 8;

  // flush stale bytes
  while (RS485.available()) RS485.read();

  rs485TransmitMode(true);
  RS485.write(req, sizeof(req));
  RS485.flush();                       // wait until all bytes are out
  rs485TransmitMode(false);

  // Expected reply: addr, func, byteCount(6), 6 data bytes, 2 CRC = 11 bytes
  const uint8_t expected = 5 + NPK_REG_COUNT * 2;
  uint8_t resp[16];
  uint8_t idx = 0;
  unsigned long start = millis();
  while (idx < expected && millis() - start < 1000) {
    if (RS485.available()) {
      resp[idx++] = RS485.read();
    }
  }

  // Dump the raw reply so the exact sensor bytes can be decoded when debugging.
  Serial.print("RS485 raw:");
  for (uint8_t i = 0; i < idx; i++) Serial.printf(" %02X", resp[i]);
  Serial.println();

  if (idx < expected) {
    Serial.printf("RS485: short reply (%u/%u bytes)\n", idx, expected);
    return false;
  }
  if (resp[0] != SENSOR_ADDR || resp[1] != 0x03) {
    Serial.println("RS485: unexpected header");
    return false;
  }
  uint16_t rxCrc = resp[idx - 2] | (resp[idx - 1] << 8);
  if (rxCrc != modbusCRC(resp, idx - 2)) {
    Serial.println("RS485: CRC mismatch");
    return false;
  }

  out[0] = (resp[3] << 8) | resp[4];   // N
  out[1] = (resp[5] << 8) | resp[6];   // P
  out[2] = (resp[7] << 8) | resp[8];   // K
  return true;
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("WiFi: connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf(" connected, IP %s\n", WiFi.localIP().toString().c_str());
    char buf[LCD_COLS + 1];
    snprintf(buf, sizeof(buf), "IP:%s", WiFi.localIP().toString().c_str());
    lcdLine(2, buf);
  } else {
    Serial.println(" failed (will retry)");
    lcdLine(2, "WiFi: failed, retry");
  }
}

bool postReading(uint16_t n, uint16_t p, uint16_t k) {
  if (WiFi.status() != WL_CONNECTED) {
    lcdLine(3, "Server: no WiFi");
    return false;
  }

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  char body[160];
  snprintf(body, sizeof(body), "{\"n\":%u,\"p\":%u,\"k\":%u,\"device_id\":\"%s\"}", n, p, k, DEVICE_ID);

  int code = http.POST((uint8_t*)body, strlen(body));
  Serial.printf("POST %s -> HTTP %d\n", body, code);
  if (code > 0) {
    Serial.println(http.getString());
  }
  http.end();

  char st[LCD_COLS + 1];
  if (code == 200)      snprintf(st, sizeof(st), "Server: OK sent");
  else if (code > 0)    snprintf(st, sizeof(st), "Server: HTTP %d", code);
  else                  snprintf(st, sizeof(st), "Server: no link");
  lcdLine(3, st);

  return code == 200;
}

void setup() {
  Serial.begin(115200);
#if !RS485_AUTO_DIR
  pinMode(RS485_DE_RE, OUTPUT);        // MAX485 direction control
#endif
  rs485TransmitMode(false);            // start in receive mode
  RS485.begin(RS485_BAUD, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);

  // Bring up the 20x4 LCD and show a splash screen.
  Wire.begin(LCD_SDA, LCD_SCL);
  lcd.init();
  lcd.backlight();
  lcdLine(0, "  Soil NPK Monitor");
  lcdLine(1, "N:--- P:--- K:---");
  lcdLine(2, "WiFi: connecting...");
  lcdLine(3, "Starting up...");

  delay(500);
  Serial.println("\nSoil NPK monitor starting...");
  connectWiFi();
}

// Real 3-in-1 soil sensors report each of N/P/K roughly in 0..1999 mg/kg. A
// flaky RS485 line (bad wiring, wrong baud/register, A/B swapped) can still
// return a CRC-valid but nonsense frame like K=52480 — reject those so garbage
// never reaches the app.
#define NPK_MAX_VALID 3000
bool plausibleNPK(const uint16_t v[3]) {
  return v[0] <= NPK_MAX_VALID && v[1] <= NPK_MAX_VALID && v[2] <= NPK_MAX_VALID;
}

void loop() {
  if (millis() - lastPost < POST_INTERVAL_MS) return;
  lastPost = millis();

  connectWiFi();

  uint16_t npk[3];
  if (!readNPK(npk)) {
    Serial.println("Sensor read failed — check wiring/baud/register.");
    lcdLine(1, "Sensor read FAILED");
    lcdLine(3, "Check RS485 wiring");
    return;
  }

  if (!plausibleNPK(npk)) {
    // CRC passed but the numbers are impossible — do NOT show or send them.
    Serial.printf("Sensor -> implausible N:%u P:%u K:%u — NOT sent\n",
                  npk[0], npk[1], npk[2]);
    lcdLine(1, "Sensor: bad data");
    lcdLine(3, "Check A/B, baud, reg");
    return;
  }

  Serial.printf("Sensor -> N:%u P:%u K:%u mg/kg\n", npk[0], npk[1], npk[2]);
  lcdShowNPK(npk[0], npk[1], npk[2]);
  postReading(npk[0], npk[1], npk[2]);
}
