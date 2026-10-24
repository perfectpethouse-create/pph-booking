// ═══════════════════════════════════════════════════════════════
// bookings.js — หน้ารายการจอง + ฟอร์มเพิ่ม/แก้ไข (หัวใจของระบบ)
// ═══════════════════════════════════════════════════════════════
import { listen, save, remove } from './db.js';
import { el, toast, openModal, confirmDialog, getSettings, currentUser, escapeHtml, isStaff, bfGroup, chipGroup } from './ui.js';
import { computeBooking, computeAddOn, computeLineItem, formatBaht, nightsBetween, todayISO, addDaysISO, owedOf } from './calc.js';
import {
  PET_TYPES, DEPOSIT_STATUSES, RECORD_STATUSES, VIP_PROMO_PRICE, VIP_CAT_PROMO_PRICE,
  FIXED_ADDONS, GROOMING_SIZES, COAT_TYPES, groomingPrice,
  DAYCARE_SIZES, daycarePrice,
  longStayPct, VIP_HIGH_SEASON,
  PAYMENT_METHODS, DEFAULT_DEPOSIT_METHOD,
} from './config-shop.js';
import { buildCustomerCard, downloadCardPNG, copySummaryText, copyText, shareCard } from './summary-card.js';
import { openIntakeForm } from './intake-form.js';
import { vaccineStatus } from './customers.js';
import { icons } from './icons.js';
import { rangeOf, roomsOf, isCat, dateWithYear, shortDate } from './mobile-kit.js';

let _bookings = [];
let _customers = [];
let _unsub = [];

export function renderBookings(container) {
  _unsub.forEach(u => u()); _unsub = [];

  const searchInput = el('input', { type: 'search', placeholder: 'ค้นหาชื่อ / เบอร์', 'aria-label': 'ค้นหาการจอง' });
  // "ไม่ได้ระบุวันที่โอน" = เกณฑ์เดียวกับชิปบนมือถือ (ไล่เติมวันที่ก่อนปิดยอด)
  const statusFilter = el('select', { 'aria-label': 'กรองสถานะมัดจำ' }, [
    el('option', { value: '', text: 'สถานะมัดจำ: ทั้งหมด' }),
    ...DEPOSIT_STATUSES.map(s => el('option', { value: s, text: s })),
    el('option', { value: 'nodate', text: 'ไม่ได้ระบุวันที่โอน' }),
  ]);
  const subtitle = el('div', { class: 'd-date' });
  const addBtn = el('button', { class: 'btn primary', html: icons.plus + ' เพิ่มการจอง' });
  addBtn.onclick = () => openBookingForm(null);

  const tableWrap = el('div', { class: 'table-wrap' });

  // มือถือ = ลิสต์การ์ดแบบแอป (.mbook) · คอม = ตารางเต็ม (.book-full) — สลับด้วย CSS
  const mobile = buildMobileList();
  container.appendChild(mobile.node);
  container.appendChild(el('div', { class: 'book-full' }, [
    el('div', { class: 'd-top' }, [el('h1', { text: 'การจองทั้งหมด' }), subtitle]),
    el('div', { class: 'd-card' }, [
      el('div', { class: 'd-filters' }, [
        el('label', { class: 'd-search' }, [el('span', { html: icons.search }), searchInput]),
        statusFilter, el('span', { class: 'd-sp' }), addBtn,
      ]),
      buildStatusLegend(),
      tableWrap,
    ]),
  ]));

  const draw = () => {
    const q = searchInput.value.trim().toLowerCase();
    const sf = statusFilter.value;
    const rows = _bookings.filter(b => {
      const hay = `${b.customerName || ''} ${b.phone || ''}`.toLowerCase();
      const st = sf === 'nodate' ? MOBILE_FILTERS.find(f => f.id === 'nodate').test(b) : (!sf || b.depositStatus === sf);
      return (!q || hay.includes(q)) && st;
    });
    subtitle.textContent = (q || sf ? `พบ ${rows.length} จาก ${_bookings.length} รายการ` : `ทั้งหมด ${_bookings.length} รายการ`)
      + ' · เรียงตามวันที่โอนล่าสุด';
    tableWrap.innerHTML = '';
    tableWrap.appendChild(buildTable(rows));
    mobile.draw();
  };
  searchInput.oninput = draw;
  statusFilter.onchange = draw;

  _unsub.push(listen('bookings', arr => { _bookings = sortByBookingDate(arr); draw(); }));
  _unsub.push(listen('customers', arr => { _customers = arr; }));
}

// ═══════════ มือถือ: ค้นหา + ชิปกรอง + การ์ดใบจอง ═══════════
// ชิปเป็นคำถามที่หน้าเคาน์เตอร์ถามบ่อย ไม่ใช่สถานะดิบ ("ใครพักอยู่" / "ใครเข้าวันนี้" / "ใครยังไม่โอน")
const MOBILE_FILTERS = [
  { id: 'all', label: 'ทั้งหมด', test: () => true },
  { id: 'staying', label: 'กำลังพัก', test: (b, t) => b.depositStatus !== 'ยกเลิก' && b.checkIn <= t && t < b.checkOut },
  { id: 'in', label: 'เข้าวันนี้', test: (b, t) => b.depositStatus !== 'ยกเลิก' && b.checkIn === t },
  { id: 'out', label: 'ออกวันนี้', test: (b, t) => b.depositStatus !== 'ยกเลิก' && b.checkOut === t },
  { id: 'nodep', label: 'ยังไม่มัดจำ', test: (b) => b.depositStatus === 'ยังไม่มัดจำ' },
  // รับเงินแล้วแต่ไม่มีวันที่โอน — ไว้ไล่เติมย้อนหลังก่อนปิดยอด (เกณฑ์เดียวกับแถวเตือนสีส้มบนการ์ด)
  { id: 'nodate', label: 'ไม่ได้ระบุวันที่โอน', test: (b) => (b.depositStatus === 'มัดจำแล้ว' || b.depositStatus === 'จ่ายครบแล้ว') && !b.depositDate },
  { id: 'cancel', label: 'ยกเลิก', test: (b) => b.depositStatus === 'ยกเลิก' },
];
const MOBILE_PAGE = 40; // วาดทีละ 40 ใบ — ร้านมีใบจองสะสมหลายร้อยใบ วาดหมดทีเดียวมือถือจะหน่วง

