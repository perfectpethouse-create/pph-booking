// ═══════════════════════════════════════════════════════════════
// bookings.js — หน้ารายการจอง + ฟอร์มเพิ่ม/แก้ไข (หัวใจของระบบ)
// ═══════════════════════════════════════════════════════════════
import { listen, save, remove } from './db.js';
import { el, toast, openModal, confirmDialog, getSettings, currentUser } from './ui.js';
import { computeBooking, formatBaht, formatDateTH, nightsBetween, todayISO } from './calc.js';
import { PET_TYPES, DEPOSIT_STATUSES, RECORD_STATUSES, VIP_PROMO_PRICE } from './config-shop.js';
import { buildCustomerCard, downloadCardPNG } from './summary-card.js';
import { icons } from './icons.js';

let _bookings = [];
let _customers = [];
let _unsub = [];

export function renderBookings(container) {
  _unsub.forEach(u => u()); _unsub = [];

  const searchInput = el('input', { placeholder: 'ค้นหาชื่อ / เบอร์', style: 'max-width:220px' });
  const statusFilter = el('select', { style: 'max-width:180px' }, [
    el('option', { value: '', text: 'สถานะมัดจำ: ทั้งหมด' }),
    ...DEPOSIT_STATUSES.map(s => el('option', { value: s, text: s })),
  ]);
  const addBtn = el('button', { class: 'btn primary', html: icons.plus + ' เพิ่มการจอง' });
  addBtn.onclick = () => openBookingForm(null);

  const tableWrap = el('div', { class: 'table-wrap' });

  container.appendChild(el('div', { class: 'page-title' }, [
    el('h1', { text: 'การจองทั้งหมด' }),
    el('div', { class: 'row', style: 'gap:8px' }, [searchInput, statusFilter, addBtn]),
  ]));
  container.appendChild(el('div', { class: 'card' }, [tableWrap]));

  const draw = () => {
    const q = searchInput.value.trim().toLowerCase();
    const sf = statusFilter.value;
    const rows = _bookings.filter(b => {
      const hay = `${b.customerName || ''} ${b.phone || ''}`.toLowerCase();
      return (!q || hay.includes(q)) && (!sf || b.depositStatus === sf);
    });
    tableWrap.innerHTML = '';
    tableWrap.appendChild(buildTable(rows));
  };
  searchInput.oninput = draw;
  statusFilter.onchange = draw;

  _unsub.push(listen('bookings', arr => { _bookings = sortByCheckIn(arr); draw(); }));
  _unsub.push(listen('customers', arr => { _customers = arr; }));
}

function sortByCheckIn(arr) {
  return [...arr].sort((a, b) => (b.checkIn || '').localeCompare(a.checkIn || ''));
}

function statusPill(s) {
  const map = { 'จ่ายครบแล้ว': 'green', 'มัดจำแล้ว': 'yellow', 'ยกเลิก': 'red', 'ยังไม่มัดจำ': 'grey' };
  return el('span', { class: 'pill ' + (map[s] || 'grey'), text: s || '-' });
}

