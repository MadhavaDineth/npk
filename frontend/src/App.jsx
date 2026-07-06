import { useState, useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Droplet, Leaf, AlertTriangle, RefreshCw, Sprout, TrendingUp, CheckCircle2, XCircle, Languages, Star, MapPin, Save, Trash2, FolderOpen, ArrowRight, ArrowLeft, Calendar, ScanLine, Wallet, Gauge, BarChart3, Printer, FileText, Shield } from "lucide-react";

// Django backend base URL. Override at build time with VITE_API_BASE if needed.
const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

// localStorage-backed shim mimicking the window.storage API used by this design.
const storage = {
  async get(key) {
    const value = localStorage.getItem(key);
    return value == null ? null : { value };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
  },
  async delete(key) {
    localStorage.removeItem(key);
  },
};

// ---------------------------------------------------------------------------
// Land session — a land is the login unit (no separate usernames). Registering
// a land mints a Land ID; the farmer signs in with (Land ID + password) and we
// keep the returned token so every land-scoped request only sees its own data.
// ---------------------------------------------------------------------------
const SESSION_KEY = "npk-session"; // { land_id, token, field }

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
  catch { return null; }
}
function saveSession(s) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

// Land IDs used on this device, so the home page can offer quick-login shortcuts
// (the password is still required — we only remember the id + a friendly name).
const REMEMBERED_KEY = "npk-remembered-lands";
function loadRemembered() {
  try { return JSON.parse(localStorage.getItem(REMEMBERED_KEY) || "[]"); }
  catch { return []; }
}
function rememberLand(land_id, name) {
  const list = loadRemembered().filter((l) => l.land_id !== land_id);
  list.unshift({ land_id, name });
  localStorage.setItem(REMEMBERED_KEY, JSON.stringify(list.slice(0, 12)));
}
function forgetLand(land_id) {
  localStorage.setItem(REMEMBERED_KEY,
    JSON.stringify(loadRemembered().filter((l) => l.land_id !== land_id)));
}

// fetch() that carries the land session token so the backend scopes the request.
function landFetch(token, path, opts = {}) {
  return fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Land-Token": token || "", ...(opts.headers || {}) },
  });
}

// Sri Lanka's 25 administrative districts — the region a land is registered
// under, so fertilizer demand + soil health can be rolled up nationally by
// district. lat/lng are approximate district centres, used to place markers on
// the soil-health heatmap.
const SL_DISTRICTS = [
  { en: "Colombo", si: "කොළඹ", lat: 6.86, lng: 79.90 }, { en: "Gampaha", si: "ගම්පහ", lat: 7.09, lng: 80.01 }, { en: "Kalutara", si: "කළුතර", lat: 6.58, lng: 80.05 },
  { en: "Kandy", si: "මහනුවර", lat: 7.29, lng: 80.64 }, { en: "Matale", si: "මාතලේ", lat: 7.47, lng: 80.62 }, { en: "Nuwara Eliya", si: "නුවරඑළිය", lat: 6.97, lng: 80.77 },
  { en: "Galle", si: "ගාල්ල", lat: 6.05, lng: 80.22 }, { en: "Matara", si: "මාතර", lat: 5.95, lng: 80.54 }, { en: "Hambantota", si: "හම්බන්තොට", lat: 6.14, lng: 81.12 },
  { en: "Jaffna", si: "යාපනය", lat: 9.66, lng: 80.02 }, { en: "Kilinochchi", si: "කිලිනොච්චිය", lat: 9.40, lng: 80.40 }, { en: "Mannar", si: "මන්නාරම", lat: 8.98, lng: 79.90 },
  { en: "Vavuniya", si: "වවුනියාව", lat: 8.75, lng: 80.50 }, { en: "Mullaitivu", si: "මුලතිව්", lat: 9.27, lng: 80.81 }, { en: "Batticaloa", si: "මඩකලපුව", lat: 7.72, lng: 81.70 },
  { en: "Ampara", si: "අම්පාර", lat: 7.29, lng: 81.68 }, { en: "Trincomalee", si: "ත්‍රිකුණාමලය", lat: 8.57, lng: 81.23 }, { en: "Kurunegala", si: "කුරුණෑගල", lat: 7.49, lng: 80.36 },
  { en: "Puttalam", si: "පුත්තලම", lat: 8.03, lng: 79.83 }, { en: "Anuradhapura", si: "අනුරාධපුර", lat: 8.31, lng: 80.40 }, { en: "Polonnaruwa", si: "පොළොන්නරුව", lat: 7.94, lng: 81.00 },
  { en: "Badulla", si: "බදුල්ල", lat: 6.99, lng: 81.06 }, { en: "Monaragala", si: "මොනරාගල", lat: 6.87, lng: 81.35 }, { en: "Ratnapura", si: "රත්නපුර", lat: 6.68, lng: 80.40 },
  { en: "Kegalle", si: "කෑගල්ල", lat: 7.25, lng: 80.35 },
];
const DISTRICT_BY_EN = Object.fromEntries(SL_DISTRICTS.map((d) => [d.en, d]));

// Crop data compiled from the Sri Lanka Department of Agriculture (HORDI crop
// pages, doa.gov.lk/hordi-crops) and the Department of Export Agriculture
// (dea.gov.lk/crops). `ph` ranges and the `fert` programme (Urea / TSP / MOP in
// kg/ha, basal + top dressings) are the official DOA/DEA recommendations.
// `n`/`p`/`k` are general soil sufficiency ranges (mg/kg) for the RS485 sensor —
// the DOA publishes fertiliser rates, not soil-test target values, so treat
// these as guidance. `organic` = recommended organic matter (t/ha).
const CROPS = {
  tomato: {
    name: { si: "තක්කාලි", en: "Tomato" }, n: [100, 200], p: [25, 50], k: [150, 300], ph: [5.5, 7.5], moisture: [50, 75], organic: 10, src: "DOA/HORDI",
    fert: [
      { si: "මූලික (රෝපණයට දින 1-2 පෙර)", en: "Basal (1-2 days before planting)", urea: 65, tsp: 325, mop: 65 },
      { si: "1වන ඉහළ පෝෂණය (සති 3)", en: "1st top dressing (3 weeks)", urea: 65, tsp: null, mop: null },
      { si: "2වන ඉහළ පෝෂණය (සති 6)", en: "2nd top dressing (6 weeks)", urea: 65, tsp: null, mop: 65 },
    ],
  },
  brinjal: {
    name: { si: "වම්බටු", en: "Brinjal" }, n: [100, 180], p: [25, 45], k: [150, 280], ph: [5.5, 5.8], moisture: [55, 75], organic: 10, src: "DOA/HORDI",
    fert: [
      { si: "මූලික", en: "Basal", urea: 75, tsp: 325, mop: 85 },
      { si: "සති 4 පසු", en: "After 4 weeks", urea: 75, tsp: null, mop: null },
      { si: "සති 8 පසු", en: "After 8 weeks", urea: 75, tsp: null, mop: 85 },
    ],
  },
  okra: {
    name: { si: "බණ්ඩක්කා", en: "Okra" }, n: [80, 160], p: [20, 40], k: [120, 220], ph: [6.0, 7.0], moisture: [50, 70], organic: 10, src: "DOA/HORDI",
    fert: [
      { si: "මූලික (රෝපණයට දින 2-3 පෙර)", en: "Basal (2-3 days before planting)", urea: 50, tsp: 195, mop: 25 },
      { si: "ඉහළ පෝෂණය (සති 2)", en: "Top dressing (2 weeks)", urea: 50, tsp: null, mop: 25 },
      { si: "ඉහළ පෝෂණය (සති 5)", en: "Top dressing (5 weeks)", urea: 100, tsp: null, mop: 50 },
      { si: "ඉහළ පෝෂණය (සති 8)", en: "Top dressing (8 weeks)", urea: 100, tsp: null, mop: 50 },
    ],
  },
  capsicum: {
    name: { si: "මාළු මිරිස්", en: "Capsicum" }, n: [90, 180], p: [25, 45], k: [130, 250], ph: [5.5, 6.8], moisture: [55, 75], organic: 10, src: "DOA/HORDI",
    fert: [
      { si: "මූලික", en: "Basal", urea: 100, tsp: 215, mop: 65 },
      { si: "මාස 1 පසු", en: "1 month after planting", urea: 100, tsp: null, mop: 65 },
      { si: "මාස 2 පසු", en: "2 months after planting", urea: 100, tsp: null, mop: 65 },
    ],
  },
  cabbage: {
    name: { si: "ගෝවා", en: "Cabbage" }, n: [120, 220], p: [30, 55], k: [150, 280], ph: [6.0, 6.5], moisture: [55, 75], organic: 10, src: "DOA/HORDI",
    fert: [
      { si: "මූලික", en: "Basal", urea: 110, tsp: 270, mop: 75 },
      { si: "සති 3 පසු", en: "After 3 weeks", urea: 110, tsp: null, mop: 75 },
      { si: "සති 6 පසු", en: "After 6 weeks", urea: 110, tsp: null, mop: 75 },
    ],
  },
  carrot: {
    name: { si: "කැරට්", en: "Carrot" }, n: [80, 150], p: [20, 45], k: [150, 280], ph: [5.5, 6.5], moisture: [50, 70], organic: 10, src: "DOA/HORDI",
    fert: [
      { si: "මූලික", en: "Basal", urea: null, tsp: 270, mop: null },
      { si: "සති 3", en: "3 weeks", urea: 55, tsp: null, mop: 43 },
      { si: "සති 6", en: "6 weeks", urea: 82.5, tsp: null, mop: 63.5 },
      { si: "සති 8", en: "8 weeks", urea: 82.5, tsp: null, mop: 63.5 },
      { si: "සති 9", en: "9 weeks", urea: 110, tsp: null, mop: 85 },
    ],
  },
  beans: {
    name: { si: "බෝංචි", en: "Beans (Bush)" }, n: [60, 130], p: [20, 45], k: [110, 220], ph: [5.5, 6.5], moisture: [45, 70], organic: 0, src: "DOA/HORDI",
    fert: [
      { si: "මූලික", en: "Basal", urea: 85, tsp: 165, mop: 65 },
      { si: "ඉහළ පෝෂණය (සති 3)", en: "Top dressing (3 weeks)", urea: 85, tsp: null, mop: 65 },
    ],
  },
  potato: {
    name: { si: "අර්තාපල්", en: "Potato" }, n: [110, 200], p: [30, 55], k: [180, 320], ph: [5.5, 6.6], moisture: [55, 75], organic: 10, src: "DOA/HORDI",
    fert: [
      { si: "මූලික", en: "Basal", urea: 55, tsp: 270, mop: 125 },
      { si: "ඉහළ පෝෂණය (සති 2)", en: "Top dressing (2 weeks)", urea: 110, tsp: null, mop: null },
      { si: "ඉහළ පෝෂණය (සති 3-4)", en: "Top dressing (3-4 weeks)", urea: 165, tsp: null, mop: 125 },
    ],
  },
  cucumber: {
    name: { si: "පිපිඤ්ඤා", en: "Cucumber" }, n: [90, 170], p: [25, 45], k: [130, 250], ph: [5.5, 7.5], moisture: [55, 75], organic: 0, src: "DOA/HORDI",
    fert: [
      { si: "මූලික", en: "Basal", urea: 75, tsp: 200, mop: 60 },
      { si: "සති 4 පසු", en: "After 4 weeks", urea: 75, tsp: null, mop: 60 },
      { si: "සති 5 පසු", en: "After 5 weeks", urea: 75, tsp: null, mop: 60 },
    ],
  },
  pumpkin: {
    name: { si: "වට්ටක්කා", en: "Pumpkin" }, n: [100, 190], p: [25, 50], k: [150, 280], ph: [5.5, 7.5], moisture: [50, 70], organic: 0, src: "DOA/HORDI",
    fert: [
      { si: "මූලික", en: "Basal", urea: 220, tsp: 380, mop: 125 },
      { si: "ඉහළ පෝෂණය (සති 4 සහ 8)", en: "Top dressing (4 & 8 weeks)", urea: 45, tsp: null, mop: 25 },
    ],
  },
  radish: {
    name: { si: "රාබු", en: "Radish" }, n: [80, 150], p: [20, 45], k: [120, 240], ph: [6.0, 7.5], moisture: [50, 70], organic: 0, src: "DOA/HORDI",
    fert: [
      { si: "මූලික", en: "Basal", urea: 125, tsp: 200, mop: 75 },
      { si: "ඉහළ පෝෂණය (සති 3)", en: "Top dressing (3 weeks)", urea: 125, tsp: null, mop: 75 },
    ],
  },
  bitterGourd: {
    name: { si: "කරවිල", en: "Bitter Gourd" }, n: [80, 160], p: [20, 45], k: [130, 250], ph: [5.5, 7.5], moisture: [50, 75], organic: 10, src: "DOA/HORDI",
    fert: [
      { si: "මූලික", en: "Basal", urea: 75, tsp: 200, mop: 60 },
      { si: "සති 4 පසු", en: "After 4 weeks", urea: 75, tsp: null, mop: 60 },
      { si: "සති 8 පසු", en: "After 8 weeks", urea: 75, tsp: null, mop: 60 },
    ],
  },
  snakeGourd: {
    name: { si: "පතෝල", en: "Snake Gourd" }, n: [80, 160], p: [20, 45], k: [130, 250], ph: [5.5, 7.5], moisture: [50, 75], organic: 10, src: "DOA/HORDI",
    fert: [
      { si: "මූලික", en: "Basal", urea: 75, tsp: 200, mop: 60 },
      { si: "සති 4 පසු", en: "After 4 weeks", urea: 75, tsp: null, mop: 60 },
      { si: "සති 8 පසු", en: "After 8 weeks", urea: 75, tsp: null, mop: 60 },
    ],
  },
  beetroot: {
    name: { si: "බීට්රූට්", en: "Beetroot" }, n: [100, 190], p: [30, 55], k: [150, 300], ph: [6.3, 7.3], moisture: [50, 70], organic: 10, src: "DOA/HORDI",
    fert: [
      { si: "මූලික", en: "Basal", urea: 165, tsp: 270, mop: 125 },
      { si: "ඉහළ පෝෂණය (සති 3)", en: "Top dressing (3 weeks)", urea: 165, tsp: null, mop: 125 },
    ],
  },
  leeks: {
    name: { si: "ලීක්ස්", en: "Leeks" }, n: [90, 170], p: [30, 55], k: [120, 240], ph: [5.0, 6.0], moisture: [55, 75], organic: 10, src: "DOA/HORDI",
    fert: [
      { si: "මූලික", en: "Basal", urea: 85, tsp: 270, mop: 50 },
      { si: "ඉහළ පෝෂණය (මාස 1 සහ 3)", en: "Top dressing (1 & 3 months)", urea: 85, tsp: null, mop: null },
      { si: "ඉහළ පෝෂණය (මාස 2 සහ 4)", en: "Top dressing (2 & 4 months)", urea: 85, tsp: null, mop: 50 },
    ],
  },
  cauliflower: {
    name: { si: "මල්ගෝවා", en: "Cauliflower" }, n: [110, 210], p: [30, 55], k: [150, 280], ph: [6.0, 6.8], moisture: [55, 75], organic: 10, src: "DOA/HORDI",
    fert: [
      { si: "මූලික", en: "Basal", urea: 110, tsp: 270, mop: 75 },
      { si: "ඉහළ පෝෂණය (සති 3)", en: "Top dressing (3 weeks)", urea: 110, tsp: null, mop: null },
      { si: "ඉහළ පෝෂණය (සති 6)", en: "Top dressing (6 weeks)", urea: 110, tsp: null, mop: 75 },
    ],
  },
  yardLongBean: {
    name: { si: "මෑ කරල්", en: "Yard Long Bean" }, n: [60, 130], p: [20, 45], k: [110, 220], ph: [5.6, 7.0], moisture: [45, 70], organic: 10, src: "DOA/HORDI",
    fert: [
      { si: "මූලික (රෝපණයට දින 2 පෙර)", en: "Basal (2 days before planting)", urea: 35, tsp: 130, mop: 35 },
      { si: "ඉහළ පෝෂණය (මාස 1 පසු)", en: "Top dressing (after 1 month)", urea: 55, tsp: null, mop: 35 },
    ],
  },
  ginger: {
    name: { si: "ඉඟුරු", en: "Ginger" }, cat: "spice", n: [80, 160], p: [25, 50], k: [130, 260], ph: [5.5, 6.5], moisture: [55, 80], organic: 20, src: "DEA",
    climate: { si: "උස: 1500m දක්වා · වර්ෂාපතනය: 1500mm හෝ වැඩි", en: "Elevation: up to 1500m · Rainfall: 1500mm or more" },
    fert: [
      { si: "මූලික (රෝපණයේදී)", en: "Basal (at planting)", urea: null, tsp: 100, mop: null },
      { si: "1වන යෙදුම (මාස 1 පසු)", en: "1st application (after 1 month)", urea: 82, tsp: null, mop: 42 },
      { si: "2වන යෙදුම (මාස 3 පසු)", en: "2nd application (after 3 months)", urea: 82, tsp: null, mop: 42 },
    ],
    fertNotes: [
      { si: "Ca හා Mg සඳහා ඉවුම් කිරීමෙන් පසු ඩොලමයිට් 2 mt/ha පසට මිශ්‍ර කරන්න.", en: "Mix dolomite at 2 mt/ha into the soil after ploughing to supply Ca & Mg." },
    ],
  },
  turmeric: {
    name: { si: "කහ", en: "Turmeric" }, cat: "spice", n: [80, 160], p: [25, 50], k: [130, 260], ph: [5.5, 6.5], moisture: [55, 80], organic: 20, src: "DEA",
    climate: { si: "උස: 1500m දක්වා · වර්ෂාපතනය: 1500mm+ · උෂ්ණත්වය: 20-35°C · මධ්‍යම සෙවණ", en: "Elevation: up to 1500m · Rainfall: 1500mm+ · Temp: 20-35°C · medium shade" },
    fert: [
      { si: "මූලික (රෝපණයේදී)", en: "Basal (at planting)", urea: null, tsp: 100, mop: null },
      { si: "1වන යෙදුම (මාස 1 පසු)", en: "1st application (after 1 month)", urea: 65, tsp: null, mop: 100 },
      { si: "2වන යෙදුම (මාස 3 පසු)", en: "2nd application (after 3 months)", urea: 65, tsp: null, mop: 100 },
    ],
  },
  pepper: {
    name: { si: "ගම්මිරිස්", en: "Pepper (Black)" }, cat: "spice", n: [60, 150], p: [15, 40], k: [100, 220], ph: [5.5, 6.5], moisture: [60, 85], organic: 0, src: "DEA",
    climate: { si: "උස: මුහුදු මට්ටමේ සිට 800m · වර්ෂාපතනය: 1750mm ට වැඩි · උෂ්ණත්වය: 20-30°C", en: "Elevation: sea level–800m · Rainfall: >1750mm · Temp: 20-30°C" },
    fertNotes: [
      { si: "පොහොර මිශ්‍රණය (බර අනුව): Urea 4 : Rock phosphate 5 : MOP 3 : Kieserite 1 → 14% N, 11% P2O5, 14% K2O, 2% MgO", en: "Fertilizer mix (by weight): Urea 4 : Rock phosphate 5 : MOP 3 : Kieserite 1 → 14% N, 11% P2O5, 14% K2O, 2% MgO" },
      { si: "වගා වයස අනුව මිශ්‍රණය (මහ + යල, kg/ha): 1වන වර්ෂය 250+250 · 2වන 500+500 · 3වන සිට 700+700", en: "Mixture by age (Maha + Yala, kg/ha): Year 1 250+250 · Year 2 500+500 · Year 3+ 700+700" },
      { si: "වාර්ෂික මිශ්‍රණය 2380 kg/ha; Gliricidia කොළ 10kg/වැල/වර්ෂය යෙදුවොත් 1190 kg/ha දක්වා (රසායනික 50% අඩු).", en: "Annual mix 2380 kg/ha; with Gliricidia lopping 10kg/vine/yr it drops to 1190 kg/ha (50% less chemical fertilizer)." },
    ],
  },
  cinnamon: {
    name: { si: "කුරුඳු", en: "Cinnamon" }, cat: "spice", n: [50, 140], p: [15, 35], k: [100, 200], ph: [4.5, 6.5], moisture: [60, 85], organic: 0, src: "DEA",
    climate: { si: "උස: 500m දක්වා · වර්ෂාපතනය: 1750-3500mm", en: "Elevation: up to 500m · Rainfall: 1750–3500mm" },
    fertNotes: [
      { si: "පොහොර මිශ්‍රණය (බර අනුව): Urea 2 : Rock phosphate 1 : MOP 1 → 23% N, 7% P2O5, 15% K2O", en: "Fertilizer mix (by weight): Urea 2 : Rock phosphate 1 : MOP 1 → 23% N, 7% P2O5, 15% K2O" },
      { si: "වගා වයස අනුව මිශ්‍රණය (මහ + යල, kg/ha): 1වන වර්ෂය (මාස 6) 150+150 · 2වන 300+300 · 3වන සිට 450+450 (වාර්ෂික 900 kg/ha)", en: "Mixture by age (Maha + Yala, kg/ha): Year 1 (6 months) 150+150 · Year 2 300+300 · Year 3+ 450+450 (900 kg/ha/yr)" },
      { si: "pH 4.5ට අඩු පසෙහි ඩොලමයිට් 500-1000 kg/ha/වර්ෂය යොදන්න.", en: "Where soil pH < 4.5, apply dolomite 500–1000 kg/ha/year." },
    ],
  },
};

