// On-device language model (narrative layer of the corner coach): Apple Foundation Models on iOS 26,
// Gemini Nano via ML Kit on supported Android phones. Nothing leaves the device. The deterministic coach
// facts are the input; the model only puts them into a few plain sentences. Without a model the app uses templates.

import { isNative } from './deviceNative.js';
import { state } from './state.js';
import { getLanguage } from './i18n.js';

function plugin() { const C = window.Capacitor; return (C.Plugins && C.Plugins.RnDevice) || C.registerPlugin('RnDevice'); }
let statusCache = null;

/** @returns {Promise<{available:boolean, provider:'apple'|'gemini'|'none', status?:string}>} */
export async function aiStatus() {
  if (!isNative() || state.settings.aiCoach === false) return { available: false, provider: 'none' };
  if (statusCache) return statusCache;
  try { statusCache = await plugin().aiAvailable(); } catch (e) { statusCache = { available: false, provider: 'none', status: String(e && e.message || e) }; }
  return statusCache;
}
export function resetAiStatus() { statusCache = null; }

/** Turns the coach facts (already rendered as sentences) into a short narrative. Throws when the model is unavailable. */
export async function aiNarrate(factLines) {
  const lang = getLanguage() === 'de' ? 'German' : 'English';
  const instructions = `You are a calm, friendly racing driving coach talking to an amateur driver. Write 3 to 4 short sentences in ${lang}, plain words, second person. Use only the facts given below; do not invent numbers or corners; no headings, no bullet points, no emojis.`;
  const prompt = `Facts about the driver's lap compared with the fastest lap:\n${factLines.join('\n')}\n\nExplain where and why the time is lost and give one concrete thing to try next lap.`;
  const r = await plugin().aiGenerate({ prompt, instructions, maxTokens: 220 });
  const text = ((r && r.text) || '').trim();
  if (!text) throw new Error('empty answer');
  return text;
}