function buildTable(rows) {
  if (!rows.length) {
    return el('p', { class: 'muted', style: 'padding:20px;text-align:center', text: 'ยังไม่มีการจอง — กด "เพิ่มการจอง" เพื่อเริ่ม' });
  }
  const cols = ['ลูกค้า', 'เข้าพัก', 'ออก', 'ห้อง', 'ยอดรวม', 'มัดจำ', 'คงเหลือ', 'สถานะ', ''];
  const head = el('tr', {}, cols.map((h, i) => el('th', { class: [4, 5, 6].includes(i) ? 'num' : '', text: h })));
  const body = rows.map(raw => {
    const b = computeBooking(raw);
    const s = getSettings();
    const roomsDesc = b.lineItems.map(li => `${li.rooms || 1}×${(s?.roomPrices?.[li.roomType]?.label || li.roomType)}`).join(', ');
    const tr = el('tr', { style: 'cursor:pointer' }, [
      el('td', {}, [el('strong', { text: b.customerName || '-' }), el('div', { class: 'muted', style: 'font-size:12px', text: b.phone || '' })]),
      el('td', { text: formatDateTH(b.checkIn) }),
      el('td', { text: formatDateTH(b.checkOut) }),
      el('td', { style: 'max-width:180px;white-space:normal', text: roomsDesc }),
      el('td', { class: 'num', text: formatBaht(b.grandTotal) }),
      el('td', { class: 'num', text: formatBaht(b.depositAmount) }),
      el('td', { class: 'num', text: formatBaht(b.balanceDue) }),
      el('td', {}, [statusPill(b.depositStatus)]),
      el('td', {}, [el('button', { class: 'btn sm ghost', text: '⋯' })]),
    ]);
    tr.onclick = () => openBookingForm(raw);
    return tr;
  });
  return el('table', {}, [el('thead', {}, [head]), el('tbody', {}, body)]);
}

// ═══════════ ฟอร์มจอง ═══════════
function blankLineItem(s) {
  const li = { petType: 'dog', roomType: 'cozy', pricePerNight: null, rooms: 1, nights: 1, discountType: 'percent', discountValue: 0 };
  li.pricePerNight = priceFor('cozy', 'dog', s);
  return li;
}
function priceFor(roomType, petType, s) { return s?.roomPrices?.[roomType]?.[petType] ?? 0; }

