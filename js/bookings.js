// ═══════════════════════════════════════════════════════════════
// bookings.js — หน้ารายการจอง + ฟอร์มเพิ่ม/แก้ไข (หัวใจของระบบ)
// ═══════════════════════════════════════════════════════════════
import { listen, save, remove } from './db.js';
import { el, toast, openModal, confirmDialog, getSettings, currentUser, escapeHtml } from './ui.js';
import { computeBooking, computeAddOn, freeBathRights, formatBaht, formatDateTH, nightsBetween, todayISO, addDaysISO } from './calc.js';
import {
  PET_TYPES, DEPOSIT_STATUSES, RECORD_STATUSES, VIP_PROMO_PRICE,
  FIXED_ADDONS, GROOMING_SIZES, COAT_TYPES, groomingPrice,
  DAYCARE_SIZES, daycarePrice,
  FREE_BATH_MIN_NIGHTS, FREE_BATH_ADDON_NAME,
  PAYMENT_METHODS, DEFAULT_DEPOSIT_METHOD,
} from './config-shop.js';
import { buildCustomerCard, downloadCardPNG, copySummaryText, shareCard } from './summary-card.js';
import { openIntakeForm } from './intake-form.js';
import { vaccineStatus } from './customers.js';
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
    addBtn,
  ]));
  container.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'toolbar' }, [searchInput, statusFilter]),
    tableWrap,
  ]));

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
  const cols = ['ลูกค้า', 'เข้าพัก', 'ออก', 'ห้อง', 'ยอดรวม', 'มัดจำ', 'คงเหลือ', 'สถานะ'];
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

// โหลดรายชื่อลูกค้าถ้ายังไม่มี (กรณีเปิดฟอร์มจากหน้าอื่น เช่น ปฏิทิน
// โดยยังไม่เคยเข้าหน้าการจอง) — เพื่อให้ autocomplete + เตือนวัคซีนทำงาน
let _custSub = null;
function ensureCustomersLoaded() {
  if (!_custSub) _custSub = listen('customers', arr => { _customers = arr; });
}