// Short month labels for the planting calendar.
const MONTH_NAMES = {
  si: ["ජන", "පෙබ", "මාර්", "අප්‍රේ", "මැයි", "ජූනි", "ජූලි", "අගෝ", "සැප්", "ඔක්", "නොවැ", "දෙසැ"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

// Sri Lanka has two cultivation seasons: Maha (Sep–Mar, main season, NE-monsoon
// rains) and Yala (Apr–Aug, minor season, SW-monsoon). For each crop: which
// season(s) it's grown in, the best months to plant, days to first harvest, and
// one practical growing tip. Compiled from DOA/HORDI & DEA crop calendars —
// general guidance only (micro-climate and elevation shift dates a few weeks).
const CROP_SEASON = {
  tomato:       { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [65, 90], tips: { si: "පැළ 60×45cm පරතරයෙන් සිටුවා කණු බැඳ ආධාරක දෙන්න; දිලීර රෝග අඩු කරන්නට වතුර මුල් අසලට දෙන්න, කොළවලට නොවේ.", en: "Transplant at 60×45cm and stake the plants; water at the base (not the leaves) to reduce blight and fruit rot." } },
  brinjal:      { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [70, 90], tips: { si: "90×60cm පරතරය තබා පහළ අතු ඉවත් කරන්න; දළඹු (shoot & fruit borer) සඳහා නිතර පරීක්ෂා කරන්න.", en: "Space at 90×60cm and remove low side-shoots; scout regularly for shoot & fruit borer." } },
  okra:         { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [45, 60], tips: { si: "45×30cm පරතරයෙන් බීජ වපුරන්න; ගෙඩි ළපටිව දින 2-3කට වරක් නෙළන්න — එවිට පැළය දිගටම ගෙඩි දරයි.", en: "Sow at 45×30cm and pick pods young every 2–3 days to keep the plant producing." } },
  capsicum:     { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [75, 95], tips: { si: "45cm පරතරය තබා පසෙහි තෙතමනය රැකගන්නට වසුන් (mulch) දමන්න; මල් හටගන්නා විට ස්ථිර ලෙස වතුර දෙන්න.", en: "Space at 45cm and mulch to hold moisture; give steady water during flowering." } },
  cabbage:      { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [75, 100], tips: { si: "සිසිල් දේශගුණය/උඩරට සුදුසුයි; 45×45cm තබා පස මතට ගොඩ කර, තද ගෝවා මල් සඳහා ඒකාකාරව තෙත් කරන්න.", en: "Best in the cool up-country; plant 45×45cm, earth up, and keep evenly moist for firm heads." } },
  carrot:       { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [90, 110], tips: { si: "ලිහිල්, ගැඹුරු වැලි සහිත පසක් තෝරන්න; පැළ 5cm පරතරයට තනුක කරන්න; අලුත් ගොම යෙදීමෙන් මුල් දෙබෑ වේ.", en: "Use loose, deep sandy soil; thin seedlings to 5cm; avoid fresh manure (it forks the roots)." } },
  beans:        { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [45, 60], tips: { si: "30×10cm පරතරයෙන් කෙළින්ම වපුරන්න; කෙටි කණු දෙන්න; වැඩිපුර වතුර මුල් කුණුවීමට හේතු වේ.", en: "Sow direct at 30×10cm, give short stakes, and don't overwater (causes root rot)." } },
  potato:       { seasons: ["maha", "yala"], plantMonths: [2, 3, 8, 9], durationDays: [90, 110], tips: { si: "උඩරට සුදුසුයි; පැළ නැඟුණු බීජ අල සිටුවන්න; අල හරිත වීම වැළැක්වීමට දෙවරක් පස ගොඩ කරන්න.", en: "Up-country crop; plant sprouted seed tubers and earth up twice to stop the tubers greening." } },
  cucumber:     { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [40, 55], tips: { si: "වැල් ට්‍රෙලිසයකට නංවන්න; පස තෙත්ව තබන්න; ගෙඩි ළපටිව නිතර නෙළන්න.", en: "Train the vines on a trellis, keep the soil moist, and pick fruit young and often." } },
  pumpkin:      { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [90, 120], tips: { si: "ඉඩ වැඩිපුර ඕනෑ (2m); වැසි කාලයේ ගෙඩි හටගැනීම වැඩි කරන්නට අතින් පරාගණය කරන්න.", en: "Needs space (2m spacing); hand-pollinate in wet weather to improve fruit set." } },
  radish:       { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [30, 45], tips: { si: "ඉක්මන් බෝගයකි; ලිහිල් පසක් තබා සති 4-6කින් — මුල් දැඩි වීමට පෙර — නෙළන්න.", en: "A fast crop; use loose soil and harvest in 4–6 weeks before roots turn woody." } },
  bitterGourd:  { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [55, 70], tips: { si: "ට්‍රෙලිසයට නංවා උදෑසන අතින් පරාගණය කරන්න; ගෙඩි ළපටිව නෙළන්න.", en: "Trellis the vines, hand-pollinate in the morning, and harvest fruit while tender." } },
  snakeGourd:   { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [60, 75], tips: { si: "උඩින් ට්‍රෙලිසයක් දමා ගෙඩි කෙළින් එල්ලෙන්නට සලස්වන්න; සවස අතින් පරාගණය කරන්න.", en: "Use an overhead trellis so the fruit hangs straight; hand-pollinate in the evening." } },
  beetroot:     { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [60, 90], tips: { si: "පැළ 8cm පරතරයට තනුක කරන්න; වටකුරු මුල් සඳහා ඒකාකාරව තෙත් කරන්න.", en: "Thin seedlings to 8cm and keep evenly moist for smooth round roots." } },
  leeks:        { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [100, 130], tips: { si: "උඩරට සුදුසුයි; සුදු කඳ දිගු කරන්නට පස ගොඩ කරන්න; දිගු බෝගයක් නිසා වල් නැති කරගෙන යන්න.", en: "Up-country crop; earth up to blanch the white stems and keep it weed-free (long season)." } },
  cauliflower:  { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [75, 95], tips: { si: "සිසිල් දේශගුණය සුදුසුයි; මල (curd) සුදුව තබන්නට පිටත කොළ ඒ මතට බැඳ, ස්ථිර ලෙස වතුර දෙන්න.", en: "Needs a cool climate; tie outer leaves over the curd to keep it white and water steadily." } },
  yardLongBean: { seasons: ["maha", "yala"], plantMonths: [3, 4, 9, 10], durationDays: [45, 65], tips: { si: "ට්‍රෙලිසයට නංවන්න; කරල් ළපටිව දින 2-3කට වරක් නෙළන්න; රනිල බෝගයක් නිසා නයිට්‍රජන් අඩුවෙන් යොදන්න.", en: "Trellis the vines; pick pods young every 2–3 days; being a legume it needs little nitrogen." } },
  ginger:       { seasons: ["maha", "yala"], plantMonths: [4, 5, 9, 10], durationDays: [210, 270], tips: { si: "ගොඩ කළ පාත්තිවල අල කැබලි සිටුවන්න; සෙවණ හා හොඳ ජලවහනය අවශ්‍යයි; වසුන් ඝනව දමන්න.", en: "Plant rhizome pieces on raised beds; it needs shade and good drainage — mulch heavily." } },
  turmeric:     { seasons: ["maha", "yala"], plantMonths: [4, 5, 9, 10], durationDays: [240, 300], tips: { si: "ගොඩ කළ පාත්තිවල අල කැබලි 20-30cm පරතරයෙන් සිටුවන්න; කොළ මැලවෙන විට (මාස ~9) අස්වනු ගන්න.", en: "Plant rhizome bits 20–30cm apart on raised beds; harvest when the leaves dry down (~9 months)." } },
  pepper:       { seasons: ["perennial"], plantMonths: null, durationDays: null, tips: { si: "ජීවමාන ආධාරකයක් (Gliricidia) මත නංවන බහුවාර්ෂික වැලකි; මුල අවට වසුන් දමන්න; සැබෑ අස්වැන්න ~3වන වර්ෂයේ.", en: "A perennial vine grown up a live support (Gliricidia); mulch the base — real yield comes around year 3." } },
  cinnamon:     { seasons: ["perennial"], plantMonths: null, durationDays: null, tips: { si: "බහුවාර්ෂිකයි; වසර 2-3කින් පොතු සඳහා කප්පාදු කරන්න; තෙත් පහත්රට වැලි පසට ගැළපේ.", en: "Perennial; coppice at 2–3 years for the bark; suits wet low-country sandy soils." } },
};

// Which planting month applies now? Returns {now:true} if the current calendar
// month is a recommended one, else the next upcoming planting month (1-12).
function plantingWindow(months) {
  if (!months || !months.length) return null;
  const m = new Date().getMonth() + 1;
  if (months.includes(m)) return { now: true, next: m };
  const sorted = [...months].sort((a, b) => a - b);
  const next = sorted.find((x) => x > m) ?? sorted[0];
  return { now: false, next };
}

const FERTILIZERS = {
  n: {
    low: { si: "යූරියා (Urea) හෝ කාබනික කොම්පෝස්ට්", en: "Apply Urea or organic compost" },
    high: { si: "නයිට්‍රජන් යෙදීම අත්හිටුවන්න", en: "Stop applying nitrogen fertilizer" },
  },
  p: {
    low: { si: "TSP (Triple Super Phosphate) හෝ රොක් පොස්පේට්", en: "Apply TSP or rock phosphate" },
    high: { si: "පොස්පේට් පොහොර යෙදීම අත්හිටුවන්න", en: "Stop applying phosphate fertilizer" },
  },
  k: {
    low: { si: "MOP (Muriate of Potash) හෝ සල්ෆේට් ඔෆ් පොටෑෂ්", en: "Apply MOP or sulphate of potash" },
    high: { si: "පොටෑසියම් පොහොර යෙදීම අත්හිටුවන්න", en: "Stop applying potassium fertilizer" },
  },
};

// One-line, farmer-plain headline per nutrient/direction — short imperative
// sentences ("Nitrogen is low — apply Urea") rather than raw mg/kg numbers.
const REC_HEADLINE = {
  n: {
    low: { si: "නයිට්‍රජන් (N) අඩුයි — යූරියා යෙදීම අවශ්‍යයි", en: "Nitrogen (N) is low — apply Urea" },
    high: { si: "නයිට්‍රජන් (N) වැඩියි — නයිට්‍රජන් පොහොර යෙදීම නවත්වන්න", en: "Nitrogen (N) is high — stop applying nitrogen fertilizer" },
  },
  p: {
    low: { si: "පොස්පරස් (P) අඩුයි — TSP යෙදීම අවශ්‍යයි", en: "Phosphorus (P) is low — apply TSP" },
    high: { si: "පොස්පරස් (P) වැඩියි — පොස්පේට් පොහොර යෙදීම නවත්වන්න", en: "Phosphorus (P) is high — stop applying phosphate fertilizer" },
  },
  k: {
    low: { si: "පොටෑසියම් (K) අඩුයි — MOP යෙදීම අවශ්‍යයි", en: "Potassium (K) is low — apply MOP" },
    high: { si: "පොටෑසියම් (K) වැඩියි — පොටෑසියම් පොහොර යෙදීම නවත්වන්න", en: "Potassium (K) is high — stop applying potassium fertilizer" },
  },
};

// Which DOA fertiliser column (from CROPS[x].fert rows) covers a deficient
// nutrient, and the plain label to show it under (matches FertilizerProgram's
// existing untranslated Urea/TSP/MOP column headers).
const FERT_KEY_FOR = { n: "urea", p: "tsp", k: "mop" };
const FERT_LABEL = { urea: "Urea", tsp: "TSP", mop: "MOP" };
const ACRES_PER_HA = 2.47105;

// Turns the crop's DOA kg/ha programme into a farmer-facing per-acre plan for
// one fertiliser: how much per acre at each stage, plus a running total. Real
// numbers straight from CROPS.fert — just unit-converted, nothing invented.
function fertPerAcrePlan(crop, fertKey) {
  if (!crop.fert) return null;
  const stages = crop.fert
    .filter((row) => row[fertKey] != null)
    .map((row) => ({ stage: row, perAcre: +(row[fertKey] / ACRES_PER_HA).toFixed(1) }));
  if (stages.length === 0) return null;
  const totalPerAcre = +stages.reduce((sum, s) => sum + s.perAcre, 0).toFixed(1);
  return { stages, totalPerAcre };
}

const T = {
  title: { si: "පස් පෝෂක නිරීක්ෂණ පද්ධතිය", en: "Soil Nutrient Monitoring System" },
  // National / staff portal (role-based access)
  officerPortal: { si: "නිලධාරී / රාජ්‍ය පිවිසුම", en: "Officer / Government portal" },
  natTitle: { si: "ජාතික පස් තොරතුරු පුවරුව", en: "National Soil Dashboard" },
  natSubtitle: { si: "ප්‍රදේශ අනුව පස් සෞඛ්‍යය සහ පොහොර ඉල්ලුම", en: "Regional soil health & fertilizer demand" },
  staffLoginTitle: { si: "නිලධාරී පිවිසුම", en: "Officer sign in" },
  staffUser: { si: "පරිශීලක නාමය", en: "Username" },
  staffPass: { si: "මුරපදය", en: "Password" },
  staffLoginBtn: { si: "පිවිසෙන්න", en: "Sign in" },
  staffLoginErr: { si: "පරිශීලක නාමය හෝ මුරපදය වැරදියි", en: "Wrong username or password" },
  staffRole: { si: "භූමිකාව", en: "Role" },
  natHealthTitle: { si: "දිස්ත්‍රික්ක අනුව පස් සෞඛ්‍යය", en: "Soil Health by District" },
  natMapTitle: { si: "පස් සෞඛ්‍ය සිතියම", en: "Soil Health Map" },
  natHealthCol: { si: "සෞඛ්‍ය ලකුණ", en: "Health" },
  natNoData: { si: "තවම දත්ත නැත", en: "No data yet" },
  healthGood: { si: "හොඳයි", en: "Good" },
  healthFair: { si: "මධ්‍යම", en: "Fair" },
  healthPoor: { si: "දුර්වලයි", en: "Poor" },
  // Government portal — crops grown across the country
  natCropsTitle: { si: "රට පුරා වගා කරන බෝග", en: "Crops Grown Across the Country" },
  natCropsHint: { si: "ලියාපදිංචි ඉඩම්වල දැනට වගා කර ඇති බෝග", en: "What is currently being cultivated on registered lands" },
  natCropsEmpty: { si: "තවම බෝග දත්ත නැත", en: "No crop data yet" },
  natCropsLands: { si: "වගා ඉඩම්", en: "Cultivated lands" },
  natCropsDistinct: { si: "බෝග වර්ග", en: "Distinct crops" },
  natCropsAcres: { si: "මුළු අක්කර", en: "Total acres" },
  natCropsByRegion: { si: "දිස්ත්‍රික්ක අනුව බෝග", en: "Crops by district" },
  cropCol: { si: "බෝගය", en: "Crop" },
  cropLandsCol: { si: "ඉඩම්", en: "Lands" },
  cropAcresCol: { si: "අක්කර", en: "Acres" },
  cropShareCol: { si: "කොටස", en: "Share" },
  topCropCol: { si: "ප්‍රධාන බෝගය", en: "Top crop" },
  // Farmer dashboard — planting calendar & growing advice
  plantAdviceTitle: { si: "වගා දින දර්ශනය සහ වගා උපදෙස්", en: "Planting Calendar & Growing Advice" },
  plantAdviceHint: { si: "මෙම බෝගය වවන්නට සුදුසු කාලය සහ වගා ක්‍රමය", en: "The best time to plant this crop and how to grow it" },
  seasonMaha: { si: "මහ කන්නය (සැප්–මාර්)", en: "Maha season (Sep–Mar)" },
  seasonYala: { si: "යල කන්නය (අප්‍රේ–අගෝ)", en: "Yala season (Apr–Aug)" },
  seasonPerennial: { si: "බහුවාර්ෂික", en: "Perennial" },
  plantGoodNow: { si: "දැන් සිටුවීමට සුදුසුයි", en: "Good to plant now" },
  plantNextWindow: { si: "ඊළඟ කන්නය", en: "Next window" },
  plantWindow: { si: "සිටුවීමට සුදුසු මාස", en: "Best planting months" },
  plantPerennialNote: { si: "වර්ෂය පුරා (වැසි ඇරඹුමේදී වඩාත් සුදුසු)", en: "Year-round (best at the onset of rains)" },
  plantDuration: { si: "අස්වැන්නට කාලය", en: "Time to first harvest" },
  plantHarvest: { si: "දැන් සිටෙව්වොත් අස්වනු ලැබෙන කාලය", en: "If planted now, harvest around" },
  days: { si: "දින", en: "days" },
  growTips: { si: "වගා උපදෙස්", en: "Growing tips" },
  staffMgmtTitle: { si: "නිලධාරී ගිණුම් කළමනාකරණය", en: "Manage Staff Accounts" },
  staffAddBtn: { si: "නිලධාරියෙක් එක් කරන්න", en: "Add staff" },
  staffAdded: { si: "නිලධාරියා එක් විය ✓", en: "Staff added ✓" },
  staffFullName: { si: "සම්පූර්ණ නම", en: "Full name" },
  subtitle: { si: "IoT NPK සංවේදක දත්ත මත පදනම් වූ බෝග/පොහොර නිර්දේශ", en: "IoT NPK sensor-based crop & fertilizer recommendations" },
  modeLabel: { si: "ක්‍රමය:", en: "Mode:" },
  modeExisting: { si: "දැනට බෝගයක් තියෙනවා", en: "Existing Crop" },
  modeEmpty: { si: "හිස් ඉඩම", en: "Empty Land" },
  crop: { si: "බෝගය:", en: "Crop:" },
  scan: { si: "Scan කරන්න", en: "Scan" },
  manual: { si: "Manual Input", en: "Manual Input" },
  manualTitle: { si: "අගයන් අතින් යොදන්න", en: "Enter values manually" },
  apply: { si: "යොදන්න", en: "Apply" },
  n: { si: "නයිට්‍රජන් (N)", en: "Nitrogen (N)" },
  p: { si: "පොස්පරස් (P)", en: "Phosphorus (P)" },
  k: { si: "පොටෑසියම් (K)", en: "Potassium (K)" },
  ph: { si: "pH", en: "pH" },
  moisture: { si: "තෙතමනය", en: "Moisture" },
  required: { si: "අවශ්‍ය පරාසය:", en: "Required range:" },
  low: { si: "අඩුයි", en: "Low" },
  high: { si: "වැඩියි", en: "High" },
  ok: { si: "හරි", en: "Good" },
  recTitle: { si: "පොහොර නිර්දේශය", en: "Fertilizer Recommendation" },
  allGood: { si: "සියලුම පෝෂක මට්ටම් සුදුසු පරාසය තුළ තිබේ. දැනට අමතර පොහොර අවශ්‍ය නැත.", en: "All nutrient levels are within the suitable range. No additional fertilizer needed right now." },
  recommendation: { si: "නිර්දේශය:", en: "Recommendation:" },
  exactPlanTitle: { si: "නිශ්චිත ප්‍රමාණය සහ කාලසටහන", en: "Exact Quantity & Timing" },
  perAcreLabel: { si: "අක්කරයට", en: "per acre" },
  totalForLandLabel: { si: "ඔබේ ඉඩම සඳහා මුළු ප්‍රමාණය", en: "Total for your land" },
  printPlanBtn: { si: "පොහොර සැලැස්ම මුද්‍රණය කරන්න", en: "Print Fertilizer Plan" },
  downloadPdfBtn: { si: "PDF එකක් ලෙස බාගන්න", en: "Download PDF" },
  anomalyTitle: { si: "⚠️ Sensor දත්ත ගැටලුවක් විය හැක", en: "⚠️ Possible sensor problem" },
  anomalyStuck: { si: "Sensor එක එකම අගය නැවත නැවත දෙනවා (හිර වෙලා විය හැක). සම්බන්ධතා/වයර් පරීක්ෂා කරන්න.", en: "The sensor is repeating identical values (it may be stuck). Check the wiring/connection." },
  anomalySpike: { si: "හදිසි අසාමාන්‍ය පිම්මක් — RS485 link එක අස්ථාවර විය හැක (A/B වයර් මාරු කර බලන්න).", en: "A sudden abnormal spike — the RS485 link may be unstable (try swapping the A/B wires)." },
  anomalyRange: { si: "භෞතිකව නොහැකි අගයක්. Sensor එක/power පරීක්ෂා කරන්න.", en: "A physically impossible value. Check the sensor/power." },
  printPlanTitle: { si: "පොහොර යෙදීමේ සැලැස්ම", en: "Fertilizer Application Plan" },
  printLandLabel: { si: "ඉඩම", en: "Land" },
  printOwnerLabel: { si: "හිමිකරු", en: "Owner" },
  printCropLabel: { si: "බෝගය", en: "Crop" },
  printCurrentReadings: { si: "වර්තමාන පස් කියවීම", en: "Current Soil Reading" },
  printFertPlanHeader: { si: "පොහොර සැලැස්ම — ඔබේ ඉඩම සඳහා", en: "Fertilizer Plan — for your land" },
  printStageCol: { si: "අදියර", en: "Stage" },
  printSignature: { si: "උපදේශකගේ අත්සන", en: "Instructor's signature" },
  printGeneratedBy: { si: "සකස් කළේ", en: "Generated by" },
  phLowMsg: { si: "ඉතා අම්ලිකයි. හුණු (Lime) එක් කරන්න.", en: "Too acidic. Add agricultural lime." },
  phHighMsg: { si: "ඉතා ක්ෂාරීයයි. කාබනික ද්‍රව්‍ය හෝ සල්ෆර් එක් කරන්න.", en: "Too alkaline. Add organic matter or sulphur." },
  moistLowMsg: { si: "තෙතමනය අඩුයි. වැඩිපුර ජලය දෙන්න.", en: "Moisture is low. Increase irrigation." },
  moistHighMsg: { si: "තෙතමනය වැඩියි. ජලය දැමීම අඩු කරන්න / drainage පරීක්ෂා කරන්න.", en: "Moisture is high. Reduce watering / check drainage." },
  trendsTitle: { si: "පෝෂක ප්‍රවණතා (අවසන් කියවීම් 10)", en: "Nutrient Trends (last 10 readings)" },
  trendsEmpty: { si: "Scan කර දත්ත ප්‍රවණතාව බලන්න.", en: "Scan to see data trends." },
  footer: { si: "ⓘ Scan කළ විට ESP32 sensor දත්ත Django backend එකෙන් (/api/latest/) ලබාගනී. දත්ත සියල්ල සැබෑ device එකෙන් — demo දත්ත නැත.", en: "ⓘ On Scan, live ESP32 sensor data is fetched from the Django backend (/api/latest/). All data is real device data — no demo values." },
  suitabilityTitle: { si: "ඉඩමට ගැලපෙන බෝග (Scan දත්ත අනුව)", en: "Suitable Crops for This Land (based on scan)" },
  suitabilityHint: { si: "පහළ ලැයිස්තුවෙන් බෝගයක් තෝරාගන්න — එයට අවශ්‍ය පොහොර නිර්දේශය පහළින් පෙන්වයි", en: "Select a crop below — its fertilizer plan will show beneath" },
  bestMatch: { si: "හොඳම ගැලපීම", en: "Best Match" },
  suitability: { si: "ගැලපීම", en: "Suitability" },
  prepFertilizerTitle: { si: "තේරූ බෝගය සඳහා පස සකස් කිරීමේ පොහොර සැලැස්ම", en: "Soil Preparation Plan for Selected Crop" },
  sampleTitle: { si: "Scan සාම්පල (ස්ථාන 3කින් — සාමාන්‍යය ගණනය කරයි)", en: "Scan Samples (3 points — averages automatically)" },
  sampleHint: { si: "නිවැරදි ප්‍රතිඵලයක් සඳහා එකම ඉඩමේ විවිධ ස්ථාන 3කින් Scan කරන්න", en: "For accurate results, scan 3 different points of the same plot" },
  sampleLabel: { si: "සාම්පලය", en: "Sample" },
  resetSamples: { si: "ආරම්භයේ සිට", en: "Reset" },
  averageDone: { si: "සාම්පල 3ම ලැබුණා — සාමාන්‍යය ඉහළින් පෙන්වයි", en: "All 3 samples collected — average shown above" },
  landsTitle: { si: "ඉඩම් කළමනාකරණය", en: "Land Management" },
  landNamePlaceholder: { si: "ඉඩමේ නම (උදා: උතුරු කුඹුර)", en: "Land name (e.g. North Field)" },
  landDetailsPlaceholder: { si: "විස්තර (ස්ථානය, ප්‍රමාණය, සටහන්...)", en: "Details (location, size, notes...)" },
  saveNew: { si: "නව ඉඩමක් ලෙස සුරකින්න", en: "Save as New Land" },
  updateLand: { si: "මේ ඉඩමේ දත්ත Update කරන්න", en: "Update This Land" },
  savedLands: { si: "සුරැකි ඉඩම්", en: "Saved Lands" },
  noLands: { si: "තවම ඉඩම් සුරකලා නැහැ", en: "No lands saved yet" },
  load: { si: "Load", en: "Load" },
  delete: { si: "මකන්න", en: "Delete" },
  lastUpdated: { si: "අවසන් update:", en: "Last updated:" },
  editingNote: { si: "දැනට සංස්කරණය වෙන්නේ:", en: "Currently editing:" },
  savedMsg: { si: "සුරැකුණා! ✓", en: "Saved! ✓" },
  newLandBtn: { si: "+ අලුත් ඉඩමක්", en: "+ New Land" },
  appTagline: { si: "ඔබේ ඉඩම් සඳහා IoT පදනම් වූ පස් විශ්ලේෂණයෙන් නිවැරදි බෝග හා පොහොර තීරණ ගන්න", en: "Make accurate crop and fertilizer decisions for your land with IoT-based soil analysis" },
  existingCropCta: { si: "පවතින බෝගයකට පොහොර", en: "Fertilizer for Existing Crop" },
  existingCropCtaDesc: { si: "දැනටමත් වවන බෝගයකට අවශ්‍ය පෝෂක මට්ටම් පරීක්ෂා කර පොහොර නිර්දේශ ලබාගන්න", en: "Check nutrient levels for a crop you're already growing and get fertilizer recommendations" },
  newScanCta: { si: "හිස් ඉඩමකට බෝග නිර්දේශ", en: "Crop Suggestions for Empty Land" },
  newScanCtaDesc: { si: "පස Scan කර, ඔබේ ඉඩමට වඩාත් ගැලපෙන බෝග මොනවාද කියා සොයාගන්න", en: "Scan the soil to discover which crops suit your land best" },
  getStarted: { si: "ආරම්භ කරන්න", en: "Get Started" },
  yourLands: { si: "ඔබේ ඉඩම්", en: "Your Lands" },
  noLandsHome: { si: "ඔබ තවම කිසිම ඉඩමක් සුරැකලා නැහැ. ඉහළින් ආරම්භ කරන්න!", en: "You haven't saved any lands yet. Start above!" },

  // Land registration flow
  registerCta: { si: "නව ඉඩමක් ලියාපදිංචි කරන්න", en: "Register a New Land" },
  registerCtaDesc: { si: "ඉඩමේ නම, ස්ථානය සහ ප්‍රමාණය ඇතුළත් කර ලියාපදිංචි කරන්න — ඉන්පසු බෝග නිර්දේශ, වගා මාර්ගෝපදේශ සහ පොහොර වියදම් ලබාගන්න", en: "Enter the land's name, location and size to register it — then get crop suggestions, cultivation guides and fertilizer costs" },
  registerTitle: { si: "ඉඩම ලියාපදිංචි කිරීම", en: "Register Land" },
  registerSubtitle: { si: "ඉඩම පිළිබඳ තොරතුරු ඇතුළත් කරන්න. ප්‍රමාණය පොහොර වියදම් ගණනය සඳහා අවශ්‍යයි.", en: "Enter the land's details. Size is required to calculate fertilizer cost." },
  regNameLabel: { si: "ඉඩමේ නම *", en: "Land name *" },
  regLocationLabel: { si: "ස්ථානය / විස්තර", en: "Location / details" },
  regSizeLabel: { si: "ප්‍රමාණය (අක්කර) *", en: "Size (acres) *" },
  regOwnerLabel: { si: "ඉඩම් හිමියාගේ නම", en: "Land owner's name" },
  regOwnerPlaceholder: { si: "උදා: සුනිල් පෙරේරා", en: "e.g. Sunil Perera" },
  regContactLabel: { si: "දුරකථන අංකය", en: "Contact number" },
  regContactPlaceholder: { si: "උදා: 0771234567", en: "e.g. 0771234567" },
  regRegionLabel: { si: "දිස්ත්‍රික්කය", en: "District" },
  regRegionPlaceholder: { si: "දිස්ත්‍රික්කය තෝරන්න", en: "Select a district" },
  regModeLabel: { si: "ඔබට අවශ්‍ය කුමක්ද?", en: "What do you need?" },
  regModeEmpty: { si: "හිස් ඉඩම — බෝගයක් නිර්දේශ කරන්න", en: "Empty land — recommend a crop" },
  regModeExisting: { si: "දැනටමත් බෝගයක් තිබේ", en: "I already have a crop" },
  regExistingCropLabel: { si: "බෝගය තෝරන්න", en: "Select the crop" },
  registerBtn: { si: "ලියාපදිංචි කර ඉදිරියට", en: "Register & Continue" },
  registerCancel: { si: "අවලංගු කරන්න", en: "Cancel" },
  registeredBadge: { si: "ලියාපදිංචියි", en: "Registered" },
  landSizeLabel: { si: "ප්‍රමාණය", en: "Size" },
  acresUnit: { si: "අක්කර", en: "acres" },
  openLandBtn: { si: "විවෘත කරන්න", en: "Open" },
  landRecommendedCrop: { si: "නිර්දේශිත බෝගය", en: "Recommended crop" },

  // Land login / accounts (a land is the login unit)
  regPasswordLabel: { si: "මුරපදය * (ඉඩමට ඇතුළු වීමට)", en: "Password * (to sign in to this land)" },
  regPasswordPlaceholder: { si: "අවම අකුරු 4ක්", en: "At least 4 characters" },
  loginTitle: { si: "ඉඩමට ඇතුළු වන්න", en: "Sign in to your land" },
  loginSubtitle: { si: "ඔබේ Land ID එකයි මුරපදයයි දෙන්න", en: "Enter your Land ID and password" },
  loginIdLabel: { si: "Land ID", en: "Land ID" },
  loginIdPlaceholder: { si: "උදා: K7F9Q2", en: "e.g. K7F9Q2" },
  loginPwLabel: { si: "මුරපදය", en: "Password" },
  loginBtn: { si: "ඇතුළු වන්න", en: "Sign in" },
  loginCta: { si: "දැනටමත් ලියාපදිංචි ඉඩමක් තිබේද? ඇතුළු වන්න", en: "Already registered a land? Sign in" },
  loginError: { si: "Land ID හෝ මුරපදය වැරදියි", en: "Wrong Land ID or password" },
  logoutBtn: { si: "පිටවෙන්න", en: "Sign out" },
  switchLandBtn: { si: "වෙනත් ඉඩමක්", en: "Switch land" },
  landIdBadge: { si: "Land ID", en: "Land ID" },
  regSuccessTitle: { si: "ඉඩම ලියාපදිංචි විය! 🎉", en: "Land registered! 🎉" },
  regSuccessBody: { si: "මෙය ඔබේ Land ID එකයි. නැවත ඇතුළු වීමට මෙය සහ ඔබේ මුරපදය සුරකින්න.", en: "This is your Land ID. Save it with your password to sign in again." },
  regSuccessCopy: { si: "පිටපත් කරගන්න", en: "Copy" },
  regSuccessCopied: { si: "පිටපත් විය ✓", en: "Copied ✓" },
  regSuccessContinue: { si: "Dashboard එකට යන්න", en: "Go to dashboard" },
  rememberedLandsTitle: { si: "මෙම උපාංගයේ ඉඩම්", en: "Lands on this device" },
  quickLoginHint: { si: "ඇතුළු වීමට tap කර මුරපදය දෙන්න", en: "Tap to sign in (password required)" },
  forgetBtn: { si: "ඉවත් කරන්න", en: "Forget" },

  // Crop info repository
  cropInfoTitle: { si: "බෝගය පිළිබඳ විස්තර", en: "Crop Details" },
  cropInfoHint: { si: "මෙම බෝගය සඳහා පස් අවශ්‍යතා සහ වගා තොරතුරු", en: "Soil requirements and cultivation notes for this crop" },
  ciNutrientNeeds: { si: "පෝෂක අවශ්‍යතා (mg/kg)", en: "Nutrient needs (mg/kg)" },
  ciIdealPh: { si: "සුදුසු pH", en: "Ideal pH" },
  ciIdealMoisture: { si: "සුදුසු තෙතමනය", en: "Ideal moisture" },
  ciOrganic: { si: "කාබනික පොහොර", en: "Organic matter" },
  ciClimate: { si: "දේශගුණය", en: "Climate" },
  ciCategory: { si: "වර්ගය", en: "Category" },
  ciVegetable: { si: "එළවළු බෝගය", en: "Vegetable crop" },
  ciSpice: { si: "අපනයන / කුළුබඩු බෝගය", en: "Export / spice crop" },
  backHome: { si: "මුල් පිටුව", en: "Home" },
  createdOn: { si: "සාදන ලද්දේ:", en: "Created:" },
  openInDashboard: { si: "Dashboard එකේ නැවත Scan කරන්න", en: "Open in Dashboard to Scan" },
  snapshotTitle: { si: "අවසන් සුරැකි දත්ත", en: "Last Saved Snapshot" },
  noHistoryYet: { si: "තවම ඉතිහාසයක් සටහන් වී නැත", en: "No history recorded yet" },
  loadingDetails: { si: "Load වෙමින්...", en: "Loading..." },
  selectedCropLabel: { si: "තෝරාගත් බෝගය:", en: "Selected crop:" },
  viewDetails: { si: "විස්තර බලන්න", en: "View Details" },
  liveData: { si: "සජීවී (Sensor)", en: "Live (Sensor)" },
  scanning: { si: "Scan වෙමින්...", en: "Scanning..." },
  deviceChecking: { si: "Device පරීක්ෂා කරමින්...", en: "Checking device..." },
  deviceOnlineLabel: { si: "Device සම්බන්ධයි", en: "Device connected" },
  deviceOfflineLabel: { si: "Device සම්බන්ධ නැත", en: "Device not connected" },
  deviceOfflineHint: { si: "ESP32 device එක WiFi සම්බන්ධතාවය සහ Django server එක පරීක්ෂා කරන්න. Device එක සම්බන්ධ වූ පසු Scan button එක auto-enable වේ.", en: "Check the ESP32's WiFi connection and that the Django server is reachable. The Scan button re-enables automatically once the device is detected." },
  npkOnlyNote: { si: "ⓘ RS485 3-in-1 sensor එකෙන් N, P, K පමණයි මනින්නේ. pH සහ තෙතමනය Manual Input එකෙන් යොදන්න.", en: "ⓘ The RS485 3-in-1 sensor measures only N, P, K. Enter pH and moisture via Manual Input." },
  noReadingTitle: { si: "තවම sensor දත්ත නැත", en: "No sensor data yet" },
  noReadingMsg: { si: "ESP32 device එක සම්බන්ධ කර Scan කරන්න. දත්ත ලැබුණු පසු පෝෂක මට්ටම් සහ නිර්දේශ මෙහි පෙන්වයි.", en: "Connect the ESP32 device and press Scan. Nutrient levels and recommendations will appear here once a reading arrives." },
  errOffline: { si: "Backend එකට සම්බන්ධ විය නොහැක. Django server එක run වෙනවද බලන්න.", en: "Cannot reach the backend. Make sure the Django server is running." },
  errNoData: { si: "Backend එකේ තවම sensor reading එකක් නැත. ESP32 device එක data යවනවද බලන්න.", en: "The backend has no sensor reading yet. Check that the ESP32 device is sending data." },
  fertPlanTitle: { si: "DOA නිර්දේශිත පොහොර වැඩසටහන", en: "DOA Recommended Fertilizer Programme" },
  fertPlanHint: { si: "කෘෂිකර්ම දෙපාර්තමේන්තුවේ (HORDI) නිල නිර්දේශය — හෙක්ටයාරයකට (kg/ha)", en: "Official Dept. of Agriculture (HORDI) recommendation — per hectare (kg/ha)" },
  fertPlanHintExport: { si: "අපනයන කෘෂිකර්ම දෙපාර්තමේන්තුවේ (DEA) නිල නිර්දේශය — හෙක්ටයාරයකට (kg/ha)", en: "Official Dept. of Export Agriculture (DEA) recommendation — per hectare (kg/ha)" },
  catVeg: { si: "එළවළු", en: "Vegetables" },
  catSpice: { si: "අපනයන / කුළුබඩු බෝග", en: "Export & Spice crops" },
  fertStage: { si: "අදියර", en: "Stage" },
  organicNote: { si: "කාබනික පොහොර (හොඳින් දිරාපත් වූ) මුල් පසට එක් කරන්න:", en: "Incorporate well-decomposed organic matter into the soil:" },
  tonPerHa: { si: "ටොන්/හෙක්", en: "t/ha" },
  dataSource: { si: "දත්ත මූලාශ්‍ර: ශ්‍රී ලංකා කෘෂිකර්ම දෙපාර්තමේන්තුව (DOA/HORDI) සහ අපනයන කෘෂිකර්ම දෙපාර්තමේන්තුව (DEA)", en: "Data sources: Sri Lanka Dept. of Agriculture (DOA/HORDI) & Dept. of Export Agriculture (DEA)" },
  soilRangeNote: { si: "ⓘ N/P/K පරාසයන් සාමාන්‍ය පස් මට්ටම් මාර්ගෝපදේශ වේ. pH පරාසය සහ පොහොර වැඩසටහන DOA නිල දත්ත වේ.", en: "ⓘ N/P/K ranges are general soil-level guidance. The pH range and fertilizer programme are official DOA data." },
  guidelineTitle: { si: "බෝග මාර්ගෝපදේශය (දත්ත සමුදාය)", en: "Crop Guideline (Database)" },
  guidelineRange: { si: "නිර්දේශිත පරාසය", en: "Recommended range" },
  guidelineYour: { si: "ඔබේ අගය", en: "Your value" },
  guidelineStatus: { si: "තත්ත්වය", en: "Status" },
  guidelineWater: { si: "ජල සැලැස්ම", en: "Watering plan" },
  waterEvery: { si: "සෑම දින", en: "Every" },
  waterDaysUnit: { si: "කට වරක්", en: "days" },
  stOptimal: { si: "හරි", en: "Optimal" },
  histTitle: { si: "සුරැකි කියවීම් ඉතිහාසය (දත්ත සමුදාය)", en: "Saved Reading History (Database)" },
  histRefresh: { si: "නැවුම් කරන්න", en: "Refresh" },
  histEmpty: { si: "දත්ත සමුදායේ තවම කියවීම් නැත. Scan කර සුරකින්න.", en: "No saved readings in the database yet. Scan to record." },
  histRows: { si: "පේළි", en: "rows" },
  colTime: { si: "වේලාව", en: "Time" },

  // Cost estimation
  costTitle: { si: "ඇස්තමේන්තුගත පොහොර වියදම", en: "Estimated Fertilizer Cost" },
  costHint: { si: "ඉඩමේ ප්‍රමාණය අනුව DOA පොහොර වැඩසටහනේ මිල ගණනය කරයි", en: "Calculates the DOA fertilizer programme's cost for your field size" },
  costFieldLabel: { si: "මෙම ඉඩම", en: "This land" },
  costFieldNone: { si: "මෙම ඉඩම", en: "This land" },
  costSizeLabel: { si: "ඉඩමේ ප්‍රමාණය (අක්කර)", en: "Field size (acres)" },
  costCalcBtn: { si: "වියදම ගණනය කරන්න", en: "Calculate Cost" },
  costCalculating: { si: "ගණනය කරමින්...", en: "Calculating..." },
  costTotal: { si: "මුළු වියදම", en: "Total Cost" },
  costQty: { si: "ප්‍රමාණය", en: "Quantity" },
  costUnitPrice: { si: "ඒකක මිල", en: "Unit Price" },
  costSubtotal: { si: "උප එකතුව", en: "Subtotal" },
  costNoProgramme: { si: "මෙම බෝගය සඳහා kg/ha පොහොර වැඩසටහනක් තවම නැත — වියදම ගණනය කළ නොහැක.", en: "No kg/ha fertilizer programme is recorded for this crop yet — cost cannot be calculated." },
  costLoggedNote: { si: "ⓘ සෑම ගණනයක්ම වාර්තාව සඳහා සුරැකේ (පරිපාලක > වියදම් වාර්තාව)", en: "ⓘ Every calculation is logged for reporting (Admin > Cost Report)" },

  // Nutrient forecast
  forecastTitle: { si: "පෝෂක අනාවැකිය (ඊළඟ දින 7)", en: "Nutrient Forecast (next 7 days)" },
  forecastHint: { si: "සුරැකි කියවීම් ඉතිහාසය මත පදනම් වූ සරල ප්‍රවණතා අනාවැකියකි", en: "A simple trend projection based on saved reading history" },
  forecastInsufficient: { si: "විශ්වාසදායක අනාවැකියක් සඳහා ප්‍රමාණවත් ඉතිහාසයක් තවම නැත. දින කිහිපයක් Scan කරගෙන යන්න.", en: "Not enough reading history yet for a reliable forecast. Keep scanning over the next few days." },
  forecastNow: { si: "දැන්", en: "Now" },
  forecastIn7d: { si: "දින 7කින්", en: "In 7 days" },
  forecastRising: { si: "වැඩිවෙමින්", en: "Rising" },
  forecastFalling: { si: "අඩුවෙමින්", en: "Falling" },
  forecastStable: { si: "ස්ථාවර", en: "Stable" },
  forecastClamped: { si: "(සීමිත දත්ත නිසා අනාවැකිය සීමා කර ඇත)", en: "(limited due to short data history)" },
  forecastLimitation: { si: "ⓘ මෙය සරල රේඛීය ප්‍රවණතාවකි (Phase 1). විශ්වාසදායක අනාවැකි සඳහා මාස ගණනක අඛණ්ඩ දත්ත අවශ්‍ය වේ.", en: "ⓘ This is a simple linear trend (Phase 1). Robust prediction needs months of continuous sensor data — a known limitation of the current prototype." },

  adminBtn: { si: "පරිපාලක", en: "Admin" },
  adminTitle: { si: "පරිපාලක · Model පුහුණුව", en: "Admin · Model Training" },
  adminSubtitle: { si: "පස් සාම්පල label කර, බෝග නිර්දේශ AI model එක train කරන්න", en: "Label soil samples and train the crop-recommendation AI model" },
  adminPwPrompt: { si: "පරිපාලක මුරපදය", en: "Admin password" },
  adminPwWrong: { si: "මුරපදය වැරදියි", en: "Wrong password" },
  adminEnter: { si: "පිවිසෙන්න", en: "Enter" },
  adminLogout: { si: "ඉවත් වන්න", en: "Log out" },
  modelStatus: { si: "Model තත්ත්වය", en: "Model status" },
  trainedYes: { si: "Train කර ඇත", en: "Trained" },
  trainedNo: { si: "තවම train කර නැත", en: "Not trained yet" },
  accuracyLabel: { si: "නිරවද්‍යතාව", en: "Accuracy" },
  samplesLabel: { si: "සාම්පල", en: "Samples" },
  classesLabel: { si: "බෝග වර්ග", en: "Crop classes" },
  trainBtn: { si: "Model එක Train කරන්න", en: "Train model" },
  training: { si: "Train වෙමින්...", en: "Training..." },
  seedBtn: { si: "නියැදි දත්ත එක් කරන්න", en: "Add starter data" },
  addSampleTitle: { si: "Training සාම්පලයක් එක් කරන්න", en: "Add a training sample" },
  cropLabelField: { si: "බෝගය (label)", en: "Crop (label)" },
  addBtn: { si: "එක් කරන්න", en: "Add" },
  samplesTitle: { si: "Training සාම්පල", en: "Training samples" },
  noSamples: { si: "තවම සාම්පල නැත — 'නියැදි දත්ත එක් කරන්න' click කරන්න.", en: "No samples yet — click 'Add starter data'." },
  predictTitle: { si: "පුරෝකථනය පරීක්ෂා කරන්න", en: "Test prediction" },
  predictBtn: { si: "Predict කරන්න", en: "Predict" },
  predictionLabel: { si: "පුරෝකථනය", en: "Prediction" },
  confidenceLabel: { si: "විශ්වාසය", en: "Confidence" },
  needTrain: { si: "මුලින්ම model එක train කරන්න", en: "Train the model first" },
  aiPickTitle: { si: "AI නිර්දේශය (train කළ model එකෙන්)", en: "AI recommendation (from trained model)" },

  // Admin: tabs
  tabModel: { si: "AI Model", en: "AI Model" },
  tabCost: { si: "වියදම් වාර්තාව", en: "Cost Report" },
  tabFields: { si: "ඉඩම් සහ ගොවිපළ", en: "Fields & Farms" },
  tabStaff: { si: "නිලධාරීන්", en: "Staff" },
  tabAnalytics: { si: "විශ්ලේෂණ", en: "Analytics" },

  // Admin: analytics + export
  seasonTitle: { si: "කාලීන සැසඳුම", en: "Seasonal Comparison" },
  seasonHint: { si: "කාල පරාස දෙකක් අතර සාමාන්‍ය NPK/pH/තෙතමනය සසඳන්න", en: "Compare average NPK / pH / moisture between two date ranges" },
  seasonPeriodA: { si: "කාලය A", en: "Period A" },
  seasonPeriodB: { si: "කාලය B", en: "Period B" },
  seasonCompareBtn: { si: "සසඳන්න", en: "Compare" },
  seasonReadings: { si: "කියවීම්", en: "readings" },
  seasonNoData: { si: "මෙම කාලය තුළ දත්ත නැත", en: "No data in this period" },
  seasonDelta: { si: "වෙනස (A − B)", en: "Change (A − B)" },
  exportTitle: { si: "දත්ත නිර්යාත කිරීම", en: "Data Export" },
  exportHint: { si: "වාර්තා තබාගැනීම සඳහා Excel / PDF ලෙස බාගන්න", en: "Download as Excel / PDF for record-keeping" },
  exportReadings: { si: "කියවීම් (Excel)", en: "Readings (Excel)" },
  exportCost: { si: "වියදම් (Excel)", en: "Cost estimates (Excel)" },
  exportPdf: { si: "සාරාංශ වාර්තාව (PDF)", en: "Summary report (PDF)" },

  // Admin: farms + map + field extras
  farmsTitle: { si: "ගොවිපළ", en: "Farms" },
  farmAddTitle: { si: "නව ගොවිපළක් එක් කරන්න", en: "Add a farm" },
  farmNameField: { si: "ගොවිපළේ නම", en: "Farm name" },
  farmOwnerField: { si: "හිමිකරු", en: "Owner" },
  farmLocationField: { si: "ස්ථානය", en: "Location" },
  noFarms: { si: "තවම ගොවිපළ නැත", en: "No farms yet" },
  fieldFarmField: { si: "ගොවිපළ", en: "Farm" },
  fieldDeviceField: { si: "Sensor Device ID", en: "Sensor Device ID" },
  fieldLatField: { si: "අක්ෂාංශ (lat)", en: "Latitude" },
  fieldLngField: { si: "දේශාංශ (lng)", en: "Longitude" },
  mapTitle: { si: "ඉඩම් සිතියම", en: "Field Map" },
  mapEmpty: { si: "සිතියමේ පෙන්වීමට ඉඩමකට අක්ෂාංශ/දේශාංශ එක් කරන්න", en: "Add latitude/longitude to a field to show it on the map" },
  farmNone: { si: "— ගොවිපළක් නැත —", en: "— no farm —" },
  fieldCount: { si: "ඉඩම්", en: "fields" },

  // Dashboard forecast extras
  forecastUncertain: { si: "අවිනිශ්චිතයි", en: "Uncertain" },
  forecastFit: { si: "ගැලපීම", en: "fit" },
  forecastLowConfidence: { si: "දත්ත විචලනය ඉහළ නිසා විශ්වාසදායක ප්‍රවණතාවක් නැත", en: "Data too variable for a reliable trend" },

  // Admin: fertilizer prices
  priceTitle: { si: "පොහොර මිල ගණන් (LKR/kg)", en: "Fertilizer Prices (LKR/kg)" },
  priceSaveBtn: { si: "මිල යාවත්කාලීන කරන්න", en: "Update price" },
  priceSaved: { si: "මිල යාවත්කාලීන විය", en: "Price updated" },

  // Admin: add a new fertilizer type
  addFertTitle: { si: "නව පොහොර වර්ගයක් එක් කරන්න", en: "Add a New Fertilizer Type" },
  addFertKey: { si: "කේතය (key)", en: "Key" },
  addFertKeyPh: { si: "උදා: dap", en: "e.g. dap" },
  addFertNameEn: { si: "නම (English)", en: "Name (English)" },
  addFertNameEnPh: { si: "උදා: DAP", en: "e.g. DAP" },
  addFertNameSi: { si: "නම (සිංහල)", en: "Name (Sinhala)" },
  addFertNameSiPh: { si: "උදා: ඩීඒපී", en: "e.g. ඩීඒපී" },
  addFertPrice: { si: "මිල (LKR/kg)", en: "Price (LKR/kg)" },
  addFertBtn: { si: "පොහොර වර්ගය එක් කරන්න", en: "Add fertilizer" },
  addFertAdded: { si: "පොහොර වර්ගය එක් විය ✓", en: "Fertilizer added ✓" },
  addFertError: { si: "එක් කිරීම අසාර්ථකයි (key එක දැනටමත් තිබෙනවා විය හැක)", en: "Could not add (key may already exist)" },

  // Admin: regional fertilizer demand
  regionTitle: { si: "දිස්ත්‍රික්ක අනුව පොහොර ඉල්ලුම", en: "Fertilizer Demand by District" },
  regionEmpty: { si: "තවම දත්ත නැත — ගොවියෝ ලියාපදිංචි වී වියදම් ගණනය කළ විට මෙහි පෙන්වයි", en: "No data yet — appears once farmers register and estimate costs" },
  regionCol: { si: "දිස්ත්‍රික්කය", en: "District" },
  regionLands: { si: "ඉඩම්", en: "Lands" },
  regionTopCrop: { si: "ප්‍රධාන බෝගය", en: "Top crop" },
  regionTotalCost: { si: "එකතුව (LKR)", en: "Total (LKR)" },
  regionTotals: { si: "මුළු එකතුව", en: "Totals" },

  // Admin: budget chart + cost log
  budgetTitle: { si: "මාසික පොහොර අයවැය", en: "Monthly Fertilizer Budget" },
  budgetEmpty: { si: "තවම වියදම් ගණනය කර නැත", en: "No cost estimates recorded yet" },
  budgetGrandTotal: { si: "එකතුව", en: "Grand total" },
  costLogTitle: { si: "මෑත වියදම් ගණන්", en: "Recent Cost Estimates" },
  colField: { si: "ඉඩම", en: "Field" },
  colCrop: { si: "බෝගය", en: "Crop" },
  colSize: { si: "ප්‍රමාණය", en: "Size" },
  colCost: { si: "වියදම", en: "Cost" },

  // Admin: fields CRUD
  fieldsTitle: { si: "ලියාපදිංචි ඉඩම්", en: "Registered Fields" },
  fieldAddTitle: { si: "නව ඉඩමක් ලියාපදිංචි කරන්න", en: "Register a new field" },
  fieldNameField: { si: "නම", en: "Name" },
  fieldDetailsField: { si: "විස්තර", en: "Details" },
  fieldSizeField: { si: "ප්‍රමාණය (අක්කර)", en: "Size (acres)" },
  fieldCropField: { si: "බෝගය", en: "Crop" },
  noFields: { si: "තවම ඉඩම් ලියාපදිංචි කර නැත", en: "No fields registered yet" },
};

// Fetch the latest live reading from the Django backend (data pushed by the
// ESP32). The 3-in-1 sensor only reports N/P/K, so pH & moisture come from the
// supplied manual values. Throws if the backend is down or has no reading yet.
async function fetchLiveReading(manual) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/latest/`);
  } catch (e) {
    throw new Error("offline");
  }
  if (!res.ok) throw new Error("offline");
  const d = await res.json();
  if (d.n == null || d.p == null || d.k == null) throw new Error("no-data");
  return {
    n: Math.round(d.n),
    p: Math.round(d.p),
    k: Math.round(d.k),
    ph: d.ph != null ? +(+d.ph).toFixed(1) : manual.ph,
    moisture: d.moisture != null ? Math.round(d.moisture) : manual.moisture,
  };
}

function statusOf(val, range) {
  if (val < range[0]) return "low";
  if (val > range[1]) return "high";
  return "ok";
}

function averageReadings(arr) {
  const sum = arr.reduce(
    (acc, r) => ({ n: acc.n + r.n, p: acc.p + r.p, k: acc.k + r.k, ph: acc.ph + r.ph, moisture: acc.moisture + r.moisture }),
    { n: 0, p: 0, k: 0, ph: 0, moisture: 0 }
  );
  const len = arr.length;
  return {
    n: Math.round(sum.n / len),
    p: Math.round(sum.p / len),
    k: Math.round(sum.k / len),
    ph: +(sum.ph / len).toFixed(1),
    moisture: Math.round(sum.moisture / len),
  };
}

function suitabilityScore(reading, crop) {
  const keys = ["n", "p", "k", "ph", "moisture"];
  let total = 0;
  keys.forEach((k) => {
    const [lo, hi] = crop[k];
    const val = reading[k];
    if (val >= lo && val <= hi) {
      total += 100;
    } else {
      const span = hi - lo;
      const dist = val < lo ? lo - val : val - hi;
      total += Math.max(0, 100 - (dist / span) * 100);
    }
  });
  return Math.round(total / keys.length);
}

// Lightweight loading placeholder — pulsing gray block, sized via className.
function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-xl bg-gray-100 ${className}`} />;
}

