// ═══════════════════════════════════════════════════════════════
// booking-requests.js — กล่องรับ "คำขอจอง" จากฟอร์มจองบนเว็บ perfectbkk.com
//   (หน้า index.html · app.html · exercise-zone.html — ใช้ endpoint เดียวกัน)
//
// ทำไมเป็น "คำขอจอง" ไม่ใช่ "การจอง" ทันที:
//   ฟอร์มบนเว็บไม่มีประเภทห้อง/จำนวนห้อง/ราคา และบางคำขอไม่ใช่ที่พักด้วยซ้ำ
//   (อาบน้ำ, โซนออกกำลังกาย) → พนักงานต้องตรวจ+เติมข้อมูลก่อนจึงเป็นการจองจริง
//
// คำขอจาก "หน้าจองใหม่" (booking.html) มี payloadJson ครบ: ห้อง/ราคา/ส่วนลด/บริการเสริม/มัดจำ
//   + กันห้องไว้ 2 ชม. (roomHolds) → พนักงานเห็นสลิปแล้วกดสร้างการจองได้เลย ไม่ต้องเติมเอง
// ═══════════════════════════════════════════════════════════════
import { listen, save, remove, getAll } from './db.js';
import { el, toast, openModal, confirmDialog, getSettings } from './ui.js';
import { formatDateTH, todayISO, nightsBetween, computeBooking, formatBaht } from './calc.js';
import { REQUEST_TYPES, classifyRequest, petIdFromWeb, DEFAULT_DEPOSIT_METHOD, FIXED_ADDONS } from './config-shop.js';
import { openBookingForm } from './bookings.js';
import { openAppointmentForm, slotsFor } from './appointments.js';
import { icons } from './icons.js';
import { shortDate, rangeOf } from './mobile-kit.js';

// คำขอจากเว็บที่เป็น "งานรายรอบ" ไม่ใช่การพักค้างคืน → เปิดเป็นนัดหมายแทนใบจองห้อง
// (อาบน้ำ/ตัดขน ใช้ฟอร์ม Grooming เหมือนกัน ต่างแค่ติ๊ก "ตัดขนด้วย" หรือไม่)
const APPOINTMENT_FROM_REQUEST = { exercise: 'exercise', grooming: 'grooming', bath: 'grooming' };

let _unsub = [];
let _reqs = [];

const PET_ICONS = { dog: icons.dog, cat: icons.cat };

// ── คำขอจากหน้าจองใหม่ ──
export function onlineOf(r) {
  if (!r?.payloadJson) return null;
  try { return JSON.parse(r.payloadJson); } catch { return null; }
}
// เวลาที่เหลือก่อนปล่อยห้อง → ข้อความสั้น (หมดแล้วคืน null)
function holdLeft(o) {
  const t = Date.parse(o?.holdUntil || '');
  if (isNaN(t)) return null;
  const ms = t - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return `${h}:${String(m).padStart(2, '0')} ชม.`;
}
async function releaseHold(r) {
  if (r.holdId) { try { await remove('roomHolds', r.holdId); } catch (e) { console.warn('ลบการกันห้องไม่สำเร็จ', e); } }
}

function typeOf(r) { return REQUEST_TYPES[classifyRequest(r.service)] || REQUEST_TYPES.other; }

function onlineChips(r) {
  const o = onlineOf(r);
  if (!o) return [];
  const left = holdLeft(o);
  const isNew = (r.status || 'new') === 'new';
  return [
    el('span', { class: 'pill blue', text: `หน้าจองใหม่ · ${o.code || ''}` }),
    o.kind === 'groom'
      ? el('span', { class: 'pill yellow', text: `คิว ${o.time} · ประมาณ ${formatBaht(o.totals?.grand || 0)}` })
      : el('span', { class: 'pill yellow', text: `มัดจำ ${formatBaht(o.totals?.deposit || 0)}` }),
    o.kind === 'groom' ? null : isNew ? el('span', { class: 'pill ' + (left ? 'grey' : 'red'), text: left ? `กันห้องเหลือ ${left}` : 'หมดเวลากันห้อง' }) : null,
  ];
}

