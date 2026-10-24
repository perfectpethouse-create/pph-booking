// ═══════════════════════════════════════════════════════════════
// theme.js — โทนสีของแอป (ส้มแบรนด์ = ค่าเริ่มต้น / เขียว / คราม)
// เก็บไว้ในเครื่องนี้เท่านั้น (localStorage) — ไม่แตะฐานข้อมูล
// แต่ละเครื่อง/แต่ละคนเลือกโทนเองได้ ไม่กระทบคนอื่น
// ═══════════════════════════════════════════════════════════════
import { el } from './ui.js';

const KEY = 'pph_theme';
// สีจุดตัวอย่าง + สีแถบสถานะเบราว์เซอร์ (meta theme-color) ของแต่ละโทน
export const THEMES = [
  { id: 'warm',   label: 'ส้ม',   color: '#F4650F' },
  { id: 'teal',   label: 'เขียว', color: '#0FA08D' },
  { id: 'indigo', label: 'คราม',  color: '#4E5BF2' },
];

export function currentTheme() {
  try { return localStorage.getItem(KEY) || 'warm'; } catch { return 'warm'; }
}

export function applyTheme(id) {
  const t = THEMES.find(x => x.id === id) || THEMES[0];
  // ส้มคือค่าใน :root อยู่แล้ว จึงไม่ต้องใส่ attribute
  if (t.id === 'warm') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t.id);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.color);
  document.querySelectorAll('.theme-dot').forEach(d =>
    d.setAttribute('aria-pressed', String(d.dataset.theme === t.id)));
}

export function setTheme(id) {
  try { localStorage.setItem(KEY, id); } catch { /* โหมดส่วนตัว — ใช้ได้แค่รอบนี้ */ }
  applyTheme(id);
}

// ปุ่มจุดสี 3 อัน — ใช้ทั้งแถบข้าง (คอม) และแผ่นเลื่อน "เพิ่มเติม" (มือถือ)
export function themePicker(withLabel = false) {
  const cur = currentTheme();
  return el('div', { class: 'theme-pick', role: 'group', 'aria-label': 'โทนสี' }, [
    withLabel ? el('span', { class: 'tp-lbl', text: 'โทนสี' }) : null,
    ...THEMES.map(t => el('button', {
      class: 'theme-dot', type: 'button', style: `background:${t.color}`,
      'data-theme': t.id, 'aria-label': 'โทน' + t.label, 'aria-pressed': String(t.id === cur),
      onclick: () => setTheme(t.id),
    })),
  ]);
}