function buildMobileList() {
  let filter = 'all', query = '', limit = MOBILE_PAGE;
  const node = el('div', { class: 'mbook' });
  const search = el('input', { type: 'search', placeholder: 'ค้นหาชื่อ หรือเบอร์โทร', 'aria-label': 'ค้นหาการจอง' });
  search.oninput = () => { query = search.value.trim().toLowerCase(); limit = MOBILE_PAGE; draw(); };
  const chips = el('div', { class: 'm-chips', role: 'tablist' });
  const listEl = el('div', {});
  node.append(
    el('div', { class: 'm-ptitle' }, [el('h1', { text: 'การจอง' })]),
    el('label', { class: 'm-search' }, [el('span', { html: icons.search }), search]),
    chips, listEl,
  );

  function draw() {
    const t = todayISO();
    const hit = (b) => !query || `${b.customerName || ''} ${b.phone || ''}`.toLowerCase().includes(query);
    const base = _bookings.filter(hit);

    chips.innerHTML = '';
    MOBILE_FILTERS.forEach(f => {
      const n = base.filter(b => f.test(b, t)).length;
      const c = el('button', { class: 'm-chipf' + (f.id === filter ? ' on' : ''), role: 'tab', 'aria-selected': String(f.id === filter) },
        [f.label, el('span', { text: String(n) })]);
      c.onclick = () => { filter = f.id; limit = MOBILE_PAGE; draw(); };
      chips.appendChild(c);
    });
    // วาดชิปใหม่ทำให้แถบเลื่อนกลับไปต้นแถว — เลื่อนให้ชิปที่เลือกยังอยู่ในจอ (ชิปท้ายแถวจะได้ไม่หลุดหาย)
    const on = chips.querySelector('.on');
    if (on) chips.scrollLeft = Math.max(0, on.offsetLeft - chips.clientWidth / 2 + on.offsetWidth / 2);

    const f = MOBILE_FILTERS.find(x => x.id === filter);
    const rows = base.filter(b => f.test(b, t));
    listEl.innerHTML = '';
    if (!rows.length) {
      listEl.appendChild(el('div', { class: 'm-empty', text: query ? 'ไม่พบการจองที่ค้นหา' : 'ไม่มีการจองในกลุ่มนี้' }));
      return;
    }
    rows.slice(0, limit).forEach(raw => listEl.appendChild(mobileCard(raw)));
    if (rows.length > limit) {
      const more = el('button', { class: 'm-more', text: `แสดงเพิ่ม (เหลืออีก ${rows.length - limit} ใบ)` });
      more.onclick = () => { limit += MOBILE_PAGE; draw(); };
      listEl.appendChild(more);
    }
  }

  return { node, draw };
}

function mobileCard(raw) {
  const b = computeBooking(raw);
  const nights = nightsBetween(b.checkIn, b.checkOut);
  const owe = owedOf(b);
  const card = el('div', { class: 'm-bk' + (b.depositStatus === 'ยกเลิก' ? ' cancel' : ''), role: 'button', tabindex: '0' }, [
    el('div', { class: 'm-bk-top' }, [
      el('span', { class: 'm-pet' + (isCat(b) ? ' cat' : ''), html: isCat(b) ? icons.cat : icons.dog }),
      el('div', { class: 'm-tx' }, [el('b', { text: b.customerName || '-' }), el('small', { text: b.phone || '' })]),
      statusPill(b.depositStatus),
    ]),
    el('div', { class: 'm-bk-meta' }, [
      el('div', {}, [el('span', { text: 'ห้อง' }), el('b', { text: roomsOf(b) })]),
      el('div', {}, [el('span', { text: 'วันที่' }), el('b', { text: rangeOf(b) })]),
      el('div', {}, owe
        ? [el('span', { text: 'คงเหลือ' }), el('b', { class: 'owe', text: formatBaht(owe) })]
        : [el('span', { text: 'จำนวน' }), el('b', { text: nights ? `${nights} คืน` : '-' })]),
    ]),
    depositRow(b),
  ]);
  card.onclick = () => openBookingForm(raw);
  card.onkeydown = (e) => { if (e.key === 'Enter') openBookingForm(raw); };
  return card;
}

// แถววันที่โอนมัดจำ — ไว้กระทบยอดกับสลิป/บัญชีธนาคาร
// ⚠️ ฟอร์มใบใหม่ใส่ depositDate = วันนี้ไว้ล่วงหน้า แม้ลูกค้ายังไม่โอน
//    จึงห้ามโชว์วันที่ตอนสถานะ "ยังไม่มัดจำ" (จะดูเหมือนเงินเข้าแล้ว)
function depositRow(b) {
  if (b.depositStatus === 'ยังไม่มัดจำ') {
    return el('div', { class: 'm-dep wait' }, [el('span', { text: 'มัดจำ' }), el('b', { text: 'ยังไม่ได้รับมัดจำ' })]);
  }
  const when = b.depositDate ? dateWithYear(b.depositDate) : null;
  return el('div', { class: 'm-dep' + (when ? '' : ' miss') }, [
    el('span', { text: 'โอนมัดจำ' }),
    el('b', { text: when ? [when, b.depositMethod].filter(Boolean).join(' · ') : 'ไม่ได้ระบุวันที่โอน' }),
    el('em', { text: formatBaht(b.depositAmount) }),
  ]);
}