export function renderBookingRequests(container) {
  _unsub.forEach(u => u()); _unsub = [];

  const listWrap = el('div', {});
  const filterSel = el('select', { style: 'max-width:200px' }, [
    el('option', { value: 'new', text: 'ยังไม่จัดการ' }),
    el('option', { value: 'all', text: 'ทั้งหมด' }),
    el('option', { value: 'done', text: 'จัดการแล้ว' }),
  ]);

  // มือถือ = ชิปกรอง + การ์ดแบบแอป (.mreq) · คอม = แบบเดิม (.req-full) — ข้อมูลและตัวกรองชุดเดียวกัน
  const mobileWrap = el('div', { class: 'mreq' });
  container.appendChild(mobileWrap);
  // คอม: แท็บแบ่งกลุ่มแทนดรอปดาวน์ (ตาม requests-mockup) — filterSel ยังเป็นตัวเก็บค่าที่เลือก
  const seg = el('div', { class: 'd-seg', role: 'tablist' });
  container.appendChild(el('div', { class: 'req-full' }, [
    el('div', { class: 'd-top' }, [
      el('h1', { text: 'คำขอจองจากเว็บ' }),
      el('div', { class: 'd-date', text: 'ลูกค้ากรอกฟอร์มที่ perfectbkk.com → ตรวจแล้วกด "สร้างการจอง" เพื่อเติมห้อง/ราคา/มัดจำ' }),
    ]),
    seg,
    listWrap,
  ]));

  const draw = () => {
    const f = filterSel.value;
    const rows = _reqs
      .filter(r => f === 'all' ? true : f === 'done' ? r.status === 'done' : (r.status || 'new') === 'new')
      // แปลงเป็นสตริงก่อนเสมอ — ฟอร์มบนเว็บส่ง submittedAt มาหลายรูปแบบ
      // ถ้าเจอค่าที่ไม่ใช่สตริง (เช่น timestamp ตัวเลข) localeCompare จะโยน error
      // แล้วหน้า "คำขอจอง" ล่มทั้งหน้า เพราะคำขอผิดรูปแบบแค่รายการเดียว
      .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));

    drawMobile(mobileWrap, rows, f, (v) => { filterSel.value = v; draw(); });
    const newN = _reqs.filter(r => (r.status || 'new') === 'new').length;
    seg.innerHTML = '';
    [['new', `ยังไม่จัดการ · ${newN}`], ['all', 'ทั้งหมด'], ['done', 'จัดการแล้ว']].forEach(([v, label]) => {
      const b = el('button', { class: v === f ? 'on' : '', role: 'tab', 'aria-selected': String(v === f), text: label });
      b.onclick = () => { filterSel.value = v; draw(); };
      seg.appendChild(b);
    });
    listWrap.innerHTML = '';
    if (!rows.length) {
      listWrap.appendChild(el('div', { class: 'd-card' }, [
        el('p', { class: 'd-empty', style: 'padding:22px 18px;text-align:center', text:
          f === 'new' ? 'ไม่มีคำขอค้างอยู่ — เคลียร์หมดแล้ว' : 'ยังไม่มีคำขอจองเข้ามา' }),
      ]));
      return;
    }
    rows.forEach(r => {
      const t = typeOf(r);
      const isNew = (r.status || 'new') === 'new';
      const pet = petIdFromWeb(r.pet);
      const when = [
        r.checkin ? (r.checkout ? rangeOf({ checkIn: r.checkin, checkOut: r.checkout }) : shortDate(r.checkin)) : '',
        r.time ? `${r.time} น.` : '',
      ].filter(Boolean).join(' · ') || 'ไม่ระบุวัน';
      const card = el('div', { class: 'd-req' + (isNew ? '' : ' done'), role: 'button', tabindex: '0' }, [
        el('div', { class: 'li-head' }, [
          el('div', {}, [
            el('strong', { text: r.owner || '-' }),
            el('span', { class: 'muted', style: 'font-size:12px;margin-left:8px', text: r.phone || '' }),
          ]),
          el('div', { class: 'row', style: 'gap:6px;align-items:center' }, [
            el('span', { class: `pill ${t.color === 'grey' ? 'grey' : 'yellow'}`, text: t.label }),
            el('span', { class: 'pill ' + (isNew ? 'red' : 'green'), text: isNew ? 'ใหม่' : 'จัดการแล้ว' }),
          ]),
        ]),
        el('div', { class: 'row', style: 'gap:6px;margin:8px 0 4px;flex-wrap:wrap' }, [
          el('span', { class: `pet-chip pet-${pet}`, html: `${PET_ICONS[pet]} ${r.petname || (pet === 'cat' ? 'แมว' : 'สุนัข')}` }),
          r.room ? el('span', { class: 'pill grey', text: r.room }) : null,
          ...onlineChips(r),
        ].filter(Boolean)),
        el('div', { class: 'd-req-meta', text:
          `${when} · ส่งเมื่อ ${r.submittedAt ? new Date(r.submittedAt).toLocaleString('th-TH') : '-'}` }),
        // ปุ่มนี้เปิดหน้ารายละเอียดเดิม (ที่มีปุ่มสร้างการจองจริง) — ไม่ได้สร้างอะไรเอง
        isNew ? el('div', { class: 'd-req-acts' }, [el('span', { class: 'btn primary sm', text: 'ตรวจคำขอ → สร้างการจอง' })]) : null,
      ].filter(Boolean));
      card.onclick = () => openRequestDetail(r);
      card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRequestDetail(r); } };
      listWrap.appendChild(card);
    });
  };

  filterSel.onchange = draw;
  _unsub.push(listen('bookingRequests', arr => { _reqs = arr; draw(); }, { orderBy: null }));
}

