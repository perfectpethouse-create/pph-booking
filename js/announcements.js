// ═══════════════════════════════════════════════════════════════
// announcements.js — ข่าวสารร้าน (ประกาศ/โปรโมชั่นภายในสำหรับพนักงาน)
//   • หน้า "ข่าวสารร้าน" (route: news) — เจ้าของโพสต์/แก้/ลบ · พี่เลี้ยงอ่านอย่างเดียว
//   • การ์ดบนแดชบอร์ด (mountNewsCard) — โชว์ข่าวที่ยังใช้งาน (active) หน้าแรก
//   • ป๊อปอัปข่าวปักหมุด (initNewsPopup) — เด้งครั้งเดียวจนกดรับทราบ (จำต่อเครื่อง)
//   • วันหมดอายุ + เก็บเข้าคลัง — ข่าวเก่าไม่รกหน้าแรก (isActive)
//   • "ใครอ่านแล้ว" — เก็บใน collection แยก announcementReads (พี่เลี้ยงเขียนของตัวเองได้)
//   • แนบรูปแบนเนอร์ — ย่อ/บีบเป็น data URL เก็บในเอกสาร (ไม่ต้องใช้ Storage)
//   • แสดงบนเว็บลูกค้า — มิเรอร์ไป publicInfo/announcements (แบบเดียวกับ savePublicPrices)
//
// ⚠️ ด่านความปลอดภัยจริงอยู่ที่ firestore.rules — ปุ่มที่ซ่อนตาม isOwner() เป็นแค่ UX
// ═══════════════════════════════════════════════════════════════
import { listen, save, remove, getAll, savePublicAnnouncements } from './db.js';
import { el, isOwner, isStaff, currentUser, getSettings, toast, openModal, confirmDialog } from './ui.js';
import { icons } from './icons.js';
import { todayISO, formatDateTH } from './calc.js';

// ── หมวดข่าว 3 สี ──
export const NEWS_CATEGORIES = {
  notice: { label: 'ประกาศ', cls: 'notice' },
  promo:  { label: 'โปรโมชั่น', cls: 'promo' },
  urgent: { label: 'ด่วน', cls: 'urgent' },
};
const CAT_ORDER = ['notice', 'promo', 'urgent'];
function catMeta(c) { return NEWS_CATEGORIES[c] || NEWS_CATEGORIES.notice; }

function newsTag(category) {
  const m = catMeta(category);
  return el('span', { class: `news-tag news-tag--${m.cls}`, text: m.label });
}