function openBookingForm(existing) {
  const s = getSettings();
  const isNew = !existing;
  const draft = existing ? structuredClone(existing) : {
    customerName: '', phone: '', depositDate: todayISO(),
    checkIn: '', checkOut: '', checkInTime: '09:00', checkOutTime: '14:00',
    lineItems: [blankLineItem(s)], addOns: [],
    depositPct: s?.depositPctDefault ?? 50,
    depositStatus: 'มัดจำแล้ว', recordStatus: 'ยังไม่ลงระบบ', notes: '',
  };

  const form = el('div', {});
  const m = openModal(form);
  build();

  function rerender() { form.innerHTML = ''; build(); }

  function build() {
    // กล่องสรุป (ประกาศก่อน เพื่อให้ handler ทุกตัวเรียก refreshSummary ได้)
    const summaryBox = el('div', { class: 'summary-box' });
    const refreshSummary = () => {
      const b = computeBooking(draft);
      const line = (k, v, cls = '') => el('div', { class: 'line ' + cls }, [el('span', { text: k }), el('span', { text: v })]);
      summaryBox.innerHTML = '';
      [
        line('ยอดค่าห้อง (หลังส่วนลด)', formatBaht(b.itemsTotal)),
        b.addOnsTotal ? line('บริการเสริม', formatBaht(b.addOnsTotal)) : null,
        b.totalDiscount ? line('รวมส่วนลด', '− ' + formatBaht(b.totalDiscount)) : null,
        line('ยอดทั้งหมด', formatBaht(b.grandTotal), 'grand'),
        line(`มัดจำ ${b.depositPct}%`, formatBaht(b.depositAmount)),
        line('จ่ายเพิ่มวัน Check-in', formatBaht(b.balanceDue)),
      ].filter(Boolean).forEach(n => summaryBox.appendChild(n));
    };

    function syncNights() {
      const n = nightsBetween(draft.checkIn, draft.checkOut);
      if (n > 0) {
        draft.lineItems.forEach(li => li.nights = n);
        itemsWrap.querySelectorAll('input[data-nights]').forEach(inp => inp.value = n);
      }
    }

    // ── หัวลูกค้า ──
    const nameField = field('ชื่อลูกค้า', draft.customerName, v => { draft.customerName = v; const c = _customers.find(c => c.name === v); if (c?.phone && !draft.phone) { draft.phone = c.phone; phoneField.querySelector('input').value = c.phone; } }, { list: 'cust-names' });
    nameField.appendChild(el('datalist', { id: 'cust-names' }, _customers.map(c => el('option', { value: c.name }))));
    const phoneField = field('เบอร์โทร', draft.phone, v => draft.phone = v);

    const depDateField = field('วันที่โอนมัดจำ', draft.depositDate, v => draft.depositDate = v, { type: 'date' });
    const inDateField = field('วันที่ Check-in', draft.checkIn, v => { draft.checkIn = v; syncNights(); refreshSummary(); }, { type: 'date' });
    const outDateField = field('วันที่ Check-out', draft.checkOut, v => { draft.checkOut = v; syncNights(); refreshSummary(); }, { type: 'date' });
    const inTimeField = field('เวลาเข้า', draft.checkInTime, v => draft.checkInTime = v, { type: 'time' });
    const outTimeField = field('เวลาออก', draft.checkOutTime, v => draft.checkOutTime = v, { type: 'time' });
    const depPctField = field('มัดจำ (%)', draft.depositPct, v => { draft.depositPct = Number(v) || 0; refreshSummary(); }, { type: 'number', min: 0, max: 100 });

    // ── รายการห้อง ──
    const itemsWrap = el('div', {});
    draft.lineItems.forEach((li, idx) => itemsWrap.appendChild(lineItemRow(li, idx)));
    const addItemBtn = el('button', { class: 'btn sm ghost', html: icons.plus + ' เพิ่มห้อง/สัตว์' });
    addItemBtn.onclick = () => { draft.lineItems.push(blankLineItem(s)); rerender(); };

    function lineItemRow(li, idx) {
      const petSel = selectEl(PET_TYPES.map(p => [p.id, p.label]), li.petType, v => { li.petType = v; li.pricePerNight = priceFor(li.roomType, v, s); priceInp.value = li.pricePerNight ?? ''; refreshSummary(); });
      const roomSel = selectEl(Object.entries(s?.roomPrices || {}).map(([k, r]) => [k, r.label]), li.roomType, v => { li.roomType = v; li.pricePerNight = priceFor(v, li.petType, s); priceInp.value = li.pricePerNight ?? ''; refreshSummary(); });
      const priceInp = numInput(li.pricePerNight, v => { li.pricePerNight = v; refreshSummary(); }, 'ราคา/คืน');
      const roomsInp = numInput(li.rooms, v => { li.rooms = v; refreshSummary(); }, 'ห้อง', 1);
      const nightsInp = numInput(li.nights, v => { li.nights = v; refreshSummary(); }, 'คืน', 1);
      nightsInp.setAttribute('data-nights', '1');
      const discType = selectEl([['percent', 'ส่วนลด %'], ['amount', 'ส่วนลด บาท']], li.discountType, v => { li.discountType = v; refreshSummary(); });
      const discVal = numInput(li.discountValue, v => { li.discountValue = v; refreshSummary(); });

      const promoBtn = el('button', { class: 'btn sm', html: `${icons.star} โปรวันนี้ VIP ${VIP_PROMO_PRICE.toLocaleString('th-TH')}` });
      promoBtn.onclick = () => { li.roomType = 'vip'; roomSel.value = 'vip'; li.pricePerNight = s?.vipPromoPrice || VIP_PROMO_PRICE; priceInp.value = li.pricePerNight; refreshSummary(); };

      const rmBtn = el('button', { class: 'btn sm danger', html: icons.x, 'aria-label': 'ลบรายการ' });
      rmBtn.onclick = () => { draft.lineItems.splice(idx, 1); if (!draft.lineItems.length) draft.lineItems.push(blankLineItem(s)); rerender(); };

      return el('div', { class: 'lineitem' }, [
        el('div', { class: 'li-head' }, [el('strong', { text: `รายการที่ ${idx + 1}` }), rmBtn]),
        el('div', { class: 'row' }, [labeled('สัตว์', petSel), labeled('ประเภทห้อง', roomSel), labeled('ราคา/คืน', priceInp)]),
        el('div', { class: 'row' }, [labeled('จำนวนห้อง', roomsInp), labeled('จำนวนคืน', nightsInp), labeled('ชนิดส่วนลด', discType), labeled('ส่วนลด', discVal)]),
        el('div', { style: 'margin-top:6px' }, [promoBtn]),
      ]);
    }

    // ── บริการเสริม ──
    const addonsWrap = el('div', {});
    const addonOpts = s?.addOnServices || [];
    draft.addOns.forEach((a, idx) => addonsWrap.appendChild(addonRow(a, idx)));
    const addAddonBtn = el('button', { class: 'btn sm ghost', html: icons.plus + ' เพิ่มบริการเสริม' });
    addAddonBtn.onclick = () => { draft.addOns.push({ name: addonOpts[0]?.name || '', price: addonOpts[0]?.price || 0 }); rerender(); };

    function addonRow(a, idx) {
      const nameInp = el('input', { list: 'addon-names', value: a.name || '', placeholder: 'ชื่อบริการ' });
      nameInp.oninput = () => { a.name = nameInp.value; const o = addonOpts.find(o => o.name === a.name); if (o) { a.price = o.price; priceInp.value = o.price; } refreshSummary(); };
      const priceInp = el('input', { type: 'number', min: 0, value: a.price ?? 0, style: 'max-width:120px' });
      priceInp.oninput = () => { a.price = Number(priceInp.value) || 0; refreshSummary(); };
      const rm = el('button', { class: 'btn sm danger', html: icons.x, 'aria-label': 'ลบ' });
      rm.onclick = () => { draft.addOns.splice(idx, 1); rerender(); };
      return el('div', { class: 'row', style: 'align-items:flex-end;margin-bottom:8px' }, [
        el('div', { class: 'field', style: 'flex:2' }, [nameInp]),
        el('div', { class: 'field' }, [priceInp]), rm,
        el('datalist', { id: 'addon-names' }, addonOpts.map(o => el('option', { value: o.name }))),
      ]);
    }

    // ── สถานะ + หมายเหตุ ──
    const depStatus = labeled('สถานะมัดจำ', selectEl(DEPOSIT_STATUSES.map(x => [x, x]), draft.depositStatus, v => draft.depositStatus = v));
    const recStatus = labeled('สถานะบันทึก', selectEl(RECORD_STATUSES.map(x => [x, x]), draft.recordStatus, v => draft.recordStatus = v));
    const notesInp = el('textarea', { placeholder: 'พันธุ์ / น้ำหนัก / อาการสุขภาพ / เงื่อนไขพิเศษ' });
    notesInp.value = draft.notes || '';
    notesInp.oninput = () => draft.notes = notesInp.value;

    // ── ปุ่ม ──
    const saveBtn = el('button', { class: 'btn primary', html: icons.save + ' บันทึก' });
    saveBtn.onclick = () => doSave(draft, isNew, m);
    const cardBtn = el('button', { class: 'btn', html: icons.image + ' การ์ดส่งลูกค้า' });
    cardBtn.onclick = () => openCardPreview(draft);
    const delBtn = existing ? el('button', { class: 'btn danger', html: icons.trash + ' ลบ' }) : null;
    if (delBtn) delBtn.onclick = async () => {
      if (await confirmDialog('ลบการจองนี้?', { danger: true, okText: 'ลบ' })) { await remove('bookings', existing.id); m.close(); toast('ลบแล้ว'); }
    };

    form.append(
      el('h2', { text: isNew ? 'เพิ่มการจอง' : 'แก้ไขการจอง' }),
      el('div', { class: 'row' }, [nameField, phoneField]),
      el('div', { class: 'row' }, [depDateField, inDateField, outDateField]),
      el('div', { class: 'row' }, [inTimeField, outTimeField, depPctField]),
      el('label', { text: 'รายการห้องพัก', style: 'margin-top:6px' }), itemsWrap, addItemBtn,
      el('label', { text: 'บริการเสริม', style: 'margin-top:14px' }), addonsWrap, addAddonBtn,
      el('div', { class: 'row', style: 'margin-top:14px' }, [depStatus, recStatus]),
      el('div', { class: 'field' }, [el('label', { text: 'รายละเอียด/หมายเหตุ' }), notesInp]),
      el('label', { text: 'สรุปยอด', style: 'margin-top:10px' }), summaryBox,
      el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px;gap:8px' }, [delBtn, cardBtn, saveBtn].filter(Boolean)),
    );
    refreshSummary();
  }
}

