// ═══════════════════════════════════════════════════════════════
// booking-requests.js — กล่องรับ "คำขอจอง" จากฟอร์มจองบนเว็บ perfectbkk.com
//   (หน้า index.html · app.html · exercise-zone.html — ใช้ endpoint เดียวกัน)
//
// ทำไมเป็น "คำขอจอง" ไม่ใช่ "การจอง" ทันที:
//   ฟอร์มบนเว็บไม่มีประเภทห้อง/จำนวนห้อง/ราคา และบางคำขอไม่ใช่ที่พักด้วยซ้ำ
//   (อาบน้ำ, โซนออกกำลังกาย) → พนักงานต้องตรวจ+เติมข้อมูลก่อนจึงเป็นการจองจริง
// ═══════════════════════════════════════════════════════════════
import { listen, save, remove, getAll } from './db.js';
import { el, toast, openModal, confirmDialog, getSettings } from './ui.js';
import { formatDateTH, todayISO, nightsBetween } from './calc.js';
import { REQUEST_TYPES, classifyRequest, petIdFromWeb, DEFAULT_DEPOSIT_METHOD } from './config-shop.js';
import { openBookingForm } from './bookings.js';
import { icons } from './icons.js';

let _unsub = [];
let _reqs = [];

const PET_ICONS = { dog: icons.dog, cat: icons.cat };

function typeOf(r) { return REQUEST_TYPES[classifyRequest(r.service)] || REQUEST_TYPES.other; }

export function renderBookingRequests(container) {
  _unsub.forEach(u => u()); _unsub = [];

  const listWrap = el('div', {});
  const filterSel = el('select', { style: 'max-width:200px' }, [
    el('option', { value: 'new', text: 'ยังไม่จัดการ' }),
    el('option', { value: 'all', text: 'ทั้งหมด' }),
    el('option', { value: 'done', text: 'จัดการแล้ว' }),
  ]);

  container.appendChild(el('div', { class: 'page-title' }, [
    el('h1', { text: 'คำขอจองจากเว็บ' }),
    filterSel,
  ]));
  container.appendChild(el('p', { class: 'muted', style: 'font-size:13px;margin-top:-8px', text:
    'ลูกค้ากรอกฟอร์มจองที่ perfectbkk.com → คำขอเด้งมาที่นี่ → ตรวจแล้วกด "สร้างการจอง" เพื่อเติมห้อง/ราคา/มัดจำ' }));
  container.appendChild(listWrap);

  const draw = () => {
    const f = filterSel.value;
    const rows = _reqs
      .filter(r => f === 'all' ? true : f === 'done' ? r.status === 'done' : (r.status || 'new') === 'new')
      .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));

    listWrap.innerHTML = '';
    if (!rows.length) {
      listWrap.appendChild(el('div', { class: 'card' }, [
        el('p', { class: 'muted', style: 'padding:16px;text-align:center', text:
          f === 'new' ? 'ไม่มีคำขอค้างอยู่ — เคลียร์หมดแล้ว' : 'ยังไม่มีคำขอจองเข้ามา' }),
      ]));
      return;
    }
    rows.forEach(r => {
      const t = typeOf(r);
      const isNew = (r.status || 'new') === 'new';
      const pet = petIdFromWeb(r.pet);
      const card = el('div', { class: `card day-guest section-card section--${t.color}`, style: 'padding:14px 16px' }, [
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
        ].filter(Boolean)),
        el('div', { class: 'muted', style: 'font-size:13px', text:
          `${r.checkin ? formatDateTH(r.checkin) : '-'}${r.checkout ? ` → ${formatDateTH(r.checkout)}` : ''}${r.time ? ` · ${r.time} น.` : ''} · ส่งเมื่อ ${r.submittedAt ? new Date(r.submittedAt).toLocaleString('th-TH') : '-'}` }),
      ]);
      card.onclick = () => openRequestDetail(r);
      listWrap.appendChild(card);
    });
  };

  filterSel.onchange = draw;
  _unsub.push(listen('bookingRequests', arr => { _reqs = arr; draw(); }, { orderBy: null }));
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

  if (!t.isStay) {
    wrap.appendChild(el('div', { class: 'promo-banner warn', style: 'margin:10px 0' }, [
      el('span', { class: 'promo-text', html:
        `${icons.alert} คำขอนี้เป็น <strong>${t.label}</strong> ไม่ใช่การพักค้างคืน — ถ้าสร้างการจองต้องเติมห้อง/ราคาเอง` }),
    ]));
  }

  const makeBtn = el('button', { class: 'btn primary', html: icons.plus + ' สร้างการจอง' });
  const doneBtn = el('button', { class: 'btn', html: icons.check + ((r.status === 'done') ? ' กลับเป็นยังไม่จัดการ' : ' ทำเครื่องหมายว่าจัดการแล้ว') });
  const delBtn = el('button', { class: 'btn danger', html: icons.trash + ' ลบ' });
  wrap.appendChild(el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px;gap:8px' }, [delBtn, doneBtn, makeBtn]));

  const m = openModal(wrap);

  makeBtn.onclick = async () => {
    try {
      await save('bookingRequests', { ...r, status: 'done', handledAt: Date.now() });
      await upsertPetFromRequest(r); // เก็บชื่อน้อง/พันธุ์ไว้ในฐานลูกค้า ไม่ให้ข้อมูลหาย
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
export function draftFromRequest(r) {
  const s = getSettings();
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