export function openBookingForm(existing) {
  ensureCustomersLoaded();
  const s = getSettings();
  // "ใบใหม่" = ไม่มี id (รวมกรณีจองซ้ำที่ก็อปข้อมูลมาแต่ยังไม่บันทึก)
  const isNew = !existing?.id;
  const draft = existing ? structuredClone(existing) : {
    customerName: '', phone: '', depositDate: todayISO(),
    checkIn: '', checkOut: '', checkInTime: '09:00', checkOutTime: '14:00',
    lineItems: [blankLineItem(s)], addOns: [],
    billDiscountType: 'percent', billDiscountValue: 0,
    depositMethod: DEFAULT_DEPOSIT_METHOD,
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
    const stickyTotal = el('span', { class: 'ss-total' });   // แถบลอยล่าง: ยอดทั้งหมด
    const stickyDeposit = el('span', { class: 'ss-deposit' }); // แถบลอยล่าง: มัดจำ
    const refreshSummary = () => {
      const b = computeBooking(draft);
      const line = (k, v, cls = '') => el('div', { class: 'line ' + cls }, [el('span', { text: k }), el('span', { text: v })]);
      summaryBox.innerHTML = '';
      [
        b.totalDiscount ? line('ยอดเต็ม (ก่อนส่วนลด)', formatBaht(b.grossTotal)) : null,
        line('ยอดค่าห้อง (หลังส่วนลดรายห้อง)', formatBaht(b.itemsTotal)),
        b.addOnsTotal ? line('บริการเสริม', formatBaht(b.addOnsTotal)) : null,
        b.billDiscountAmount ? line(
          `ส่วนลดทั้งบิล${(b.billDiscountType || 'percent') === 'percent' ? ` ${Number(b.billDiscountValue) || 0}%` : ''}`,
          '− ' + formatBaht(b.billDiscountAmount)) : null,
        b.totalDiscount ? line('รวมส่วนลดทั้งหมด', '− ' + formatBaht(b.totalDiscount)) : null,
        line('ยอดทั้งหมด', formatBaht(b.grandTotal), 'grand'),
        line(`มัดจำ ${b.depositPct}%`, formatBaht(b.depositAmount)),
        line('จ่ายเพิ่มวัน Check-in', formatBaht(b.balanceDue)),
      ].filter(Boolean).forEach(n => summaryBox.appendChild(n));
      // อัปเดตแถบสรุปลอยล่าง
      stickyTotal.innerHTML = `ยอดทั้งหมด <b>${formatBaht(b.grandTotal)}</b>`;
      stickyDeposit.textContent = `มัดจำ ${formatBaht(b.depositAmount)}`;
      refreshPromo();
      refreshVaccine();
    };

    function syncNights() {
      const n = nightsBetween(draft.checkIn, draft.checkOut);
      if (n > 0) {
        draft.lineItems.forEach(li => li.nights = n);
        itemsWrap.querySelectorAll('input[data-nights]').forEach(inp => inp.value = n);
      }
    }

    // ── เตือนวัคซีนของสัตว์เลี้ยงลูกค้ารายนี้ (เทียบกับวันที่พักถึง) ──
    const vaccineBanner = el('div', { class: 'promo-banner warn hidden' });
    function refreshVaccine() {
      const norm = (t) => (t || '').replace(/\D/g, '');
      const c = _customers.find(c =>
        (draft.phone && c.phone && norm(c.phone) === norm(draft.phone)) ||
        (c.name && c.name === draft.customerName));
      vaccineBanner.innerHTML = '';
      const ref = draft.checkOut || todayISO();
      const bad = (c?.pets || [])
        .map(p => ({ p, st: vaccineStatus(p, ref) }))
        .filter(x => x.st === 'expired' || x.st === 'soon');
      if (!bad.length) { vaccineBanner.classList.add('hidden'); return; }
      vaccineBanner.classList.remove('hidden');
      const names = bad.map(x => x.p.name || 'สัตว์เลี้ยง').join(', ');
      vaccineBanner.appendChild(el('span', { class: 'promo-text', html:
        `${icons.alert} วัคซีนของ <strong>${escapeHtml(names)}</strong> ${bad.some(x => x.st === 'expired') ? 'หมดอายุก่อนวันเข้าพัก' : 'ใกล้หมดอายุ'} — แจ้งลูกค้าเตรียมสมุดวัคซีน/ฉีดกระตุ้น` }));
    }

    // ── หัวลูกค้า ──
    const nameField = field('ชื่อลูกค้า', draft.customerName, v => { draft.customerName = v; const c = _customers.find(c => c.name === v); if (c?.phone && !draft.phone) { draft.phone = c.phone; phoneField.querySelector('input').value = c.phone; } refreshVaccine(); }, { list: 'cust-names' });
    nameField.appendChild(el('datalist', { id: 'cust-names' }, _customers.map(c => el('option', { value: c.name }))));
    const phoneField = field('เบอร์โทร', draft.phone, v => { draft.phone = v; refreshVaccine(); });

    const depDateField = field('วันที่โอนมัดจำ', draft.depositDate, v => draft.depositDate = v, { type: 'date' });
    const inDateField = field('วันที่ Check-in', draft.checkIn, v => {
      draft.checkIn = v;
      // ฟังก์ชัน A: เลือกเช็คอินแล้วเด้งเช็คเอาท์เป็น +1 คืนอัตโนมัติ (ถ้ายังว่างหรือไม่หลังเช็คอิน)
      if (v && (!draft.checkOut || draft.checkOut <= v)) {
        draft.checkOut = addDaysISO(v, 1);
        const outInp = outDateField.querySelector('input');
        if (outInp) outInp.value = draft.checkOut;
      }
      syncNights(); refreshSummary();
    }, { type: 'date' });
    const outDateField = field('วันที่ Check-out', draft.checkOut, v => { draft.checkOut = v; syncNights(); refreshSummary(); }, { type: 'date' });
    const inTimeField = field('เวลาเข้า', draft.checkInTime, v => draft.checkInTime = v, { type: 'time' });
    const outTimeField = field('เวลาออก', draft.checkOutTime, v => draft.checkOutTime = v, { type: 'time' });
    const depPctField = field('มัดจำ (%)', draft.depositPct, v => { draft.depositPct = Number(v) || 0; refreshSummary(); }, { type: 'number', min: 0, max: 100 });
    const depMethodSel = selectEl(PAYMENT_METHODS.map(m => [m, m]), draft.depositMethod || DEFAULT_DEPOSIT_METHOD, v => draft.depositMethod = v);

    // ── รายการห้อง ──
    const itemsWrap = el('div', {});
    draft.lineItems.forEach((li, idx) => itemsWrap.appendChild(lineItemRow(li, idx)));
    const addItemBtn = el('button', { class: 'btn sm ghost', html: icons.plus + ' เพิ่มห้อง/สัตว์' });
    addItemBtn.onclick = () => { draft.lineItems.push(blankLineItem(s)); rerender(); };

    // ตัวเลือกราคา/คืน — ล็อกเฉพาะราคามาตรฐานจากหน้าตั้งค่า (+โปร VIP)
    // กันพนักงานพิมพ์ราคาผิด · ถ้าข้อมูลเก่ามีราคาอื่นอยู่แล้ว ให้คงเป็นตัวเลือกไว้
    function priceOptions(roomType, petType, current) {
      const opts = [];
      const std = priceFor(roomType, petType, s);
      if (std) opts.push([String(std), `มาตรฐาน ${std.toLocaleString('th-TH')}`]);
      const promo = s?.vipPromoPrice || VIP_PROMO_PRICE;
      if (roomType === 'vip' && promo && promo !== std) {
        opts.push([String(promo), `โปร VIP ${promo.toLocaleString('th-TH')}`]);
      }
      const cur = Number(current) || 0;
      if (cur && !opts.some(([v]) => Number(v) === cur)) {
        opts.push([String(cur), `ราคาเดิม ${cur.toLocaleString('th-TH')}`]);
      }
      return opts.length ? opts : [['0', '0']];
    }

    function lineItemRow(li, idx) {
      const petSel = selectEl(PET_TYPES.map(p => [p.id, p.label]), li.petType, v => { li.petType = v; li.pricePerNight = priceFor(li.roomType, v, s); rerender(); });
      const roomSel = selectEl(Object.entries(s?.roomPrices || {}).map(([k, r]) => [k, r.label]), li.roomType, v => { li.roomType = v; li.pricePerNight = priceFor(v, li.petType, s); rerender(); });
      const priceSel = selectEl(priceOptions(li.roomType, li.petType, li.pricePerNight), String(li.pricePerNight ?? ''), v => { li.pricePerNight = Number(v) || 0; refreshSummary(); });
      const roomsInp = numInput(li.rooms, v => { li.rooms = v; refreshSummary(); }, 'ห้อง', 1);
      const nightsInp = numInput(li.nights, v => { li.nights = v; refreshSummary(); }, 'คืน', 1);
      nightsInp.setAttribute('data-nights', '1');
      const discType = selectEl([['percent', 'ส่วนลด %'], ['amount', 'ส่วนลด บาท']], li.discountType, v => { li.discountType = v; refreshSummary(); });
      const discVal = numInput(li.discountValue, v => { li.discountValue = v; refreshSummary(); });

      const rmBtn = el('button', { class: 'btn sm danger', html: icons.x, 'aria-label': 'ลบรายการ' });
      rmBtn.onclick = () => { draft.lineItems.splice(idx, 1); if (!draft.lineItems.length) draft.lineItems.push(blankLineItem(s)); rerender(); };

      return el('div', { class: 'lineitem' }, [
        el('div', { class: 'li-head' }, [el('strong', { text: `รายการที่ ${idx + 1}` }), rmBtn]),
        el('div', { class: 'row' }, [labeled('สัตว์', petSel), labeled('ประเภทห้อง', roomSel), labeled('ราคา/คืน', priceSel)]),
        el('div', { class: 'row' }, [labeled('จำนวนห้อง', roomsInp), labeled('จำนวนคืน', nightsInp), labeled('ชนิดส่วนลด', discType), labeled('ส่วนลด', discVal)]),
      ]);
    }

    // ── โปรพัก 5 คืนขึ้นไป: อาบน้ำฟรี 1 สิทธิ์/ห้อง ──
    const promoBanner = el('div', { class: 'promo-banner hidden' });
    function refreshPromo() {
      const rights = freeBathRights(draft.lineItems, FREE_BATH_MIN_NIGHTS);
      const used = (draft.addOns || []).some(a => a.name === FREE_BATH_ADDON_NAME);
      promoBanner.innerHTML = '';
      if (!rights) { promoBanner.classList.add('hidden'); return; }
      promoBanner.classList.remove('hidden');
      promoBanner.appendChild(el('span', { class: 'promo-text', html: `${icons.star} พักครบ ${FREE_BATH_MIN_NIGHTS} คืน — ได้สิทธิ์<strong>อาบน้ำฟรี ${rights} สิทธิ์</strong> (1 สิทธิ์/ห้อง)` }));
      if (used) {
        promoBanner.appendChild(el('span', { class: 'pill green', text: 'ใช้สิทธิ์แล้ว' }));
      } else {
        const useBtn = el('button', { class: 'btn sm primary', text: 'ใช้สิทธิ์' });
        useBtn.onclick = () => {
          draft.addOns.push({ kind: 'custom', name: FREE_BATH_ADDON_NAME, qty: rights, unitPrice: 0 });
          rerender();
        };
        promoBanner.appendChild(useBtn);
      }
    }

    // ── บริการเสริม ──
    const addonsWrap = el('div', {});
    const addonOpts = (s?.addOnServices || []).filter(o => o.name);
    draft.addOns.forEach((a, idx) => addonsWrap.appendChild(addonRow(a, idx)));
    const addAddonBtn = el('button', { class: 'btn sm ghost', html: icons.plus + ' เพิ่มบริการเสริม' });
    addAddonBtn.onclick = () => {
      const a = {};
      applyAddonKind(a, 'bath');
      draft.addOns.push(a);
      rerender();
    };

    // ตั้งค่ารายการบริการตามชนิดที่เลือก (ล้างค่าเก่าที่ไม่เกี่ยวออก)
    function applyAddonKind(a, key) {
      const nights = nightsBetween(draft.checkIn, draft.checkOut) || Number(draft.lineItems[0]?.nights) || 1;
      delete a.price; delete a.pet; delete a.size; delete a.coat; delete a.unit;
      if (key === 'bath' || key === 'groom') {
        const pet = draft.lineItems[0]?.petType || 'dog';
        Object.assign(a, {
          kind: key, name: key === 'bath' ? 'อาบน้ำ' : 'อาบน้ำตัดขน',
          pet, size: 'm', coat: 'short', qty: 1, unit: 'ตัว',
          unitPrice: groomingPrice(pet, 'm', 'short', key === 'groom'),
        });
      } else if (key === 'daycare') {
        const pet = draft.lineItems[0]?.petType || 'dog';
        Object.assign(a, {
          kind: 'daycare', name: 'Day Care เหมาวัน',
          pet, size: 'm', qty: 1, unit: 'วัน',
          unitPrice: daycarePrice(pet, 'm'),
        });
      } else if (key.startsWith('fixed:')) {
        const f = FIXED_ADDONS.find(f => f.name === key.slice(6));
        Object.assign(a, {
          kind: 'fixed', name: f.name, unit: f.unit, unitPrice: f.unitPrice,
          qty: f.unit === 'คืน' ? nights : 1,
        });
      } else if (key.startsWith('svc:')) {
        const o = addonOpts.find(o => o.name === key.slice(4));
        Object.assign(a, { kind: 'svc', name: o?.name || '', unit: 'ครั้ง', unitPrice: o?.price || 0, qty: 1 });
      } else {
        Object.assign(a, { kind: 'custom', name: a.name || '', unit: 'ครั้ง', unitPrice: 0, qty: 1 });
      }
    }

    function addonKindKey(a) {
      if (a.kind === 'bath' || a.kind === 'groom' || a.kind === 'daycare') return a.kind;
      if (a.kind === 'fixed') return 'fixed:' + a.name;
      if (a.kind === 'svc') return 'svc:' + a.name;
      return 'custom';
    }

    function addonRow(a, idx) {
      // ข้อมูลเก่า (name+price ก้อนเดียว) → แสดงเป็นแบบกำหนดเอง
      if (!a.kind) { a.kind = 'custom'; a.qty = a.qty ?? 1; a.unitPrice = a.unitPrice ?? (Number(a.price) || 0); delete a.price; }

      const choices = [
        ['bath', 'อาบน้ำ (ราคาตามไซส์)'],
        ['groom', 'อาบน้ำตัดขน (ราคาตามไซส์)'],
        ['daycare', 'Day Care เหมาวัน (ราคาตามไซส์)'],
        ...FIXED_ADDONS.map(f => ['fixed:' + f.name, `${f.name} (${f.unitPrice}/${f.unit})`]),
        ...addonOpts.map(o => ['svc:' + o.name, o.name]),
        ['custom', 'กำหนดเอง'],
      ];
      const svcSel = selectEl(choices, addonKindKey(a), key => { applyAddonKind(a, key); rerender(); });

      const rm = el('button', { class: 'btn sm danger', html: icons.x, 'aria-label': 'ลบ' });
      rm.onclick = () => { draft.addOns.splice(idx, 1); rerender(); };

      const totalSpan = el('span', { class: 'addon-total', text: formatBaht(computeAddOn(a).total) });
      const refreshRow = () => { totalSpan.textContent = formatBaht(computeAddOn(a).total); refreshSummary(); };

      const controls = [];
      if (a.kind === 'bath' || a.kind === 'groom') {
        // เลือกสัตว์/ไซส์/ขน → ราคาอัตโนมัติจากตารางร้าน
        const recalc = () => { a.unitPrice = groomingPrice(a.pet, a.size, a.coat, a.kind === 'groom'); };
        const petSel = selectEl(PET_TYPES.map(p => [p.id, p.label]), a.pet, v => {
          a.pet = v;
          if (!GROOMING_SIZES[v].some(x => x.id === a.size)) a.size = 'm';
          if (!COAT_TYPES[v].some(x => x.id === a.coat)) a.coat = 'short';
          recalc(); rerender();
        });
        const sizeSel = selectEl(GROOMING_SIZES[a.pet].map(x => [x.id, x.label]), a.size, v => { a.size = v; recalc(); priceTag.textContent = `฿${a.unitPrice.toLocaleString('th-TH')}/ตัว`; refreshRow(); });
        const coatSel = selectEl(COAT_TYPES[a.pet].map(x => [x.id, x.label]), a.coat, v => { a.coat = v; recalc(); priceTag.textContent = `฿${a.unitPrice.toLocaleString('th-TH')}/ตัว`; refreshRow(); });
        const qtyInp = numInput(a.qty, v => { a.qty = v; refreshRow(); }, '', 1);
        const priceTag = el('span', { class: 'addon-unit-price', text: `฿${(a.unitPrice || 0).toLocaleString('th-TH')}/ตัว` });
        controls.push(labeled('สัตว์', petSel), labeled('ไซส์', sizeSel), labeled('ขน', coatSel), labeled('จำนวน (ตัว)', qtyInp), el('div', { class: 'field', style: 'margin:0' }, [el('label', { text: 'ราคา' }), priceTag]));
      } else if (a.kind === 'daycare') {
        // Day Care: ไซส์คนละชุดกับ grooming (S-XL) ราคาเหมาวันจากตารางร้าน
        const recalc = () => { a.unitPrice = daycarePrice(a.pet, a.size); };
        const petSel = selectEl(PET_TYPES.map(p => [p.id, p.label]), a.pet, v => {
          a.pet = v;
          if (!DAYCARE_SIZES[v].some(x => x.id === a.size)) a.size = 'm';
          recalc(); rerender();
        });
        const sizeSel = selectEl(DAYCARE_SIZES[a.pet].map(x => [x.id, x.label]), a.size, v => { a.size = v; recalc(); priceTag.textContent = `฿${a.unitPrice.toLocaleString('th-TH')}/วัน`; refreshRow(); });
        const qtyInp = numInput(a.qty, v => { a.qty = v; refreshRow(); }, '', 1);
        const priceTag = el('span', { class: 'addon-unit-price', text: `฿${(a.unitPrice || 0).toLocaleString('th-TH')}/วัน` });
        controls.push(labeled('สัตว์', petSel), labeled('ไซส์', sizeSel), labeled('จำนวน (วัน)', qtyInp), el('div', { class: 'field', style: 'margin:0' }, [el('label', { text: 'ราคา' }), priceTag]));
      } else if (a.kind === 'fixed') {
        const qtyInp = numInput(a.qty, v => { a.qty = v; refreshRow(); }, '', 1);
        const priceTag = el('span', { class: 'addon-unit-price', text: `฿${(a.unitPrice || 0).toLocaleString('th-TH')}/${a.unit}` });
        controls.push(labeled(`จำนวน (${a.unit})`, qtyInp), el('div', { class: 'field', style: 'margin:0' }, [el('label', { text: 'ราคา' }), priceTag]));
      } else {
        // svc / custom: แก้ชื่อ (custom) + ราคา/หน่วย + จำนวน
        if (a.kind === 'custom') {
          const nameInp = el('input', { value: a.name || '', placeholder: 'ชื่อบริการ' });
          nameInp.oninput = () => { a.name = nameInp.value; };
          controls.push(el('div', { class: 'field', style: 'margin:0;flex:1.6' }, [el('label', { text: 'ชื่อบริการ' }), nameInp]));
        }
        const priceInp = numInput(a.unitPrice, v => { a.unitPrice = v; refreshRow(); }, 'ราคา');
        const qtyInp = numInput(a.qty, v => { a.qty = v; refreshRow(); }, '', 1);
        controls.push(labeled('ราคา/หน่วย', priceInp), labeled('จำนวน', qtyInp));
      }

      return el('div', { class: 'lineitem addon-item' }, [
        el('div', { class: 'li-head' }, [svcSel, el('div', { class: 'row', style: 'gap:8px;align-items:center' }, [totalSpan, rm])]),
        el('div', { class: 'row', style: 'align-items:flex-end' }, controls),
      ]);
    }

    // ── ส่วนลดทั้งบิล ──
    const billDiscType = selectEl(
      [['percent', '% ของทั้งบิล'], ['amount', 'บาท']],
      draft.billDiscountType || 'percent',
      v => { draft.billDiscountType = v; refreshSummary(); });
    const billDiscVal = numInput(draft.billDiscountValue, v => { draft.billDiscountValue = v; refreshSummary(); }, 'เช่น 5');

    // ── สถานะ + หมายเหตุ ──
    const depStatus = labeled('สถานะมัดจำ', selectEl(DEPOSIT_STATUSES.map(x => [x, x]), draft.depositStatus, v => draft.depositStatus = v));
    const recStatus = labeled('สถานะบันทึก', selectEl(RECORD_STATUSES.map(x => [x, x]), draft.recordStatus, v => draft.recordStatus = v));
    const notesInp = el('textarea', { placeholder: 'พันธุ์ / น้ำหนัก / อาการสุขภาพ / เงื่อนไขพิเศษ' });
    notesInp.value = draft.notes || '';
    notesInp.oninput = () => draft.notes = notesInp.value;

    // ── ปุ่ม ──
    const saveBtn = el('button', { class: 'btn primary', html: icons.save + ' บันทึก' });
    saveBtn.onclick = () => doSave(draft, isNew, m);
    const cardBtn = el('button', { class: 'btn ghost', html: icons.image + ' ดูการ์ด' });
    cardBtn.onclick = () => openCardPreview(draft);
    // ฟังก์ชัน C: จองซ้ำ — ก็อปการจองเดิม เปิดใบใหม่ให้แก้เฉพาะวัน
    const dupBtn = existing?.id ? el('button', { class: 'btn ghost', html: icons.copy + ' จองซ้ำ' }) : null;
    if (dupBtn) dupBtn.onclick = () => {
      const clone = structuredClone(draft);
      delete clone.id;
      delete clone.checkedInAt; delete clone.checkedOutAt; delete clone.stayStatus;
      clone.checkIn = ''; clone.checkOut = '';
      clone.depositDate = todayISO();
      clone.depositStatus = 'มัดจำแล้ว'; clone.recordStatus = 'ยังไม่ลงระบบ';
      m.close();
      openBookingForm(clone);
      toast('ก็อปการจองแล้ว — กรอกวันเข้าพักใหม่');
    };
    const delBtn = existing?.id ? el('button', { class: 'btn danger', html: icons.trash + ' ลบ' }) : null;
    if (delBtn) delBtn.onclick = async () => {
      if (await confirmDialog('ลบการจองนี้?', { danger: true, okText: 'ลบ' })) { await remove('bookings', existing.id); m.close(); toast('ลบแล้ว'); }
    };

    // ฟังก์ชัน B: แถบสรุปยอด+มัดจำ ลอยติดล่าง (มีปุ่มบันทึกในตัว)
    const stickyBar = el('div', { class: 'sticky-summary' }, [
      el('div', { class: 'ss-figures' }, [stickyTotal, stickyDeposit]),
      saveBtn,
    ]);

    form.append(
      el('h2', { text: isNew ? 'เพิ่มการจอง' : 'แก้ไขการจอง' }),
      formGroup(icons.users, 'ข้อมูลลูกค้า', 'blue',
        el('div', { class: 'row' }, [nameField, phoneField]), vaccineBanner),
      formGroup(icons.calendar, 'ช่วงเข้าพัก', 'green',
        el('div', { class: 'row' }, [inDateField, outDateField]),
        el('div', { class: 'row' }, [inTimeField, outTimeField])),
      formGroup(icons.home, 'ห้องพัก', 'orange',
        itemsWrap, addItemBtn, promoBanner),
      formGroup(icons.star, 'บริการเสริม', 'purple',
        addonsWrap, addAddonBtn),
      formGroup(icons.banknote, 'การชำระเงิน / มัดจำ', 'gold',
        el('div', { class: 'row' }, [depDateField, depPctField]),
        el('div', { class: 'row' }, [labeled('ช่องทางโอนมัดจำ', depMethodSel)]),
        el('div', { class: 'row' }, [
          labeled('ส่วนลดทั้งบิล — ชนิด', billDiscType),
          labeled('ส่วนลดทั้งบิล — จำนวน', billDiscVal),
        ]),
        el('div', { class: 'row' }, [depStatus])),
      formGroup(icons.bookings, 'หมายเหตุ & สรุปยอด', 'grey',
        el('div', { class: 'row' }, [recStatus]),
        el('div', { class: 'field' }, [el('label', { text: 'รายละเอียด/หมายเหตุ' }), notesInp]),
        summaryBox),
      el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px;flex-wrap:wrap' }, [delBtn, dupBtn, cardBtn].filter(Boolean)),
      stickyBar,
    );
    refreshSummary();
  }
}

