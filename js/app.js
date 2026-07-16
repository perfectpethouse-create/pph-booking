// ═══════════════════════════════════════════════════════════════
// app.js — จุดเริ่มต้น: boot DB, ล็อกอิน, และ router สลับหน้า
// ═══════════════════════════════════════════════════════════════
import { initDb, MODE, onAuthChanged, signIn, signOutUser, listenSettings } from './db.js';
import { setSettingsCache, setUser, toast, escapeHtml } from './ui.js';
import { icons } from './icons.js';

import { renderDashboard } from './dashboard.js';
import { renderBookings } from './bookings.js';
import { renderCalendar } from './calendar.js';
import { renderCustomers } from './customers.js';
import { renderRegistrations } from './registrations.js';
import { renderReports } from './reports.js';
import { renderSettings } from './settings.js';
import { renderBackup } from './backup.js';

const ROUTES = {
  dashboard: renderDashboard,
  bookings: renderBookings,
  calendar: renderCalendar,
  customers: renderCustomers,
  registrations: renderRegistrations,
  reports: renderReports,
  settings: renderSettings,
  backup: renderBackup,
};

const loginScreen = document.getElementById('login-screen');
const appEl = document.getElementById('app');
const contentEl = document.getElementById('content');

// ใส่ไอคอน SVG ให้เมนูตาม route (แทน emoji — คมชัด/สม่ำเสมอทุกเครื่อง)
const NAV_ICONS = {
  dashboard: icons.home,
  bookings: icons.bookings,
  calendar: icons.calendar,
  customers: icons.paw,
  registrations: icons.inbox,
  reports: icons.chart,
  settings: icons.settings,
  backup: icons.backup,
};
document.querySelectorAll('.navlink').forEach(b => {
  const ico = b.querySelector('.ico');
  if (ico && NAV_ICONS[b.dataset.route]) ico.innerHTML = NAV_ICONS[b.dataset.route];
});

let settingsUnsub = null;

async function boot() {
  await initDb();

  // ป้ายบอกโหมด
  const badge = document.getElementById('mode-badge');
  const hint = document.getElementById('login-hint');
  if (MODE === 'mock') {
    badge.textContent = 'โหมดทดลอง · ข้อมูลอยู่ในเครื่องนี้';
    badge.classList.remove('hidden');
    hint.textContent = 'โหมดทดลอง: พิมพ์อีเมล/รหัสอะไรก็เข้าได้ (ยังไม่ได้ตั้ง Firebase)';
  }

  onAuthChanged((user) => {
    if (user) showApp(user);
    else showLogin();
  });
}

function showLogin() {
  if (settingsUnsub) { settingsUnsub(); settingsUnsub = null; }
  appEl.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

function showApp(user) {
  setUser(user);
  document.getElementById('who-email').textContent = user.email || '';
  loginScreen.classList.add('hidden');
  appEl.classList.remove('hidden');

  // subscribe settings เรียลไทม์ → เก็บในแคชให้ทุกหน้าใช้
  if (!settingsUnsub) settingsUnsub = listenSettings((s) => setSettingsCache(s));

  navigate(location.hash.replace('#', '') || 'dashboard');
}

function navigate(route) {
  if (!ROUTES[route]) route = 'dashboard';
  location.hash = route;
  document.querySelectorAll('.navlink').forEach(b =>
    b.classList.toggle('active', b.dataset.route === route));
  contentEl.innerHTML = '';
  try {
    ROUTES[route](contentEl);
  } catch (err) {
    console.error(err);
    contentEl.innerHTML = `<div class="card"><p class="pill red">เกิดข้อผิดพลาด: ${escapeHtml(err.message)}</p></div>`;
  }
}

// ── event: nav ──
document.querySelectorAll('.navlink').forEach(b =>
  b.addEventListener('click', () => navigate(b.dataset.route)));
window.addEventListener('hashchange', () => {
  const r = location.hash.replace('#', '');
  if (r && ROUTES[r] && !appEl.classList.contains('hidden')) navigate(r);
});

// ── event: login ──
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  try {
    await signIn(email, pass);
    // onAuthChanged จะพาไปหน้าแอปเอง (firestore) — mock ต้องเรียกเอง
    if (MODE === 'mock') showApp({ uid: 'mock_' + email, email });
  } catch (err) {
    errEl.textContent = mapAuthError(err);
    errEl.classList.remove('hidden');
  }
});

document.getElementById('logout-btn').addEventListener('click', () => signOutUser());

function mapAuthError(err) {
  const c = err.code || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found'))
    return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (c.includes('invalid-email')) return 'อีเมลไม่ถูกต้อง';
  if (c.includes('too-many-requests')) return 'ลองผิดหลายครั้ง กรุณารอสักครู่';
  return err.message || 'เข้าสู่ระบบไม่สำเร็จ';
}

// เปิดให้หน้าอื่นสั่งเปลี่ยนหน้าได้
export function go(route) { navigate(route); }
window.__go = navigate;

boot().catch(err => {
  document.getElementById('login-hint').textContent = 'เริ่มระบบไม่สำเร็จ: ' + err.message;
  console.error(err);
});