// ── มือถือ: ชิปกรอง + การ์ดคำขอ ── (แตะการ์ด = เปิดรายละเอียดเดิมที่มีปุ่มสร้างการจอง)
function drawMobile(wrap, rows, f, setFilter) {
  const newN = _reqs.filter(r => (r.status || 'new') === 'new').length;
  wrap.innerHTML = '';
  wrap.appendChild(el('div', { class: 'm-ptitle' }, [el('h1', { text: 'คำขอจองจากเว็บ' })]));
  wrap.appendChild(el('div', { class: 'm-chips' }, [['new', 'รอจัดการ', newN], ['done', 'จัดการแล้ว'], ['all', 'ทั้งหมด']].map(([v, label, n]) => {
    const c = el('button', { class: 'm-chipf' + (v === f ? ' on' : '') }, [label, n != null ? el('span', { text: String(n) }) : null]);
    c.onclick = () => setFilter(v);
    return c;
  })));
  if (!rows.length) {
    wrap.appendChild(el('div', { class: 'm-empty', text: f === 'new' ? 'ไม่มีคำขอค้างอยู่ — เคลียร์หมดแล้ว' : 'ยังไม่มีคำขอจองเข้ามา' }));
    return;
  }
  rows.forEach(r => {
    const t = typeOf(r);
    const isNew = (r.status || 'new') === 'new';
    const pet = petIdFromWeb(r.pet);
    const o = onlineOf(r);
    const left = o && o.kind !== 'groom' && isNew ? holdLeft(o) : null;
    const when = [
      r.checkin ? (r.checkout ? rangeOf({ checkIn: r.checkin, checkOut: r.checkout }) : shortDate(r.checkin)) : '',
      r.time ? `${r.time} น.` : '',
    ].filter(Boolean).join(' · ') || 'ไม่ระบุวัน';
    const card = el('div', { class: 'm-bk m-req' + (isNew ? '' : ' done'), role: 'button', tabindex: '0' }, [
      el('div', { class: 'm-bk-top' }, [
        el('span', { class: 'm-pet' + (pet === 'cat' ? ' cat' : ''), html: PET_ICONS[pet] || icons.paw }),
        el('div', { class: 'm-tx' }, [
          el('b', { text: r.owner || '-' }),
          el('small', { text: `${r.petname || (pet === 'cat' ? 'แมว' : 'สุนัข')} · ${r.phone || ''}` }),
        ]),
        el('span', { class: 'pill ' + (isNew ? 'red' : 'green'), text: isNew ? 'ใหม่' : 'จัดการแล้ว' }),
      ]),
      el('div', { class: 'm-req-tags' }, [
        el('span', { class: 'm-tag', text: t.label }),
        r.room ? el('span', { class: 'm-tag', text: r.room }) : null,
        o ? el('span', { class: 'm-tag blue', text: `จองออนไลน์ ${o.code || ''}`.trim() }) : null,
        o && o.kind !== 'groom' ? el('span', { class: 'm-tag', text: `มัดจำ ${formatBaht(o.totals?.deposit || 0)}` }) : null,
      ]),
      el('div', { class: 'm-req-foot' }, [
        el('span', { text: when }),
        // กันห้อง 2 ชม. — เวลาเหลือต้องเห็นชัด เพราะหมดแล้วห้องจะถูกปล่อยให้คนอื่น
        o && o.kind !== 'groom' && isNew
          ? el('span', { class: 'm-hold' + (left ? '' : ' over'), text: left ? `กันห้องเหลือ ${left}` : 'หมดเวลากันห้อง' })
          : null,
      ]),
    ]);
    card.onclick = () => openRequestDetail(r);
    card.onkeydown = (e) => { if (e.key === 'Enter') openRequestDetail(r); };
    wrap.appendChild(card);
  });
}