// เรียงตาม "วันที่จอง/โอนมัดจำ" ล่าสุดก่อน — เห็นทันทีว่าจองเข้ามาล่าสุดวันไหน
// เท่ากันให้ทับด้วย createdAt (ใบที่บันทึกทีหลังอยู่บน) · ไม่มี depositDate ค่อย fallback createdAt/checkIn
function sortByBookingDate(arr) {
  const key = b => b.depositDate || (b.createdAt || '').slice(0, 10) || b.checkIn || '';
  return [...arr].sort((a, b) => {
    const d = key(b).localeCompare(key(a));
    if (d) return d;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

// สีสถานะสื่อความหมาย: เขียว=จบครบ · ส้ม=มัดจำแล้วรอครึ่งหลัง · แดง=รอโอนมัดจำ (ต้องตาม) · เทา=ยกเลิก
function statusPill(s) {
  const map = { 'จ่ายครบแล้ว': 'green', 'มัดจำแล้ว': 'yellow', 'ยังไม่มัดจำ': 'red', 'ยกเลิก': 'grey' };
  return el('span', { class: 'pill ' + (map[s] || 'grey'), text: s || '-' });
}

// คำอธิบายว่าแต่ละสี/สถานะหมายถึงอะไร — วางใต้แถบค้นหา ให้ดูปราดเดียวรู้
function buildStatusLegend() {
  const items = [
    ['จ่ายครบแล้ว', 'green', 'รับเงินครบแล้ว'],
    ['มัดจำแล้ว', 'yellow', 'รับมัดจำ 50% · ค้างครึ่งหลัง'],
    ['ยังไม่มัดจำ', 'red', 'รอลูกค้าโอนมัดจำ'],
    ['ยกเลิก', 'grey', 'ยกเลิกการจอง'],
  ];
  return el('div', { class: 'd-legend' },
    items.map(([label, color, hint]) => el('span', {}, [
      statusPill(label),
      el('small', { text: hint }),
    ])));
}

function buildTable(rows) {
  if (!rows.length) {
    return el('p', { class: 'd-empty', style: 'padding:24px 18px;text-align:center', text: _bookings.length ? 'ไม่พบการจองที่ค้นหา' : 'ยังไม่มีการจอง — กด "เพิ่มการจอง" เพื่อเริ่ม' });
  }
  // พนักงานเห็นยอดเงินได้ (ต้องแจ้งลูกค้า/เก็บยอดคงเหลือหน้าเคาน์เตอร์)
  // "วันที่โอน" อยู่ในกลุ่มการเงิน (ติดกับมัดจำ) ไม่วางชิดวันเข้าพัก/ออก — กันอ่านสลับกัน
  const cols = ['ลูกค้า', 'เข้าพัก', 'ออก', 'ห้อง', 'ยอดรวม', 'วันที่โอน', 'มัดจำ', 'คงเหลือ', 'สถานะ'];
  const numCols = [4, 6, 7];
  const head = el('tr', {}, cols.map((h, i) => el('th', { class: numCols.includes(i) ? 'num' : '', text: h })));
  const body = rows.map(raw => {
    const b = computeBooking(raw);
    const s = getSettings();
    // ไม่มีห้อง = จองบริการรายวัน (เช่น Day Care) → โชว์ชื่อบริการแทน ไม่ให้ช่อง "ห้อง" ว่างเปล่า
    const roomsDesc = b.lineItems.length
      ? b.lineItems.map(li => `${li.rooms || 1}×${(s?.roomPrices?.[li.roomType]?.label || li.roomType)}`).join(', ')
      : ((b.addOns || []).map(a => a.name).filter(Boolean).join(', ') || 'บริการรายวัน');
    // วันที่โอน: ยังไม่มัดจำ/ยกเลิก = ขีด (ฟอร์มใส่วันนี้ไว้ล่วงหน้า โชว์ไปจะดูเหมือนเงินเข้าแล้ว)
    // รับเงินแล้วแต่ไม่มีวันที่ = ป้ายส้ม "ไม่ระบุ" ให้ไล่เติม (ตรงกับการ์ดบนมือถือ)
    const paidIn = b.depositStatus === 'มัดจำแล้ว' || b.depositStatus === 'จ่ายครบแล้ว';
    const dateCell = !paidIn ? el('td', { class: 'muted', text: '—' })
      : b.depositDate ? el('td', { text: dayLabel(b.depositDate) })
      : el('td', {}, [el('span', { class: 'pill yellow', text: 'ไม่ระบุ' })]);
    const left = owedOf(b); // คงเหลือ = ยอดที่ยังต้องเก็บจริง (สูตรเดียวกับแดชบอร์ด)
    const moneyCells = [
      el('td', { class: 'num', text: formatBaht(b.grandTotal) }),
      dateCell,
      el('td', { class: 'num', text: paidIn ? formatBaht(b.depositAmount) : '—' }),
      el('td', { class: 'num' + (left > 0 ? ' d-owe' : ''), text: formatBaht(left) }),
    ];
    const tr = el('tr', { style: 'cursor:pointer', class: b.depositStatus === 'ยกเลิก' ? 'd-cancel' : '' }, [
      el('td', {}, [el('strong', { text: b.customerName || '-' }), el('div', { class: 'd-sub', text: b.phone || '' })]),
      el('td', { text: dayLabel(b.checkIn) }),
      el('td', { text: dayLabel(b.checkOut) }),
      el('td', { style: 'max-width:200px;white-space:normal', text: roomsDesc }),
      ...moneyCells,
      el('td', {}, [statusPill(b.depositStatus)]),
    ]);
    tr.onclick = () => openBookingForm(raw);
    return tr;
  });
  return el('table', { class: 'd-bktable' }, [el('thead', {}, [head]), el('tbody', {}, body)]);
}

// "24 ต.ค." ถ้าเป็นปีนี้ · "24 ต.ค. 68" ถ้าข้ามปี (ใบจองสะสมหลายปี กันอ่านปีผิด)
function dayLabel(iso) {
  if (!iso) return '-';
  return iso.slice(0, 4) === todayISO().slice(0, 4) ? shortDate(iso) : dateWithYear(iso);
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
let _allBookings = [];   // ไว้หา "ครั้งก่อนพักห้องอะไร" ของลูกค้าเก่า (โหลดครั้งเดียว ฟังต่อเนื่อง)
let _bkSub = null;
function ensureCustomersLoaded() {
  if (!_custSub) _custSub = listen('customers', arr => { _customers = arr; });
  if (!_bkSub) _bkSub = listen('bookings', arr => { _allBookings = arr; });
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

  // พนักงานเห็นราคาได้ เพราะต้องแจ้งลูกค้าที่ยืนรออยู่หน้าเคาน์เตอร์
  // (สิ่งที่ยังกันไว้คือ แก้/ลบใบเดิม และเมนูรายงานรายได้ ซึ่งคุมด้วย staffPerms)
  const form = el('div', { class: 'bk-form' });
  const m = openModal(form);
  // มือถือ: ฟอร์มนี้ยาวมาก → เปิดเต็มจอแบบหน้าแอป (ดู .modal--full ใน styles.css) · คอมยังเป็นกล่องกลางจอเหมือนเดิม
  m.el.classList.add('modal--full');
  // สถานะหน้าจอที่ต้องอยู่รอดข้าม rerender (ไม่บันทึกลงฐานข้อมูล)
  const openDisc = new Set();   // รายการห้องที่เปิดช่องส่วนลดไว้ (index)
  let saveNow = () => {};
  // กำลังบันทึกอยู่ → กดซ้ำไม่ทำอะไร (ใบใหม่ยังไม่มี id ถ้ายิง save สองครั้งจะได้ใบจองซ้ำ 2 ใบ)
  let saving = false;
  // ⌘/Ctrl + Enter = บันทึก (ผูกครั้งเดียวที่ตัวฟอร์ม ซึ่งไม่ถูกสร้างใหม่ตอน rerender)
  // e.repeat = กดปุ่มค้างแล้วคีย์บอร์ดยิงซ้ำเอง → ไม่นับ
  form.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (!e.repeat) saveNow(); }
  });
  build();

  function rerender() { form.innerHTML = ''; build(); }

  function build() {
    // กล่องสรุป (ประกาศก่อน เพื่อให้ handler ทุกตัวเรียก refreshSummary ได้)
    const summaryBox = el('div', { class: 'summary-box owner-only' });
    const stickyTotal = el('span', { class: 'ss-total owner-only' });   // แถบลอยล่าง: ยอดทั้งหมด
    const stickyDeposit = el('span', { class: 'ss-deposit owner-only' }); // แถบลอยล่าง: มัดจำ
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
        // ตัวเลขที่ต้องบอกลูกค้า = มัดจำ — ทำเป็นกล่องเด่น ไม่ซ้ำกับแถบล่างบนคอม (ดู .bf-pay)
        el('div', { class: 'bf-pay' }, [
          el('span', { class: 'bf-pay-k', text: `มัดจำ ${b.depositPct}%` }),
          el('b', { text: formatBaht(b.depositAmount) }),
          el('span', { class: 'bf-pay-k', text: `จ่ายเพิ่มวัน Check-in ${formatBaht(b.balanceDue)}` }),
        ]),
      ].filter(Boolean).forEach(n => summaryBox.appendChild(n));
      // อัปเดตแถบสรุปลอยล่าง
      stickyTotal.innerHTML = `ยอดทั้งหมด <b>${formatBaht(b.grandTotal)}</b>`;
      stickyDeposit.textContent = `มัดจำ ${formatBaht(b.depositAmount)}`;
      refreshPromo();
      refreshVaccine();
    };

    // ป้าย "N คืน" ระหว่างวันเข้า-ออก — เห็นทันทีว่านับคืนถูกไหมก่อนดูยอดเงิน
    const nightsBadge = el('span', { class: 'nights-badge' });
    const quickChips = [];   // ชิปลัด "วันนี้/พรุ่งนี้/N คืน" — ไฮไลต์ตัวที่ตรงกับวันที่ตอนนี้
    const refreshNightsBadge = () => {
      const n = nightsBetween(draft.checkIn, draft.checkOut);
      nightsBadge.textContent = n > 0 ? `${n} คืน` : 'เลือกวันที่';
      nightsBadge.classList.toggle('empty', !(n > 0));
      quickChips.forEach(c => c.classList.toggle('on', c.isOn()));
    };

    function syncNights() {
      refreshNightsBadge();
      const n = nightsBetween(draft.checkIn, draft.checkOut);
      if (n > 0) {
        draft.lineItems.forEach(li => li.nights = n);
        itemsWrap.querySelectorAll('[data-nights]').forEach(out => out.value = n);
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

    // ── หัวลูกค้า ── พิมพ์ชื่อหรือเบอร์ก็เจอ (datalist ทั้งสองช่อง) ถ้าตรงลูกค้าเก่า → การ์ดให้แตะเติมข้อมูลเดิม
    const digits = (t) => (t || '').replace(/\D/g, '');
    const nameField = field('ชื่อลูกค้า', draft.customerName, v => { draft.customerName = v; const c = _customers.find(c => c.name === v); if (c?.phone && !draft.phone) { draft.phone = c.phone; phoneField.querySelector('input').value = c.phone; } refreshVaccine(); refreshCust(); }, { list: 'cust-names', autocomplete: 'off' });
    nameField.appendChild(el('datalist', { id: 'cust-names' }, _customers.map(c => el('option', { value: c.name }))));
    const phoneField = field('เบอร์โทร', draft.phone, v => {
      draft.phone = v;
      const c = digits(v).length >= 9 && _customers.find(c => digits(c.phone) === digits(v));
      if (c?.name && !draft.customerName) { draft.customerName = c.name; nameField.querySelector('input').value = c.name; }
      refreshVaccine(); refreshCust();
    }, { list: 'cust-phones', type: 'tel', inputmode: 'tel', autocomplete: 'off' });
    phoneField.appendChild(el('datalist', { id: 'cust-phones' }, _customers.filter(c => c.phone).map(c => el('option', { value: c.phone, label: c.name || '' }))));

    const custCard = el('div', { class: 'bf-cust hidden' });
    function refreshCust() {
      const c = _customers.find(c =>
        (draft.phone && c.phone && digits(c.phone) === digits(draft.phone)) ||
        (draft.customerName && c.name === draft.customerName));
      custCard.innerHTML = '';
      custCard.classList.toggle('hidden', !c);
      if (!c) return;
      const last = _allBookings
        .filter(b => b.id !== draft.id && ((c.phone && digits(b.phone) === digits(c.phone)) || b.customerName === c.name))
        .sort((a, b) => (b.checkIn || '').localeCompare(a.checkIn || ''))[0];
      const lastLi = last?.lineItems?.[0];
      const lastRoom = lastLi && s?.roomPrices?.[lastLi.roomType]?.label;
      const pets = (c.pets || []).map(p => `${p.name || 'ไม่ระบุชื่อ'} (${p.species === 'cat' ? 'แมว' : 'สุนัข'})`).join(', ');
      const pet0 = c.pets?.[0]?.species || lastLi?.petType;
      const li0 = draft.lineItems[0];
      // ใช้ข้อมูลเดิมแล้ว = ชื่อ/เบอร์ตรง และ (ถ้ามีห้อง) ชนิดสัตว์/ห้องตรงกับครั้งก่อน
      const applied = c.name === draft.customerName && (!c.phone || digits(c.phone) === digits(draft.phone)) &&
        (!li0 || ((!pet0 || li0.petType === pet0) && (!lastLi || li0.roomType === lastLi.roomType)));
      custCard.append(
        el('div', { class: 'bf-cust-txt' }, [
          el('b', { text: `ลูกค้าเก่า · ${c.name || ''}${c.phone ? ' · ' + c.phone : ''}` }),
          el('span', { text: [pets, lastRoom ? `ครั้งก่อนพัก ${lastRoom}` : ''].filter(Boolean).join(' · ') || 'ยังไม่มีข้อมูลน้อง' }),
        ]),
        applied ? el('span', { class: 'bf-cust-ok', html: icons.check + ' ใช้ข้อมูลเดิมแล้ว' }) : (() => {
          const b = el('button', { type: 'button', class: 'bf-chip on', text: 'ใช้ข้อมูลเดิม' });
          b.onclick = () => {
            draft.customerName = c.name || draft.customerName;
            draft.phone = c.phone || draft.phone;
            // ใบใหม่เท่านั้นที่เติมสัตว์/ห้องให้ — ใบเดิมไม่ไปแก้รายการที่บันทึกไว้แล้ว
            if (isNew && li0) {
              if (pet0) li0.petType = pet0;
              if (lastLi?.roomType && s?.roomPrices?.[lastLi.roomType]) li0.roomType = lastLi.roomType;
              li0.pricePerNight = priceFor(li0.roomType, li0.petType, s);
            }
            rerender();
          };
          return b;
        })(),
      );
    }

    const depDateField = field('วันที่โอนมัดจำ', draft.depositDate, v => draft.depositDate = v, { type: 'date' });
    const setCheckIn = (v) => {
      draft.checkIn = v;
      inDateField.querySelector('input').value = v;
      const outInp = outDateField.querySelector('input');
      // มีห้องพัก → เด้งเช็คเอาท์เป็น +1 คืนอัตโนมัติ (ถ้ายังว่างหรือไม่หลังเช็คอิน)
      // ไม่มีห้อง (จองบริการรายวัน เช่น Day Care) → วันเดียว เช็คเอาท์ = วันเดียวกัน
      if (v && draft.lineItems.length && (!draft.checkOut || draft.checkOut <= v)) {
        draft.checkOut = addDaysISO(v, 1);
        if (outInp) outInp.value = draft.checkOut;
      } else if (v && !draft.lineItems.length && (!draft.checkOut || draft.checkOut < v)) {
        draft.checkOut = v;
        if (outInp) outInp.value = v;
      }
      syncNights(); refreshSummary();
    };
    const inDateField = field('วันที่ Check-in', draft.checkIn, v => setCheckIn(v), { type: 'date' });
    const outDateField = field('วันที่ Check-out', draft.checkOut, v => { draft.checkOut = v; syncNights(); refreshSummary(); }, { type: 'date' });

    // ชิปลัด: วันเช็คอิน (วันนี้/พรุ่งนี้) + จำนวนคืน → ตั้งวันเช็คเอาท์ให้
    const quickChip = (text, isOn, onClick) => {
      const b = el('button', { type: 'button', class: 'bf-chip', text });
      b.isOn = isOn; b.onclick = onClick;
      quickChips.push(b);
      return b;
    };
    const dayChips = [['วันนี้', 0], ['พรุ่งนี้', 1]].map(([t, d]) =>
      quickChip(t, () => draft.checkIn === addDaysISO(todayISO(), d), () => setCheckIn(addDaysISO(todayISO(), d))));
    const nightChips = draft.lineItems.length ? [1, 2, 3, 5, 7].map(n =>
      quickChip(`${n} คืน`, () => nightsBetween(draft.checkIn, draft.checkOut) === n, () => {
        if (!draft.checkIn) return toast('เลือกวันเช็คอินก่อน');
        draft.checkOut = addDaysISO(draft.checkIn, n);
        outDateField.querySelector('input').value = draft.checkOut;
        syncNights(); refreshSummary();
      })) : [];
    const inTimeField = field('เวลาเข้า', draft.checkInTime, v => draft.checkInTime = v, { type: 'time' });
    const outTimeField = field('เวลาออก', draft.checkOutTime, v => draft.checkOutTime = v, { type: 'time' });
    const depPctField = field('มัดจำ (%)', draft.depositPct, v => { draft.depositPct = Number(v) || 0; refreshSummary(); }, { type: 'number', min: 0, max: 100 });

    // ── รายการห้อง ──
    const itemsWrap = el('div', {});
    if (draft.lineItems.length) {
      draft.lineItems.forEach((li, idx) => itemsWrap.appendChild(lineItemRow(li, idx)));
    } else {
      // จองบริการรายวันล้วน (เช่น Day Care) — ไม่มีห้องพัก บอกวิธีใช้ให้ชัด
      itemsWrap.appendChild(el('p', { class: 'muted', style: 'margin:2px 2px 12px',
        text: 'ไม่มีห้องพัก — ลูกค้าจองแค่บริการรายวัน (เช่น Day Care) ได้ เพิ่มบริการที่หัวข้อ “บริการเสริม” ด้านล่าง' }));
    }
    const addItemBtn = el('button', { class: 'btn sm ghost', html: icons.plus + ' เพิ่มน้อง / ห้องอีกรายการ' });
    addItemBtn.onclick = () => { draft.lineItems.push(blankLineItem(s)); rerender(); };

    // ตัวเลือกราคา/คืน — ล็อกเฉพาะราคาที่ร้านกำหนด กันพนักงานพิมพ์ราคาผิด
    // VIP ตามช่วง: สุนัข ปกติ 1,590 / High season 1,890 · แมว ปกติ 1,390 / High season 1,590
    // (ยืนยันกับเจ้าของร้าน 24 ต.ค. 2569) · ราคาในตารางตั้งค่าคงไว้เป็นอีกตัวเลือกถ้าไม่ซ้ำ
    // พนักงานเลือกเองตอนจอง — ค่าเริ่มต้นยังเป็นราคาจากตารางตั้งค่าเหมือนเดิม · ใบเก่าที่ใช้ราคาอื่นคงไว้เป็นตัวเลือก
    function seasonPrices(roomType, petType) {
      if (roomType !== 'vip') return [];
      const low = petType === 'cat' ? (s?.vipCatPromoPrice || VIP_CAT_PROMO_PRICE) : (s?.vipPromoPrice || VIP_PROMO_PRICE);
      return [[low, 'ช่วงปกติ'], [VIP_HIGH_SEASON[petType] || 0, 'High season']].filter(([v]) => v);
    }
    function priceOptions(roomType, petType, current) {
      const opts = seasonPrices(roomType, petType).map(([v, t]) => [String(v), `${t} ${formatBaht(v)}`]);
      const std = priceFor(roomType, petType, s);
      if (std && !opts.some(([v]) => Number(v) === std)) opts.push([String(std), opts.length ? `ราคาตั้งค่า ${formatBaht(std)}` : `มาตรฐาน ${formatBaht(std)}`]);
      const cur = Number(current) || 0;
      if (cur && !opts.some(([v]) => Number(v) === cur)) {
        opts.push([String(cur), `ราคาเดิม ${formatBaht(cur)}`]);
      }
      return opts.length ? opts : [['0', '0']];
    }

    function lineItemRow(li, idx) {
      const petSeg = chipGroup(PET_TYPES.map(p => [p.id, p.label]), li.petType, 'สัตว์', v => {
        li.petType = v; li.pricePerNight = priceFor(li.roomType, v, s); rerender();
      });
      const rooms = el('div', { class: 'bf-rooms', role: 'radiogroup', 'aria-label': 'ประเภทห้อง' },
        Object.entries(s?.roomPrices || {}).map(([k, r]) => {
          const on = k === li.roomType;
          const p = priceFor(k, li.petType, s);
          const all = [p, ...seasonPrices(k, li.petType).map(([v]) => v)].filter(Boolean);   // VIP: โชว์ช่วงราคา
          const low = Math.min(...all), high = Math.max(...all);
          const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: 'bf-room' + (on ? ' on' : '') }, [
            el('b', { text: r.label }),
            el('span', { class: 'owner-only', text: !all.length ? 'ยังไม่ตั้งราคา' : low < high ? `${formatBaht(low)}–${formatBaht(high, false)}/คืน` : `${formatBaht(high)}/คืน` }),
          ]);
          b.onclick = () => { if (on) return; li.roomType = k; li.pricePerNight = priceFor(k, li.petType, s); rerender(); };
          return b;
        }));
      // ราคา/คืน: โชว์ดรอปดาวน์เฉพาะตอนมีให้เลือกมากกว่า 1 (เช่น VIP มีราคาโปร / ใบเก่าที่ใช้ราคาอื่น)
      const opts = priceOptions(li.roomType, li.petType, li.pricePerNight);
      // มีให้เลือกมากกว่า 1 ราคา (VIP ช่วงปกติ/High season · ใบเก่าที่ใช้ราคาอื่น) → ชิปแตะเลือก
      const priceSel = opts.length > 1
        ? el('div', { class: 'bf-price owner-only' }, [chipGroup(opts, String(li.pricePerNight ?? ''), 'ราคาต่อคืน', v => { li.pricePerNight = Number(v) || 0; refreshSummary(); })])
        : null;
      const roomsStep = labeled('จำนวนห้อง', stepper(li.rooms, 1, 'จำนวนห้อง', v => { li.rooms = v; refreshSummary(); }));
      const nightsStep = stepper(li.nights, 1, 'จำนวนคืน', v => { li.nights = v; refreshSummary(); });
      nightsStep.querySelector('output').setAttribute('data-nights', '1');

      // ส่วนลดรายห้อง: ซ่อนไว้หลังลิงก์ (แทบไม่ได้ใช้) · มีค่าอยู่แล้ว = เปิดค้าง
      const discOpen = openDisc.has(idx) || Number(li.discountValue) > 0;
      const discToggle = discOpen ? null : el('button', { type: 'button', class: 'bf-link owner-only', text: 'ใส่ส่วนลด' });
      if (discToggle) discToggle.onclick = () => { openDisc.add(idx); rerender(); };
      const discRow = discOpen ? el('div', { class: 'row owner-only' }, [
        labeled('ชนิดส่วนลด', selectEl([['percent', 'ส่วนลด %'], ['amount', 'ส่วนลด บาท']], li.discountType, v => { li.discountType = v; refreshSummary(); })),
        labeled('ส่วนลด', numInput(li.discountValue, v => { li.discountValue = v; refreshSummary(); })),
      ]) : null;

      const rmBtn = el('button', { type: 'button', class: 'btn sm ghost bf-rm', html: icons.trash, 'aria-label': `ลบรายการที่ ${idx + 1}` });
      // ลบได้จนหมด — ถ้าไม่เหลือห้องเลยจะกลายเป็น "จองบริการรายวัน" (เช่น Day Care) ล้วน
      rmBtn.onclick = () => { draft.lineItems.splice(idx, 1); openDisc.clear(); rerender(); };

      return el('div', { class: 'lineitem bf-li' }, [
        el('div', { class: 'li-head' }, [petSeg, rmBtn]),
        rooms,
        priceSel,
        el('div', { class: 'bf-li-row' }, [roomsStep, labeled('จำนวนคืน', nightsStep), discToggle].filter(Boolean)),
        discRow,
      ].filter(Boolean));
    }

    // ── ส่วนลดพักยาว (ลดเฉพาะค่าห้อง): 5–9 คืน 5% · 10 คืนขึ้นไป 10% ──
    // ขั้นเดียวกับหน้าจองออนไลน์ (longStayDiscounts ในตั้งค่า) · นับคืนของแต่ละรายการห้อง
    // กดรับสิทธิ์ = ใส่ส่วนลดเป็น "บาท ปัดเต็ม" ให้ห้องที่เข้าเงื่อนไข (แบบเดียวกับใบที่มาจากเว็บ → ยอดไม่มีเศษสตางค์)
    // เปลี่ยนคืน/ราคาทีหลัง → ปุ่มเปลี่ยนเป็น "ปรับส่วนลด" · พักไม่ถึงเกณฑ์แล้วแต่ยังมีส่วนลด → เตือนให้เอาออก
    const promoBanner = el('div', { class: 'promo-banner hidden' });
    const tiers = s?.longStayDiscounts;
    const longStayAmt = (li, pct) => Math.round(computeLineItem(li).gross * pct / 100);
    function refreshPromo() {
      promoBanner.innerHTML = '';
      promoBanner.classList.remove('warn');
      const lis = draft.lineItems.map(li => ({ li, pct: longStayPct(li.nights, tiers) }));
      const hits = lis.filter(x => x.pct);
      const stale = lis.filter(x => !x.pct && Number(x.li.discountValue) > 0);
      const btn = (text, fn) => { const b = el('button', { type: 'button', class: 'btn sm primary', text }); b.onclick = () => { fn(); rerender(); }; return b; };
      if (hits.length) {
        const pct = Math.max(...hits.map(x => x.pct));
        const nights = Math.max(...hits.map(x => Number(x.li.nights) || 0));
        const ok = ({ li, pct }) => li.discountType === 'amount' && Number(li.discountValue) === longStayAmt(li, pct);
        promoBanner.appendChild(el('span', { class: 'promo-text', html:
          `${icons.star} พัก ${nights} คืน — ได้<strong>ส่วนลดพักยาว ${pct}%</strong> (ลดเฉพาะค่าห้อง)` }));
        promoBanner.appendChild(hits.every(ok)
          ? el('span', { class: 'pill green', text: 'รับสิทธิ์แล้ว' })
          : btn(hits.some(x => Number(x.li.discountValue) > 0) ? 'ปรับส่วนลด' : 'รับสิทธิ์',
            () => hits.forEach(({ li, pct }) => { li.discountType = 'amount'; li.discountValue = longStayAmt(li, pct); })));
      } else if (stale.length) {
        // ส่วนลดที่ค้างอยู่อาจเป็นส่วนลดพิเศษที่ตั้งใจให้ — แค่เตือน ไม่ลบเอง
        promoBanner.classList.add('warn');
        promoBanner.appendChild(el('span', { class: 'promo-text', html:
          `${icons.alert} จำนวนคืนไม่ถึงเกณฑ์ส่วนลดพักยาวแล้ว แต่ห้องยังมีส่วนลดอยู่ — ถ้าเป็นส่วนลดพักยาว ให้เอาออก` }));
        promoBanner.appendChild(btn('เอาส่วนลดออก', () => stale.forEach(({ li }) => { li.discountValue = 0; })));
      }
      promoBanner.classList.toggle('hidden', !promoBanner.childNodes.length);
    }

    // ── บริการเสริม ──
    const addonsWrap = el('div', {});
    const addonOpts = (s?.addOnServices || []).filter(o => o.name);
    draft.addOns.forEach((a, idx) => addonsWrap.appendChild(addonRow(a, idx)));
    // แตะครั้งเดียวได้รายการชนิดที่ถูกเลย (เดิมต้องกดเพิ่ม แล้วไปเปลี่ยนชนิดในดรอปดาวน์อีกที)
    const addonChips = el('div', { class: 'bf-chips' }, [
      ['bath', 'อาบน้ำ'], ['groom', 'อาบน้ำตัดขน'], ['daycare', 'Day Care'], ['custom', 'อื่น ๆ'],
    ].map(([key, text]) => {
      const b = el('button', { type: 'button', class: 'bf-chip', html: icons.plus + escapeHtml(text) });
      b.onclick = () => { const a = {}; applyAddonKind(a, key); draft.addOns.push(a); rerender(); };
      return b;
    }));

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

      const totalSpan = el('span', { class: 'addon-total owner-only', text: formatBaht(computeAddOn(a).total) });
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
        controls.push(labeled('ราคา/หน่วย', priceInp, 'owner-only'), labeled('จำนวน', qtyInp));
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
    // สถานะมัดจำ / ช่องทางโอน = ชิปแตะครั้งเดียว (ทั้งคอมและมือถือ)
    const depStatus = labeled('สถานะมัดจำ', chipGroup(DEPOSIT_STATUSES.map(x => [x, x]), draft.depositStatus, 'สถานะมัดจำ',
      v => { draft.depositStatus = v; }, 'dep-chips'));
    const depMethod = labeled('ช่องทางโอนมัดจำ', chipGroup(PAYMENT_METHODS.map(x => [x, x]), draft.depositMethod || DEFAULT_DEPOSIT_METHOD, 'ช่องทางโอนมัดจำ',
      v => { draft.depositMethod = v; }));
    const recStatus = labeled('สถานะบันทึก', selectEl(RECORD_STATUSES.map(x => [x, x]), draft.recordStatus, v => draft.recordStatus = v));
    // ตัวเลือกที่ไม่ค่อยแตะ → พับไว้ · มีค่าที่ไม่ใช่ค่าเริ่มต้น = เปิดค้าง จะได้ไม่มีส่วนลดซ่อนอยู่โดยไม่เห็น
    const moreOpen = Number(draft.billDiscountValue) > 0 || Number(draft.depositPct) !== Number(s?.depositPctDefault ?? 50);
    const more = el('details', { class: 'bf-more', open: moreOpen ? '' : null }, [
      el('summary', { text: 'ตัวเลือกเพิ่มเติม · ส่วนลดทั้งบิล · % มัดจำ · สถานะบันทึก' }),
      el('div', { class: 'row' }, [labeled('ส่วนลดทั้งบิล — ชนิด', billDiscType), labeled('ส่วนลดทั้งบิล — จำนวน', billDiscVal)]),
      el('div', { class: 'row' }, [depPctField, recStatus]),
    ]);
    const notesInp = el('textarea', { placeholder: 'พันธุ์ / น้ำหนัก / อาการสุขภาพ / เงื่อนไขพิเศษ' });
    notesInp.value = draft.notes || '';
    notesInp.oninput = () => draft.notes = notesInp.value;

    // ── ปุ่ม ──
    // พนักงานเปิดใบเดิมมาดูยอด/แจ้งลูกค้าได้ แต่แก้ไม่ได้ (firestore.rules บล็อก update อยู่)
    // ต้องปิดปุ่มบันทึกไว้ ไม่งั้นกดแล้วเจอ error โดยไม่รู้สาเหตุ
    const readOnly = !isNew && isStaff();
    const saveBtn = el('button', {
      class: 'btn primary' + (readOnly ? ' disabled' : ''),
      html: icons.save + (readOnly ? ' แก้ไขได้เฉพาะเจ้าของร้าน' : ' บันทึกการจอง'),
    });
    saveNow = async () => {
      if (readOnly) return toast('ใบที่บันทึกแล้วแก้ได้เฉพาะเจ้าของร้าน — ถ้าต้องแก้ กรุณาแจ้งเจ้าของร้าน');
      if (saving) return;
      saving = true;
      try { await doSave(draft, isNew, m); } finally { saving = false; }
    };
    saveBtn.onclick = saveNow;
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const keyHint = readOnly ? null : el('div', { class: 'bf-key', text: `กด ${isMac ? '⌘' : 'Ctrl'} + Enter เพื่อบันทึก` });
    const cardBtn = el('button', { class: 'btn ghost', html: icons.image + ' ดูการ์ดส่งลูกค้า' });
    cardBtn.onclick = () => openCardPreview(draft);
    // ฟังก์ชัน C: จองซ้ำ — ก็อปการจองเดิม เปิดใบใหม่ให้แก้เฉพาะวัน
    const dupBtn = existing?.id ? el('button', { class: 'btn sm ghost', html: icons.copy + ' จองซ้ำ' }) : null;
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
    // ลบได้เฉพาะเจ้าของร้าน (firestore.rules บล็อกฝั่ง server อยู่แล้ว — ตรงนี้กันไม่ให้เห็นปุ่มที่กดแล้วพัง)
    const delBtn = existing?.id && !isStaff() ? el('button', { class: 'btn sm ghost bf-del', html: icons.trash + ' ลบการจอง' }) : null;
    if (delBtn) delBtn.onclick = async () => {
      if (await confirmDialog('ลบการจองนี้?', { danger: true, okText: 'ลบ' })) { await remove('bookings', existing.id); m.close(); toast('ลบแล้ว'); }
    };

    // ฟังก์ชัน B: แถบสรุปยอด+มัดจำ ลอยติดล่าง (มีปุ่มบันทึกในตัว) · บนคอมตัวเลขในแถบนี้ซ่อน (ซ้ำกับ .bf-pay)
    const stickyBar = el('div', { class: 'sticky-summary' }, [
      el('div', { class: 'ss-figures' }, [stickyTotal, stickyDeposit]),
      saveBtn,
    ]);

    // ใบใหม่ที่เปิดมาพร้อมวันครบแล้ว (เช่น สร้างจากคำขอเว็บ / จองซ้ำ) ต้องคิดคืนให้เลย
    // — syncNights ทำงานเฉพาะตอน "เปลี่ยนวันที่" ถ้าไม่เรียกตรงนี้จะค้างที่ 1 คืน = คิดเงินขาด
    if (isNew && draft.checkIn && draft.checkOut) syncNights();

    // คอม: 2 แผง — ซ้าย = ขั้นตอนกรอก (เลขขั้นนับด้วย CSS counter จึงไม่ข้ามเลขตอนพี่เลี้ยงไม่เห็นกลุ่มมัดจำ)
    //       ขวา = สรุปยอด + ปุ่มบันทึก ติดอยู่ตลอดตอนเลื่อน
    // มือถือ: .bf-main/.bf-side เป็น display:contents → ลำดับเหมือนเดิม และแถบสรุปยังลอยติดล่างจอ
    form.append(
      el('h2', { text: isNew ? 'เพิ่มการจอง' : 'แก้ไขการจอง' }),
      el('div', { class: 'bf-main' }, [
        bfGroup('ลูกค้า', null,
          el('div', { class: 'row' }, [nameField, phoneField]), custCard, vaccineBanner),
        bfGroup('วันเข้าพัก', nightsBadge,
          el('div', { class: 'row' }, [inDateField, outDateField]),
          el('div', { class: 'bf-chips bf-quick' }, [...dayChips, nightChips.length ? el('span', { class: 'bf-sep' }) : null, ...nightChips].filter(Boolean)),
          el('div', { class: 'row' }, [inTimeField, outTimeField])),
        bfGroup('ห้องพัก', null,
          itemsWrap, addItemBtn, promoBanner),
        bfGroup('บริการเสริม', null,
          addonsWrap, addonChips),
        bfGroup('มัดจำ owner-only', null,
          depStatus,
          el('div', { class: 'row' }, [depMethod]),
          el('div', { class: 'row' }, [depDateField]),
          more),
        bfGroup('หมายเหตุ', null,
          el('div', { class: 'field' }, [notesInp])),
      ].filter(Boolean)),
      el('aside', { class: 'bf-side' }, [
        el('h3', { class: 'bf-side-h owner-only', text: 'สรุปยอด' }),
        summaryBox,
        stickyBar,
        keyHint,
        el('div', { class: 'bf-acts' }, [cardBtn]),
        dupBtn || delBtn ? el('div', { class: 'bf-acts bf-acts-sm' }, [dupBtn, delBtn].filter(Boolean)) : null,
      ].filter(Boolean)),
    );
    refreshSummary();
    refreshNightsBadge();
    refreshCust();
  }
}

