// Session weather from Open-Meteo (free, no key, CC BY 4.0 – attribution shown in Settings).
// One request per session (track position + date), hourly values, cached in IndexedDB.

import { state } from './state.js';
import { db } from './db.js';
import { t } from './i18n.js';

const HOURLY = 'temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,weather_code,relative_humidity_2m';
const mem = new Map();

/** WMO weather code → { icon, key } */
export function describeWeatherCode(code) {
  const c = Number(code);
  if (c === 0) return { icon: '☀️', key: 'wx_clear' };
  if (c === 1 || c === 2) return { icon: '⛅', key: 'wx_partly' };
  if (c === 3) return { icon: '☁️', key: 'wx_cloudy' };
  if (c === 45 || c === 48) return { icon: '🌫️', key: 'wx_fog' };
  if (c >= 51 && c <= 57) return { icon: '🌦️', key: 'wx_drizzle' };
  if (c >= 61 && c <= 67) return { icon: '🌧️', key: 'wx_rain' };
  if (c >= 71 && c <= 77) return { icon: '🌨️', key: 'wx_snow' };
  if (c >= 80 && c <= 82) return { icon: '🌦️', key: 'wx_showers' };
  if (c >= 95) return { icon: '⛈️', key: 'wx_thunder' };
  return { icon: '🌡️', key: 'wx_unknown' };
}

/** Wet session? true when the hours saw rain (WMO code ≥ 51) or measurable precipitation; null when unknown. */
export function isWet(w) {
  if (!w) return null;
  const code = Number(w.code), precip = Number(w.precip);
  if (!Number.isFinite(code) && !Number.isFinite(precip)) return null;
  return (Number.isFinite(code) && code >= 51) || (Number.isFinite(precip) && precip > 0.5);
}

export function windDirectionLabel(deg) {
  if (!Number.isFinite(deg)) return '';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

function sessionPosition(laps) {
  for (const l of laps) {
    const pts = l.trackDef && (l.trackDef.startLine || []).concat(...(l.trackDef.sectors || []).map((s) => s.points || []));
    const p = pts && pts.find((q) => Number.isFinite(q.lat) && Number.isFinite(q.lng) && Math.abs(q.lat) > 0.01);
    if (p) return { lat: p.lat, lng: p.lng };
  }
  return null;
}

function isoDate(ms) { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

async function fetchHourly(lat, lng, date) {
  const ageDays = (Date.now() - new Date(date).getTime()) / 86400000;
  const q = `latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&hourly=${HOURLY}&timeformat=unixtime&timezone=UTC`;
  const urls = ageDays > 6
    ? [`https://archive-api.open-meteo.com/v1/archive?${q}&start_date=${date}&end_date=${date}`]
    : [`https://api.open-meteo.com/v1/forecast?${q}&past_days=${Math.min(92, Math.max(1, Math.ceil(ageDays) + 1))}&forecast_days=1`];
  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
    const j = await res.json();
    if (j && j.hourly && j.hourly.time && j.hourly.time.length) return j.hourly;
  }
  throw new Error('no weather data');
}

/**
 * Weather summary for the laps of one session, or null when unavailable.
 * @returns {Promise<null|{temp:number, precip:number, wind:number, windDir:number, code:number, humidity:number, icon:string, text:string}>}
 */
export async function getSessionWeather(laps) {
  if (state.settings.weather === false || !laps.length) return null;
  const pos = sessionPosition(laps);
  if (!pos) return null;
  const times = laps.map((l) => l.startMs).filter(Number.isFinite).sort((a, b) => a - b);
  if (!times.length) return null;
  const date = isoDate(times[0]);
  const key = `weather:${pos.lat.toFixed(2)}|${pos.lng.toFixed(2)}|${date}`;
  let hourly = mem.get(key);
  if (!hourly) {
    hourly = await db.getSetting(key, null);
    if (!hourly) {
      if (navigator.onLine === false) return null;
      try { hourly = await fetchHourly(pos.lat, pos.lng, date); } catch (e) { console.warn('weather', e.message); return null; }
      await db.setSetting(key, hourly);
    }
    mem.set(key, hourly);
  }
  // hours touched by the session (nearest hour per lap start)
  const idx = new Set();
  for (const ms of times) {
    let best = -1, bd = Infinity;
    hourly.time.forEach((ts, i) => { const d = Math.abs(ts * 1000 - ms); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && bd < 2 * 3600 * 1000) idx.add(best);
  }
  if (!idx.size) return null;
  const pick = (arr) => [...idx].map((i) => arr && arr[i]).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const temps = pick(hourly.temperature_2m), prec = pick(hourly.precipitation), wind = pick(hourly.wind_speed_10m), dirs = pick(hourly.wind_direction_10m), codes = pick(hourly.weather_code), hum = pick(hourly.relative_humidity_2m);
  if (!temps.length) return null;
  const code = codes.length ? Math.max(...codes) : NaN; // worst weather of the session hours
  const { icon, key: k } = describeWeatherCode(code);
  const w = { temp: avg(temps), precip: prec.reduce((x, y) => x + y, 0), wind: avg(wind), windDir: avg(dirs), code, humidity: avg(hum), icon };
  const units = state.settings.units === 'imperial';
  const tempTxt = units ? `${Math.round(w.temp * 9 / 5 + 32)} °F` : `${Math.round(w.temp)} °C`;
  const windTxt = Number.isFinite(w.wind) ? ` · ${Math.round(units ? w.wind * 0.621371 : w.wind)} ${units ? 'mph' : 'km/h'} ${windDirectionLabel(w.windDir)}` : '';
  const precTxt = w.precip > 0.05 ? ` · ${w.precip.toFixed(1)} mm` : ` · ${t('wx_dry')}`;
  w.text = `${icon} ${t(k)} ${tempTxt}${windTxt}${precTxt}`;
  return w;
}