// ── รายละเอียดคำขอ + ปุ่มสร้างการจอง ──
function openRequestDetail(r) {
  const t = typeOf(r);
  const pet = petIdFromWeb(r.pet);
  const wrap = el('div', {});
  wrap.appendChild(el('h2', { text: `คำขอจอง — ${r.owner || '-'}` }));
  wrap.appendChild(el('div', { class: 'row', style: 'gap:6px;margin-bottom:10px' }, [
    el('span', { class: 'pill yellow', text: t.label }),
    el('span', { class: `pet-chip pet-${pet} pet-chip-lg`, html: `${PET_ICONS[pet]} ${r.petname || '-'}` }),
  ]));

  const box = el('div', { class: 'lineitem' }, [el('div', { class: 'li-head' }, [el('strong', { text: 'ข้อมูลที่ลูกค้ากรอก' })])]);
  const add = (k, v) => { if (v) box.appendChild(el('div', { class: 'cc-row' }, [el('span', { class: 'k', text: k }), el('span', { class: 'v', style: 'white-space:normal;max-width:62%', text: String(v) })])); };
  add('เจ้าของ', r.owner);
  add('เบอร์โทร', r.phone);
  add('LINE', r.line);
  add('อีเมล', r.email);
  add('ชนิดสัตว์', r.pet);
  add('ชื่อน้อง', r.petname);
  add('สายพันธุ์/ขนาด', r.breed);
  add('บริการที่ขอ', r.service);
  add('ห้องที่เลือก', r.room);
  add('วันรับเข้า', r.checkin ? formatDateTH(r.checkin) : '');
  add('วันรับกลับ', r.checkout ? formatDateTH(r.checkout) : '');
  add('ช่วงเวลา', r.time ? `${r.time} น.` : '');
  add('หมายเหตุ', r.note);
  add('ส่งเมื่อ', r.submittedAt ? new Date(r.submittedAt).toLocaleString('th-TH') : '');
  wrap.appendChild(box);

  const o = onlineOf(r);
  if (o) {
    const draft = o.kind === 'groom' ? { lineItems: [], addOns: [] } : draftFromRequest(r);
    const calc = computeBooking(draft);
    const ob = el('div', { class: 'lineitem' }, [el('div', { class: 'li-head' }, [
      el('strong', { text: `จองผ่านหน้าจองใหม่ · ${o.code}` })])]);
    const row = (k, v) => ob.appendChild(el('div', { class: 'cc-row' }, [el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v })]));
    if (o.kind === 'groom') {
      row('บริการ', `${o.serviceLabel} · ${o.pet === 'cat' ? 'แมว' : 'สุนัข'} ไซส์ ${String(o.size).toUpperCase()} · ${o.coatLabel}`);
      row('วัน/รอบ', `${formatDateTH(o.date)} · ${o.time} น. (${o.durationLabel || ''})`);
      row('ราคาประมาณ', formatBaht(o.totals?.grand || 0));
      if (o.weightKg) row('น้ำหนัก', `${o.weightKg} กก.`);
    } else if (o.kind === 'daycare') {
      row('Day Care', `${o.daycare?.count || 1} ตัว · ไซส์ ${String(o.daycare?.size || '').toUpperCase()} · ${formatBaht(o.daycare?.unitPrice || 0)}/ตัว`);
    } else {
      row('ห้อง', `${o.roomLabel || o.roomType} × ${o.rooms} ห้อง · ${formatBaht(o.pricePerNight)}/คืน${o.listPrice > o.pricePerNight ? ` (ราคาเต็ม ${formatBaht(o.listPrice)})` : ''}`);
      row('จำนวนคืน', `${o.nights} คืน${o.longStayPct ? ` · ลดพักยาว ${o.longStayPct}%` : ''}`);
    }
    if (o.kind !== 'groom') {
      (o.addOns || []).forEach(a => row(a.name, `${a.qty} ${a.unit || ''} × ${formatBaht(a.unitPrice)}`));
      row('ยอดรวม', formatBaht(calc.grandTotal));
      row('มัดจำที่ต้องเห็นในสลิป', formatBaht(calc.depositAmount));
      if (o.wantGroom) row('สนใจ', 'อาบน้ำ–ตัดขนก่อนกลับบ้าน');
      const left = holdLeft(o);
      row('กันห้อง', left ? `เหลือ ${left}` : 'หมดเวลาแล้ว — เช็คปฏิทินก่อนยืนยัน');
    } else {
      row('มัดจำ', 'ไม่เก็บ — ยืนยันคิวทาง LINE');
    }
    wrap.appendChild(ob);
    // กันพลาด: ยอดที่ระบบคำนวณใหม่ต้องตรงกับที่ลูกค้าเห็นบนเว็บ
    if (o.kind !== 'groom' && Math.round(calc.grandTotal) !== Math.round(o.totals?.grand || 0)) {
      wrap.appendChild(el('div', { class: 'promo-banner warn', style: 'margin:10px 0' }, [
        el('span', { class: 'promo-text', html: `${icons.alert} ยอดในระบบ (${formatBaht(calc.grandTotal)}) ไม่ตรงกับที่ลูกค้าเห็นบนเว็บ (${formatBaht(o.totals?.grand || 0)}) — ตรวจราคาก่อนบันทึก` }),
      ]));
    }
  }

  const apptType = APPOINTMENT_FROM_REQUEST[classifyRequest(r.service)] || null;

  if (!t.isStay && !onlineOf(r)) {
    wrap.appendChild(el('div', { class: 'promo-banner warn', style: 'margin:10px 0' }, [
      el('span', { class: 'promo-text', html: apptType
        ? `${icons.alert} คำขอนี้เป็น <strong>${t.label}</strong> — ใช้ปุ่ม "สร้างนัดหมาย" เพื่อลงคิวรายรอบ`
        : `${icons.alert} คำขอนี้เป็น <strong>${t.label}</strong> ไม่ใช่การพักค้างคืน — ถ้าสร้างการจองต้องเติมห้อง/ราคาเอง` }),
    ]));
  }

  // คำขอ Grooming/ออกกำลังกาย → ปุ่มหลักคือ "สร้างนัดหมาย" ไม่ใช่ "สร้างการจอง"
  const apptBtn = apptType ? el('button', { class: 'btn primary', html: icons.plus + ' สร้างนัดหมาย' }) : null;
  const makeBtn = el('button', { class: apptType ? 'btn' : 'btn primary', html: icons.plus + ' สร้างการจอง' });
  const doneBtn = el('button', { class: 'btn', html: icons.check + ((r.status === 'done') ? ' กลับเป็นยังไม่จัดการ' : ' ทำเครื่องหมายว่าจัดการแล้ว') });
  const delBtn = el('button', { class: 'btn danger', html: icons.trash + ' ลบ' });
  // คำขอจากหน้าจองใหม่: ปุ่มหลัก = เห็นสลิปแล้ว → สร้างการจอง (มัดจำแล้ว) · ปล่อยห้อง = ลูกค้าไม่โอน
  const isGroom = o?.kind === 'groom';
  const slipBtn = o ? el('button', { class: 'btn primary', html: icons.check + (isGroom ? ' ยืนยันคิว → สร้างนัดหมาย' : ' เห็นสลิปแล้ว → สร้างการจอง') }) : null;
  const releaseBtn = o && (r.status || 'new') === 'new' ? el('button', { class: 'btn', html: isGroom ? ' ปล่อยคิว' : ' ปล่อยห้อง' }) : null;
  if (o) makeBtn.className = 'btn';
  wrap.appendChild(el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px;gap:8px;flex-wrap:wrap' },
    (isGroom ? [delBtn, doneBtn, releaseBtn, slipBtn] : [delBtn, doneBtn, releaseBtn, makeBtn, apptBtn, slipBtn]).filter(Boolean)));

  if (apptBtn) apptBtn.onclick = async () => {
    try {
      await save('bookingRequests', { ...r, status: 'done', handledAt: Date.now() });
      await upsertPetFromRequest(r);
      m.close();
      openAppointmentForm(apptDraftFromRequest(r, apptType));
      toast('เติมข้อมูลให้แล้ว — เลือกรอบเวลา/ขนาดน้อง แล้วกดบันทึก');
    } catch (e) {
      console.error(e);
      toast('สร้างนัดหมายไม่สำเร็จ: ' + e.message);
    }
  };

  const m = openModal(wrap);

  if (slipBtn) slipBtn.onclick = async () => {
    try {
      await save('bookingRequests', { ...r, status: 'done', handledAt: Date.now() });
      await upsertPetFromRequest(r);
      await releaseHold(r); // การจองจริงจะนับห้องแทนการกันห้อง
      m.close();
      if (isGroom) {
        openAppointmentForm(apptDraftFromOnline(r, o));
        toast('เติมข้อมูลคิวครบแล้ว — ตรวจไซส์/ขนกับลูกค้า แล้วกดบันทึก');
      } else {
        openBookingForm({ ...draftFromRequest(r), depositStatus: 'มัดจำแล้ว', depositDate: todayISO() });
        toast('เติมข้อมูลครบแล้ว — ตรวจยอดกับสลิป แล้วกดบันทึก');
      }
    } catch (e) {
      console.error(e);
      toast('สร้างการจองไม่สำเร็จ: ' + e.message);
    }
  };
  if (releaseBtn) releaseBtn.onclick = async () => {
    if (!await confirmDialog(isGroom ? 'ปล่อยคิวนี้? (ลูกค้ายกเลิก/ติดต่อไม่ได้)' : 'ปล่อยห้องที่กันไว้ให้คำขอนี้? (ลูกค้าไม่โอน/ยกเลิก)', { okText: isGroom ? 'ปล่อยคิว' : 'ปล่อยห้อง' })) return;
    await releaseHold(r);
    await save('bookingRequests', { ...r, status: 'done', released: true, handledAt: Date.now() });
    m.close(); toast('ปล่อยห้องแล้ว');
  };

  makeBtn.onclick = async () => {
    try {
      await save('bookingRequests', { ...r, status: 'done', handledAt: Date.now() });
      await upsertPetFromRequest(r); // เก็บชื่อน้อง/พันธุ์ไว้ในฐานลูกค้า ไม่ให้ข้อมูลหาย
      await releaseHold(r);
      m.close();
      openBookingForm(draftFromRequest(r)); // เปิดฟอร์มจองที่เติมข้อมูลลูกค้าให้แล้ว
      toast('เติมข้อมูลลูกค้าให้แล้ว — เลือกห้อง/ราคา แล้วกดบันทึก');
    } catch (e) {
      // ถ้าไม่ดัก error ใน async onclick จะเงียบหาย ปุ่มดูเหมือนกดไม่ติด
      console.error(e);
      toast('สร้างการจองไม่สำเร็จ: ' + e.message);
    }
  };
  doneBtn.onclick = async () => {
    await save('bookingRequests', { ...r, status: r.status === 'done' ? 'new' : 'done', handledAt: Date.now() });
    m.close(); toast('อัปเดตสถานะแล้ว');
  };
  delBtn.onclick = async () => {
    if (!await confirmDialog('ลบคำขอนี้?', { danger: true, okText: 'ลบ' })) return;
    await releaseHold(r);
    await remove('bookingRequests', r.id); m.close(); toast('ลบแล้ว');
  };
}

