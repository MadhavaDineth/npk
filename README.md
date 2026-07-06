# Soil Nutrient Monitoring System (NPK)

A real IoT soil monitoring system:

```
RS485 3-in-1 NPK sensor ──Modbus──► ESP32 ──WiFi/HTTP──► Django ◄──fetch── React frontend
```

The ESP32 reads Nitrogen, Phosphorus and Potassium from the sensor and POSTs
them to the Django backend. The React app polls the backend on each **Scan** and
shows crop suitability + fertilizer recommendations. pH and moisture are entered
manually (the 3-in-1 sensor measures N/P/K only).

---

## 1. Backend (Django)

```bash
cd c:\wamp64\www\npk
pip install -r requirements.txt
python manage.py migrate          # first run only
python manage.py runserver 0.0.0.0:8000
```

> Use `0.0.0.0:8000` (not `127.0.0.1`) so the ESP32 on your WiFi can reach it.

### API endpoints
| Method | Path           | Used by   | Purpose                                  |
|--------|----------------|-----------|------------------------------------------|
| POST   | `/api/reading/`| ESP32     | Push a reading, e.g. `{"n":210,"p":34,"k":180}` |
| GET    | `/api/latest/` | Frontend  | Most recent reading                      |
| GET    | `/api/history/`| (optional)| Last 50 readings                         |

Quick test without hardware (PowerShell):
```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8000/api/reading/ -Method Post `
  -ContentType application/json -Body '{"n":210,"p":34,"k":180}'
Invoke-RestMethod -Uri http://127.0.0.1:8000/api/latest/
```

## 2. Frontend (React + Vite)

```bash
cd c:\wamp64\www\npk\frontend
npm install
npm run dev        # http://localhost:5173
```

The backend URL defaults to `http://127.0.0.1:8000`. To point elsewhere, create
`frontend/.env`:
```
VITE_API_BASE=http://192.168.1.50:8000
```

On **Scan**, the app fetches `/api/latest/`. If the backend or device is offline
it falls back to demo data and the badge shows **Demo data** instead of **Live**.

## 3. ESP32 firmware

File: [`npk iot device/npk/npk.ino`](npk%20iot%20device/npk/npk.ino)

### Wiring (ESP32 ↔ RS485 module ↔ sensor)

**Auto-direction module** (only VCC/GND/RXD/TXD/A/B — no DE/RE pin) — default:
| RS485 module | ESP32       |
|--------------|-------------|
| RXD          | GPIO26 (TX) |
| TXD          | GPIO25 (RX) |
| VCC / GND    | 5V / GND    |
| A / B        | sensor A / B|

Keep `RS485_AUTO_DIR true` in `npk.ino` for this type.

**MAX485 module** (has DE/RE pins): additionally wire DE+RE (tied) → GPIO4, and
set `RS485_AUTO_DIR false`.

Sensor power wire usually needs 5–12 V (check your model's label).

### 20×4 I2C LCD (optional display)
| LCD (I2C backpack) | ESP32   |
|--------------------|---------|
| VCC / GND          | 5V / GND|
| SDA                | GPIO21  |
| SCL                | GPIO22  |

The LCD shows, in real time:
```
  Soil NPK Monitor
N: 210 P:  34 K: 180
IP:192.168.1.50
Server: OK sent
```
I2C is on separate pins from RS485, so there is no conflict.

### Configure & flash
1. Arduino IDE → install **esp32** boards (Boards Manager), select *ESP32 Dev Module*.
2. Library Manager → install **"LiquidCrystal I2C"** (by Frank de Brabander).
3. Edit the `CONFIG` block at the top of `npk.ino`:
   - `WIFI_SSID`, `WIFI_PASS`
   - `SERVER_URL` → `http://<your-PC-LAN-IP>:8000/api/reading/`
   - `LCD_ADDR` → `0x27` or `0x3F` depending on your backpack
4. Upload, open Serial Monitor at **115200** baud.

### Troubleshooting
- **LCD blank / shows only boxes:** wrong I2C address — switch `LCD_ADDR`
  between `0x27` and `0x3F`; check SDA=GPIO21, SCL=GPIO22 and 5V power.
- **Sensor returns 0 / read fails:** try `NPK_START_REG = 0x0000` (some modules
  map N/P/K there instead of `0x001E`), and confirm `RS485_BAUD` (4800 vs 9600).
- **Garbage / impossible values (e.g. K=52480):** the RS485 link is unstable.
  Most common fix is **swapping the A/B wires**; also check sensor power (many
  need 5–12 V), a common ground with the ESP32, and the baud/register above.
  The firmware now rejects any N/P/K outside 0–3000 mg/kg (and so does the
  backend, returning HTTP 422), so bad frames no longer reach the app. Watch the
  Serial Monitor (115200) — it prints `RS485 raw: ..` (the exact reply bytes)
  plus `short reply` / `CRC mismatch` / `unexpected header` to pinpoint the fault.
- **POST fails:** ESP32 and PC must be on the same WiFi; run Django on
  `0.0.0.0:8000`; allow port 8000 through the Windows firewall.
- **CORS errors in browser:** already handled (`CORS_ALLOW_ALL_ORIGINS=True` for dev).