function StatusBadge({ status, lang }) {
  const map = {
    low: { color: "bg-red-100 text-red-700 border-red-300", icon: <XCircle size={14} /> },
    high: { color: "bg-amber-100 text-amber-700 border-amber-300", icon: <AlertTriangle size={14} /> },
    ok: { color: "bg-emerald-100 text-emerald-700 border-emerald-300", icon: <CheckCircle2 size={14} /> },
  };
  const s = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${s.color}`}>
      {s.icon}{T[status][lang]}
    </span>
  );
}

// Polar-to-cartesian + arc-path helpers for the semicircle gauge below.
// angle 0 = left end of the semicircle, angle 180 = right end (sweeping
// through the top), so a 0-100 value percentage maps directly to 0-180deg.
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 180) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function arcPath(cx, cy, r, a0, a1) {
  if (a1 <= a0) return "";
  const p0 = polarToCartesian(cx, cy, r, a0);
  const p1 = polarToCartesian(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`;
}

// Traffic-light gauge: a red/green/amber semicircle (low/ok/high zones sized
// to the crop's actual range) with a needle pointing at the current value —
// a farmer reads "needle in the red" faster than comparing two numbers.
function NutrientGauge({ value, range, status }) {
  const domainMin = range[0] * 0.3;
  const domainMax = range[1] * 1.3;
  const toPct = (v) => Math.min(100, Math.max(0, ((v - domainMin) / (domainMax - domainMin)) * 100));
  const pct = toPct(value);
  const lowEnd = toPct(range[0]);
  const highStart = toPct(range[1]);
  const cx = 60, cy = 58, r = 48, sw = 13;
  const needleColor = status === "ok" ? "#059669" : status === "low" ? "#dc2626" : "#d97706";
  const tip = polarToCartesian(cx, cy, r - sw / 2 - 3, pct * 1.8);

  return (
    <svg viewBox="0 0 120 66" className="w-full h-auto" role="img" aria-label={`${value} — ${status}`}>
      <path d={arcPath(cx, cy, r, 0, 180)} stroke="#e5e7eb" strokeWidth={sw} fill="none" />
      <path d={arcPath(cx, cy, r, 0, lowEnd * 1.8)} stroke="#ef4444" strokeWidth={sw} fill="none" />
      <path d={arcPath(cx, cy, r, lowEnd * 1.8, highStart * 1.8)} stroke="#10b981" strokeWidth={sw} fill="none" />
      <path d={arcPath(cx, cy, r, highStart * 1.8, 180)} stroke="#f59e0b" strokeWidth={sw} fill="none" />
      <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={needleColor} strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={4.5} fill={needleColor} />
    </svg>
  );
}

