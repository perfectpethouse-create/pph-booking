// ═══════════════════════════════════════════════════════════════
// app.js — จุดเริ่มต้น: boot DB, ล็อกอิน, และ router สลับหน้า
// ═══════════════════════════════════════════════════════════════
import { initDb, MODE, onAuthChanged, signIn, signOutUser, listenSettings } from './db.js';
import { el, setSettingsCache, setUser, toast, escapeHtml, isStaff, staffCan, getSettings, currentUser, confirmDialog } from './ui.js';
import { STAFF_PERM_ITEMS } from './config-shop.js';
import { icons, brandLogo } from './icons.js';

import { renderDashboard } from './dashboard.js';
import { renderStaffToday } from './staff-today.js';
import { renderBookings } from './bookings.js';
import { renderCalendar } from './calendar.js';
import { renderAppointments } from './appointments.js';
import { renderCustomers } from './customers.js';
import { renderRegistrations } from './registrations.js';
import { renderBookingRequests } from './booking-requests.js';
import { renderReports } from './reports.js';
import { renderSettings } from './settings.js';
import { renderBackup } from './backup.js';

const ROUTES = {
  dashboard: renderDashboard,
  today: renderStaffToday,
  bookings: renderBookings,
  appointments: renderAppointments,
  calendar: renderCalendar,
  customers: renderCustomers,
  requests: renderBookingRequests,
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
  today: icons.home,
  bookings: icons.bookings,
  appointments: icons.star,
  calendar: icons.calendar,
  customers: icons.paw,
  requests: icons.bookings,
  registrations: icons.inbox,
  reports: icons.chart,
  settings: icons.settings,
  backup: icons.backup,
};
document.querySelectorAll('.navlink').forEach(b => {
  const ico = b.querySelector('.ico');
  if (ico && NAV_ICONS[b.dataset.route]) ico.innerHTML = NAV_ICONS[b.dataset.route];
});
document.querySelector('#logout-btn .ico').innerHTML = icons.logout;
document.querySelector('#nav-more-btn .ico').innerHTML = icons.more;
document.getElementById('nav-more-btn').addEventListener('click', openNavSheet);

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
  // สิทธิ์ (staffEmails) อยู่ใน settings ซึ่งโหลดแบบ async →
  // "รอ settings รอบแรกก่อน" ค่อยเปิดหน้าแรก ไม่งั้นพี่เลี้ยงจะเห็น
  // แดชบอร์ดเจ้าของ (มียอดเงิน) แวบหนึ่งก่อนถูกเด้งออก
  let firstNavPending = !getSettings();
  if (!settingsUnsub) settingsUnsub = listenSettings((s) => {
    setSettingsCache(s);
    applyRoleUI();
    if (firstNavPending) {
      firstNavPending = false;
      navigate(location.hash.replace('#', '') || defaultRoute());
    }
  });

  if (!firstNavPending) {
    applyRoleUI();
    navigate(location.hash.replace('#', '') || defaultRoute());
  } else {
    // ระหว่างรอ: ซ่อนเมนูทั้งหมดไว้ก่อน กันข้อมูลแวบ
    document.querySelectorAll('.navlink').forEach(b => b.classList.add('hidden'));
    contentEl.innerHTML = '<p class="muted" style="padding:30px;text-align:center">กำลังโหลด…</p>';
  }
}

// หน้าเริ่มต้นตามสิทธิ์: เจ้าของ = แดชบอร์ด · พี่เลี้ยง = เมนูแรกที่เปิดสิทธิ์ไว้
// (ไม่ fix เป็น 'today' เพราะเจ้าของร้านปิดสวิตช์ 'งานวันนี้' ได้ ถ้า fix ไว้จะวนกลับมาหน้าที่ไม่มีสิทธิ์)
function defaultRoute() {
  if (!isStaff()) return 'dashboard';
  return STAFF_PERM_ITEMS.map(i => i.route).find(r => staffCan(r)) || null;
}

// พี่เลี้ยงเข้าได้เฉพาะเมนูที่เจ้าของร้านเปิดสวิตช์ไว้ · เจ้าของเข้าได้ทุกหน้ายกเว้น "งานวันนี้" (ใช้แดชบอร์ดแทน)
function routeAllowed(route) {
  return isStaff() ? staffCan(route) : route !== 'today';
}

// ซ่อน/แสดงเมนูตามสิทธิ์ + เด้งออกจากหน้าที่ไม่มีสิทธิ์ (เผื่อ settings มาทีหลัง)
function applyRoleUI() {
  document.querySelectorAll('.navlink').forEach(b =>
    b.classList.toggle('hidden', !routeAllowed(b.dataset.route)));
  applyMobileNav();
  const cur = location.hash.replace('#', '');
  if (cur && !appEl.classList.contains('hidden') && !routeAllowed(cur)) navigate(defaultRoute());
}

