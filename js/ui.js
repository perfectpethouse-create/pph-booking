// ═══════════════════════════════════════════════════════════════
// ui.js — เครื่องมือช่วยงาน DOM ที่ใช้ร่วมกันทุกหน้า + แคช settings/user
// (แยกจาก app.js เพื่อกันการ import วนกัน)
// ═══════════════════════════════════════════════════════════════

// สร้าง element แบบสั้น: el('div', {class:'x'}, [child, 'text'])
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    // กัน html/text ที่เป็น undefined ไม่ให้พิมพ์คำว่า "undefined" ออกจอ
    // (เคยหลุดไปโผล่บนการ์ดที่ส่งให้ลูกค้าตอนไอคอนหาย)
    else if (k === 'html') node.innerHTML = v ?? '';
    else if (k === 'text') node.textContent = v ?? '';
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

export function toast(msg, ms = 2200) {
  const t = el('div', { class: 'toast', text: msg });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// modal ทั่วไป: content = element ; คืน object { close }
export function openModal(content, { onClose } = {}) {
  const bg = el('div', { class: 'modal-bg' });
  // ปุ่มปิด (X) มุมขวาบน — จำเป็นมากบนมือถือที่แทบไม่มีฉากหลังให้กด
  const closeBtn = el('button', { class: 'modal-close', 'aria-label': 'ปิด', html: CLOSE_ICON });
  const modal = el('div', { class: 'modal' }, [closeBtn, content]);
  bg.appendChild(modal);
  closeBtn.onclick = () => close();

  // ปิดเมื่อ "กดและปล่อย" บนฉากหลังเท่านั้น — กันเคสลากเมาส์เลือกข้อความ
  // ในฟอร์มแล้วปล่อยนอกกล่อง (click จะไปลงที่ฉากหลัง ทำให้ modal เด้งหาย)
  let downOnBg = false;
  bg.addEventListener('mousedown', (e) => { downOnBg = (e.target === bg); });
  bg.addEventListener('click', (e) => {
    if (e.target === bg && downOnBg) close();
    downOnBg = false;
  });

  // กด Esc ปิดได้ (เดสก์ท็อป) — ปิดเฉพาะ modal บนสุด
  const onKey = (e) => { if (e.key === 'Escape' && isTop()) close(); };
  document.addEventListener('keydown', onKey);
  const isTop = () => [...document.querySelectorAll('.modal-bg')].pop() === bg;

  document.body.appendChild(bg);
  // ล็อกไม่ให้หน้าหลังเลื่อนตาม (มือถือ)
  document.body.classList.add('modal-open');

  function close() {
    bg.remove();
    document.removeEventListener('keydown', onKey);
    if (!document.querySelector('.modal-bg')) document.body.classList.remove('modal-open');
    onClose && onClose();
  }
  return { close, el: modal };
}

const CLOSE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

// กล่องยืนยัน (คืน Promise<boolean>)
export function confirmDialog(message, { okText = 'ยืนยัน', danger = false } = {}) {
  return new Promise((resolve) => {
    const okBtn = el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), text: okText });
    const cancelBtn = el('button', { class: 'btn ghost', text: 'ยกเลิก' });
    const content = el('div', {}, [
      el('p', { text: message, style: 'margin-top:0;font-size:16px' }),
      el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:8px' }, [cancelBtn, okBtn]),
    ]);
    const m = openModal(content);
    okBtn.onclick = () => { m.close(); resolve(true); };
    cancelBtn.onclick = () => { m.close(); resolve(false); };
  });
}

// ── แคช settings ที่อัปเดตแบบเรียลไทม์ (app.js เป็นคนเซ็ต) ──
let _settings = null;
const _settingsSubs = new Set();
export function setSettingsCache(s) { _settings = s; _settingsSubs.forEach(cb => cb(s)); }
export function getSettings() { return _settings; }
export function onSettings(cb) { _settingsSubs.add(cb); if (_settings) cb(_settings); return () => _settingsSubs.delete(cb); }

// ── ผู้ใช้ปัจจุบัน ──
let _user = null;
export function setUser(u) { _user = u; }
export function currentUser() { return _user; }

// ── สิทธิ์การใช้งาน ──
// อีเมลที่อยู่ใน settings.staffEmails = "พี่เลี้ยง" (เห็นเฉพาะเมนูที่ไม่เกี่ยวกับเงิน)
// ที่เหลือ = เจ้าของร้าน (เห็นทุกอย่าง) — ค่าเริ่มต้นลิสต์ว่าง จึงไม่มีทางล็อกตัวเองออก
export function isStaff() {
  const email = (_user?.email || '').trim().toLowerCase();
  if (!email) return false;
  const list = _settings?.staffEmails || [];
  return list.some(e => String(e).trim().toLowerCase() === email);
}
export function isOwner() { return !isStaff(); }

// เมนูที่พี่เลี้ยงเข้าได้ (นอกเหนือจากนี้เป็นของเจ้าของร้าน)
export const STAFF_ROUTES = ['today', 'calendar', 'customers', 'registrations'];