// ────────── helpers ──────────
function field(label, value, onInput, extra = {}) {
  const inp = el('input', { value: value ?? '', ...extra });
  inp.oninput = () => onInput(inp.value);
  return el('div', { class: 'field' }, [el('label', { text: label }), inp]);
}
function numInput(value, onInput, placeholder = '', min = 0) {
  const inp = el('input', { type: 'number', min, value: value ?? '', placeholder });
  inp.oninput = () => onInput(Number(inp.value) || 0);
  return inp;
}
function labeled(label, node) { return el('div', { class: 'field', style: 'margin:0' }, [el('label', { text: label }), node]); }
function selectEl(pairs, value, onChange) {
  const sel = el('select', {}, pairs.map(([v, t]) => el('option', { value: v, text: t })));
  sel.value = value;
  sel.onchange = () => onChange(sel.value);
  return sel;
}

// ────────── บันทึก ──────────
async function doSave(draft, isNew, modal) {
  if (!draft.customerName?.trim()) return toast('กรุณากรอกชื่อลูกค้า');
  if (!draft.checkIn || !draft.checkOut) return toast('กรุณาเลือกวันเข้า-ออก');
  if (nightsBetween(draft.checkIn, draft.checkOut) <= 0) return toast('วัน Check-out ต้องหลัง Check-in');

  const b = computeBooking(draft);
  const rec = {
    ...draft,
    lineItems: b.lineItems, grandTotal: b.grandTotal, itemsTotal: b.itemsTotal,
    addOnsTotal: b.addOnsTotal, totalDiscount: b.totalDiscount,
    depositAmount: b.depositAmount, balanceDue: b.balanceDue, depositPct: b.depositPct,
    createdBy: draft.createdBy || currentUser()?.email || '',
  };
  await save('bookings', rec);
  await upsertCustomer(draft);
  modal.close();
  toast(isNew ? 'บันทึกการจองแล้ว' : 'อัปเดตแล้ว');
}