// บันทึกชื่อน้อง/สายพันธุ์จากคำขอเข้าฐานลูกค้า
// (ถ้าไม่ทำ พี่เลี้ยงจะไม่เห็นชื่อน้องในหน้างานวันนี้ และใบรับฝากจะไม่มีหมวดสัตว์เลี้ยง)
async function upsertPetFromRequest(r) {
  if (!r.petname) return;
  const norm = t => (t || '').replace(/\D/g, '');
  const customers = await getAll('customers'); // อ่านสดตอนใช้ — ไฟล์นี้ไม่ได้ subscribe ลูกค้าไว้
  const existing = customers.find(c =>
    (r.phone && c.phone && norm(c.phone) === norm(r.phone)) || (c.name && c.name === r.owner));

  const pet = {
    name: r.petname,
    species: petIdFromWeb(r.pet),
    breed: r.breed || '',
    weight: '',
    healthNotes: r.note || '',
    vaccineNotes: '',
    vaccineExpiry: '', // ให้พนักงานกรอกตอนตรวจสมุดวัคซีน
  };

  if (!existing) {
    await save('customers', { name: r.owner || '', phone: r.phone || '', pets: [pet], notes: '' });
    return;
  }
  // มีลูกค้าแล้ว — เพิ่มน้องเฉพาะที่ยังไม่มีชื่อนี้ (กันซ้ำเมื่อจองหลายรอบ)
  const pets = existing.pets || [];
  if (pets.some(p => (p.name || '').trim() === pet.name.trim())) return;
  await save('customers', { ...existing, pets: [...pets, pet] });
}