// ────────── helpers ──────────
// bfGroup / chipGroup ย้ายไป ui.js (ใช้ร่วมกับฟอร์มจองคิว)

// ปุ่ม − ค่า + · ค่าเก็บใน <output> (syncNights เขียน .value ทับได้ตรงๆ)
function stepper(value, min, label, onChange) {
  const out = el('output', { 'aria-live': 'polite' });
  out.value = String(Number(value) || min);
  const btn = (d, icon, name) => {
    const b = el('button', { type: 'button', class: 'bf-stepbtn', html: icon, 'aria-label': `${name}${label}` });
    b.onclick = () => { const v = Math.max(min, (Number(out.value) || min) + d); out.value = String(v); onChange(v); };
    return b;
  };
  return el('div', { class: 'bf-step', role: 'group', 'aria-label': label }, [btn(-1, icons.minus, 'ลด'), out, btn(1, icons.plus, 'เพิ่ม')]);
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
// cls: ใส่ 'owner-only' กับช่องที่เกี่ยวกับเงิน — พี่เลี้ยงจะไม่เห็น (ดู .staff-mode ใน styles.css)
function labeled(label, node, cls = '') { return el('div', { class: 'field ' + cls, style: 'margin:0' }, [el('label', { text: label }), node]); }
function selectEl(pairs, value, onChange) {
  const sel = el('select', {}, pairs.map(([v, t]) => el('option', { value: v, text: t })));
  sel.value = value;
  sel.onchange = () => onChange(sel.value);
  return sel;
}

// ────────── บันทึก ──────────
async function doSave(draft, isNew, modal) {
  if (!draft.customerName?.trim()) return toast('กรุณากรอกชื่อลูกค้า');
  if (!draft.checkIn) return toast('กรุณาเลือกวันที่');

  const hasRooms = (draft.lineItems || []).length > 0;
  const hasAddOns = (draft.addOns || []).length > 0;
  if (!hasRooms && !hasAddOns) return toast('กรุณาเพิ่มห้องพัก หรือบริการอย่างน้อย 1 รายการ');

  if (hasRooms) {
    // จองห้องพัก (ค้างคืน) — ต้องมีวันออกที่หลังวันเข้า
    if (!draft.checkOut) return toast('กรุณาเลือกวัน Check-out');
    if (nightsBetween(draft.checkIn, draft.checkOut) <= 0) return toast('วัน Check-out ต้องหลัง Check-in');
  } else {
    // จองบริการรายวัน (เช่น Day Care) — วันเดียว ไม่ต้องมีคืน เช็คเอาท์ = วันเดียวกัน
    if (!draft.checkOut || draft.checkOut < draft.checkIn) draft.checkOut = draft.checkIn;
  }

  const b = computeBooking(draft);
  const rec = {
    ...draft,
    lineItems: b.lineItems, grandTotal: b.grandTotal, itemsTotal: b.itemsTotal,
    addOnsTotal: b.addOnsTotal, totalDiscount: b.totalDiscount,
    depositAmount: b.depositAmount, balanceDue: b.balanceDue, depositPct: b.depositPct,
    createdBy: draft.createdBy || currentUser()?.email || '',
  };
  const savedId = await save('bookings', rec);
  if (!rec.id) rec.id = savedId; // ใบใหม่: เก็บ id ที่เพิ่งสร้าง เพื่อทำลิงก์เช็คอินได้
  await upsertCustomer(draft);
  modal.close();
  toast(isNew ? 'บันทึกการจองแล้ว' : 'อัปเดตแล้ว');
  // ฟังก์ชัน D: บันทึกแล้วเปิดการ์ดส่งลูกค้าทันที (ส่ง Line ต่อได้เลย)
  openCardPreview(rec, true); // savedMode → มีปุ่ม "เสร็จแล้ว" ให้กลับหน้ารายการจอง
}

async function upsertCustomer(draft) {
  const name = draft.customerName.trim();
  if (!name) return;
  if (_customers.some(c => c.name === name)) return; // มีแล้ว ไม่สร้างซ้ำ
  await save('customers', { name, phone: draft.phone || '', pets: [], notes: '' });
}

// ────────── การ์ดสรุป ──────────
// savedMode = เปิดหลังบันทึกเสร็จ → ต้องมีทางออกชัดเจนว่า "จบงานแล้ว ไปไหนต่อ"
function openCardPreview(draft, savedMode = false) {
  if (!draft.checkIn || !draft.checkOut) return toast('กรอกวันเข้า-ออกก่อนสร้างการ์ด');
  const card = buildCustomerCard(draft);
  const shareBtn = el('button', { class: 'btn primary', html: icons.share + ' แชร์เข้า Line' });
  const dlBtn = el('button', { class: 'btn', html: icons.download + ' ดาวน์โหลด PNG' });
  const copyBtn = el('button', { class: 'btn', html: icons.copy + ' คัดลอกข้อความ' });
  const intakeBtn = el('button', { class: 'btn ghost', html: icons.print + ' พิมพ์ใบรับฝาก' });
  const checkinLinkBtn = el('button', { class: 'btn ghost', html: icons.login + ' คัดลอกลิงก์เช็คอิน' });
  const doneBtn = el('button', { class: 'btn primary block', html: icons.check + ' เสร็จแล้ว — กลับหน้ารายการจอง' });

  const m = openModal(el('div', {}, [
    el('h2', { text: savedMode ? 'บันทึกการจองแล้ว ✓' : 'การ์ดสรุปส่งลูกค้า' }),
    el('p', { class: 'muted', style: 'margin-top:-6px', text: savedMode
      ? 'ส่งการ์ดให้ลูกค้าได้เลย — หรือกด "เสร็จแล้ว" เพื่อกลับไปหน้ารายการจอง'
      : 'กดแชร์ส่งเข้า Line ได้เลย หรือดาวน์โหลด/คัดลอกเป็นข้อความ' }),
    el('div', { style: 'display:flex;justify-content:center;margin:10px 0' }, [card]),
    el('div', { class: 'row', style: 'justify-content:center;gap:8px' }, [copyBtn, dlBtn, shareBtn]),
    el('div', { class: 'row', style: 'justify-content:center;gap:8px;margin-top:4px' }, [intakeBtn, checkinLinkBtn]),
    // ทางออกชัดๆ หลังบันทึก — กันงงว่า "แล้วไปไหนต่อ" โดยเฉพาะบนมือถือ
    ...(savedMode ? [el('div', { style: 'margin-top:14px' }, [doneBtn])] : []),
  ]));

  shareBtn.onclick = () => shareCard(card, draft);
  dlBtn.onclick = () => downloadCardPNG(card, `สรุป-${draft.customerName || 'ลูกค้า'}.png`);
  copyBtn.onclick = () => copySummaryText(draft);
  intakeBtn.onclick = () => openIntakeForm(draft, _customers); // ส่งลูกค้าไปด้วยเพื่อดึงข้อมูลสัตว์มาลงใบ
  // ลิงก์ให้ลูกค้ากรอกฟอร์มเช็คอินก่อนมาถึง — ฝัง ?b=<bookingId> เพื่อให้ใบที่ส่งกลับจับคู่ใบจองนี้อัตโนมัติ
  checkinLinkBtn.onclick = () => copyText('https://perfectbkk.com/checkin.html' + (draft.id ? '?b=' + encodeURIComponent(draft.id) : ''));
  doneBtn.onclick = () => { m.close(); window.__go && window.__go('bookings'); };
}