async function upsertCustomer(draft) {
  const name = draft.customerName.trim();
  if (!name) return;
  if (_customers.some(c => c.name === name)) return; // มีแล้ว ไม่สร้างซ้ำ
  await save('customers', { name, phone: draft.phone || '', pets: [], notes: '' });
}

// ────────── การ์ดสรุป ──────────
function openCardPreview(draft) {
  if (!draft.checkIn || !draft.checkOut) return toast('กรอกวันเข้า-ออกก่อนสร้างการ์ด');
  const card = buildCustomerCard(draft);
  const dlBtn = el('button', { class: 'btn primary', html: icons.download + ' ดาวน์โหลดรูป PNG' });
  openModal(el('div', {}, [
    el('h2', { text: 'การ์ดสรุปส่งลูกค้า' }),
    el('p', { class: 'muted', style: 'margin-top:-6px', text: 'บันทึกเป็นรูปแล้วส่งทาง Line ได้เลย' }),
    el('div', { style: 'display:flex;justify-content:center;margin:10px 0' }, [card]),
    el('div', { class: 'row', style: 'justify-content:center' }, [dlBtn]),
  ]));
  dlBtn.onclick = () => downloadCardPNG(card, `สรุป-${draft.customerName || 'ลูกค้า'}.png`);
}