// แปลงคำขอ → draft ของฟอร์มจอง (เติมเท่าที่รู้จริง ที่เหลือพนักงานกรอก)
// แปลงคำขอจากเว็บเป็น "ร่างนัดหมาย" — เติมได้เท่าที่ฟอร์มเว็บมี
// ขนาดน้อง/ระดับบริการ เว็บไม่ได้ถาม พนักงานต้องเลือกเองตอนเปิดฟอร์ม (ราคาจึงคำนวณตอนนั้น)
export function apptDraftFromRequest(r, type) {
  const notes = [
    `[จากเว็บ] บริการที่ขอ: ${r.service || '-'}`,
    r.breed && `สายพันธุ์/ขนาด: ${r.breed}`,
    r.line && `LINE: ${r.line}`,
    r.email && `อีเมล: ${r.email}`,
    r.note && `หมายเหตุลูกค้า: ${r.note}`,
  ].filter(Boolean).join('\n');

  return {
    type,
    date: r.checkin || todayISO(),
    // ใช้เวลาที่ลูกค้าขอมาได้ก็ต่อเมื่อตรงกับรอบจริงของโซนนั้น ไม่งั้นให้เลือกใหม่
    time: slotsFor(type).includes(r.time) ? r.time : '',
    customerName: r.owner || '',
    phone: r.phone || '',
    petName: r.petname || '',
    petType: type === 'exercise' ? 'dog' : petIdFromWeb(r.pet),
    size: '', coatType: 'short',
    // เว็บส่งมาแค่ข้อความ แยกไม่ออกว่าตัดขนอย่างเดียวหรืออาบน้ำด้วย → ตั้งเป็นอาบน้ำ+ตัดขน
    // ให้พนักงานเปลี่ยนเป็น "ตัดขนอย่างเดียว" ตอนคุยกับลูกค้าถ้าจำเป็น
    groomService: /ตัดขน/.test(String(r.service || '')) ? 'bathCut' : 'bath',
    // โซนออกกำลังกาย: เดาโซนจากข้อความบริการ (สระ/ว่ายน้ำ/splash/pool → โซนสระ) ค่าเริ่มต้น = โซนสนาม
    exSize: 'S', zone: /สระ|ว่ายน้ำ|splash|pool/i.test(String(r.service || '')) ? 'pool' : 'field',
    price: 0, status: 'จองแล้ว', notes,
    source: 'web',
  };
}