// createdAt/updatedAt เก็บเป็น ISO — แสดงเป็น DD/MM/YYYY · HH:MM (ค.ศ. ให้ตรงทั้งแอป)
function fmtNewsTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()} · ${hh}:${mi} น.`;
}

function sortNews(list) {
  return [...list].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
  });
}

// ── สถานะข่าว: ใช้งานอยู่ (active) vs หมดอายุ/เก็บเข้าคลัง ──
// active = ยังไม่เก็บเข้าคลัง และ (ไม่มีวันหมดอายุ หรือยังไม่เลยวันหมดอายุ)
function isExpired(n) { return !!n.expiresAt && n.expiresAt < todayISO(); }
function isActive(n) { return !n.archived && !isExpired(n); }

// ─────────────────────────────────────────────────────────────
// "ใครอ่านแล้ว" — เก็บใน collection announcementReads (id ผูกกับข่าว+อีเมล)
// พี่เลี้ยงเขียน record ของตัวเองได้ · เจ้าของอ่านทั้งหมดเพื่อดูสถานะ
// จำต่อเครื่องด้วย localStorage ว่าเคยบันทึกอ่านของข่าวไหนแล้ว → กันเขียนซ้ำทุกครั้งที่เปิดหน้า
// ─────────────────────────────────────────────────────────────
const READ_DONE_KEY = 'pph_news_read';
function emailKey(email) { return String(email || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'); }
function readDoneSet() {
  try { return new Set(JSON.parse(localStorage.getItem(READ_DONE_KEY) || '[]')); } catch { return new Set(); }
}
function markReadLocal(annId) {
  const s = readDoneSet(); s.add(annId);
  try { localStorage.setItem(READ_DONE_KEY, JSON.stringify([...s])); } catch {}
}
// บันทึกว่า "อ่านแล้ว" — เฉพาะพี่เลี้ยง (การอ่านของเจ้าของไม่นับ) และเขียนครั้งเดียวต่อเครื่อง
async function markRead(annId) {
  if (!annId || !isStaff()) return;
  if (readDoneSet().has(annId)) return;
  const email = (currentUser()?.email || '').trim();
  if (!email) return;
  markReadLocal(annId); // กันเขียนซ้ำก่อน แม้ระหว่างรอเน็ต
  try {
    await save('announcementReads', {
      id: `${annId}__${emailKey(email)}`, announcementId: annId, email, readAt: new Date().toISOString(),
    });
  } catch { /* เขียนไม่ได้ก็ไม่เป็นไร ไม่รบกวนการอ่านข่าว */ }
}

// ─────────────────────────────────────────────────────────────
// ย่อ+บีบรูปฝั่ง client → data URL (กันเกินลิมิต 1MB/เอกสารของ Firestore)
// ─────────────────────────────────────────────────────────────
function compressImage(file, { maxW = 1280, quality = 0.72, maxChars = 900 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type).startsWith('image/')) return reject(new Error('ไฟล์นี้ไม่ใช่รูปภาพ'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('เปิดรูปไม่สำเร็จ'));
      img.onload = () => {
        const scale = Math.min(1, maxW / (img.width || maxW));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = el('canvas'); canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        let q = quality, out = canvas.toDataURL('image/jpeg', q);
        // ยังใหญ่ไป → ลดคุณภาพทีละขั้น
        while (out.length > maxChars && q > 0.4) { q -= 0.12; out = canvas.toDataURL('image/jpeg', q); }
        if (out.length > maxChars) return reject(new Error('รูปใหญ่เกินไป ลองใช้รูปที่เล็กลง'));
        resolve(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────────────────────────
// หน้า "ข่าวสารร้าน" (route: news)
// ─────────────────────────────────────────────────────────────
let _pageUnsub = [];

export function renderAnnouncements(container) {
  _pageUnsub.forEach(u => u()); _pageUnsub = [];
  const owner = isOwner();
  let showArchive = false; // เจ้าของกดดู "คลังข่าว" (ปิด/หมดอายุ)

  container.appendChild(el('div', { class: 'page-title' }, [
    el('h1', { text: 'ข่าวสารร้าน' }),
    el('span', { class: 'muted', text: owner ? 'โพสต์/แก้ไขข่าวให้พนักงานทั้งร้าน' : 'ข่าวสาร ประกาศ และโปรโมชั่นจากร้าน' }),
  ]));

  if (owner) {
    const addBtn = el('button', { class: 'btn primary', style: 'margin-bottom:14px', html: icons.plus + ' โพสต์ข่าวใหม่' });
    addBtn.onclick = () => openNewsEditor();
    container.appendChild(addBtn);
  }

  const listWrap = el('div', { class: 'news-list' });
  container.appendChild(listWrap);

  let allNews = [];
  let reads = [];

  // เจ้าของ: ฟังสถานะ "อ่านแล้ว" ด้วย เพื่อโชว์ว่าใครอ่านข่าวแล้วบ้าง
  if (owner) {
    _pageUnsub.push(listen('announcementReads', r => { reads = r; drawList(); }, { orderBy: null }));
  }
  _pageUnsub.push(listen('announcements', list => { allNews = list; drawList(); }));

  function drawList() {
    const sorted = sortNews(allNews);
    const active = sorted.filter(isActive);
    const inactive = sorted.filter(n => !isActive(n));
    const staffEmails = (getSettings()?.staffEmails || []).map(e => String(e).trim().toLowerCase());
    const readSet = new Set(reads.map(r => `${r.announcementId}|${String(r.email || '').trim().toLowerCase()}`));

    // พี่เลี้ยง: เห็นข่าวไหน = ถือว่าอ่านแล้ว (บันทึกครั้งเดียวต่อเครื่อง)
    if (!owner) active.forEach(n => markRead(n.id));

    listWrap.innerHTML = '';
    if (!active.length && !(owner && inactive.length)) {
      listWrap.appendChild(el('div', { class: 'card' }, [
        el('p', { class: 'muted', style: 'text-align:center;margin:8px 0', text:
          owner ? 'ยังไม่มีข่าว — กด "โพสต์ข่าวใหม่" เพื่อประกาศให้พนักงาน' : 'ยังไม่มีข่าวสารตอนนี้' }),
      ]));
      return;
    }

    active.forEach(n => listWrap.appendChild(newsItem(n, owner, { staffEmails, readSet })));

    // เจ้าของ: ปุ่มพับ/กาง "คลังข่าว" (ปิดหรือหมดอายุแล้ว)
    if (owner && inactive.length) {
      const toggle = el('button', { class: 'btn ghost sm news-archive-toggle',
        html: icons.backup + ` คลังข่าว (ปิด/หมดอายุแล้ว) · ${inactive.length}` });
      const archiveWrap = el('div', { class: 'news-list', style: 'margin-top:14px' + (showArchive ? '' : ';display:none') });
      inactive.forEach(n => archiveWrap.appendChild(newsItem(n, owner, { staffEmails, readSet })));
      toggle.onclick = () => { showArchive = !showArchive; archiveWrap.style.display = showArchive ? '' : 'none'; };
      listWrap.appendChild(el('div', { style: 'margin-top:6px' }, [toggle]));
      listWrap.appendChild(archiveWrap);
    }
  }
}

// การ์ดข่าว 1 ชิ้น (มุมมองเต็ม)
function newsItem(n, owner, ctx) {
  const expired = isExpired(n);
  const head = el('div', { class: 'news-item-head' }, [
    newsTag(n.category),
    n.pinned && !n.archived && !expired ? el('span', { class: 'news-pin', html: icons.pin + '<span>ปักหมุด</span>' }) : null,
    n.showOnWebsite ? el('span', { class: 'news-flag', html: icons.share + '<span>บนเว็บลูกค้า</span>' }) : null,
    n.archived ? el('span', { class: 'pill grey', text: 'อยู่ในคลัง' })
      : expired ? el('span', { class: 'pill grey', text: 'หมดอายุแล้ว' })
      : n.expiresAt ? el('span', { class: 'pill yellow', text: 'ถึง ' + formatDateTH(n.expiresAt) }) : null,
    el('span', { class: 'news-time', text: fmtNewsTime(n.updatedAt || n.createdAt) }),
  ].filter(Boolean));

  const item = el('div', { class: 'card news-item' + (n.pinned && isActive(n) ? ' news-item--pinned' : '') }, [
    head,
    el('h3', { class: 'news-title', text: n.title || '(ไม่มีหัวข้อ)' }),
    n.image ? el('div', { class: 'news-img' }, [el('img', { src: n.image, alt: '', loading: 'lazy' })]) : null,
    n.body ? el('div', { class: 'news-body', text: n.body }) : null,
  ].filter(Boolean));

  // เจ้าของ: สรุปว่าใครอ่านแล้ว (เฉพาะเมื่อมีพี่เลี้ยงในระบบ)
  if (owner) {
    const rs = readSummary(n, ctx);
    if (rs) item.appendChild(rs);
  }

  if (owner) {
    const editBtn = el('button', { class: 'btn ghost sm', html: icons.save + ' แก้ไข' });
    editBtn.onclick = () => openNewsEditor(n);

    const archiveBtn = el('button', { class: 'btn ghost sm',
      html: n.archived ? icons.upload + ' เอากลับมาแสดง' : icons.backup + ' เก็บเข้าคลัง' });
    archiveBtn.onclick = async () => {
      await save('announcements', { id: n.id, createdAt: n.createdAt, archived: !n.archived });
      toast(n.archived ? 'นำกลับมาแสดงแล้ว' : 'เก็บเข้าคลังแล้ว');
      syncPublicWebsite();
    };

    const delBtn = el('button', { class: 'btn ghost sm danger', html: icons.trash + ' ลบ' });
    delBtn.onclick = async () => {
      if (await confirmDialog(`ลบข่าว "${n.title || ''}" ใช่ไหม?`, { okText: 'ลบ', danger: true })) {
        await remove('announcements', n.id);
        toast('ลบข่าวแล้ว');
        syncPublicWebsite();
      }
    };
    item.appendChild(el('div', { class: 'news-actions' }, [editBtn, archiveBtn, delBtn]));
  }
  return item;
}

// สรุป "อ่านแล้ว X/Y" + รายชื่อ (เจ้าของเท่านั้น) — คืน null ถ้ายังไม่มีพี่เลี้ยงในระบบ
function readSummary(n, { staffEmails, readSet }) {
  if (!staffEmails.length) return null;
  const readByStaff = staffEmails.filter(e => readSet.has(`${n.id}|${e}`));
  const unread = staffEmails.filter(e => !readSet.has(`${n.id}|${e}`));
  const wrap = el('div', { class: 'news-reads' });
  const allRead = unread.length === 0;
  const summary = el('button', { class: 'news-reads-summary' + (allRead ? ' done' : ''),
    html: icons.check + ` อ่านแล้ว ${readByStaff.length}/${staffEmails.length} คน` });
  const detail = el('div', { class: 'news-reads-detail', style: 'display:none' }, [
    readByStaff.length ? el('div', { class: 'muted', style: 'font-size:12px', text: 'อ่านแล้ว: ' + readByStaff.join(', ') }) : null,
    unread.length ? el('div', { class: 'muted', style: 'font-size:12px', text: 'ยังไม่อ่าน: ' + unread.join(', ') }) : null,
  ].filter(Boolean));
  summary.onclick = () => { detail.style.display = detail.style.display === 'none' ? '' : 'none'; };
  wrap.append(summary, detail);
  return wrap;
}

// ─────────────────────────────────────────────────────────────
// ตัวแก้ไขข่าว (โมดัล) — เจ้าของร้านเท่านั้น
// ─────────────────────────────────────────────────────────────
function openNewsEditor(existing) {
  const isEdit = !!existing;
  const data = existing || { category: 'notice', title: '', body: '', pinned: false, image: '', expiresAt: '', showOnWebsite: false };
  let imageData = data.image || '';

  const catSel = el('select', {});
  CAT_ORDER.forEach(c => {
    const opt = el('option', { value: c, text: NEWS_CATEGORIES[c].label });
    if (c === (data.category || 'notice')) opt.setAttribute('selected', '');
    catSel.appendChild(opt);
  });

  const titleInp = el('input', { type: 'text', placeholder: 'หัวข้อข่าว เช่น ปิดร้านวันหยุดนักขัตฤกษ์', value: data.title || '' });
  const bodyInp = el('textarea', { rows: '5', placeholder: 'รายละเอียด… (ขึ้นบรรทัดใหม่ได้)' });
  bodyInp.value = data.body || '';

  // ── แนบรูป ──
  const fileInp = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  const pickBtn = el('button', { class: 'btn ghost sm', type: 'button', html: icons.image + ' แนบรูป' });
  const preview = el('div', { class: 'news-img-preview' });
  function renderPreview() {
    preview.innerHTML = '';
    if (!imageData) return;
    const rmBtn = el('button', { class: 'btn ghost sm danger', type: 'button', html: icons.trash + ' ลบรูป' });
    rmBtn.onclick = () => { imageData = ''; renderPreview(); };
    preview.append(el('img', { src: imageData, alt: '' }), rmBtn);
  }
  pickBtn.onclick = () => fileInp.click();
  fileInp.onchange = async () => {
    const f = fileInp.files && fileInp.files[0];
    if (!f) return;
    pickBtn.disabled = true;
    try { imageData = await compressImage(f); renderPreview(); }
    catch (e) { toast(e?.message || 'แนบรูปไม่สำเร็จ'); }
    pickBtn.disabled = false;
    fileInp.value = '';
  };
  renderPreview();

  // ── วันหมดอายุ (ไม่บังคับ) ──
  const expInp = el('input', { type: 'date', value: data.expiresAt || '' });

  // ── ปักหมุด ──
  const pinChk = el('input', { type: 'checkbox' });
  if (data.pinned) pinChk.checked = true;
  const pinLabel = el('label', { class: 'news-toggle' }, [
    pinChk,
    el('span', {}, [
      el('strong', { text: 'ปักหมุด + เด้งป๊อปอัปแจ้งพนักงาน' }),
      el('span', { class: 'muted', style: 'display:block;font-size:12px', text: 'ข่าวจะขึ้นบนสุด และเด้งให้พนักงานเห็นครั้งเดียวตอนเปิดแอป' }),
    ]),
  ]);

  // ── แสดงบนเว็บลูกค้า ──
  const webChk = el('input', { type: 'checkbox' });
  if (data.showOnWebsite) webChk.checked = true;
  const webLabel = el('label', { class: 'news-toggle' }, [
    webChk,
    el('span', {}, [
      el('strong', { text: 'แสดงบนเว็บลูกค้าด้วย' }),
      el('span', { class: 'muted', style: 'display:block;font-size:12px', text: 'ส่งหัวข้อ+รายละเอียดไปแสดงบน perfectbkk.com (ไม่รวมรูป)' }),
    ]),
  ]);

  const saveBtn = el('button', { class: 'btn primary', text: isEdit ? 'บันทึกการแก้ไข' : 'โพสต์ข่าว' });
  const cancelBtn = el('button', { class: 'btn ghost', text: 'ยกเลิก' });

  const content = el('div', { class: 'news-editor' }, [
    el('h2', { style: 'margin-top:0', text: isEdit ? 'แก้ไขข่าว' : 'โพสต์ข่าวใหม่' }),
    el('div', { class: 'field' }, [el('label', { text: 'หมวด' }), catSel]),
    el('div', { class: 'field' }, [el('label', { text: 'หัวข้อ' }), titleInp]),
    el('div', { class: 'field' }, [el('label', { text: 'รายละเอียด' }), bodyInp]),
    el('div', { class: 'field' }, [el('label', { text: 'รูปประกอบ (ไม่บังคับ)' }), pickBtn, fileInp, preview]),
    el('div', { class: 'field' }, [el('label', { text: 'ซ่อนอัตโนมัติหลังวันที่ (ไม่บังคับ)' }), expInp]),
    pinLabel,
    webLabel,
    el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px;margin-top:12px' }, [cancelBtn, saveBtn]),
  ]);

  const m = openModal(content);
  cancelBtn.onclick = () => m.close();
  titleInp.focus();

  saveBtn.onclick = async () => {
    const title = titleInp.value.trim();
    const body = bodyInp.value.trim();
    if (!title && !body) { toast('กรุณากรอกหัวข้อหรือรายละเอียด'); titleInp.focus(); return; }
    saveBtn.disabled = true;
    try {
      await save('announcements', {
        ...(isEdit ? { id: existing.id, createdAt: existing.createdAt, archived: existing.archived || false } : {}),
        category: catSel.value,
        title, body,
        image: imageData || '',
        expiresAt: expInp.value || '',
        pinned: pinChk.checked,
        showOnWebsite: webChk.checked,
        authorEmail: currentUser()?.email || '',
      });
      m.close();
      toast(isEdit ? 'บันทึกข่าวแล้ว' : 'โพสต์ข่าวเรียบร้อย');
      syncPublicWebsite();
    } catch (err) {
      saveBtn.disabled = false;
      toast('บันทึกไม่สำเร็จ: ' + (err?.message || err));
    }
  };
}

// มิเรอร์ข่าวที่ติดธง "แสดงบนเว็บ" + ยัง active → publicInfo/announcements (เว็บลูกค้าอ่าน)
// ทำเฉพาะโหมด firestore (savePublicAnnouncements คืนค่าเฉยๆ ในโหมดทดลอง)
async function syncPublicWebsite() {
  try {
    const all = await getAll('announcements');
    const pub = sortNews(all.filter(n => n.showOnWebsite && isActive(n))).map(n => ({
      title: n.title || '', body: n.body || '', category: n.category || 'notice',
      createdAt: n.createdAt || '', updatedAt: n.updatedAt || '',
    }));
    await savePublicAnnouncements(pub);
  } catch { /* มิเรอร์ไม่สำเร็จไม่กระทบข่าวในแอป */ }
}

// ─────────────────────────────────────────────────────────────
// การ์ดข่าวบนแดชบอร์ด — โชว์เฉพาะข่าวที่ยังใช้งาน (active)
// ─────────────────────────────────────────────────────────────
const DASH_MAX = 3;

export function mountNewsCard(container) {
  const owner = isOwner();
  const card = el('div', { class: 'card news-card' });
  container.appendChild(card);

  function draw(list) {
    const sorted = sortNews(list.filter(isActive));
    card.innerHTML = '';

    card.appendChild(el('div', { class: 'news-card-head' }, [
      el('h2', { class: 'sec-title' }, [
        el('span', { class: 'sec-ico', html: icons.megaphone }),
        el('span', { text: 'ข่าวสารร้าน' }),
      ]),
      el('button', { class: 'btn ghost sm news-more', text: 'ดูทั้งหมด', onclick: () => window.__go && window.__go('news') }),
    ]));

    if (!sorted.length) {
      card.appendChild(el('p', { class: 'muted', style: 'margin:6px 0 0', text:
        owner ? 'ยังไม่มีข่าว — ไปที่ "ข่าวสารร้าน" เพื่อโพสต์ให้พนักงาน' : 'ยังไม่มีข่าวสารตอนนี้' }));
      return;
    }

    sorted.slice(0, DASH_MAX).forEach(n => {
      const row = el('div', { class: 'news-mini' + (n.pinned ? ' news-mini--pinned' : '') }, [
        n.image ? el('div', { class: 'news-mini-thumb' }, [el('img', { src: n.image, alt: '', loading: 'lazy' })]) : null,
        el('div', { class: 'news-mini-main' }, [
          el('div', { class: 'news-mini-head' }, [
            newsTag(n.category),
            n.pinned ? el('span', { class: 'news-pin sm', html: icons.pin }) : null,
            el('span', { class: 'news-time', text: fmtNewsTime(n.updatedAt || n.createdAt) }),
          ].filter(Boolean)),
          el('div', { class: 'news-mini-title', text: n.title || '(ไม่มีหัวข้อ)' }),
          n.body ? el('div', { class: 'news-mini-body', text: n.body }) : null,
        ]),
      ].filter(Boolean));
      row.onclick = () => window.__go && window.__go('news');
      card.appendChild(row);
    });

    if (sorted.length > DASH_MAX) {
      card.appendChild(el('div', { class: 'muted', style: 'font-size:12px;margin-top:6px',
        text: `และอีก ${sorted.length - DASH_MAX} ข่าว — กด "ดูทั้งหมด"` }));
    }
  }

  return listen('announcements', draw);
}

// ─────────────────────────────────────────────────────────────
// ป๊อปอัปข่าวปักหมุด — เด้งครั้งเดียวต่อข่าว (จำต่อเครื่อง) เฉพาะข่าวที่ยัง active
// ─────────────────────────────────────────────────────────────
const SEEN_KEY = 'pph_news_seen';
let _popupInited = false;
let _popupOpen = false;

export function initNewsPopup() {
  if (_popupInited) return;
  _popupInited = true;

  listen('announcements', list => {
    if (_popupOpen) return;
    const top = sortNews(list.filter(n => n.pinned && isActive(n)))[0];
    if (!top) return;
    const key = `${top.id}:${top.updatedAt || top.createdAt || ''}`;
    if (localStorage.getItem(SEEN_KEY) === key) return;
    showNewsPopup(top, key);
  });
}

function showNewsPopup(n, key) {
  _popupOpen = true;
  const okBtn = el('button', { class: 'btn primary block', text: 'รับทราบ' });
  const content = el('div', { class: 'news-popup' }, [
    el('div', { class: 'news-popup-icon', html: icons.megaphone }),
    el('div', { class: 'news-popup-tag' }, [newsTag(n.category)]),
    el('h2', { class: 'news-popup-title', text: n.title || 'ข่าวสารร้าน' }),
    n.image ? el('div', { class: 'news-img' }, [el('img', { src: n.image, alt: '' })]) : null,
    n.body ? el('div', { class: 'news-body', text: n.body }) : null,
    okBtn,
  ].filter(Boolean));

  const m = openModal(content, {
    onClose: () => { _popupOpen = false; try { localStorage.setItem(SEEN_KEY, key); } catch {} },
  });
  // กดรับทราบ = บันทึกว่าอ่านแล้ว (พี่เลี้ยง) แล้วปิด
  okBtn.onclick = () => { markRead(n.id); m.close(); };
}