function NutrientCard({ label, value, unit, range, icon, lang }) {
  const status = statusOf(value, range);
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-gray-600">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <StatusBadge status={status} lang={lang} />
      </div>
      <NutrientGauge value={value} range={range} status={status} />
      <div className="text-center -mt-3">
        <span className="text-2xl font-bold text-gray-800">{value}</span>
        <span className="text-sm font-normal text-gray-400 ml-1">{unit}</span>
      </div>
      <div className="text-xs text-gray-400 text-center mt-1">{T.required[lang]} {range[0]} - {range[1]} {unit}</div>
    </div>
  );
}

// Official DOA/HORDI fertilizer programme table for a crop (Urea / TSP / MOP in
// kg/ha across basal + top-dressing stages). Not conditional on the sensor
// reading — it's the department's standard recommendation for the crop.
function FertilizerProgram({ crop, lang }) {
  if (!crop || (!crop.fert && !crop.fertNotes)) return null;
  const cell = (v) => (v == null ? <span className="text-gray-300">–</span> : v);
  const isExport = crop.cat === "spice";
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
      <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
        <Sprout size={18} className="text-emerald-600" /> {T.fertPlanTitle[lang]} — {crop.name[lang]}
      </h3>
      <p className="text-xs text-gray-400 mb-3">{isExport ? T.fertPlanHintExport[lang] : T.fertPlanHint[lang]}</p>

      {crop.climate && (
        <div className="flex items-start gap-2 text-xs bg-sky-50 text-sky-700 rounded-xl px-3 py-2 mb-3">
          <Droplet size={14} className="mt-0.5 shrink-0" /> {crop.climate[lang]}
        </div>
      )}

      {crop.fert && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[420px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-3 font-medium">{T.fertStage[lang]}</th>
                <th className="py-2 px-3 font-medium text-right">Urea</th>
                <th className="py-2 px-3 font-medium text-right">TSP</th>
                <th className="py-2 pl-3 font-medium text-right">MOP</th>
              </tr>
            </thead>
            <tbody>
              {crop.fert.map((row, i) => (
                <tr key={i} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 pr-3 text-gray-700">{row[lang]}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-emerald-700">{cell(row.urea)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-amber-700">{cell(row.tsp)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums text-indigo-700">{cell(row.mop)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {crop.fertNotes && (
        <ul className="space-y-2 text-sm text-gray-700 mt-1">
          {crop.fertNotes.map((note, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-emerald-500 mt-0.5">•</span>
              <span>{note[lang]}</span>
            </li>
          ))}
        </ul>
      )}

      {crop.organic > 0 && (
        <p className="text-xs text-gray-500 mt-3 flex items-start gap-1.5">
          <Leaf size={14} className="text-emerald-500 mt-0.5 shrink-0" />
          {T.organicNote[lang]} <span className="font-medium">{crop.organic} {T.tonPerHa[lang]}</span>
        </p>
      )}
      {crop.src && <p className="text-[10px] text-gray-300 mt-2">— {crop.src}</p>}
    </div>
  );
}

// Printer/instructor-visit slip: land + owner + today's reading + the DOA
// fertilizer programme already scaled to this land's real acreage. Hidden on
// screen (.print-only), shown only inside @media print — see index.css.
function PrintFertilizerPlan({ crop, lang, landName, ownerName, landId, landSize, reading, statuses }) {
  if (!crop.fert) return null;
  const acres = Number(landSize) || 1;
  const rows = crop.fert.map((row) => ({
    label: row[lang],
    urea: row.urea != null ? +((row.urea / ACRES_PER_HA) * acres).toFixed(1) : null,
    tsp: row.tsp != null ? +((row.tsp / ACRES_PER_HA) * acres).toFixed(1) : null,
    mop: row.mop != null ? +((row.mop / ACRES_PER_HA) * acres).toFixed(1) : null,
  }));
  const totals = rows.reduce(
    (acc, r) => ({ urea: acc.urea + (r.urea || 0), tsp: acc.tsp + (r.tsp || 0), mop: acc.mop + (r.mop || 0) }),
    { urea: 0, tsp: 0, mop: 0 }
  );
  const th = "border border-gray-300 px-2 py-1 text-left";
  const td = "border border-gray-300 px-2 py-1";

  return (
    <div className="print-only p-8 text-black">
      <h1 className="text-2xl font-bold mb-1">{T.printPlanTitle[lang]}</h1>
      <p className="text-sm text-gray-600 mb-4">{new Date().toLocaleDateString(lang === "si" ? "si-LK" : "en-US")}</p>
      <div className="grid grid-cols-2 gap-2 text-sm mb-4 border-b border-gray-300 pb-4">
        <div><strong>{T.printLandLabel[lang]}:</strong> {landName || "-"}</div>
        <div><strong>{T.printOwnerLabel[lang]}:</strong> {ownerName || "-"}</div>
        <div><strong>{T.printCropLabel[lang]}:</strong> {crop.name[lang]}</div>
        <div><strong>{T.landSizeLabel[lang]}:</strong> {acres} {T.acresUnit[lang]}</div>
        {landId && <div><strong>{T.landIdBadge[lang]}:</strong> {landId}</div>}
      </div>

      <h2 className="font-semibold mb-2">{T.printCurrentReadings[lang]}</h2>
      <table className="w-full text-sm border-collapse mb-6">
        <thead><tr>
          <th className={th}>N</th><th className={th}>P</th><th className={th}>K</th>
          <th className={th}>pH</th><th className={th}>{T.moisture[lang]}</th>
        </tr></thead>
        <tbody><tr>
          <td className={td}>{reading.n} mg/kg ({T[statuses.n][lang]})</td>
          <td className={td}>{reading.p} mg/kg ({T[statuses.p][lang]})</td>
          <td className={td}>{reading.k} mg/kg ({T[statuses.k][lang]})</td>
          <td className={td}>{reading.ph} ({T[statuses.ph][lang]})</td>
          <td className={td}>{reading.moisture}% ({T[statuses.moisture][lang]})</td>
        </tr></tbody>
      </table>

      <h2 className="font-semibold mb-2">{T.printFertPlanHeader[lang]} ({acres} {T.acresUnit[lang]})</h2>
      <table className="w-full text-sm border-collapse mb-8">
        <thead><tr>
          <th className={th}>{T.printStageCol[lang]}</th>
          <th className={`${th} text-right`}>Urea (kg)</th>
          <th className={`${th} text-right`}>TSP (kg)</th>
          <th className={`${th} text-right`}>MOP (kg)</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className={td}>{r.label}</td>
              <td className={`${td} text-right`}>{r.urea ?? "–"}</td>
              <td className={`${td} text-right`}>{r.tsp ?? "–"}</td>
              <td className={`${td} text-right`}>{r.mop ?? "–"}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className={td}>{T.regionTotals[lang]}</td>
            <td className={`${td} text-right`}>{totals.urea.toFixed(1)}</td>
            <td className={`${td} text-right`}>{totals.tsp.toFixed(1)}</td>
            <td className={`${td} text-right`}>{totals.mop.toFixed(1)}</td>
          </tr>
        </tbody>
      </table>

      <div className="flex justify-between mt-12 text-sm">
        <div>{T.printSignature[lang]}: ____________________</div>
        <div>{T.printGeneratedBy[lang]}: {T.title[lang]}</div>
      </div>
    </div>
  );
}

const cropName = (key, lang) => (CROPS[key]?.name?.[lang]) || key;

// Sums a crop's DOA fertilizer programme (all stages) into kg/ha totals.
function fertTotals(crop) {
  if (!crop?.fert) return null;
  return crop.fert.reduce(
    (acc, stage) => ({
      urea: acc.urea + (stage.urea || 0),
      tsp: acc.tsp + (stage.tsp || 0),
      mop: acc.mop + (stage.mop || 0),
    }),
    { urea: 0, tsp: 0, mop: 0 }
  );
}

// Automated Cost Estimation: prices a crop's DOA fertilizer programme for a
// given field size. Quantities come from CROPS.fert (kg/ha); prices come from
// the backend (admin-editable). Each "Calculate" logs a CostEstimate row so
// the admin Cost Report / monthly budget chart has real data to show.
function CostEstimatePanel({ crop, activeCropKey, lang, defaultSize, defaultFieldId, landName }) {
  const [sizeAcres, setSizeAcres] = useState(defaultSize || 1);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  // The estimate is locked to the logged-in land's OWN field (defaultFieldId).
  // There is deliberately no cross-land field picker here — a farmer only ever
  // sees and costs their own land, never anyone else's. We just prefill this
  // land's size (still editable for a quick what-if on the same land).
  useEffect(() => {
    if (defaultSize) setSizeAcres(defaultSize);
  }, [defaultSize]);

  useEffect(() => {
    setResult(null); // a different crop invalidates the last estimate shown
  }, [activeCropKey]);

  const totals = fertTotals(crop);
  if (!totals) return null;

  async function calculate() {
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch(`${API_BASE}/api/estimate-cost/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crop_key: activeCropKey,
          size_acres: sizeAcres,
          urea_kg_ha: totals.urea,
          tsp_kg_ha: totals.tsp,
          mop_kg_ha: totals.mop,
          ...(defaultFieldId ? { field: Number(defaultFieldId) } : {}),
        }),
      });
      if (!res.ok) throw new Error("failed");
      const d = await res.json();
      setResult(d.estimate);
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  }

  const rows = result
    ? [
        { label: "Urea", kg: result.urea_kg, cost: result.urea_cost },
        { label: "TSP", kg: result.tsp_kg, cost: result.tsp_cost },
        { label: "MOP", kg: result.mop_kg, cost: result.mop_cost },
      ]
    : [];

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
      <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
        <Wallet size={18} className="text-emerald-600" /> {T.costTitle[lang]}
      </h3>
      <p className="text-xs text-gray-400 mb-4">{T.costHint[lang]}</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-xs text-gray-400">{T.costFieldLabel[lang]}</label>
          <div className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-gray-50 text-gray-700 truncate">
            {landName || T.costFieldNone[lang]}
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-400">{T.costSizeLabel[lang]}</label>
          <input
            type="number" min="0.1" step="0.1" value={sizeAcres}
            onChange={(e) => setSizeAcres(+e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={calculate} disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
          >
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> {busy ? T.costCalculating[lang] : T.costCalcBtn[lang]}
          </button>
        </div>
      </div>

      {err && <p className="text-xs text-red-600 mb-3">{T.errOffline[lang]}</p>}

      {result && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-xs">
                <th className="py-1.5 pr-3 font-medium"> </th>
                <th className="py-1.5 pr-3 font-medium">{T.costQty[lang]}</th>
                <th className="py-1.5 font-medium">{T.costSubtotal[lang]}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-gray-50">
                  <td className="py-2 pr-3 font-medium text-gray-700">{r.label}</td>
                  <td className="py-2 pr-3 text-gray-500">{r.kg.toFixed(1)} kg</td>
                  <td className="py-2 font-semibold text-gray-800">LKR {r.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-between bg-emerald-50 text-emerald-700 px-4 py-3 rounded-xl">
            <span className="font-medium">{T.costTotal[lang]}</span>
            <span className="text-lg font-bold">LKR {result.total_cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </div>
          <p className="text-[11px] text-gray-300 mt-2">{T.costLoggedNote[lang]}</p>
        </div>
      )}
    </div>
  );
}

// Planting calendar + growing advice for the active crop: when to plant it
// (Maha / Yala season + best months, and whether now is a good time), how long
// to first harvest, an approximate harvest window if planted today, and one
// practical growing tip. For an empty land the "active crop" is the app's
// recommended next crop, so this doubles as "what to grow next and how".
function PlantingAdvicePanel({ crop, activeCropKey, lang }) {
  const info = CROP_SEASON[activeCropKey];
  if (!crop || !info) return null;

  const perennial = info.seasons.includes("perennial");
  const win = perennial ? null : plantingWindow(info.plantMonths);
  const fmt = (d) => d.toLocaleDateString(lang === "si" ? "si-LK" : "en-US", { month: "short", day: "numeric" });
  let harvest = null;
  if (!perennial && info.durationDays) {
    const d0 = new Date(); d0.setDate(d0.getDate() + info.durationDays[0]);
    const d1 = new Date(); d1.setDate(d1.getDate() + info.durationDays[1]);
    harvest = `${fmt(d0)} – ${fmt(d1)}`;
  }
  const seasonLabel = (s) => (s === "maha" ? T.seasonMaha[lang] : s === "yala" ? T.seasonYala[lang] : T.seasonPerennial[lang]);

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
      <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
        <Calendar size={18} className="text-emerald-600" /> {T.plantAdviceTitle[lang]} — {crop.name[lang]}
      </h3>
      <p className="text-xs text-gray-400 mb-4">{T.plantAdviceHint[lang]}</p>

      <div className="flex flex-wrap gap-2 mb-4">
        {info.seasons.map((s) => (
          <span key={s} className="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">{seasonLabel(s)}</span>
        ))}
        {win && (
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${win.now ? "bg-emerald-600 text-white" : "bg-amber-100 text-amber-700"}`}>
            {win.now ? T.plantGoodNow[lang] : `${T.plantNextWindow[lang]}: ${MONTH_NAMES[lang][win.next - 1]}`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="rounded-xl bg-gray-50 p-3">
          <div className="text-xs text-gray-400 mb-1">{T.plantWindow[lang]}</div>
          <div className="text-sm text-gray-700 font-medium">
            {perennial ? T.plantPerennialNote[lang] : info.plantMonths.map((m) => MONTH_NAMES[lang][m - 1]).join(", ")}
          </div>
        </div>
        <div className="rounded-xl bg-gray-50 p-3">
          <div className="text-xs text-gray-400 mb-1">{T.plantDuration[lang]}</div>
          <div className="text-sm text-gray-700 font-medium">
            {info.durationDays ? `${info.durationDays[0]}–${info.durationDays[1]} ${T.days[lang]}` : "—"}
          </div>
        </div>
        <div className="rounded-xl bg-gray-50 p-3">
          <div className="text-xs text-gray-400 mb-1">{T.plantHarvest[lang]}</div>
          <div className="text-sm text-gray-700 font-medium">{harvest || "—"}</div>
        </div>
      </div>

      <div className="rounded-xl bg-emerald-50 p-3">
        <div className="text-xs font-medium text-emerald-700 mb-1 flex items-center gap-1.5"><Sprout size={14} /> {T.growTips[lang]}</div>
        <p className="text-sm text-emerald-800 leading-relaxed">{info.tips[lang]}</p>
      </div>
    </div>
  );
}

// Crop details repository: shows the selected/recommended crop's soil
// requirements and cultivation notes, drawn from the DOA/DEA CROPS data.
// Serves as the browsable "crop info" for a registered land.
function CropInfo({ crop, lang }) {
  if (!crop) return null;
  const isSpice = crop.cat === "spice";
  const rangeText = (r, unit = "") => `${r[0]}–${r[1]}${unit}`;

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <Leaf size={18} className="text-emerald-600" /> {T.cropInfoTitle[lang]} — {crop.name[lang]}
        </h3>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${isSpice ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
          {isSpice ? T.ciSpice[lang] : T.ciVegetable[lang]}
        </span>
      </div>
      <p className="text-xs text-gray-400 mb-4">{T.cropInfoHint[lang]}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl bg-gray-50 p-3">
          <div className="text-xs text-gray-400 mb-1">{T.ciNutrientNeeds[lang]}</div>
          <div className="text-sm text-gray-700 font-medium">
            N {rangeText(crop.n)} · P {rangeText(crop.p)} · K {rangeText(crop.k)}
          </div>
        </div>
        <div className="rounded-xl bg-gray-50 p-3">
          <div className="text-xs text-gray-400 mb-1">{T.ciIdealPh[lang]} · {T.ciIdealMoisture[lang]}</div>
          <div className="text-sm text-gray-700 font-medium">
            pH {rangeText(crop.ph)} · {rangeText(crop.moisture, "%")}
          </div>
        </div>
        {crop.organic > 0 && (
          <div className="rounded-xl bg-gray-50 p-3">
            <div className="text-xs text-gray-400 mb-1">{T.ciOrganic[lang]}</div>
            <div className="text-sm text-gray-700 font-medium">{crop.organic} {T.tonPerHa[lang]}</div>
          </div>
        )}
        {crop.climate && (
          <div className="rounded-xl bg-gray-50 p-3">
            <div className="text-xs text-gray-400 mb-1">{T.ciClimate[lang]}</div>
            <div className="text-sm text-gray-700">{crop.climate[lang]}</div>
          </div>
        )}
      </div>
      {crop.src && <p className="text-[10px] text-gray-300 mt-3">— {crop.src}</p>}
    </div>
  );
}

// Historical Trend Analysis, Phase 2: a simple linear-trend forecast for N/P/K
// pulled from the backend's persisted reading history. Honestly reports when
// there isn't enough data span yet rather than guessing (see backend/trend.py).
function ForecastPanel({ lang, fieldId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fieldQ = fieldId ? `&field=${fieldId}` : "";
    fetch(`${API_BASE}/api/predict-trend/?hours=720&horizon_days=7${fieldQ}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fieldId]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mt-6">
        <Skeleton className="h-5 w-48 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" />
        </div>
      </div>
    );
  }
  if (!data) return null;
  const f = data.forecast;
  const anyInsufficient = ["n", "p", "k"].some((k) => !f[k].sufficient_data);
  const badgeFor = (t) => (t === "falling" ? "bg-amber-100 text-amber-700" : t === "rising" ? "bg-emerald-100 text-emerald-700" : t === "uncertain" ? "bg-gray-100 text-gray-400" : "bg-gray-100 text-gray-500");
  const labelFor = (t) => (t === "falling" ? T.forecastFalling[lang] : t === "rising" ? T.forecastRising[lang] : t === "uncertain" ? T.forecastUncertain[lang] : T.forecastStable[lang]);

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mt-6">
      <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
        <Gauge size={18} className="text-emerald-600" /> {T.forecastTitle[lang]}
        <span className="text-[10px] font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">scikit-learn</span>
      </h3>
      <p className="text-xs text-gray-400 mb-4">{T.forecastHint[lang]}</p>

      {anyInsufficient ? (
        <p className="text-sm text-gray-400 bg-gray-50 rounded-xl px-4 py-3">{T.forecastInsufficient[lang]}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {["n", "p", "k"].map((key) => {
            const r = f[key];
            return (
              <div key={key} className="rounded-xl border border-gray-100 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm text-gray-700">{key.toUpperCase()}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeFor(r.trend)}`}>{labelFor(r.trend)}</span>
                </div>
                <div className="text-sm text-gray-500">{T.forecastNow[lang]}: <span className="font-semibold text-gray-800">{r.current}</span></div>
                <div className="text-sm text-gray-500">{T.forecastIn7d[lang]}: <span className="font-semibold text-gray-800">{r.predicted != null ? r.predicted : "—"}</span></div>
                {r.reliable === false ? (
                  <div className="text-[10px] text-amber-500 mt-1">{T.forecastLowConfidence[lang]}</div>
                ) : (
                  <div className="text-[10px] text-gray-300 mt-1">R² {r.r2} {T.forecastFit[lang]}{r.clamped ? ` · ${T.forecastClamped[lang]}` : ""}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-gray-300 mt-3">{T.forecastLimitation[lang]}</p>
    </div>
  );
}

// Password-gated admin page for managing labelled training data and training
// the crop-recommendation model. Self-contained: manages its own state and
// talks to the Django admin API with the X-Admin-Password header.
function AdminView({ lang, onBack, langBtn }) {
  const [pw, setPw] = useState(() => sessionStorage.getItem("npk-admin-pw") || "");
  const [authed, setAuthed] = useState(false);
  const [pwError, setPwError] = useState(false);
  const [tab, setTab] = useState("model"); // 'model' | 'cost' | 'fields'
  const [samples, setSamples] = useState([]);
  const [model, setModel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const emptyForm = { n: "", p: "", k: "", ph: "", moisture: "", crop: "tomato" };
  const [form, setForm] = useState(emptyForm);
  const [predForm, setPredForm] = useState({ n: 120, p: 35, k: 200, ph: 6.5, moisture: 60 });
  const [predResult, setPredResult] = useState(null);

  const api = (path, opts = {}) =>
    fetch(`${API_BASE}/api${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", "X-Admin-Password": pw, ...(opts.headers || {}) },
    });

  async function loadAll() {
    const [mi, td] = await Promise.all([api("/model-info/"), api("/train-data/")]);
    if (mi.ok) setModel(await mi.json());
    if (td.ok) setSamples((await td.json()).samples || []);
  }

  async function tryLogin(e) {
    e && e.preventDefault();
    setPwError(false);
    try {
      const res = await api("/model-info/");
      if (res.status === 401) { setPwError(true); return; }
      if (res.ok) {
        sessionStorage.setItem("npk-admin-pw", pw);
        setAuthed(true);
        setModel(await res.json());
        const td = await api("/train-data/");
        if (td.ok) setSamples((await td.json()).samples || []);
      }
    } catch { setPwError(true); }
  }

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(null), 3000); };

  async function seed() {
    setBusy(true);
    try { await (await api("/train-data/seed/", { method: "POST", body: JSON.stringify({ per_crop: 12 }) })).json(); await loadAll(); flash(T.savedMsg[lang]); }
    finally { setBusy(false); }
  }

  async function addSample(e) {
    e.preventDefault();
    const body = { crop: form.crop };
    for (const f of ["n", "p", "k", "ph", "moisture"]) body[f] = Number(form[f]);
    setBusy(true);
    try {
      const res = await api("/train-data/", { method: "POST", body: JSON.stringify(body) });
      if (res.ok) { setForm({ ...emptyForm, crop: form.crop }); await loadAll(); flash(T.savedMsg[lang]); }
    } finally { setBusy(false); }
  }

  async function removeSample(id) {
    setBusy(true);
    try { await api(`/train-data/${id}/delete/`, { method: "POST" }); await loadAll(); }
    finally { setBusy(false); }
  }

  async function train() {
    setBusy(true);
    try {
      const res = await api("/train/", { method: "POST" });
      const d = await res.json();
      if (res.ok) { await loadAll(); flash(`${T.accuracyLabel[lang]}: ${Math.round(d.accuracy * 100)}%`); }
      else flash(d.error || "error");
    } finally { setBusy(false); }
  }

  async function runPredict(e) {
    e.preventDefault();
    setBusy(true);
    setPredResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/predict/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(predForm),
      });
      const d = await res.json();
      if (res.ok) setPredResult(d); else flash(d.error || T.needTrain[lang]);
    } finally { setBusy(false); }
  }

  const perCrop = model?.per_crop || {};

  // ---- password gate ----
  if (!authed) {
    return (
      <div className="min-h-screen app-bg p-4 md:p-8 flex items-center justify-center">
        <form onSubmit={tryLogin} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 w-full max-w-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-emerald-600 p-2.5 rounded-xl"><Sprout className="text-white" size={20} /></div>
            <h1 className="font-bold text-gray-800">{T.adminTitle[lang]}</h1>
          </div>
          <label className="text-sm text-gray-500">{T.adminPwPrompt[lang]}</label>
          <input
            type="password" value={pw} autoFocus
            onChange={(e) => { setPw(e.target.value); setPwError(false); }}
            className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          {pwError && <p className="text-xs text-red-600 mt-1">{T.adminPwWrong[lang]}</p>}
          <div className="flex items-center gap-2 mt-4">
            <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition">{T.adminEnter[lang]}</button>
            <button type="button" onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2">{T.backHome[lang]}</button>
          </div>
        </form>
      </div>
    );
  }

  // ---- admin dashboard ----
  return (
    <div className="min-h-screen app-bg p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-emerald-600 transition">
            <ArrowLeft size={16} /> {T.backHome[lang]}
          </button>
          <div className="flex items-center gap-2">
            {langBtn}
            <button onClick={() => { sessionStorage.removeItem("npk-admin-pw"); setAuthed(false); }} className="text-sm text-gray-500 hover:text-red-600 px-3 py-2">{T.adminLogout[lang]}</button>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className="bg-emerald-600 p-3 rounded-2xl shadow-lg shadow-emerald-200"><Sprout className="text-white" size={26} /></div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-800">{T.adminTitle[lang]}</h1>
            <p className="text-sm text-gray-500">{T.adminSubtitle[lang]}</p>
          </div>
        </div>

        {msg && <div className="mb-4 bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-sm inline-flex items-center gap-2"><CheckCircle2 size={16} /> {msg}</div>}

        {/* Tabs */}
        <div className="bg-white rounded-2xl p-2 shadow-sm border border-gray-100 mb-6 flex gap-2">
          {[
            { key: "model", label: T.tabModel[lang], icon: <TrendingUp size={15} /> },
            { key: "cost", label: T.tabCost[lang], icon: <Wallet size={15} /> },
            { key: "analytics", label: T.tabAnalytics[lang], icon: <BarChart3 size={15} /> },
            { key: "fields", label: T.tabFields[lang], icon: <MapPin size={15} /> },
            { key: "staff", label: T.tabStaff[lang], icon: <Shield size={15} /> },
          ].map((t) => (
            <button
              key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition ${tab === t.key ? "bg-emerald-600 text-white shadow-sm" : "text-gray-500 hover:bg-gray-50"}`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === "cost" && <AdminCostTab pw={pw} lang={lang} />}
        {tab === "analytics" && <AdminAnalyticsTab lang={lang} />}
        {tab === "fields" && <AdminFieldsTab lang={lang} />}
        {tab === "staff" && <StaffManager lang={lang} authHeaders={{ "X-Admin-Password": pw }} />}

        {tab === "model" && (
        <>
        {/* Model status */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><TrendingUp size={18} className="text-emerald-600" /> {T.modelStatus[lang]}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-xs text-gray-400">{T.modelStatus[lang]}</div>
              <div className={`text-sm font-semibold ${model?.trained ? "text-emerald-700" : "text-amber-600"}`}>{model?.trained ? T.trainedYes[lang] : T.trainedNo[lang]}</div>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-xs text-gray-400">{T.accuracyLabel[lang]}</div>
              <div className="text-sm font-semibold text-gray-800">{model?.accuracy != null ? `${Math.round(model.accuracy * 100)}%` : "—"}</div>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-xs text-gray-400">{T.samplesLabel[lang]}</div>
              <div className="text-sm font-semibold text-gray-800">{model?.total_samples ?? samples.length}</div>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-xs text-gray-400">{T.classesLabel[lang]}</div>
              <div className="text-sm font-semibold text-gray-800">{model?.classes?.length || 0}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <button onClick={train} disabled={busy || samples.length < 2} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition">
              <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> {busy ? T.training[lang] : T.trainBtn[lang]}
            </button>
            <button onClick={seed} disabled={busy} className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium transition">
              <Star size={15} /> {T.seedBtn[lang]}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Add sample */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><Save size={17} className="text-emerald-600" /> {T.addSampleTitle[lang]}</h3>
            <form onSubmit={addSample}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                {["n", "p", "k", "ph", "moisture"].map((f) => (
                  <div key={f}>
                    <label className="text-xs text-gray-400 uppercase">{f}</label>
                    <input type="number" step={f === "ph" ? "0.1" : "1"} required value={form[f]}
                      onChange={(e) => setForm((s) => ({ ...s, [f]: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-gray-400">{T.cropLabelField[lang]}</label>
                  <select value={form.crop} onChange={(e) => setForm((s) => ({ ...s, crop: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-400">
                    {Object.keys(CROPS).map((k) => <option key={k} value={k}>{cropName(k, lang)}</option>)}
                  </select>
                </div>
              </div>
              <button type="submit" disabled={busy} className="bg-gray-800 hover:bg-gray-900 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition">{T.addBtn[lang]}</button>
            </form>
          </div>

          {/* Predict tester */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><Star size={17} className="text-amber-500" /> {T.predictTitle[lang]}</h3>
            <form onSubmit={runPredict}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                {["n", "p", "k", "ph", "moisture"].map((f) => (
                  <div key={f}>
                    <label className="text-xs text-gray-400 uppercase">{f}</label>
                    <input type="number" step={f === "ph" ? "0.1" : "1"} required value={predForm[f]}
                      onChange={(e) => setPredForm((s) => ({ ...s, [f]: Number(e.target.value) }))}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  </div>
                ))}
              </div>
              <button type="submit" disabled={busy || !model?.trained} className="bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition">{T.predictBtn[lang]}</button>
              {!model?.trained && <p className="text-xs text-amber-600 mt-2">{T.needTrain[lang]}</p>}
            </form>
            {predResult && (
              <div className="mt-4 space-y-2">
                {predResult.ranked.map((r, i) => (
                  <div key={r.crop} className={`rounded-xl p-3 border ${i === 0 ? "border-emerald-400 bg-emerald-50" : "border-gray-100 bg-gray-50"}`}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-800">{i === 0 && "🏆 "}{cropName(r.crop, lang)}</span>
                      <span className="text-gray-500">{T.confidenceLabel[lang]}: {Math.round(r.confidence * 100)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mt-1">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(r.confidence * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Samples table */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2"><FolderOpen size={17} className="text-emerald-600" /> {T.samplesTitle[lang]} ({samples.length})</h3>
          </div>
          {Object.keys(perCrop).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {Object.entries(perCrop).map(([c, n]) => (
                <span key={c} className="text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full">{cropName(c, lang)}: {n}</span>
              ))}
            </div>
          )}
          {samples.length === 0 ? (
            <p className="text-sm text-gray-400">{T.noSamples[lang]}</p>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead className="text-left text-gray-500 border-b border-gray-100 sticky top-0 bg-white">
                  <tr><th className="py-2 pr-3 font-medium">{T.cropLabelField[lang]}</th><th className="py-2 px-2 text-right font-medium">N</th><th className="py-2 px-2 text-right font-medium">P</th><th className="py-2 px-2 text-right font-medium">K</th><th className="py-2 px-2 text-right font-medium">pH</th><th className="py-2 px-2 text-right font-medium">Moist.</th><th></th></tr>
                </thead>
                <tbody>
                  {samples.map((s) => (
                    <tr key={s.id} className="border-b border-gray-50">
                      <td className="py-1.5 pr-3 text-gray-700">{cropName(s.crop, lang)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{s.n}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{s.p}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{s.k}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{s.ph}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{s.moisture}</td>
                      <td className="py-1.5 pl-2 text-right"><button onClick={() => removeSample(s.id)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}

// Admin tab: fertilizer price editor + monthly budget chart + recent cost log.
function AdminCostTab({ pw, lang }) {
  const [prices, setPrices] = useState([]);
  const [edits, setEdits] = useState({});
  const [summary, setSummary] = useState(null);
  const [log, setLog] = useState([]);
  const [regions, setRegions] = useState(null); // region-fertilizer report
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const emptyFert = { key: "", name_en: "", name_si: "", price_per_kg: "" };
  const [newFert, setNewFert] = useState(emptyFert);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(null), 3000); };

  async function loadAll() {
    const [pr, su, lo, rg] = await Promise.all([
      fetch(`${API_BASE}/api/fertilizer-types/`),
      fetch(`${API_BASE}/api/cost-summary/?months=6`),
      fetch(`${API_BASE}/api/cost-estimates/?limit=20`),
      fetch(`${API_BASE}/api/region-fertilizer/`),
    ]);
    if (pr.ok) setPrices(await pr.json());
    if (su.ok) setSummary(await su.json());
    if (lo.ok) setLog(await lo.json());
    if (rg.ok) setRegions(await rg.json());
  }

  useEffect(() => { loadAll(); }, []);

  async function savePrice(key) {
    const value = edits[key];
    if (value === undefined || value === "") return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/fertilizer-types/${key}/update/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Admin-Password": pw },
        body: JSON.stringify({ price_per_kg: Number(value) }),
      });
      if (res.ok) { await loadAll(); flash(T.priceSaved[lang]); }
    } finally {
      setBusy(false);
    }
  }

  async function addFertilizer() {
    if (!newFert.key.trim() || !newFert.name_en.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/fertilizer-types/create/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Password": pw },
        body: JSON.stringify({
          key: newFert.key.trim(),
          name_en: newFert.name_en.trim(),
          name_si: newFert.name_si.trim(),
          price_per_kg: Number(newFert.price_per_kg) || 0,
        }),
      });
      if (res.ok) { setNewFert(emptyFert); await loadAll(); flash(T.addFertAdded[lang]); }
      else { flash(T.addFertError[lang]); }
    } finally {
      setBusy(false);
    }
  }

  const maxTotal = Math.max(1, ...(summary?.series || []).map((s) => s.total_cost));

  return (
    <>
      {msg && <div className="mb-4 bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-sm inline-flex items-center gap-2"><CheckCircle2 size={16} /> {msg}</div>}

      {/* Fertilizer prices */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><Wallet size={18} className="text-emerald-600" /> {T.priceTitle[lang]}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {prices.map((p) => (
            <div key={p.key} className="rounded-xl bg-gray-50 p-3">
              <div className="text-xs text-gray-400 mb-1">{p.name_en}{p.name_si ? ` (${p.name_si})` : ""}</div>
              <div className="flex items-center gap-2">
                <input
                  type="number" step="0.1"
                  defaultValue={p.price_per_kg}
                  onChange={(e) => setEdits((s) => ({ ...s, [p.key]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <button onClick={() => savePrice(p.key)} disabled={busy} className="shrink-0 bg-gray-800 hover:bg-gray-900 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition">
                  {T.priceSaveBtn[lang]}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add a new fertilizer type */}
        <div className="mt-5 pt-4 border-t border-gray-100">
          <h4 className="text-sm font-medium text-gray-600 mb-2">{T.addFertTitle[lang]}</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <label className="text-[11px] text-gray-400">{T.addFertKey[lang]}</label>
              <input value={newFert.key} placeholder={T.addFertKeyPh[lang]}
                onChange={(e) => setNewFert((s) => ({ ...s, key: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="text-[11px] text-gray-400">{T.addFertNameEn[lang]}</label>
              <input value={newFert.name_en} placeholder={T.addFertNameEnPh[lang]}
                onChange={(e) => setNewFert((s) => ({ ...s, name_en: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="text-[11px] text-gray-400">{T.addFertNameSi[lang]}</label>
              <input value={newFert.name_si} placeholder={T.addFertNameSiPh[lang]}
                onChange={(e) => setNewFert((s) => ({ ...s, name_si: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="text-[11px] text-gray-400">{T.addFertPrice[lang]}</label>
              <input type="number" step="0.1" value={newFert.price_per_kg} placeholder="0"
                onChange={(e) => setNewFert((s) => ({ ...s, price_per_kg: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
          </div>
          <button onClick={addFertilizer} disabled={busy || !newFert.key.trim() || !newFert.name_en.trim()}
            className="mt-2 inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition">
            <CheckCircle2 size={14} /> {T.addFertBtn[lang]}
          </button>
        </div>
      </div>

      {/* Fertilizer demand by district (national roll-up) */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><MapPin size={18} className="text-emerald-600" /> {T.regionTitle[lang]}</h3>
        {!regions || regions.regions.length === 0 ? (
          <p className="text-sm text-gray-400">{T.regionEmpty[lang]}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-3 font-medium">{T.regionCol[lang]}</th>
                  <th className="py-2 px-2 font-medium text-right">{T.regionLands[lang]}</th>
                  <th className="py-2 px-2 font-medium">{T.regionTopCrop[lang]}</th>
                  <th className="py-2 px-2 font-medium text-right">Urea (kg)</th>
                  <th className="py-2 px-2 font-medium text-right">TSP (kg)</th>
                  <th className="py-2 px-2 font-medium text-right">MOP (kg)</th>
                  <th className="py-2 pl-2 font-medium text-right">{T.regionTotalCost[lang]}</th>
                </tr>
              </thead>
              <tbody>
                {regions.regions.map((r) => (
                  <tr key={r.region} className="border-b border-gray-50">
                    <td className="py-2 pr-3 font-medium text-gray-700">{r.region}</td>
                    <td className="py-2 px-2 text-right text-gray-600">{r.lands}</td>
                    <td className="py-2 px-2 text-gray-600">{r.top_crop && CROPS[r.top_crop] ? CROPS[r.top_crop].name[lang] : (r.top_crop || "—")}</td>
                    <td className="py-2 px-2 text-right text-gray-600">{r.urea_kg.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right text-gray-600">{r.tsp_kg.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right text-gray-600">{r.mop_kg.toLocaleString()}</td>
                    <td className="py-2 pl-2 text-right font-medium text-gray-800">{Math.round(r.total_cost).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-gray-800">
                  <td className="py-2 pr-3">{T.regionTotals[lang]}</td>
                  <td className="py-2 px-2 text-right">{regions.totals.lands}</td>
                  <td className="py-2 px-2"></td>
                  <td className="py-2 px-2 text-right">{regions.totals.urea_kg.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right">{regions.totals.tsp_kg.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right">{regions.totals.mop_kg.toLocaleString()}</td>
                  <td className="py-2 pl-2 text-right">{Math.round(regions.totals.total_cost).toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Monthly budget chart */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><BarChart3 size={18} className="text-emerald-600" /> {T.budgetTitle[lang]}</h3>
        {!summary || summary.series.length === 0 ? (
          <p className="text-sm text-gray-400">{T.budgetEmpty[lang]}</p>
        ) : (
          <>
            <div className="flex items-end gap-3 h-40 mb-2">
              {summary.series.map((s) => (
                <div key={s.month} className="flex-1 flex flex-col items-center justify-end h-full">
                  <div className="text-[10px] text-gray-500 mb-1">{Math.round(s.total_cost).toLocaleString()}</div>
                  <div className="w-full bg-emerald-500 rounded-t-md" style={{ height: `${Math.max(4, (s.total_cost / maxTotal) * 100)}%` }} />
                  <div className="text-[10px] text-gray-400 mt-1">{s.month}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 pt-3 mt-2">
              <span className="text-sm text-gray-500">{T.budgetGrandTotal[lang]}</span>
              <span className="font-bold text-gray-800">LKR {summary.grand_total.toLocaleString()}</span>
            </div>
          </>
        )}
      </div>

      {/* Recent cost estimates */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><FolderOpen size={17} className="text-emerald-600" /> {T.costLogTitle[lang]} ({log.length})</h3>
        {log.length === 0 ? (
          <p className="text-sm text-gray-400">{T.budgetEmpty[lang]}</p>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead className="text-left text-gray-500 border-b border-gray-100 sticky top-0 bg-white">
                <tr>
                  <th className="py-2 pr-3 font-medium">{T.colField[lang]}</th>
                  <th className="py-2 pr-3 font-medium">{T.colCrop[lang]}</th>
                  <th className="py-2 pr-3 text-right font-medium">{T.colSize[lang]}</th>
                  <th className="py-2 text-right font-medium">{T.colCost[lang]}</th>
                </tr>
              </thead>
              <tbody>
                {log.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50">
                    <td className="py-1.5 pr-3 text-gray-700">{c.field_name || "—"}</td>
                    <td className="py-1.5 pr-3 text-gray-700">{cropName(c.crop_key, lang)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{c.size_acres} ac</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">LKR {c.total_cost.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// Admin tab: register / list / delete Fields (multi-field support).
// Leaflet map (vanilla, no react-leaflet — avoids React 19 peer issues). Draws
// a CircleMarker per field with lat/lng, so no marker-image assets are needed.
// OpenStreetMap tiles require internet at view time.
function LeafletMap({ points, lang }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    mapRef.current = L.map(ref.current, { scrollWheelZoom: false }).setView([7.8731, 80.7718], 7); // Sri Lanka
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "© OpenStreetMap",
    }).addTo(mapRef.current);
    layerRef.current = L.layerGroup().addTo(mapRef.current);
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, group = layerRef.current;
    if (!map || !group) return;
    group.clearLayers();
    const latlngs = [];
    points.forEach((p) => {
      if (p.latitude == null || p.longitude == null) return;
      const ll = [p.latitude, p.longitude];
      latlngs.push(ll);
      L.circleMarker(ll, { radius: 8, color: "#059669", fillColor: "#10b981", fillOpacity: 0.8, weight: 2 })
        .bindPopup(`<b>${p.name}</b><br>${p.size_acres} ac${p.crop_key ? " · " + cropName(p.crop_key, lang) : ""}`)
        .addTo(group);
    });
    if (latlngs.length === 1) map.setView(latlngs[0], 13);
    else if (latlngs.length > 1) map.fitBounds(latlngs, { padding: [30, 30] });
  }, [points, lang]);

  return <div ref={ref} className="w-full h-72 rounded-xl overflow-hidden border border-gray-100" />;
}

function AdminFieldsTab({ lang }) {
  const emptyField = { name: "", details: "", size_acres: 1, crop_key: "tomato", farm: "", device_id: "", latitude: "", longitude: "" };
  const emptyFarm = { name: "", owner_name: "", location: "" };
  const [fieldsList, setFieldsList] = useState([]);
  const [farms, setFarms] = useState([]);
  const [form, setForm] = useState(emptyField);
  const [farmForm, setFarmForm] = useState(emptyFarm);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [fr, fa] = await Promise.all([fetch(`${API_BASE}/api/fields/`), fetch(`${API_BASE}/api/farms/`)]);
    if (fr.ok) setFieldsList(await fr.json());
    if (fa.ok) setFarms(await fa.json());
  }
  useEffect(() => { load(); }, []);

  async function addFarm(e) {
    e.preventDefault();
    if (!farmForm.name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/farms/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(farmForm) });
      if (res.ok) { setFarmForm(emptyFarm); await load(); }
    } finally { setBusy(false); }
  }

  async function removeFarm(id) {
    setBusy(true);
    try { await fetch(`${API_BASE}/api/farms/${id}/`, { method: "DELETE" }); await load(); }
    finally { setBusy(false); }
  }

  async function addField(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const body = {
        name: form.name, details: form.details, crop_key: form.crop_key,
        size_acres: Number(form.size_acres), device_id: form.device_id,
        farm: form.farm ? Number(form.farm) : null,
        latitude: form.latitude === "" ? null : Number(form.latitude),
        longitude: form.longitude === "" ? null : Number(form.longitude),
      };
      const res = await fetch(`${API_BASE}/api/fields/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) { setForm(emptyField); await load(); }
    } finally { setBusy(false); }
  }

  async function removeField(id) {
    setBusy(true);
    try { await fetch(`${API_BASE}/api/fields/${id}/`, { method: "DELETE" }); await load(); }
    finally { setBusy(false); }
  }

  const mapped = fieldsList.filter((f) => f.latitude != null && f.longitude != null);

  return (
    <>
      {/* Map */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><MapPin size={17} className="text-emerald-600" /> {T.mapTitle[lang]}</h3>
        {mapped.length === 0 ? (
          <p className="text-sm text-gray-400">{T.mapEmpty[lang]}</p>
        ) : (
          <LeafletMap points={mapped} lang={lang} />
        )}
      </div>

      {/* Farms */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><Sprout size={17} className="text-emerald-600" /> {T.farmsTitle[lang]} ({farms.length})</h3>
        <form onSubmit={addFarm} className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <input required placeholder={T.farmNameField[lang]} value={farmForm.name} onChange={(e) => setFarmForm((s) => ({ ...s, name: e.target.value }))}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          <input placeholder={T.farmOwnerField[lang]} value={farmForm.owner_name} onChange={(e) => setFarmForm((s) => ({ ...s, owner_name: e.target.value }))}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          <input placeholder={T.farmLocationField[lang]} value={farmForm.location} onChange={(e) => setFarmForm((s) => ({ ...s, location: e.target.value }))}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          <button type="submit" disabled={busy} className="bg-gray-800 hover:bg-gray-900 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition">{T.farmAddTitle[lang]}</button>
        </form>
        {farms.length === 0 ? (
          <p className="text-sm text-gray-400">{T.noFarms[lang]}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {farms.map((fa) => (
              <span key={fa.id} className="inline-flex items-center gap-2 text-xs bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full">
                <span className="font-medium">{fa.name}</span>
                {fa.owner_name && <span className="text-emerald-500">· {fa.owner_name}</span>}
                <span className="text-emerald-400">· {fa.field_count} {T.fieldCount[lang]}</span>
                <button onClick={() => removeFarm(fa.id)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Field registration */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><Save size={17} className="text-emerald-600" /> {T.fieldAddTitle[lang]}</h3>
        <form onSubmit={addField} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-gray-400">{T.fieldNameField[lang]}</label>
            <input required value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
          <div>
            <label className="text-xs text-gray-400">{T.fieldFarmField[lang]}</label>
            <select value={form.farm} onChange={(e) => setForm((s) => ({ ...s, farm: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-400">
              <option value="">{T.farmNone[lang]}</option>
              {farms.map((fa) => <option key={fa.id} value={fa.id}>{fa.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400">{T.fieldSizeField[lang]}</label>
            <input type="number" min="0.1" step="0.1" required value={form.size_acres}
              onChange={(e) => setForm((s) => ({ ...s, size_acres: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
          <div>
            <label className="text-xs text-gray-400">{T.fieldCropField[lang]}</label>
            <select value={form.crop_key} onChange={(e) => setForm((s) => ({ ...s, crop_key: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-400">
              {Object.keys(CROPS).map((k) => <option key={k} value={k}>{cropName(k, lang)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400">{T.fieldDeviceField[lang]}</label>
            <input value={form.device_id} placeholder="esp32-field-1" onChange={(e) => setForm((s) => ({ ...s, device_id: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
          <div>
            <label className="text-xs text-gray-400">{T.fieldLatField[lang]}</label>
            <input type="number" step="any" value={form.latitude} onChange={(e) => setForm((s) => ({ ...s, latitude: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
          <div>
            <label className="text-xs text-gray-400">{T.fieldLngField[lang]}</label>
            <input type="number" step="any" value={form.longitude} onChange={(e) => setForm((s) => ({ ...s, longitude: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
          <div>
            <label className="text-xs text-gray-400">{T.fieldDetailsField[lang]}</label>
            <input value={form.details} onChange={(e) => setForm((s) => ({ ...s, details: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
          <button type="submit" disabled={busy} className="md:col-span-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition">
            {T.saveNew[lang]}
          </button>
        </form>
      </div>

      {/* Field list */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><MapPin size={17} className="text-emerald-600" /> {T.fieldsTitle[lang]} ({fieldsList.length})</h3>
        {fieldsList.length === 0 ? (
          <p className="text-sm text-gray-400">{T.noFields[lang]}</p>
        ) : (
          <div className="space-y-2">
            {fieldsList.map((f) => (
              <div key={f.id} className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{f.name} · {f.size_acres} ac · {cropName(f.crop_key, lang)}</div>
                  <div className="text-xs text-gray-400 truncate flex flex-wrap gap-x-2">
                    {f.farm_name && <span>🏡 {f.farm_name}</span>}
                    {f.device_id && <span>📡 {f.device_id}</span>}
                    {f.latitude != null && f.longitude != null && <span>📍 {f.latitude.toFixed(3)}, {f.longitude.toFixed(3)}</span>}
                  </div>
                </div>
                <button onClick={() => removeField(f.id)} className="shrink-0 ml-2 text-red-400 hover:text-red-600"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// Analytics tab: seasonal comparison + data export downloads.
function AdminAnalyticsTab({ lang }) {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + "01";
  const [range, setRange] = useState({ a_start: firstOfMonth, a_end: today, b_start: "", b_end: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function compare() {
    setBusy(true);
    try {
      const qs = new URLSearchParams(Object.fromEntries(Object.entries(range).filter(([, v]) => v)));
      const res = await fetch(`${API_BASE}/api/season-compare/?${qs}`);
      if (res.ok) setResult(await res.json());
    } finally { setBusy(false); }
  }

  useEffect(() => { compare(); /* initial default comparison */ // eslint-disable-next-line
  }, []);

  const NUTRIENTS = [["n", "N"], ["p", "P"], ["k", "K"], ["ph", "pH"], ["moisture", "Moisture"]];
  const dl = (path) => `${API_BASE}/api${path}`;

  return (
    <>
      {/* Export */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
        <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2"><FolderOpen size={18} className="text-emerald-600" /> {T.exportTitle[lang]}</h3>
        <p className="text-xs text-gray-400 mb-4">{T.exportHint[lang]}</p>
        <div className="flex flex-wrap gap-2">
          <a href={dl("/export/readings.xlsx")} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition">📊 {T.exportReadings[lang]}</a>
          <a href={dl("/export/cost.xlsx")} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition">💰 {T.exportCost[lang]}</a>
          <a href={dl("/export/report.pdf")} className="inline-flex items-center gap-2 bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-xl text-sm font-medium transition">📄 {T.exportPdf[lang]}</a>
        </div>
      </div>

      {/* Seasonal comparison */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2"><BarChart3 size={18} className="text-emerald-600" /> {T.seasonTitle[lang]}</h3>
        <p className="text-xs text-gray-400 mb-4">{T.seasonHint[lang]}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {[["a", T.seasonPeriodA[lang]], ["b", T.seasonPeriodB[lang]]].map(([k, label]) => (
            <div key={k} className="rounded-xl bg-gray-50 p-3">
              <div className="text-xs font-medium text-gray-500 mb-2">{label}</div>
              <div className="flex items-center gap-2">
                <input type="date" value={range[`${k}_start`]} onChange={(e) => setRange((s) => ({ ...s, [`${k}_start`]: e.target.value }))}
                  className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                <span className="text-gray-400 text-xs">→</span>
                <input type="date" value={range[`${k}_end`]} onChange={(e) => setRange((s) => ({ ...s, [`${k}_end`]: e.target.value }))}
                  className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
              </div>
            </div>
          ))}
        </div>
        <button onClick={compare} disabled={busy} className="mb-4 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition">
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> {T.seasonCompareBtn[lang]}
        </button>

        {result && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="text-left text-gray-400 text-xs border-b border-gray-100">
                  <th className="py-2 pr-3 font-medium"> </th>
                  <th className="py-2 pr-3 font-medium">{T.seasonPeriodA[lang]}<br /><span className="text-[10px] text-gray-300">{result.a.start} → {result.a.end} · {result.a.count} {T.seasonReadings[lang]}</span></th>
                  <th className="py-2 pr-3 font-medium">{T.seasonPeriodB[lang]}<br /><span className="text-[10px] text-gray-300">{result.b.start} → {result.b.end} · {result.b.count} {T.seasonReadings[lang]}</span></th>
                  <th className="py-2 font-medium">{T.seasonDelta[lang]}</th>
                </tr>
              </thead>
              <tbody>
                {NUTRIENTS.map(([key, label]) => {
                  const d = result.deltas[key];
                  const color = !d ? "text-gray-300" : d.direction === "up" ? "text-emerald-600" : d.direction === "down" ? "text-amber-600" : "text-gray-500";
                  const arrow = !d ? "" : d.direction === "up" ? "▲" : d.direction === "down" ? "▼" : "—";
                  return (
                    <tr key={key} className="border-b border-gray-50">
                      <td className="py-2 pr-3 font-medium text-gray-700">{label}</td>
                      <td className="py-2 pr-3 tabular-nums">{result.a.avg[key] ?? "—"}</td>
                      <td className="py-2 pr-3 tabular-nums">{result.b.avg[key] ?? "—"}</td>
                      <td className={`py-2 tabular-nums font-medium ${color}`}>{d ? `${arrow} ${Math.abs(d.diff)}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {result.b.count === 0 && <p className="text-xs text-amber-500 mt-2">{T.seasonNoData[lang]} ({T.seasonPeriodB[lang]})</p>}
          </div>
        )}
      </div>
    </>
  );
}

// Compares the latest saved reading against a crop's database guideline.
function GuidelinePanel({ guideline, lang }) {
  if (!guideline || !guideline.crop) return null;
  const c = guideline.crop;
  const r = guideline.reading;
  const st = guideline.status;
  const badge = {
    optimal: "bg-emerald-100 text-emerald-700",
    low: "bg-red-100 text-red-700",
    high: "bg-amber-100 text-amber-700",
    unknown: "bg-gray-100 text-gray-400",
  };
  const stLabel = { optimal: T.stOptimal[lang], low: T.low[lang], high: T.high[lang], unknown: "—" };
  const rows = [
    { key: "n", label: "N", min: c.n_min, max: c.n_max, val: r.n, unit: "mg/kg" },
    { key: "p", label: "P", min: c.p_min, max: c.p_max, val: r.p, unit: "mg/kg" },
    { key: "k", label: "K", min: c.k_min, max: c.k_max, val: r.k, unit: "mg/kg" },
    { key: "ph", label: "pH", min: c.ph_min, max: c.ph_max, val: r.ph, unit: "" },
    { key: "moisture", label: T.moisture[lang], min: c.moisture_min, max: c.moisture_max, val: r.moisture, unit: "%" },
  ];
  const cropName = lang === "si" && c.name_si ? c.name_si : c.name_en;
  const notes = lang === "si" && c.notes_si ? c.notes_si : c.notes_en;
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
      <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
        <Leaf size={18} className="text-emerald-600" /> {T.guidelineTitle[lang]} — {cropName}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 text-xs">
              <th className="py-1.5 pr-3 font-medium"> </th>
              <th className="py-1.5 pr-3 font-medium">{T.guidelineRange[lang]}</th>
              <th className="py-1.5 pr-3 font-medium">{T.guidelineYour[lang]}</th>
              <th className="py-1.5 font-medium">{T.guidelineStatus[lang]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-gray-50">
                <td className="py-2 pr-3 font-medium text-gray-700">{row.label}</td>
                <td className="py-2 pr-3 text-gray-500">{row.min} – {row.max} {row.unit}</td>
                <td className="py-2 pr-3 font-semibold text-gray-800">{row.val ?? "—"} {row.unit}</td>
                <td className="py-2">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${badge[st[row.key]] || badge.unknown}`}>
                    {stLabel[st[row.key]] || "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-start gap-2 bg-blue-50 text-blue-700 px-3 py-2 rounded-xl text-sm">
        <Droplet size={16} className="mt-0.5 shrink-0" />
        <span>
          <span className="font-medium">{T.guidelineWater[lang]}:</span>{" "}
          {T.waterEvery[lang]} {c.water_frequency_days} {T.waterDaysUnit[lang]} · {c.water_amount_mm} mm
        </span>
      </div>
      {notes && <p className="text-xs text-gray-500 mt-2">{notes}</p>}
    </div>
  );
}

// Persisted reading history (from MySQL): a trend chart plus a recent table.
function HistorySection({ dbHistory, lang, onRefresh, loading }) {
  const locale = lang === "si" ? "si-LK" : "en-US";
  const chartData = dbHistory.map((row) => ({
    t: new Date(row.time).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
    n: row.n,
    p: row.p,
    k: row.k,
  }));
  const recent = dbHistory.slice().reverse().slice(0, 8); // most recent first

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <Skeleton className="h-5 w-40 mb-4" />
        <Skeleton className="h-[240px] w-full" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <TrendingUp size={18} className="text-emerald-600" /> {T.histTitle[lang]}
          {dbHistory.length > 0 && <span className="text-xs font-normal text-gray-400">({dbHistory.length} {T.histRows[lang]})</span>}
        </h3>
        <button onClick={onRefresh} className="flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2.5 py-1.5 rounded-lg transition">
          <RefreshCw size={12} /> {T.histRefresh[lang]}
        </button>
      </div>
      {dbHistory.length > 1 ? (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="t" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="n" stroke="#10b981" name="N" strokeWidth={2} dot={{ r: 2 }} />
            <Line type="monotone" dataKey="p" stroke="#f59e0b" name="P" strokeWidth={2} dot={{ r: 2 }} />
            <Line type="monotone" dataKey="k" stroke="#6366f1" name="K" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-sm text-gray-400 text-center py-8">{T.histEmpty[lang]}</p>
      )}
      {recent.length > 0 && (
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-xs">
                <th className="py-1.5 pr-3 font-medium">{T.colTime[lang]}</th>
                <th className="py-1.5 pr-3 font-medium">N</th>
                <th className="py-1.5 pr-3 font-medium">P</th>
                <th className="py-1.5 pr-3 font-medium">K</th>
                <th className="py-1.5 pr-3 font-medium">pH</th>
                <th className="py-1.5 font-medium">{T.moisture[lang]}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id} className="border-t border-gray-50 text-gray-700">
                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{new Date(row.time).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="py-2 pr-3">{row.n ?? "—"}</td>
                  <td className="py-2 pr-3">{row.p ?? "—"}</td>
                  <td className="py-2 pr-3">{row.k ?? "—"}</td>
                  <td className="py-2 pr-3">{row.ph ?? "—"}</td>
                  <td className="py-2">{row.moisture ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Health score -> color/label. Green (healthy) / amber (fair) / red (poor).
function healthColor(h) {
  if (h == null) return { color: "#9ca3af", key: "healthFair" };
  if (h >= 70) return { color: "#10b981", key: "healthGood" };
  if (h >= 45) return { color: "#f59e0b", key: "healthFair" };
  return { color: "#ef4444", key: "healthPoor" };
}

// Vanilla-leaflet choropleth-ish map: one circle per district, colored by soil
// health score and sized by how many lands report there. Reuses the same
// no-react-leaflet approach as LeafletMap to avoid React 19 peer issues.
function SoilHealthHeatmap({ regions, lang }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    mapRef.current = L.map(ref.current, { scrollWheelZoom: false }).setView([7.8731, 80.7718], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mapRef.current);
    layerRef.current = L.layerGroup().addTo(mapRef.current);
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const group = layerRef.current;
    if (!group) return;
    group.clearLayers();
    (regions || []).forEach((r) => {
      const d = DISTRICT_BY_EN[r.region];
      if (!d) return;
      const { color } = healthColor(r.health);
      L.circleMarker([d.lat, d.lng], {
        radius: 8 + Math.min(18, (r.lands || 0) * 2),
        color, fillColor: color, fillOpacity: 0.55, weight: 2,
      })
        .bindPopup(`<b>${lang === "si" ? d.si : d.en}</b><br>${T.regionLands[lang]}: ${r.lands}<br>${T.natHealthCol[lang]}: ${r.health ?? "—"}<br>N ${r.avg_n ?? "—"} · P ${r.avg_p ?? "—"} · K ${r.avg_k ?? "—"} · pH ${r.avg_ph ?? "—"}`)
        .addTo(group);
    });
  }, [regions, lang]);

  return <div ref={ref} className="w-full h-96 rounded-xl overflow-hidden border border-gray-100" />;
}

// Admin-only panel to create + list staff accounts (government / agronomist /
// admin). `authHeaders` carries whatever credential got us in (admin password
// or an admin staff token).
function StaffManager({ lang, authHeaders }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ username: "", password: "", role: "government", full_name: "" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/api/staff/list/`, { headers: authHeaders });
      if (res.ok) setList((await res.json()).staff);
    } catch { /* offline */ }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.username.trim() || form.password.length < 4) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/staff/create/`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(form),
      });
      if (res.ok) { setForm({ username: "", password: "", role: "government", full_name: "" }); await load(); setMsg(T.staffAdded[lang]); setTimeout(() => setMsg(null), 2500); }
    } finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
      <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><Shield size={18} className="text-emerald-600" /> {T.staffMgmtTitle[lang]}</h3>
      {msg && <div className="mb-3 text-sm text-emerald-600">{msg}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
        <input placeholder={T.staffUser[lang]} value={form.username} onChange={(e) => setForm((s) => ({ ...s, username: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input type="password" placeholder={T.staffPass[lang]} value={form.password} onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input placeholder={T.staffFullName[lang]} value={form.full_name} onChange={(e) => setForm((s) => ({ ...s, full_name: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <select value={form.role} onChange={(e) => setForm((s) => ({ ...s, role: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-gray-50">
          <option value="government">government</option>
          <option value="agronomist">agronomist</option>
          <option value="admin">admin</option>
        </select>
      </div>
      <button onClick={add} disabled={busy || !form.username.trim() || form.password.length < 4} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-medium mb-3">
        <CheckCircle2 size={14} /> {T.staffAddBtn[lang]}
      </button>
      <div className="flex flex-wrap gap-2">
        {list.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-100 rounded-full px-3 py-1 text-xs">
            <span className="font-medium text-gray-700">{s.username}</span>
            <span className="text-emerald-600">· {s.role}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// The national portal: a role-based view for government / agronomist / admin.
// Government sees regional soil health + fertilizer demand + heatmap; admins
// additionally manage staff. Self-contained staff session in localStorage.
function NationalDashboard({ lang, onBack, langBtn }) {
  const [staff, setStaff] = useState(() => { try { return JSON.parse(localStorage.getItem("npk-staff") || "null"); } catch { return null; } });
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState(false);
  const [soil, setSoil] = useState(null);
  const [fert, setFert] = useState(null);
  const [crops, setCrops] = useState(null); // region-crops: what's grown where

  useEffect(() => {
    if (!staff) return;
    (async () => {
      const [sh, fr, cr] = await Promise.all([
        fetch(`${API_BASE}/api/region-soil-health/`),
        fetch(`${API_BASE}/api/region-fertilizer/`),
        fetch(`${API_BASE}/api/region-crops/`),
      ]);
      if (sh.ok) setSoil(await sh.json());
      if (fr.ok) setFert(await fr.json());
      if (cr.ok) setCrops(await cr.json());
    })();
  }, [staff]);

  async function login() {
    setErr(false);
    try {
      const res = await fetch(`${API_BASE}/api/staff/login/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.trim(), password: pass }),
      });
      if (!res.ok) { setErr(true); return; }
      const data = await res.json();
      const s = { token: data.token, ...data.staff };
      setStaff(s); localStorage.setItem("npk-staff", JSON.stringify(s));
      setPass("");
    } catch { setErr(true); }
  }
  function logout() { setStaff(null); localStorage.removeItem("npk-staff"); }

  if (!staff) {
    return (
      <div className="min-h-screen app-bg p-4 md:p-8 flex items-center justify-center">
        <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-4"><Shield className="text-emerald-600" size={22} /><h1 className="font-bold text-gray-800">{T.staffLoginTitle[lang]}</h1></div>
          <label className="text-xs text-gray-500">{T.staffUser[lang]}</label>
          <input value={user} onChange={(e) => { setUser(e.target.value); setErr(false); }} className="w-full mt-1 mb-2 border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          <label className="text-xs text-gray-500">{T.staffPass[lang]}</label>
          <input type="password" value={pass} onChange={(e) => { setPass(e.target.value); setErr(false); }} onKeyDown={(e) => { if (e.key === "Enter") login(); }} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          {err && <p className="text-xs text-red-500 mt-1">{T.staffLoginErr[lang]}</p>}
          <div className="flex items-center gap-2 mt-4">
            <button onClick={login} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-sm font-medium">{T.staffLoginBtn[lang]}</button>
            <button onClick={onBack} className="text-sm text-gray-500 px-3 py-2">{T.backHome[lang]}</button>
          </div>
        </div>
      </div>
    );
  }

  const soilRows = soil?.regions?.filter((r) => r.region !== "Unspecified") || [];

  return (
    <div className="min-h-screen app-bg p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-emerald-600"><ArrowLeft size={16} /> {T.backHome[lang]}</button>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 text-emerald-700 px-3 py-2 rounded-xl text-sm font-medium"><Shield size={14} /> {staff.full_name || staff.username} · {staff.role}</span>
            {langBtn}
            <button onClick={logout} className="text-sm text-gray-500 hover:text-red-600 px-3 py-2">{T.logoutBtn[lang]}</button>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className="bg-emerald-600 p-3 rounded-2xl shadow-lg shadow-emerald-200"><Shield className="text-white" size={26} /></div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-800">{T.natTitle[lang]}</h1>
            <p className="text-sm text-gray-500">{T.natSubtitle[lang]}</p>
          </div>
        </div>

        {/* Soil health map */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><MapPin size={18} className="text-emerald-600" /> {T.natMapTitle[lang]}</h3>
          <SoilHealthHeatmap regions={soilRows} lang={lang} />
          <div className="flex gap-4 mt-3 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full" style={{ background: "#10b981" }} /> {T.healthGood[lang]}</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full" style={{ background: "#f59e0b" }} /> {T.healthFair[lang]}</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full" style={{ background: "#ef4444" }} /> {T.healthPoor[lang]}</span>
          </div>
        </div>

        {/* Soil health table */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><Leaf size={18} className="text-emerald-600" /> {T.natHealthTitle[lang]}</h3>
          {soilRows.length === 0 ? <p className="text-sm text-gray-400">{T.natNoData[lang]}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-3 font-medium">{T.regionCol[lang]}</th>
                  <th className="py-2 px-2 font-medium text-right">{T.regionLands[lang]}</th>
                  <th className="py-2 px-2 font-medium text-right">N</th>
                  <th className="py-2 px-2 font-medium text-right">P</th>
                  <th className="py-2 px-2 font-medium text-right">K</th>
                  <th className="py-2 px-2 font-medium text-right">pH</th>
                  <th className="py-2 pl-2 font-medium text-right">{T.natHealthCol[lang]}</th>
                </tr></thead>
                <tbody>
                  {soilRows.map((r) => {
                    const hc = healthColor(r.health);
                    return (
                      <tr key={r.region} className="border-b border-gray-50">
                        <td className="py-2 pr-3 font-medium text-gray-700">{DISTRICT_BY_EN[r.region] ? (lang === "si" ? DISTRICT_BY_EN[r.region].si : r.region) : r.region}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{r.lands}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{r.avg_n ?? "—"}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{r.avg_p ?? "—"}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{r.avg_k ?? "—"}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{r.avg_ph ?? "—"}</td>
                        <td className="py-2 pl-2 text-right">
                          <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: hc.color }}>
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: hc.color }} />
                            {r.health ?? "—"} {r.health != null && `· ${T[hc.key][lang]}`}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Fertilizer demand by district */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><Wallet size={18} className="text-emerald-600" /> {T.regionTitle[lang]}</h3>
          {!fert || fert.regions.filter((r) => r.region !== "Unspecified").length === 0 ? <p className="text-sm text-gray-400">{T.regionEmpty[lang]}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-3 font-medium">{T.regionCol[lang]}</th>
                  <th className="py-2 px-2 font-medium text-right">Urea (kg)</th>
                  <th className="py-2 px-2 font-medium text-right">TSP (kg)</th>
                  <th className="py-2 px-2 font-medium text-right">MOP (kg)</th>
                  <th className="py-2 pl-2 font-medium text-right">{T.regionTotalCost[lang]}</th>
                </tr></thead>
                <tbody>
                  {fert.regions.filter((r) => r.region !== "Unspecified").map((r) => (
                    <tr key={r.region} className="border-b border-gray-50">
                      <td className="py-2 pr-3 font-medium text-gray-700">{DISTRICT_BY_EN[r.region] ? (lang === "si" ? DISTRICT_BY_EN[r.region].si : r.region) : r.region}</td>
                      <td className="py-2 px-2 text-right text-gray-600">{r.urea_kg.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right text-gray-600">{r.tsp_kg.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right text-gray-600">{r.mop_kg.toLocaleString()}</td>
                      <td className="py-2 pl-2 text-right font-medium text-gray-800">{Math.round(r.total_cost).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* What's grown across the country (crop distribution) */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
          <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2"><BarChart3 size={18} className="text-emerald-600" /> {T.natCropsTitle[lang]}</h3>
          <p className="text-xs text-gray-400 mb-4">{T.natCropsHint[lang]}</p>
          {!crops || crops.crops.length === 0 ? <p className="text-sm text-gray-400">{T.natCropsEmpty[lang]}</p> : (() => {
            const cropName = (k) => (CROPS[k] ? CROPS[k].name[lang] : k);
            const maxLands = Math.max(...crops.crops.map((c) => c.lands), 1);
            const regionRows = crops.regions.filter((r) => r.region !== "Unspecified" && r.top_crop);
            return (
              <>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="rounded-xl bg-emerald-50 p-3 text-center">
                    <div className="text-lg font-bold text-emerald-700">{crops.totals.lands}</div>
                    <div className="text-xs text-gray-500">{T.natCropsLands[lang]}</div>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-3 text-center">
                    <div className="text-lg font-bold text-emerald-700">{crops.totals.crops_count}</div>
                    <div className="text-xs text-gray-500">{T.natCropsDistinct[lang]}</div>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-3 text-center">
                    <div className="text-lg font-bold text-emerald-700">{crops.totals.acres.toLocaleString()}</div>
                    <div className="text-xs text-gray-500">{T.natCropsAcres[lang]}</div>
                  </div>
                </div>

                <div className="overflow-x-auto mb-6">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-gray-400 border-b border-gray-100">
                      <th className="py-2 pr-3 font-medium">{T.cropCol[lang]}</th>
                      <th className="py-2 px-2 font-medium text-right">{T.cropLandsCol[lang]}</th>
                      <th className="py-2 px-2 font-medium text-right">{T.cropAcresCol[lang]}</th>
                      <th className="py-2 pl-2 font-medium w-1/3">{T.cropShareCol[lang]}</th>
                    </tr></thead>
                    <tbody>
                      {crops.crops.map((c) => (
                        <tr key={c.crop_key} className="border-b border-gray-50">
                          <td className="py-2 pr-3 font-medium text-gray-700">{cropName(c.crop_key)}</td>
                          <td className="py-2 px-2 text-right text-gray-600">{c.lands}</td>
                          <td className="py-2 px-2 text-right text-gray-600">{c.acres.toLocaleString()}</td>
                          <td className="py-2 pl-2">
                            <div className="h-2.5 rounded-full bg-emerald-500" style={{ width: `${Math.max(6, (c.lands / maxLands) * 100)}%` }} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {regionRows.length > 0 && (
                  <>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">{T.natCropsByRegion[lang]}</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-gray-400 border-b border-gray-100">
                          <th className="py-2 pr-3 font-medium">{T.regionCol[lang]}</th>
                          <th className="py-2 px-2 font-medium text-right">{T.regionLands[lang]}</th>
                          <th className="py-2 px-2 font-medium text-right">{T.natCropsDistinct[lang]}</th>
                          <th className="py-2 pl-2 font-medium">{T.topCropCol[lang]}</th>
                        </tr></thead>
                        <tbody>
                          {regionRows.map((r) => (
                            <tr key={r.region} className="border-b border-gray-50">
                              <td className="py-2 pr-3 font-medium text-gray-700">{DISTRICT_BY_EN[r.region] ? (lang === "si" ? DISTRICT_BY_EN[r.region].si : r.region) : r.region}</td>
                              <td className="py-2 px-2 text-right text-gray-600">{r.lands}</td>
                              <td className="py-2 px-2 text-right text-gray-600">{r.distinct_crops}</td>
                              <td className="py-2 pl-2 text-gray-700">{cropName(r.top_crop)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            );
          })()}
        </div>

        {/* Admin-only: staff management */}
        {staff.role === "admin" && <StaffManager lang={lang} authHeaders={{ "X-Staff-Token": staff.token }} />}
      </div>
    </div>
  );
}

export default function SoilDashboard() {
  const [view, setView] = useState("home"); // 'home' | 'dashboard' | 'details'
  const [lang, setLang] = useState("si");
  const [mode, setMode] = useState("existing");
  const [cropKey, setCropKey] = useState("tomato");
  const [candidateKey, setCandidateKey] = useState("tomato");
  const [reading, setReading] = useState({ n: 0, p: 0, k: 0, ph: 6.0, moisture: 60 });
  const [history, setHistory] = useState([]);
  const [manualMode, setManualMode] = useState(false);
  const [manualInput, setManualInput] = useState(reading);
  const [samples, setSamples] = useState([]);
  const [justCompleted, setJustCompleted] = useState(false);
  const [hasReading, setHasReading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null); // null | 'offline' | 'no-data'
  const [deviceOnline, setDeviceOnline] = useState(null); // null=checking | true | false
  const [aiPrediction, setAiPrediction] = useState(null); // trained-model crop prediction
  const [dbHistory, setDbHistory] = useState([]); // persisted readings from MySQL
  const [historyLoading, setHistoryLoading] = useState(true);
  const [anomalies, setAnomalies] = useState([]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [guideline, setGuideline] = useState(null); // /api/compare/ result

  const [lands, setLands] = useState([]);
  const [selectedLandId, setSelectedLandId] = useState(null);
  const [landName, setLandName] = useState("");
  const [landDetails, setLandDetails] = useState("");
  const [landSize, setLandSize] = useState("1"); // acres — needed for cost estimation
  const [ownerName, setOwnerName] = useState("");     // land owner (farmer)
  const [contactNumber, setContactNumber] = useState(""); // owner phone
  const [region, setRegion] = useState("");           // Sri Lanka district
  const [landFieldId, setLandFieldId] = useState(null); // linked backend Field id
  const [saveMsg, setSaveMsg] = useState(false);
  const [landsLoading, setLandsLoading] = useState(true);

  const [viewLand, setViewLand] = useState(null);
  const [viewLandId, setViewLandId] = useState(null);

  // --- Land session (login) state -------------------------------------------
  const [session, setSession] = useState(null); // { land_id, token, field } | null
  const [authReady, setAuthReady] = useState(false); // restored session yet?
  const [landPassword, setLandPassword] = useState(""); // register form password
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [loginErr, setLoginErr] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [registeredLand, setRegisteredLand] = useState(null); // {land_id} for success screen
  const [copied, setCopied] = useState(false);
  const [remembered, setRemembered] = useState(loadRemembered());

  useEffect(() => {
    (async () => {
      try {
        const idx = await storage.get("lands-index");
        if (idx && idx.value) setLands(JSON.parse(idx.value));
      } catch (e) {
        setLands([]);
      } finally {
        setLandsLoading(false);
      }
    })();
  }, []);

  // On load, restore a saved session and validate its token against the server.
  useEffect(() => {
    (async () => {
      const s = loadSession();
      if (s && s.token) {
        try {
          const res = await landFetch(s.token, "/api/land/me/");
          if (res.ok) {
            const data = await res.json();
            const restored = { land_id: data.land_id, token: s.token, field: data.field };
            setSession(restored);
            applyLandToState(data.field);
          } else {
            saveSession(null);
          }
        } catch { /* backend offline — stay logged out, keep saved session */ }
      }
      setAuthReady(true);
    })();
    // eslint-disable-next-line
  }, []);

  // Load a server Field (the land) into the working dashboard state.
  function applyLandToState(field) {
    if (!field) return;
    setSelectedLandId(field.id);
    setLandFieldId(field.id);
    setLandName(field.name || "");
    setLandDetails(field.details || "");
    setLandSize(String(field.size_acres || 1));
    setOwnerName(field.owner_name || "");
    setContactNumber(field.contact_number || "");
    setRegion(field.region || "");
    // Restore the saved crop + mode so everything the farmer chose reappears on
    // login, from any device. Fall back to inferring the mode from crop_key for
    // legacy lands saved before `mode` was persisted server-side.
    const savedMode = field.mode === "empty" || field.mode === "existing"
      ? field.mode
      : (field.crop_key && CROPS[field.crop_key] ? "existing" : "empty");
    setMode(savedMode);
    if (field.crop_key && CROPS[field.crop_key]) setCropKey(field.crop_key);
  }

  // Fetch this land's saved readings from the server (per-land history).
  async function loadLandReadings(token) {
    try {
      const res = await landFetch(token, "/api/land/latest/");
      if (res.ok) {
        const d = await res.json();
        if (d && d.n != null) {
          const r = { n: d.n, p: d.p, k: d.k, ph: d.ph ?? 6.0, moisture: d.moisture ?? 60 };
          setReading(r); setManualInput(r); setHasReading(true);
        }
      }
    } catch { /* offline — dashboard still works with a fresh scan */ }
  }

  function enterLandSession(s) {
    setSession(s);
    saveSession(s);
    rememberLand(s.land_id, s.field?.name || "");
    setRemembered(loadRemembered());
    applyLandToState(s.field);
    loadLandReadings(s.token);
    setLoginPw(""); setLandPassword(""); setLoginErr(false);
  }

  async function handleLogin(idArg) {
    const id = String(idArg ?? loginId).trim().toUpperCase();
    if (!id || !loginPw) { setLoginErr(true); return; }
    setAuthBusy(true); setLoginErr(false);
    try {
      const res = await fetch(`${API_BASE}/api/land/login/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ land_id: id, password: loginPw }),
      });
      if (!res.ok) { setLoginErr(true); return; }
      const data = await res.json();
      enterLandSession({ land_id: data.land_id, token: data.token, field: data.field });
      setView("dashboard");
    } catch {
      setLoginErr(true);
    } finally {
      setAuthBusy(false);
    }
  }

  function handleLogout() {
    if (session?.token) {
      landFetch(session.token, "/api/land/logout/", { method: "POST" }).catch(() => {});
    }
    setSession(null);
    saveSession(null);
    setSelectedLandId(null);
    setLandFieldId(null);
    setHasReading(false);
    setReading({ n: 0, p: 0, k: 0, ph: 6.0, moisture: 60 });
    setView("home");
  }

  // Persist edits to this land's own details back to the server (name / location
  // / size / crop). Server-backed so they follow the farmer to any device.
  async function handleSaveLandServer() {
    if (!session?.token) return;
    try {
      const res = await landFetch(session.token, "/api/land/update/", {
        method: "PUT",
        body: JSON.stringify({
          name: landName.trim(),
          details: landDetails.trim(),
          size_acres: Number(landSize) || 1,
          crop_key: mode === "existing" ? cropKey : "",
          mode,
          owner_name: ownerName.trim(),
          contact_number: contactNumber.trim(),
          region,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const s = { ...session, field: data.field };
        setSession(s); saveSession(s);
        rememberLand(session.land_id, landName.trim());
        setRemembered(loadRemembered());
        flashSaved();
      }
    } catch { /* offline — leave the form as-is */ }
  }

  // Auto-save the crop + mode the instant the farmer changes them, so the crop
  // being grown is always persisted (no need to press "Update This Land") and
  // reappears on the next login from any device. Takes the next values as args
  // because React state updates are async.
  async function persistCropMode(nextMode, nextCrop) {
    if (!session?.token) return;
    try {
      const res = await landFetch(session.token, "/api/land/update/", {
        method: "PUT",
        body: JSON.stringify({ mode: nextMode, crop_key: nextMode === "existing" ? nextCrop : "" }),
      });
      if (res.ok) {
        const data = await res.json();
        const s = { ...session, field: data.field };
        setSession(s); saveSession(s);
      }
    } catch { /* offline — re-saves on the next change or via the Update button */ }
  }

  async function persistIndex(newLands) {
    try {
      await storage.set("lands-index", JSON.stringify(newLands), false);
    } catch (e) {
      console.error("index save failed", e);
    }
  }

  function currentSnapshot(id, name, details, updatedAt, createdAt) {
    return {
      id, name, details, mode, cropKey, candidateKey, reading, history,
      sizeAcres: Number(landSize) || 1, fieldId: landFieldId,
      updatedAt, createdAt: createdAt || updatedAt,
    };
  }

  async function handleSaveNew() {
    if (!landName.trim()) return;
    const id = "land_" + Date.now();
    const updatedAt = Date.now();
    const data = currentSnapshot(id, landName.trim(), landDetails.trim(), updatedAt, updatedAt);
    try {
      await storage.set(`land:${id}`, JSON.stringify(data), false);
      const newLands = [...lands, indexEntry(data)];
      setLands(newLands);
      await persistIndex(newLands);
      setSelectedLandId(id);
      flashSaved();
    } catch (e) {
      console.error("save failed", e);
    }
  }

  // The lightweight per-land entry kept in the lands index (home grid reads this
  // without opening each full snapshot).
  function indexEntry(data) {
    return {
      id: data.id, name: data.name, details: data.details,
      sizeAcres: data.sizeAcres, mode: data.mode,
      cropKey: data.mode === "existing" ? data.cropKey : data.candidateKey,
      updatedAt: data.updatedAt,
    };
  }

  async function handleUpdateLand() {
    if (!selectedLandId) return;
    const updatedAt = Date.now();
    const data = currentSnapshot(selectedLandId, landName.trim() || "Land", landDetails.trim(), updatedAt);
    try {
      await storage.set(`land:${selectedLandId}`, JSON.stringify(data), false);
      const newLands = lands.map((l) => (l.id === selectedLandId ? { ...l, ...indexEntry(data) } : l));
      setLands(newLands);
      await persistIndex(newLands);
      flashSaved();
    } catch (e) {
      console.error("update failed", e);
    }
  }

  async function handleLoadLand(id) {
    try {
      const res = await storage.get(`land:${id}`);
      if (res && res.value) {
        const data = JSON.parse(res.value);
        setSelectedLandId(id);
        setLandName(data.name || "");
        setLandDetails(data.details || "");
        setLandSize(String(data.sizeAcres || 1));
        setLandFieldId(data.fieldId || null);
        setMode(data.mode || "existing");
        setCropKey(CROPS[data.cropKey] ? data.cropKey : "tomato");
        setCandidateKey(CROPS[data.candidateKey] ? data.candidateKey : "tomato");
        setReading(data.reading || reading);
        setManualInput(data.reading || reading);
        setHistory(data.history || []);
        setSamples([]);
        setHasReading(!!data.reading);
        setScanError(null);
      }
    } catch (e) {
      console.error("load failed", e);
    }
  }

  async function handleDeleteLand(id) {
    try {
      await storage.delete(`land:${id}`);
    } catch (e) {
      console.error("delete failed", e);
    }
    const newLands = lands.filter((l) => l.id !== id);
    setLands(newLands);
    await persistIndex(newLands);
    if (selectedLandId === id) {
      setSelectedLandId(null);
      setLandName("");
      setLandDetails("");
    }
  }

  function handleNewLandForm() {
    setSelectedLandId(null);
    setLandName("");
    setLandDetails("");
    setLandSize("1");
    setLandFieldId(null);
  }

  function startFresh(newMode) {
    setSelectedLandId(null);
    setLandName("");
    setLandDetails("");
    setLandSize("1");
    setLandFieldId(null);
    setMode(newMode);
    setReading({ n: 0, p: 0, k: 0, ph: 6.0, moisture: 60 });
    setHasReading(false);
    setScanError(null);
    setHistory([]);
    setSamples([]);
    setView("dashboard");
  }

  // Registration flow: register a land on the server (name, location, SIZE and
  // a password). The server mints a Land ID and returns a session token; we log
  // the farmer straight in and show them the Land ID to note down.
  async function handleRegisterLand() {
    if (!landName.trim() || !(Number(landSize) > 0)) return;
    if (landPassword.length < 4) { setLoginErr(true); return; }
    setAuthBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/land/register/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: landName.trim(),
          details: landDetails.trim(),
          size_acres: Number(landSize),
          crop_key: mode === "existing" ? cropKey : "",
          mode,
          owner_name: ownerName.trim(),
          contact_number: contactNumber.trim(),
          region,
          password: landPassword,
        }),
      });
      if (!res.ok) { setLoginErr(true); return; }
      const data = await res.json();
      const s = { land_id: data.land_id, token: data.token, field: data.field };
      enterLandSession(s);

      // Fresh land: clear any stale reading and show the Land ID confirmation.
      setReading({ n: 0, p: 0, k: 0, ph: 6.0, moisture: 60 });
      setManualInput({ n: 0, p: 0, k: 0, ph: 6.0, moisture: 60 });
      setHasReading(false);
      setScanError(null);
      setHistory([]);
      setSamples([]);
      setRegisteredLand({ land_id: data.land_id });
      setCopied(false);
      setView("registered");
    } catch {
      setLoginErr(true);
    } finally {
      setAuthBusy(false);
    }
  }

  function openLand(id) {
    handleLoadLand(id);
    setView("dashboard");
  }

  // Open a blank registration form (defaults to empty-land so the app can
  // recommend a crop for a freshly registered plot).
  function startRegister() {
    setSelectedLandId(null);
    setLandName("");
    setLandDetails("");
    setLandSize("1");
    setOwnerName("");
    setContactNumber("");
    setRegion("");
    setLandFieldId(null);
    setLandPassword("");
    setLoginErr(false);
    setMode("empty");
    setCropKey("tomato");
    setCandidateKey("tomato");
    setView("register");
  }

  async function viewLandDetails(id) {
    setViewLandId(id);
    setViewLand(null);
    setView("details");
    try {
      const res = await storage.get(`land:${id}`);
      if (res && res.value) setViewLand(JSON.parse(res.value));
    } catch (e) {
      console.error("details load failed", e);
    }
  }

  async function deleteFromDetails(id) {
    await handleDeleteLand(id);
    setView("home");
  }

  function flashSaved() {
    setSaveMsg(true);
    setTimeout(() => setSaveMsg(false), 2000);
  }

  // Empty-land ranking covers annual vegetables only (soil-scan → best crop to
  // plant). Perennial export/spice crops are a reference library, not ranked here.
  const suitabilityList = Object.entries(CROPS)
    .filter(([, c]) => c.cat !== "spice")
    .map(([key, c]) => ({ key, crop: c, score: suitabilityScore(reading, c) }))
    .sort((a, b) => b.score - a.score);

  useEffect(() => {
    if (mode === "empty") {
      setCandidateKey(suitabilityList[0].key);
    }
    // eslint-disable-next-line
  }, [reading, mode]);

  // Ask the trained crop-recommendation model for its prediction (empty-land
  // mode only). Silently hides if the model is untrained or the backend is off.
  useEffect(() => {
    if (mode !== "empty" || !hasReading) { setAiPrediction(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/predict/`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reading),
        });
        if (!res.ok) { if (!cancelled) setAiPrediction(null); return; }
        const d = await res.json();
        if (!cancelled) setAiPrediction(d);
      } catch { if (!cancelled) setAiPrediction(null); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [reading, mode, hasReading]);

  useEffect(() => {
    if (!hasReading) return; // don't log placeholder/zero readings
    setHistory((h) => {
      const next = [...h, { time: new Date().toLocaleTimeString(lang === "si" ? "si-LK" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), n: reading.n, p: reading.p, k: reading.k }];
      return next.slice(-10);
    });
    // eslint-disable-next-line
  }, [reading]);

  async function handleScan() {
    if (scanning || deviceOnline === false) return;
    setScanning(true);
    setScanError(null);
    let r;
    try {
      r = await fetchLiveReading(manualInput);
    } catch (e) {
      setScanError(e.message === "no-data" ? "no-data" : "offline");
      setScanning(false);
      return; // no fake data — stop here on failure
    }
    setScanning(false);
    setSamples((prev) => {
      const next = [...prev, r];
      if (next.length >= 3) {
        const avg = averageReadings(next);
        setReading(avg);
        setManualInput(avg);
        setHasReading(true);
        setJustCompleted(true);
        setTimeout(() => setJustCompleted(false), 2500);
        saveReadingToLand(avg); // attach the completed scan to this land
        return [];
      }
      return next;
    });
  }

  function applyManual() {
    setReading(manualInput);
    setHasReading(true);
    setScanError(null);
    saveReadingToLand(manualInput);
  }

  // Persist a reading (scan average or manual entry) to the logged-in land, so
  // it's this land's own history/trend — not mixed with any other farmer's.
  async function saveReadingToLand(r) {
    if (!session?.token) return;
    try {
      await landFetch(session.token, "/api/land/reading/", {
        method: "POST",
        body: JSON.stringify(r),
      });
      loadDbHistory();
    } catch (e) {
      /* backend offline — reading still shown locally, just not persisted */
    }
  }

  // This land's persisted history (survives restarts), for the trend chart.
  async function loadDbHistory() {
    if (!session?.token) return;
    setHistoryLoading(true);
    try {
      const res = await landFetch(session.token, "/api/land/history/");
      if (res.ok) setDbHistory((await res.json()).readings);
    } catch (e) {
      /* backend offline — leave existing history in place */
    } finally {
      setHistoryLoading(false);
    }
    loadAnomalies();
  }

  // Sensor sanity: ask the server whether this land's recent readings look
  // stuck / spiked / impossible, so the dashboard can warn about a bad sensor.
  async function loadAnomalies() {
    if (!session?.token) return;
    try {
      const res = await landFetch(session.token, "/api/land/anomalies/");
      if (res.ok) setAnomalies((await res.json()).anomalies || []);
    } catch (e) { /* offline — skip */ }
  }

  // Build the DOA per-acre plan rows and download them as a PDF from the server.
  async function downloadPlanPdf() {
    if (!session?.token || !crop.fert) return;
    setPdfBusy(true);
    const acres = Number(landSize) || 1;
    const scale = (v) => (v == null ? null : +((v / ACRES_PER_HA) * acres).toFixed(1));
    const rows = crop.fert.map((row) => ({
      stage: row[lang], urea: scale(row.urea), tsp: scale(row.tsp), mop: scale(row.mop),
    }));
    const sum = (key) => +rows.reduce((a, r) => a + (r[key] || 0), 0).toFixed(1);
    try {
      const res = await landFetch(session.token, "/api/land/plan.pdf", {
        method: "POST",
        body: JSON.stringify({
          crop_name: crop.name[lang], size_acres: acres, reading,
          rows, totals: { urea: sum("urea"), tsp: sum("tsp"), mop: sum("mop") },
        }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `fertilizer-plan-${session.land_id}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (e) { /* offline */ } finally {
      setPdfBusy(false);
    }
  }

  // Compare the latest saved reading against a crop's DB guideline (this land only).
  async function loadCompare(key) {
    try {
      const fieldQ = session?.field?.id ? `&field=${session.field.id}` : "";
      const res = await fetch(`${API_BASE}/api/compare/?crop=${key}${fieldQ}`);
      setGuideline(res.ok ? await res.json() : null);
    } catch (e) {
      setGuideline(null);
    }
  }

  useEffect(() => {
    if (view === "dashboard") loadDbHistory();
    // eslint-disable-next-line
  }, [view]);

  useEffect(() => {
    if (view === "dashboard" && hasReading) loadCompare(activeCropKey);
    else setGuideline(null);
    // eslint-disable-next-line
  }, [view, hasReading, mode, cropKey, candidateKey, reading]);

  // Poll the backend for whether the ESP32 is actively sending data, so the
  // Scan button can be disabled (rather than clicked and only then failing)
  // when the device isn't connected. The firmware posts every ~5s, so a
  // reading older than DEVICE_STALE_MS means it's gone quiet.
  useEffect(() => {
    if (view !== "dashboard") return undefined;
    let cancelled = false;
    const DEVICE_STALE_MS = 20000;

    async function checkDevice() {
      try {
        const res = await fetch(`${API_BASE}/api/latest/`);
        if (!res.ok) throw new Error();
        const d = await res.json();
        const fresh = d.time && (Date.now() - new Date(d.time).getTime()) < DEVICE_STALE_MS;
        if (!cancelled) setDeviceOnline(!!(fresh && d.n != null));
      } catch {
        if (!cancelled) setDeviceOnline(false);
      }
    }

    checkDevice();
    const timer = setInterval(checkDevice, 6000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [view]);

  // Route by session: a land dashboard needs a session (else -> home/login),
  // and a logged-in farmer should never land on the login screen (-> dashboard).
  useEffect(() => {
    if (!authReady) return;
    if (!session && (view === "dashboard" || view === "details" || view === "registered")) {
      setView("home");
    } else if (session && view === "home") {
      setView("dashboard");
    }
    // eslint-disable-next-line
  }, [authReady, session, view]);

  const activeCropKey = mode === "existing" ? cropKey : candidateKey;
  const crop = CROPS[activeCropKey];

  const statuses = {
    n: statusOf(reading.n, crop.n),
    p: statusOf(reading.p, crop.p),
    k: statusOf(reading.k, crop.k),
    ph: statusOf(reading.ph, crop.ph),
    moisture: statusOf(reading.moisture, crop.moisture),
  };

  const deficiencies = ["n", "p", "k"].filter((k) => statuses[k] !== "ok");
  const allGood = deficiencies.length === 0 && statuses.ph === "ok" && statuses.moisture === "ok";

  const LangBtn = (
    <button
      onClick={() => setLang((l) => (l === "si" ? "en" : "si"))}
      className="flex items-center gap-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-3 py-2 rounded-xl text-sm font-medium transition shadow-sm"
    >
      <Languages size={16} />
      {lang === "si" ? "English" : "සිංහල"}
    </button>
  );

  // ---------- AUTH SPLASH (restoring a saved session) ----------
  if (!authReady) {
    return (
      <div className="min-h-screen app-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="bg-emerald-600 p-4 rounded-3xl shadow-lg shadow-emerald-200 animate-pulse">
            <Sprout className="text-white" size={32} />
          </div>
          <p className="text-sm text-gray-400">...</p>
        </div>
      </div>
    );
  }

  // ---------- ADMIN VIEW ----------
  if (view === "admin") {
    return <AdminView lang={lang} onBack={() => setView("home")} langBtn={LangBtn} />;
  }

  // ---------- NATIONAL / OFFICER PORTAL (role-based) ----------
  if (view === "national") {
    return <NationalDashboard lang={lang} onBack={() => setView("home")} langBtn={LangBtn} />;
  }

  // ---------- REGISTERED (show the new Land ID) ----------
  if (view === "registered" && registeredLand) {
    return (
      <div className="min-h-screen app-bg p-4 md:p-8 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-2xl p-8 shadow-lg border border-emerald-100 text-center">
          <div className="inline-flex bg-emerald-100 text-emerald-600 p-4 rounded-2xl mb-4">
            <CheckCircle2 size={32} />
          </div>
          <h1 className="text-xl font-bold text-gray-800 mb-1">{T.regSuccessTitle[lang]}</h1>
          <p className="text-sm text-gray-500 mb-5">{T.regSuccessBody[lang]}</p>

          <div className="bg-emerald-50 border border-dashed border-emerald-300 rounded-xl p-4 mb-2">
            <p className="text-[11px] uppercase tracking-wide text-emerald-600 font-semibold mb-1">{T.landIdBadge[lang]}</p>
            <p className="text-3xl font-mono font-bold text-emerald-700 tracking-widest">{registeredLand.land_id}</p>
          </div>
          <button
            onClick={() => { navigator.clipboard?.writeText(registeredLand.land_id); setCopied(true); }}
            className="text-xs text-emerald-600 hover:text-emerald-700 font-medium mb-6"
          >
            {copied ? T.regSuccessCopied[lang] : T.regSuccessCopy[lang]}
          </button>

          <button
            onClick={() => { setRegisteredLand(null); setView("dashboard"); }}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition shadow-sm"
          >
            {T.regSuccessContinue[lang]} <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  // ---------- HOME VIEW ----------
  if (view === "home") {
    return (
      <div className="min-h-screen app-bg p-4 md:p-8">
        <div className="max-w-md mx-auto">
          <div className="flex justify-end items-center gap-2 mb-2 flex-wrap">
            <button
              onClick={() => setView("national")}
              className="flex items-center gap-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-2 rounded-xl text-sm font-medium transition shadow-sm"
            >
              <Shield size={16} /> {T.officerPortal[lang]}
            </button>
            <button
              onClick={() => setView("admin")}
              className="flex items-center gap-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-2 rounded-xl text-sm font-medium transition shadow-sm"
            >
              <ScanLine size={16} /> {T.adminBtn[lang]}
            </button>
            {LangBtn}
          </div>

          <div className="text-center mb-8 mt-4">
            <div className="inline-flex bg-gradient-to-br from-emerald-500 to-emerald-700 p-4 rounded-3xl shadow-lg shadow-emerald-200/70 ring-1 ring-emerald-400/30 mb-4 animate-floaty">
              <Sprout className="text-white" size={36} />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-gradient-brand mb-2 pb-1 leading-tight">{T.title[lang]}</h1>
            <p className="text-gray-500 max-w-md mx-auto text-sm md:text-base">{T.appTagline[lang]}</p>
          </div>

          {/* Sign in to an existing land (Land ID + password) */}
          <div className="bg-white rounded-2xl p-5 shadow-soft border border-gray-100 mb-4">
            <div className="flex items-center gap-2 mb-1">
              <FolderOpen size={18} className="text-emerald-600" />
              <h2 className="font-semibold text-gray-800">{T.loginTitle[lang]}</h2>
            </div>
            <p className="text-xs text-gray-400 mb-3">{T.loginSubtitle[lang]}</p>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-500 font-medium">{T.loginIdLabel[lang]}</label>
                <input
                  value={loginId}
                  onChange={(e) => { setLoginId(e.target.value.toUpperCase()); setLoginErr(false); }}
                  placeholder={T.loginIdPlaceholder[lang]}
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono tracking-wider uppercase focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">{T.loginPwLabel[lang]}</label>
                <input
                  type="password" value={loginPw}
                  onChange={(e) => { setLoginPw(e.target.value); setLoginErr(false); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              {loginErr && <p className="text-xs text-red-500">{T.loginError[lang]}</p>}
              <button
                onClick={() => handleLogin()} disabled={authBusy}
                className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition shadow-sm"
              >
                <FolderOpen size={16} /> {T.loginBtn[lang]}
              </button>
            </div>

            {remembered.length > 0 && (
              <div className="mt-4 pt-3 border-t border-gray-100">
                <p className="text-[11px] text-gray-400 mb-2">{T.rememberedLandsTitle[lang]} · {T.quickLoginHint[lang]}</p>
                <div className="flex flex-wrap gap-2">
                  {remembered.map((l) => (
                    <span key={l.land_id} className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-100 rounded-full pl-3 pr-1 py-1 text-xs">
                      <button
                        onClick={() => { setLoginId(l.land_id); setLoginErr(false); }}
                        className="font-mono font-semibold text-emerald-700"
                        title={l.name}
                      >
                        {l.land_id}{l.name ? ` · ${l.name}` : ""}
                      </button>
                      <button
                        onClick={() => { forgetLand(l.land_id); setRemembered(loadRemembered()); }}
                        className="text-gray-300 hover:text-red-400 px-1"
                        title={T.forgetBtn[lang]}
                      >
                        <XCircle size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Register a brand-new land (mints a Land ID) */}
          <button
            onClick={startRegister}
            className="w-full text-left bg-gradient-to-br from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 rounded-2xl p-5 shadow-lg shadow-emerald-200/70 lift group flex items-center gap-4"
          >
            <div className="bg-white/20 text-white w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 group-hover:scale-105 transition">
              <MapPin size={24} />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-white text-base mb-0.5">{T.registerCta[lang]}</h3>
              <p className="text-xs text-emerald-50">{T.registerCtaDesc[lang]}</p>
            </div>
            <ArrowRight size={20} className="text-white ml-auto shrink-0" />
          </button>
        </div>
      </div>
    );
  }

  // ---------- REGISTER VIEW ----------
  if (view === "register") {
    const canSubmit = landName.trim() && Number(landSize) > 0 && landPassword.length >= 4;
    return (
      <div className="min-h-screen app-bg p-4 md:p-8">
        <div className="max-w-xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setView("home")} className="flex items-center gap-2 text-sm text-gray-500 hover:text-emerald-600 transition">
              <ArrowLeft size={16} /> {T.backHome[lang]}
            </button>
            {LangBtn}
          </div>

          <div className="flex items-center gap-3 mb-6">
            <div className="bg-emerald-600 p-3 rounded-2xl shadow-lg shadow-emerald-200"><MapPin className="text-white" size={26} /></div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-gray-800">{T.registerTitle[lang]}</h1>
              <p className="text-sm text-gray-500">{T.registerSubtitle[lang]}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-4">
            <div>
              <label className="text-xs text-gray-500 font-medium">{T.regNameLabel[lang]}</label>
              <input
                value={landName} autoFocus
                onChange={(e) => setLandName(e.target.value)}
                placeholder={T.landNamePlaceholder[lang]}
                className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium">{T.regOwnerLabel[lang]}</label>
              <input
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder={T.regOwnerPlaceholder[lang]}
                className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 font-medium">{T.regContactLabel[lang]}</label>
                <input
                  type="tel" value={contactNumber}
                  onChange={(e) => setContactNumber(e.target.value)}
                  placeholder={T.regContactPlaceholder[lang]}
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">{T.regRegionLabel[lang]}</label>
                <select
                  value={region} onChange={(e) => setRegion(e.target.value)}
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                >
                  <option value="">{T.regRegionPlaceholder[lang]}</option>
                  {SL_DISTRICTS.map((d) => (
                    <option key={d.en} value={d.en}>{lang === "si" ? d.si : d.en}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium">{T.regLocationLabel[lang]}</label>
              <input
                value={landDetails}
                onChange={(e) => setLandDetails(e.target.value)}
                placeholder={T.landDetailsPlaceholder[lang]}
                className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium">{T.regSizeLabel[lang]}</label>
              <input
                type="number" min="0.1" step="0.1" value={landSize}
                onChange={(e) => setLandSize(e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium">{T.regPasswordLabel[lang]}</label>
              <input
                type="password" value={landPassword}
                onChange={(e) => { setLandPassword(e.target.value); setLoginErr(false); }}
                placeholder={T.regPasswordPlaceholder[lang]}
                className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
              {loginErr && <p className="text-xs text-red-500 mt-1">{T.regPasswordPlaceholder[lang]}</p>}
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">{T.regModeLabel[lang]}</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                <button
                  type="button" onClick={() => setMode("empty")}
                  className={`text-left rounded-xl p-3 border-2 transition ${mode === "empty" ? "border-emerald-500 bg-emerald-50" : "border-gray-100 hover:border-gray-200"}`}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-800"><Star size={15} className="text-amber-500" /> {T.regModeEmpty[lang]}</div>
                </button>
                <button
                  type="button" onClick={() => setMode("existing")}
                  className={`text-left rounded-xl p-3 border-2 transition ${mode === "existing" ? "border-emerald-500 bg-emerald-50" : "border-gray-100 hover:border-gray-200"}`}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-800"><Leaf size={15} className="text-emerald-600" /> {T.regModeExisting[lang]}</div>
                </button>
              </div>
            </div>

            {mode === "existing" && (
              <div>
                <label className="text-xs text-gray-500 font-medium">{T.regExistingCropLabel[lang]}</label>
                <select
                  value={cropKey} onChange={(e) => setCropKey(e.target.value)}
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                >
                  <optgroup label={T.catVeg[lang]}>
                    {Object.entries(CROPS).filter(([, v]) => v.cat !== "spice").map(([k, v]) => (
                      <option key={k} value={k}>{v.name[lang]}</option>
                    ))}
                  </optgroup>
                  <optgroup label={T.catSpice[lang]}>
                    {Object.entries(CROPS).filter(([, v]) => v.cat === "spice").map(([k, v]) => (
                      <option key={k} value={k}>{v.name[lang]}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleRegisterLand} disabled={!canSubmit}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-medium transition shadow-sm"
              >
                <CheckCircle2 size={16} /> {T.registerBtn[lang]}
              </button>
              <button onClick={() => setView("home")} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2.5">{T.registerCancel[lang]}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- DETAILS VIEW ----------
  if (view === "details") {
    if (!viewLand) {
      return (
        <div className="min-h-screen app-bg p-4 md:p-8 flex items-center justify-center">
          <p className="text-gray-400 text-sm">{T.loadingDetails[lang]}</p>
        </div>
      );
    }
    const dCropKey = CROPS[viewLand.mode === "existing" ? viewLand.cropKey : viewLand.candidateKey]
      ? (viewLand.mode === "existing" ? viewLand.cropKey : viewLand.candidateKey)
      : "tomato";
    const dCrop = CROPS[dCropKey];
    const dStatuses = {
      n: statusOf(viewLand.reading.n, dCrop.n),
      p: statusOf(viewLand.reading.p, dCrop.p),
      k: statusOf(viewLand.reading.k, dCrop.k),
      ph: statusOf(viewLand.reading.ph, dCrop.ph),
      moisture: statusOf(viewLand.reading.moisture, dCrop.moisture),
    };
    const dAllGood = ["n", "p", "k"].every((k) => dStatuses[k] === "ok") && dStatuses.ph === "ok" && dStatuses.moisture === "ok";
    const dSuitabilityList =
      viewLand.mode === "empty"
        ? Object.entries(CROPS)
            .filter(([, c]) => c.cat !== "spice")
            .map(([key, c]) => ({ key, crop: c, score: suitabilityScore(viewLand.reading, c) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 6)
        : [];

    return (
      <div className="min-h-screen app-bg p-4 md:p-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setView("home")} className="flex items-center gap-2 text-sm text-gray-500 hover:text-emerald-600 transition">
              <ArrowLeft size={16} /> {T.backHome[lang]}
            </button>
            {LangBtn}
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <h1 className="text-xl font-bold text-gray-800 mb-1">{viewLand.name}</h1>
                {viewLand.details && <p className="text-sm text-gray-500 mb-2">{viewLand.details}</p>}
                <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                  <span className="flex items-center gap-1"><Calendar size={12} /> {T.createdOn[lang]} {new Date(viewLand.createdAt || viewLand.updatedAt).toLocaleDateString(lang === "si" ? "si-LK" : "en-US")}</span>
                  <span>{T.lastUpdated[lang]} {new Date(viewLand.updatedAt).toLocaleString(lang === "si" ? "si-LK" : "en-US")}</span>
                </div>
              </div>
              <span className={`text-xs font-medium px-3 py-1.5 rounded-full ${viewLand.mode === "existing" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {viewLand.mode === "existing" ? T.modeExisting[lang] : T.modeEmpty[lang]}
              </span>
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              <button
                onClick={() => openLand(viewLand.id)}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition shadow-sm"
              >
                <ScanLine size={16} /> {T.openInDashboard[lang]}
              </button>
              <button
                onClick={() => deleteFromDetails(viewLand.id)}
                className="flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2 rounded-xl text-sm font-medium transition"
              >
                <Trash2 size={16} /> {T.delete[lang]}
              </button>
            </div>
          </div>

          <h3 className="font-semibold text-gray-800 mb-3">{T.snapshotTitle[lang]} — <span className="text-emerald-700">{dCrop.name[lang]}</span></h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            <NutrientCard label={T.n[lang]} value={viewLand.reading.n} unit="mg/kg" range={dCrop.n} icon={<Leaf size={16} />} lang={lang} />
            <NutrientCard label={T.p[lang]} value={viewLand.reading.p} unit="mg/kg" range={dCrop.p} icon={<Leaf size={16} />} lang={lang} />
            <NutrientCard label={T.k[lang]} value={viewLand.reading.k} unit="mg/kg" range={dCrop.k} icon={<Leaf size={16} />} lang={lang} />
            <NutrientCard label={T.ph[lang]} value={viewLand.reading.ph} unit="" range={dCrop.ph} icon={<Droplet size={16} />} lang={lang} />
            <NutrientCard label={T.moisture[lang]} value={viewLand.reading.moisture} unit="%" range={dCrop.moisture} icon={<Droplet size={16} />} lang={lang} />
          </div>

          {viewLand.mode === "empty" && (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
              <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Star size={18} className="text-amber-500" /> {T.suitabilityTitle[lang]}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {dSuitabilityList.map(({ key, crop: c, score }, idx) => (
                  <div key={key} className={`rounded-xl p-3 border-2 ${key === dCropKey ? "border-emerald-500 bg-emerald-50" : "border-gray-100 bg-gray-50"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm text-gray-800">{c.name[lang]}</span>
                      {idx === 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">
                          <Star size={10} fill="currentColor" /> {T.bestMatch[lang]}
                        </span>
                      )}
                    </div>
                    <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mb-1">
                      <div className={`h-full rounded-full ${score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-400"}`} style={{ width: `${score}%` }} />
                    </div>
                    <span className="text-xs text-gray-500">{T.suitability[lang]}: {score}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Sprout size={18} className="text-emerald-600" /> {T.recTitle[lang]}
            </h3>
            {dAllGood ? (
              <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-4 py-3 rounded-xl text-sm">
                <CheckCircle2 size={18} /> {T.allGood[lang]}
              </div>
            ) : (
              <div className="space-y-2">
                {["n", "p", "k"].map((key) => {
                  if (dStatuses[key] === "ok") return null;
                  const label = T[key][lang];
                  const rec = dStatuses[key] === "low" ? FERTILIZERS[key].low[lang] : FERTILIZERS[key].high[lang];
                  return (
                    <div key={key} className={`flex items-start gap-3 px-4 py-3 rounded-xl text-sm ${dStatuses[key] === "low" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                      {dStatuses[key] === "low" ? <XCircle size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
                      <div>
                        <span className="font-medium">{label} {dStatuses[key] === "low" ? T.low[lang] : T.high[lang]}.</span>{" "}
                        {T.recommendation[lang]} {rec}
                      </div>
                    </div>
                  );
                })}
                {dStatuses.ph !== "ok" && (
                  <div className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm bg-blue-50 text-blue-700">
                    <Droplet size={18} className="mt-0.5 shrink-0" />
                    <div>{dStatuses.ph === "low" ? T.phLowMsg[lang] : T.phHighMsg[lang]}</div>
                  </div>
                )}
                {dStatuses.moisture !== "ok" && (
                  <div className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm bg-indigo-50 text-indigo-700">
                    <Droplet size={18} className="mt-0.5 shrink-0" />
                    <div>{dStatuses.moisture === "low" ? T.moistLowMsg[lang] : T.moistHighMsg[lang]}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          <FertilizerProgram crop={dCrop} lang={lang} />

          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <TrendingUp size={18} className="text-emerald-600" /> {T.trendsTitle[lang]}
            </h3>
            {viewLand.history && viewLand.history.length > 1 ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={viewLand.history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="n" stroke="#10b981" name="N" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="p" stroke="#f59e0b" name="P" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="k" stroke="#6366f1" name="K" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-gray-400 text-center py-10">{T.noHistoryYet[lang]}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------- DASHBOARD VIEW ----------
  return (
    <div className="min-h-screen app-bg p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 p-3 rounded-2xl shadow-lg shadow-emerald-200">
              <Sprout className="text-white" size={28} />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-gray-800">{T.title[lang]}</h1>
              <p className="text-sm text-gray-500">{T.subtitle[lang]}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {session && (
              <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 text-emerald-700 px-3 py-2 rounded-xl text-sm font-medium">
                <MapPin size={14} /> {T.landIdBadge[lang]}: <span className="font-mono font-bold tracking-wide">{session.land_id}</span>
              </span>
            )}
            {LangBtn}
          </div>
        </div>

        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-500 transition"
          >
            <ArrowLeft size={16} /> {T.logoutBtn[lang]}
          </button>
        </div>

        {/* Land management */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <MapPin size={16} className="text-emerald-600" /> {T.landsTitle[lang]}
            </h3>
          </div>

          {selectedLandId && (
            <div className="text-xs text-gray-400 mb-2">
              {T.editingNote[lang]} <span className="font-medium text-gray-600">{landName}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <input
              value={landName}
              onChange={(e) => setLandName(e.target.value)}
              placeholder={T.landNamePlaceholder[lang]}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
            <input
              value={landDetails}
              onChange={(e) => setLandDetails(e.target.value)}
              placeholder={T.landDetailsPlaceholder[lang]}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
            <input
              type="number" min="0.1" step="0.1" value={landSize}
              onChange={(e) => setLandSize(e.target.value)}
              placeholder={T.regSizeLabel[lang]}
              title={T.regSizeLabel[lang]}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>

          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <button
              onClick={handleSaveLandServer}
              disabled={!landName.trim()}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl text-sm font-medium transition shadow-sm"
            >
              <Save size={14} /> {T.updateLand[lang]}
            </button>
            {saveMsg && <span className="text-xs text-emerald-600 font-medium">{T.savedMsg[lang]}</span>}
          </div>
        </div>

        {/* Mode toggle */}
        <div className="bg-white rounded-2xl p-2 shadow-sm border border-gray-100 mb-4 flex gap-2">
          <button
            onClick={() => { setMode("existing"); persistCropMode("existing", cropKey); }}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition ${mode === "existing" ? "bg-emerald-600 text-white shadow-sm" : "text-gray-500 hover:bg-gray-50"}`}
          >
            {T.modeExisting[lang]}
          </button>
          <button
            onClick={() => { setMode("empty"); persistCropMode("empty", cropKey); }}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition ${mode === "empty" ? "bg-emerald-600 text-white shadow-sm" : "text-gray-500 hover:bg-gray-50"}`}
          >
            {T.modeEmpty[lang]}
          </button>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6 flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            {mode === "existing" && (
              <>
                <label className="text-sm font-medium text-gray-600">{T.crop[lang]}</label>
                <select
                  value={cropKey}
                  onChange={(e) => { setCropKey(e.target.value); persistCropMode("existing", e.target.value); }}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                >
                  <optgroup label={T.catVeg[lang]}>
                    {Object.entries(CROPS).filter(([, v]) => v.cat !== "spice").map(([k, v]) => (
                      <option key={k} value={k}>{v.name[lang]}</option>
                    ))}
                  </optgroup>
                  <optgroup label={T.catSpice[lang]}>
                    {Object.entries(CROPS).filter(([, v]) => v.cat === "spice").map(([k, v]) => (
                      <option key={k} value={k}>{v.name[lang]}</option>
                    ))}
                  </optgroup>
                </select>
              </>
            )}
            {mode === "empty" && <span className="text-sm text-gray-500">{T.suitabilityHint[lang]}</span>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {hasReading && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {T.liveData[lang]}
              </span>
            )}
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${deviceOnline === true ? "bg-emerald-100 text-emerald-700" : deviceOnline === false ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${deviceOnline === true ? "bg-emerald-500" : deviceOnline === false ? "bg-red-500" : "bg-gray-400"}`} />
              {deviceOnline === true ? T.deviceOnlineLabel[lang] : deviceOnline === false ? T.deviceOfflineLabel[lang] : T.deviceChecking[lang]}
            </span>
            <button
              onClick={handleScan}
              disabled={scanning || deviceOnline === false}
              title={deviceOnline === false ? T.deviceOfflineHint[lang] : undefined}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl text-sm font-medium transition shadow-sm"
            >
              <RefreshCw size={16} className={scanning ? "animate-spin" : ""} /> {scanning ? T.scanning[lang] : `${T.scan[lang]} (${samples.length}/3)`}
            </button>
            <button
              onClick={() => setManualMode((m) => !m)}
              className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium transition"
            >
              {T.manual[lang]}
            </button>
          </div>
        </div>

        {deviceOnline === false && (
          <div className="flex items-start gap-3 bg-amber-50 text-amber-700 px-4 py-3 rounded-2xl text-sm mb-6">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>{T.deviceOfflineHint[lang]}</div>
          </div>
        )}

        {/* Sample collection panel */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-gray-700">{T.sampleTitle[lang]}</h3>
            {samples.length > 0 && (
              <button onClick={() => setSamples([])} className="text-xs text-gray-400 hover:text-gray-600 underline">
                {T.resetSamples[lang]}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 mb-1">{T.sampleHint[lang]}</p>
          <p className="text-xs text-amber-600 mb-3">{T.npkOnlyNote[lang]}</p>
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => {
              const s = samples[i];
              return (
                <div key={i} className={`rounded-xl p-3 border text-xs ${s ? "bg-emerald-50 border-emerald-200" : "border-dashed border-gray-200 text-gray-300"}`}>
                  <div className="font-medium mb-1 text-gray-500">{T.sampleLabel[lang]} {i + 1}</div>
                  {s ? (
                    <div className="space-y-0.5 text-gray-600">
                      <div>N:{s.n} P:{s.p} K:{s.k}</div>
                      <div>pH:{s.ph} {T.moisture[lang]}:{s.moisture}%</div>
                    </div>
                  ) : (
                    <div>—</div>
                  )}
                </div>
              );
            })}
          </div>
          {justCompleted && (
            <div className="mt-3 flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-2 rounded-xl text-xs">
              <CheckCircle2 size={14} /> {T.averageDone[lang]}
            </div>
          )}
          {scanError && (
            <div className="mt-3 flex items-start gap-2 bg-red-50 text-red-700 px-3 py-2 rounded-xl text-xs">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {scanError === "no-data" ? T.errNoData[lang] : T.errOffline[lang]}
            </div>
          )}
        </div>

        {/* Manual input panel */}
        {manualMode && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{T.manualTitle[lang]}</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {["n", "p", "k", "ph", "moisture"].map((key) => (
                <div key={key}>
                  <label className="text-xs text-gray-400 uppercase">{key}</label>
                  <input
                    type="number"
                    step={key === "ph" ? "0.1" : "1"}
                    value={manualInput[key]}
                    onChange={(e) => setManualInput((m) => ({ ...m, [key]: +e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>
              ))}
            </div>
            <button
              onClick={applyManual}
              className="mt-3 bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
            >
              {T.apply[lang]}
            </button>
          </div>
        )}

        {/* AI model prediction (from the trained crop-recommendation model) */}
        {mode === "empty" && hasReading && aiPrediction?.prediction && (
          <div className="bg-gradient-to-r from-violet-50 to-emerald-50 rounded-2xl p-5 shadow-sm border border-violet-100 mb-6">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Sprout size={18} className="text-violet-600" /> {T.aiPickTitle[lang]}
            </h3>
            <div className="flex flex-wrap gap-2">
              {aiPrediction.ranked.map((r, i) => (
                <span key={r.crop} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${i === 0 ? "bg-violet-600 text-white" : "bg-white text-gray-600 border border-gray-200"}`}>
                  {i === 0 && "🤖"} {cropName(r.crop, lang)} <span className={i === 0 ? "text-violet-200" : "text-gray-400"}>{Math.round(r.confidence * 100)}%</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Crop suitability ranking */}
        {mode === "empty" && hasReading && (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Star size={18} className="text-amber-500" /> {T.suitabilityTitle[lang]}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {suitabilityList.slice(0, 6).map(({ key, crop: c, score }, idx) => {
                const selected = key === candidateKey;
                const barColor = score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-400";
                return (
                  <button
                    key={key}
                    onClick={() => setCandidateKey(key)}
                    className={`text-left rounded-xl p-3 border-2 transition ${selected ? "border-emerald-500 bg-emerald-50" : "border-gray-100 hover:border-gray-200 bg-gray-50"}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm text-gray-800">{c.name[lang]}</span>
                      {idx === 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">
                          <Star size={10} fill="currentColor" /> {T.bestMatch[lang]}
                        </span>
                      )}
                    </div>
                    <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mb-1">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${score}%` }} />
                    </div>
                    <span className="text-xs text-gray-500">{T.suitability[lang]}: {score}%</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* No sensor reading yet */}
        {!hasReading && (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-dashed border-gray-200 mb-6 text-center">
            <div className="inline-flex bg-gray-100 text-gray-400 w-12 h-12 rounded-2xl items-center justify-center mb-3">
              <ScanLine size={22} />
            </div>
            <h3 className="font-semibold text-gray-700 mb-1">{T.noReadingTitle[lang]}</h3>
            <p className="text-sm text-gray-400 max-w-sm mx-auto">{T.noReadingMsg[lang]}</p>
          </div>
        )}

        {/* Sensor anomaly warning (stuck / spike / impossible readings) */}
        {anomalies.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6">
            <div className="flex items-center gap-2 font-semibold text-red-700 mb-2">{T.anomalyTitle[lang]}</div>
            <ul className="space-y-1 text-sm text-red-700">
              {[...new Set(anomalies.map((a) => a.type))].map((type) => (
                <li key={type} className="flex gap-2">
                  <span>•</span>
                  <span>{type === "stuck" ? T.anomalyStuck[lang] : type === "spike" ? T.anomalySpike[lang] : T.anomalyRange[lang]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Nutrient cards + recommendation (only after a real reading) */}
        {hasReading && (
        <>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          <NutrientCard label={T.n[lang]} value={reading.n} unit="mg/kg" range={crop.n} icon={<Leaf size={16} />} lang={lang} />
          <NutrientCard label={T.p[lang]} value={reading.p} unit="mg/kg" range={crop.p} icon={<Leaf size={16} />} lang={lang} />
          <NutrientCard label={T.k[lang]} value={reading.k} unit="mg/kg" range={crop.k} icon={<Leaf size={16} />} lang={lang} />
          <NutrientCard label={T.ph[lang]} value={reading.ph} unit="" range={crop.ph} icon={<Droplet size={16} />} lang={lang} />
          <NutrientCard label={T.moisture[lang]} value={reading.moisture} unit="%" range={crop.moisture} icon={<Droplet size={16} />} lang={lang} />
        </div>

        {/* Recommendation panel */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Sprout size={18} className="text-emerald-600" />
            {mode === "existing" ? T.recTitle[lang] : T.prepFertilizerTitle[lang]} — {crop.name[lang]}
          </h3>
          {allGood ? (
            <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-4 py-3 rounded-xl text-sm">
              <CheckCircle2 size={18} /> {T.allGood[lang]}
            </div>
          ) : (
            <div className="space-y-3">
              {["n", "p", "k"].map((key) => {
                if (statuses[key] === "ok") return null;
                const isLow = statuses[key] === "low";
                const headline = REC_HEADLINE[key][isLow ? "low" : "high"][lang];
                const plan = isLow ? fertPerAcrePlan(crop, FERT_KEY_FOR[key]) : null;
                const acres = Number(landSize) || 1;
                return (
                  <div key={key} className={`px-4 py-3 rounded-xl text-sm ${isLow ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                    <div className="flex items-start gap-3">
                      {isLow ? <XCircle size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
                      <span className="font-semibold text-base">{headline}</span>
                    </div>
                    {plan && (
                      <div className="mt-2 ml-8 bg-white/70 rounded-lg p-3 text-gray-700">
                        <div className="text-xs font-semibold text-gray-500 mb-1.5">{T.exactPlanTitle[lang]}</div>
                        <ul className="space-y-1 text-xs">
                          {plan.stages.map((s, i) => (
                            <li key={i} className="flex justify-between gap-3">
                              <span className="text-gray-500">{s.stage[lang]}</span>
                              <span className="font-medium tabular-nums shrink-0">{s.perAcre} kg {FERT_LABEL[FERT_KEY_FOR[key]]} / {T.perAcreLabel[lang]}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="flex justify-between gap-3 mt-2 pt-2 border-t border-gray-100 text-xs font-semibold">
                          <span>{T.totalForLandLabel[lang]} ({acres} {T.acresUnit[lang]})</span>
                          <span className="tabular-nums">{+(plan.totalPerAcre * acres).toFixed(1)} kg {FERT_LABEL[FERT_KEY_FOR[key]]}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {statuses.ph !== "ok" && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm bg-blue-50 text-blue-700">
                  <Droplet size={18} className="mt-0.5 shrink-0" />
                  <div>{statuses.ph === "low" ? T.phLowMsg[lang] : T.phHighMsg[lang]}</div>
                </div>
              )}
              {statuses.moisture !== "ok" && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm bg-indigo-50 text-indigo-700">
                  <Droplet size={18} className="mt-0.5 shrink-0" />
                  <div>{statuses.moisture === "low" ? T.moistLowMsg[lang] : T.moistHighMsg[lang]}</div>
                </div>
              )}
            </div>
          )}
        </div>

        <CropInfo crop={crop} lang={lang} />

        <PlantingAdvicePanel crop={crop} activeCropKey={activeCropKey} lang={lang} />

        <GuidelinePanel guideline={guideline} lang={lang} />

        <FertilizerProgram crop={crop} lang={lang} />

        {crop.fert && (
          <div className="no-print flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
            >
              <Printer size={16} /> {T.printPlanBtn[lang]}
            </button>
            <button
              onClick={downloadPlanPdf} disabled={pdfBusy}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
            >
              <FileText size={16} /> {pdfBusy ? "..." : T.downloadPdfBtn[lang]}
            </button>
          </div>
        )}
        <PrintFertilizerPlan
          crop={crop} lang={lang} landName={landName} ownerName={ownerName}
          landId={session?.land_id} landSize={landSize} reading={reading} statuses={statuses}
        />

        <CostEstimatePanel
          crop={crop} activeCropKey={activeCropKey} lang={lang}
          defaultSize={Number(landSize) || 1} defaultFieldId={landFieldId}
          landName={landName}
        />
        </>
        )}

        {/* Saved reading history (from MySQL) */}
        <HistorySection dbHistory={dbHistory} lang={lang} onRefresh={loadDbHistory} loading={historyLoading} />

        <ForecastPanel lang={lang} fieldId={session?.field?.id} />

        <p className="text-center text-xs text-gray-400 mt-6">{T.footer[lang]}</p>
        <p className="text-center text-[11px] text-gray-400 mt-2">{T.soilRangeNote[lang]}</p>
        <p className="text-center text-[11px] text-gray-500 mt-1 font-medium">{T.dataSource[lang]}</p>
      </div>
    </div>
  );
}