// คำขอจากหน้าจองใหม่ → ร่างใบจองครบทุกช่อง (ราคา/ส่วนลด/บริการเสริมตามที่ลูกค้าเห็นบนเว็บ)
// คำขอ Grooming จากหน้าจองออนไลน์ → ร่างนัดหมายครบ (ไซส์/ขน/บริการ/รอบ)
export function apptDraftFromOnline(r, o) {
  const notes = [
    `[จองออนไลน์ ${o.code}]`,
    r.breed && `สายพันธุ์: ${r.breed}`,
    o.weightKg && `น้ำหนัก: ${o.weightKg} กก.`,
    r.line && `LINE: ${r.line}`,
    r.email && `อีเมล: ${r.email}`,
    r.note && `หมายเหตุลูกค้า: ${r.note}`,
  ].filter(Boolean).join('\n');
  const pet = { petName: r.petname || '', petType: o.pet, size: o.size, coatType: o.coat || 'short', groomService: o.service };
  return {
    type: 'grooming', date: o.date, time: o.time,
    customerName: r.owner || '', phone: r.phone || '',
    pets: Array.from({ length: Math.max(1, Number(o.pets) || 1) }, (_, i) => ({ ...pet, petName: i ? '' : pet.petName })),
    status: 'จองแล้ว', notes, source: 'web', onlineCode: o.code, fromWebRequest: r.id,
  };
}