// ────────── helpers ──────────
// การ์ดกลุ่มในฟอร์ม — หัวสี+ไอคอน แยกประเภทชัดเจน (color = blue|green|orange|purple|gold|grey)
function formGroup(icon, title, color, ...children) {
  return el('div', { class: `form-group form-group--${color}` }, [
    el('div', { class: 'form-group-head' }, [
      el('span', { class: 'fg-ico', html: icon }),
      el('span', { text: title }),
    ]),
    el('div', { class: 'form-group-body' }, children),
  ]);
}

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
  // ฟังก์ชัน D: บันทึกแล้วเปิดการ์ดส่งลูกค้าทันที (ส่ง Line ต่อได้เลย)
  openCardPreview(rec);
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
  const shareBtn = el('button', { class: 'btn primary', html: icons.share + ' แชร์เข้า Line' });
  const dlBtn = el('button', { class: 'btn', html: icons.download + ' ดาวน์โหลด PNG' });
  const copyBtn = el('button', { class: 'btn', html: icons.copy + ' คัดลอกข้อความ' });
  const intakeBtn = el('button', { class: 'btn ghost', html: icons.print + ' พิมพ์ใบรับฝาก' });
  openModal(el('div', {}, [
    el('h2', { text: 'การ์ดสรุปส่งลูกค้า' }),
    el('p', { class: 'muted', style: 'margin-top:-6px', text: 'กดแชร์ส่งเข้า Line ได้เลย หรือดาวน์โหลด/คัดลอกเป็นข้อความ' }),
    el('div', { style: 'display:flex;justify-content:center;margin:10px 0' }, [card]),
    el('div', { class: 'row', style: 'justify-content:center;gap:8px' }, [copyBtn, dlBtn, shareBtn]),
    el('div', { class: 'row', style: 'justify-content:center;margin-top:4px' }, [intakeBtn]),
  ]));
  shareBtn.onclick = () => shareCard(card, draft);
  dlBtn.onclick = () => downloadCardPNG(card, `สรุป-${draft.customerName || 'ลูกค้า'}.png`);
  copyBtn.onclick = () => copySummaryText(draft);
  intakeBtn.onclick = () => openIntakeForm(draft, _customers); // ส่งลูกค้าไปด้วยเพื่อดึงข้อมูลสัตว์มาลงใบ
}