// ── แถบเมนูล่างบนมือถือ ──
// แถบล่างรับได้จำกัด ถ้ายัดครบ 11 เมนูจะเล็กจนกดพลาด จึงโชว์ 4 เมนูแรกที่มีสิทธิ์
// ที่เหลือย้ายไปแผ่นเลื่อน "เพิ่มเติม" (รูปแบบมาตรฐานของแอปมือถือ)
const MOBILE_MQ = window.matchMedia('(max-width: 760px)');
const MAX_BOTTOM_TABS = 4;
// สลับแนวจอ/ปรับขนาดหน้าต่าง → คำนวณเมนูหลัก-เมนูเพิ่มเติมใหม่
// ฟังทั้ง matchMedia และ resize เพราะบางเบราว์เซอร์/WebView ไม่ยิง change ของ matchMedia
MOBILE_MQ.addEventListener('change', applyMobileNav);
window.addEventListener('resize', applyMobileNav);

function applyMobileNav() {
  const links = [...document.querySelectorAll('.navlink')].filter(b => !b.classList.contains('hidden'));
  const moreBtn = document.getElementById('nav-more-btn');
  if (!moreBtn) return;
  if (!MOBILE_MQ.matches) {
    links.forEach(b => b.classList.remove('nav-secondary'));
    moreBtn.classList.add('hidden');
    return;
  }
  // เมนูพอดีแถบอยู่แล้ว (≤5) ก็ไม่ต้องมีปุ่มเพิ่มเติมให้เกะกะ
  const fitsAll = links.length <= MAX_BOTTOM_TABS + 1;
  links.forEach((b, i) => b.classList.toggle('nav-secondary', !fitsAll && i >= MAX_BOTTOM_TABS));
  moreBtn.classList.toggle('hidden', fitsAll);
  syncMoreActive();
}

// ปุ่ม "เพิ่มเติม" ต้องดูเป็น active ด้วย ถ้าหน้าที่เปิดอยู่ถูกเก็บไว้ในแผ่นเลื่อน
function syncMoreActive() {
  const moreBtn = document.getElementById('nav-more-btn');
  if (!moreBtn) return;
  const cur = location.hash.replace('#', '');
  const hidden = [...document.querySelectorAll('.navlink.nav-secondary')].some(b => b.dataset.route === cur);
  moreBtn.classList.toggle('active', hidden);
}

function openNavSheet() {
  const secondary = [...document.querySelectorAll('.navlink.nav-secondary')];
  const bg = el('div', { class: 'sheet-bg' });
  const rows = secondary.map(b => {
    const row = el('button', { class: 'sheet-row' + (b.classList.contains('active') ? ' active' : '') }, [
      el('span', { class: 'sheet-ico', html: b.querySelector('.ico')?.innerHTML || '' }),
      el('span', { text: b.querySelector('.txt')?.textContent || b.dataset.route }),
    ]);
    row.onclick = () => { close(); navigate(b.dataset.route); };
    return row;
  });

  const outBtn = el('button', { class: 'sheet-row sheet-row--danger' }, [
    el('span', { class: 'sheet-ico', html: icons.logout }),
    el('span', { text: 'ออกจากระบบ' }),
  ]);
  outBtn.onclick = async () => {
    close();
    if (await confirmDialog('ออกจากระบบใช่ไหม?', { okText: 'ออกจากระบบ' })) signOutUser();
  };

  const sheet = el('div', { class: 'nav-sheet' }, [
    el('div', { class: 'sheet-grab' }),
    el('div', { class: 'sheet-user' }, [
      el('span', { class: 'sheet-avatar', html: brandLogo }),
      el('span', { class: 'sheet-email', text: getSettings() ? (currentUser()?.email || '') : '' }),
    ]),
    ...rows,
    el('div', { class: 'sheet-sep' }),
    outBtn,
  ]);
  bg.appendChild(sheet);

  function close() {
    bg.classList.add('closing');
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('modal-open');
    setTimeout(() => bg.remove(), 180);
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });

  document.body.appendChild(bg);
  document.body.classList.add('modal-open');
}

function navigate(route) {
  if (!ROUTES[route]) route = defaultRoute();
  if (!routeAllowed(route)) route = defaultRoute(); // กันพิมพ์ URL ตรงเข้าหน้าต้องห้าม
  // เจ้าของร้านปิดสวิตช์ทุกเมนู → ไม่มีหน้าให้ไป บอกให้ชัดแทนที่จะจอขาว
  if (!route) {
    contentEl.innerHTML = '<div class="card"><p class="muted" style="text-align:center;padding:24px">'
      + 'ยังไม่ได้เปิดสิทธิ์ให้บัญชีนี้ใช้เมนูใดเลย — กรุณาแจ้งเจ้าของร้านให้เปิดสิทธิ์ในหน้า "ตั้งค่า"</p></div>';
    return;
  }
  location.hash = route;
  document.querySelectorAll('.navlink').forEach(b =>
    b.classList.toggle('active', b.dataset.route === route));
  syncMoreActive();
  contentEl.innerHTML = '';
  document.getElementById('main')?.scrollTo?.({ top: 0 });
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

// ถามยืนยันก่อน — บนมือถือปุ่มนี้อยู่ติดแถบเมนู กดโดนตอนรับลูกค้าหน้าเคาน์เตอร์ได้ง่าย
document.getElementById('logout-btn').addEventListener('click', async () => {
  if (await confirmDialog('ออกจากระบบใช่ไหม?', { okText: 'ออกจากระบบ' })) signOutUser();
});

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