function draftFromOnline(r, o, s) {
  const notes = [
    `[จองออนไลน์ ${o.code}]`,
    o.longStayPct && `ส่วนลดพักยาว ${o.longStayPct}% (${o.longStayDisc || 0} บาท)`,
    r.breed && `สายพันธุ์: ${r.breed}`,
    o.weightKg && `น้ำหนัก: ${o.weightKg} กก.`,
    o.arriveTime && `เวลามาถึง: ${o.arriveTime}`,
    r.line && `LINE: ${r.line}`,
    r.email && `อีเมล: ${r.email}`,
    o.wantGroom && 'สนใจอาบน้ำ–ตัดขนก่อนกลับบ้าน',
    r.note && `หมายเหตุลูกค้า: ${r.note}`,
  ].filter(Boolean).join('\n');
  const addOns = (o.addOns || []).map(a => ({
    kind: FIXED_ADDONS.some(f => f.name === a.name) ? 'fixed' : 'svc',
    name: a.name, unit: a.unit || 'ครั้ง', unitPrice: Number(a.unitPrice) || 0, qty: Number(a.qty) || 1,
  }));
  const base = {
    customerName: r.owner || '', phone: r.phone || '',
    depositDate: todayISO(),
    checkInTime: (o.arriveTime || '09:00').slice(0, 5), checkOutTime: '14:00',
    billDiscountType: 'percent', billDiscountValue: 0,
    depositMethod: DEFAULT_DEPOSIT_METHOD,
    depositPct: o.depositPct ?? s?.depositPctDefault ?? 50,
    depositStatus: 'ยังไม่มัดจำ', recordStatus: 'ยังไม่ลงระบบ',
    notes, fromWebRequest: r.id, onlineCode: o.code,
  };
  if (o.kind === 'daycare') {
    const d = o.daycare || {};
    return { ...base, checkIn: o.checkIn, checkOut: o.checkIn, lineItems: [],
      addOns: [{ kind: 'daycare', name: 'Day Care เหมาวัน', pet: o.pet, size: d.size || 'm', unit: 'วัน',
        unitPrice: Number(d.unitPrice) || 0, qty: Number(d.count) || 1, weightKg: o.weightKg || '' }, ...addOns] };
  }
  return { ...base, checkIn: o.checkIn, checkOut: o.checkOut,
    lineItems: [{ petType: o.pet, roomType: o.roomType, pricePerNight: Number(o.pricePerNight) || 0,
      rooms: Number(o.rooms) || 1, nights: Number(o.nights) || nightsBetween(o.checkIn, o.checkOut) || 1,
      // ส่วนลดพักยาว: ลูกค้าเห็นยอดปัดเป็นบาทเต็มบนเว็บ → บันทึกเป็นจำนวนเงินให้ตรงกันเป๊ะ
      discountType: 'amount', discountValue: Number(o.longStayDisc) || 0 }],
    addOns };
}

export function draftFromRequest(r) {
  const s = getSettings();
  const online = onlineOf(r);
  if (online) return draftFromOnline(r, online, s);
  const pet = petIdFromWeb(r.pet);
  const type = classifyRequest(r.service);
  const isStay = REQUEST_TYPES[type]?.isStay;

  // จับคู่ห้องจากชื่อที่เว็บส่งมา (app.html ส่ง "Cozy Room" ตรงกับ label ในระบบ)
  let roomType = 'cozy';
  if (r.room) {
    const hit = Object.entries(s?.roomPrices || {}).find(([, v]) =>
      String(v.label).trim().toLowerCase() === String(r.room).trim().toLowerCase());
    if (hit) roomType = hit[0];
  }
  const price = s?.roomPrices?.[roomType]?.[pet] ?? 0;

  // รวมข้อมูลที่ระบบจองไม่มีช่องเก็บ ให้ไปอยู่ในหมายเหตุ (กันข้อมูลลูกค้าหาย)
  const notes = [
    `[จากเว็บ] บริการที่ขอ: ${r.service || '-'}`,
    r.breed && `สายพันธุ์/ขนาด: ${r.breed}`,
    r.time && `ช่วงเวลาที่สะดวก: ${r.time} น.`,
    r.line && `LINE: ${r.line}`,
    r.email && `อีเมล: ${r.email}`,
    r.note && `หมายเหตุลูกค้า: ${r.note}`,
    !isStay && `⚠️ คำขอนี้ไม่ใช่การพักค้างคืน (${REQUEST_TYPES[type]?.label || '-'})`,
  ].filter(Boolean).join('\n');

  return {
    // ไม่ใส่ id → เป็นใบใหม่
    customerName: r.owner || '',
    phone: r.phone || '',
    depositDate: todayISO(),
    checkIn: r.checkin || '',
    checkOut: r.checkout || '',
    checkInTime: '09:00', checkOutTime: '14:00',
    lineItems: [{
      petType: pet, roomType, pricePerNight: price,
      rooms: 1,
      // คำนวณคืนจากวันที่ลูกค้าเลือกมาเลย — ตัว syncNights ในฟอร์มทำงานเฉพาะตอน
      // "เปลี่ยนวันที่" ถ้าไม่คิดตรงนี้ จะได้ 1 คืนเสมอ = คิดเงินขาด
      nights: nightsBetween(r.checkin, r.checkout) || 1,
      discountType: 'percent', discountValue: 0,
    }],
    addOns: [],
    billDiscountType: 'percent', billDiscountValue: 0,
    depositMethod: DEFAULT_DEPOSIT_METHOD,
    depositPct: s?.depositPctDefault ?? 50,
    depositStatus: 'ยังไม่มัดจำ', // คำขอยังไม่จ่ายเงิน
    recordStatus: 'ยังไม่ลงระบบ',
    notes,
    fromWebRequest: r.id, // อ้างอิงกลับไปคำขอต้นทาง
  };
}
