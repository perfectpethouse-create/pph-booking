// ═══════════════════════════════════════════════════════════════
// calendar.js — ปฏิทินห้องว่างรายเดือน + เตือน (soft) เมื่อจองเกิน capacity
// ห้องถูกจองในช่วง [checkIn, checkOut) — วันเช็คเอาท์นับว่าห้องว่าง
// ═══════════════════════════════════════════════════════════════
import { listen } from './db.js';
import { el, getSettings, toast, openModal, isStaff, staffCan, escapeHtml } from './ui.js';
import { computeBooking, todayISO, formatDateTH, formatBaht, nightsBetween, eachDate, isoOf, owedOf } from './calc.js';
import { PET_TYPES, capacityOf } from './config-shop.js';
import { openBookingForm } from './bookings.js';
import { icons } from './icons.js';
import { formForBooking, openGuestCheckin, parseRaw, mapFormToPets } from './registrations.js';
import { MONTHS, longDate, rangeOf, roomsOf, isCat } from './mobile-kit.js';

const PET_ICONS = { dog: icons.dog, cat: icons.cat };

let _unsub = [];
let _view = new Date(); // เดือนที่กำลังดู

export function renderCalendar(container) {
  _unsub.forEach(u => u()); _unsub = [];
  _view = new Date();

  const title = el('span', { class: 'd-month' });
  const subtitle = el('div', { class: 'd-date' });
  const prev = el('button', { class: 'btn ghost sm', html: icons.chevronLeft, 'aria-label': 'เดือนก่อนหน้า' });
  const next = el('button', { class: 'btn ghost sm', html: icons.chevronRight, 'aria-label': 'เดือนถัดไป' });
  const roomSel = el('select', { 'aria-label': 'กรองประเภทห้อง' });
  const petSel = el('select', { 'aria-label': 'กรองห้องสุนัข/แมว' }, [
    el('option', { value: '', text: 'ทุกสัตว์' }),
    ...PET_TYPES.map(p => el('option', { value: p.id, text: `ห้อง${p.label}` })),
  ]);
  const grid = el('div', {});
  const legend = el('div', { class: 'd-cal-legend' });

  // มือถือ = ปฏิทินกะทัดรัด + รายละเอียดวันที่เลือกใต้ปฏิทิน (.mcal) · คอม = แบบเดิม (.cal-full)
  let _bookings = [];
  // ใบลงทะเบียน + ลูกค้า — แตะชื่อแขกแล้วเปิดข้อมูลเช็คอิน (หมา/แมว สุขภาพ) แทนใบจอง
  const reg = { forms: [], customers: [] };
  const mobile = buildMobileCalendar(() => _bookings, reg);
  container.appendChild(mobile.node);
  container.appendChild(el('div', { class: 'cal-full' }, [
    el('div', { class: 'd-top' }, [el('h1', { text: 'ปฏิทินห้องว่าง' }), subtitle]),
    el('div', { class: 'd-card' }, [
      el('div', { class: 'd-filters' }, [
        el('div', { class: 'd-datenav' }, [prev, title, next]),
        roomSel, petSel,
      ]),
      el('div', { class: 'd-cal' }, [grid]),
      legend,
    ]),
  ]));

  const refreshRoomOptions = () => {
    const s = getSettings();
    const cur = roomSel.value; // คงค่าที่เลือกไว้เมื่อ options ถูกสร้างใหม่
    roomSel.innerHTML = '';
    roomSel.appendChild(el('option', { value: '', text: 'ทุกประเภทห้อง' }));
    Object.entries(s?.roomPrices || {}).forEach(([k, r]) => roomSel.appendChild(el('option', { value: k, text: r.label })));
    roomSel.value = cur;
  };

  const draw = () => {
    refreshRoomOptions();
    const s = getSettings();
    const y = _view.getFullYear(), mth = _view.getMonth();
    title.textContent = _view.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

    // นับห้องที่จองต่อวัน แยกตาม "ประเภทห้อง|สัตว์" (ห้องสุนัข/แมวแยกกัน)
    const occ = {}; // 'YYYY-MM-DD' -> { 'roomType|pet': count }
    _bookings.filter(b => b.depositStatus !== 'ยกเลิก').forEach(b => {
      if (!b.checkIn || !b.checkOut) return;
      const perKey = {};
      b.lineItems.forEach(li => {
        const key = `${li.roomType}|${li.petType || 'dog'}`;
        perKey[key] = (perKey[key] || 0) + (Number(li.rooms) || 0);
      });
      eachDate(b.checkIn, b.checkOut, iso => {
        occ[iso] = occ[iso] || {};
        for (const [k, n] of Object.entries(perKey)) occ[iso][k] = (occ[iso][k] || 0) + n;
      });
    });

    const filterRoom = roomSel.value;
    const filterPet = petSel.value;
    const capacity = s?.roomCapacity || {};
    const roomTypes = filterRoom ? [filterRoom] : Object.keys(s?.roomPrices || {});
    const totalCap = roomTypes.reduce((sum, rt) => sum + capacityOf(capacity, rt, filterPet || undefined), 0);
    // นับยอดจองตามฟิลเตอร์ (ประเภทห้อง + สัตว์)
    const usedOf = (dayOcc) => Object.entries(dayOcc).reduce((sum, [k, n]) => {
      const [rt, pet] = k.split('|');
      if (filterRoom && rt !== filterRoom) return sum;
      if (filterPet && pet !== filterPet) return sum;
      return sum + n;
    }, 0);

    // สร้างกริดเดือน
    grid.innerHTML = '';
    const dow = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    const head = el('div', { class: 'cal-grid' }, dow.map(d => el('div', { class: 'cal-dow', text: d })));
    grid.appendChild(head);

    const first = new Date(y, mth, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(y, mth + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push(el('div', {}));
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = isoOf(y, mth, d);
      const dayOcc = occ[iso] || {};
      const used = usedOf(dayOcc);
      const over = totalCap > 0 && used > totalCap;
      // ระดับความเต็ม (สีของป้ายและแถบ): ว่างเยอะ < 70% ≤ เริ่มเต็ม < 100% ≤ เต็ม/เกิน
      const pct = totalCap ? Math.min(100, Math.round(used / totalCap * 100)) : 0;
      const lvl = !used ? 'free' : (totalCap && used >= totalCap) ? 'full' : pct >= 70 ? 'mid' : 'low';
      const cell = el('div', { class: `cal-cell lvl-${lvl}` + (iso === todayISO() ? ' today' : ''), role: 'button', tabindex: '0' }, [
        el('div', { class: 'd', text: String(d) }),
      ]);
      if (used > 0) {
        cell.appendChild(el('span', { class: 'cal-occ' + (over ? ' over' : ''), text: `${used}/${totalCap || '∞'} ห้อง${over ? ' เกิน' : ''}` }));
        // ชิปแยกสุนัข/แมว — เห็นปราดเดียวว่าวันนั้นมีสัตว์ชนิดไหนพักกี่ห้อง
        const perPet = { dog: 0, cat: 0 };
        Object.entries(dayOcc).forEach(([k, n]) => {
          const [rt, pet] = k.split('|');
          if (filterRoom && rt !== filterRoom) return;
          if (filterPet && pet !== filterPet) return;
          perPet[pet] = (perPet[pet] || 0) + n;
        });
        const petRow = el('div', { class: 'cal-pets' });
        if (perPet.dog > 0) petRow.appendChild(el('span', { class: 'pet-chip pet-dog', html: `${icons.dog}${perPet.dog}` }));
        if (perPet.cat > 0) petRow.appendChild(el('span', { class: 'pet-chip pet-cat', html: `${icons.cat}${perPet.cat}` }));
        if (petRow.children.length) cell.appendChild(petRow);
      } else {
        cell.appendChild(el('span', { class: 'cal-occ muted', text: 'ว่าง' }));
      }
      if (totalCap) cell.appendChild(el('div', { class: 'd-cal-bar' }, [el('i', { style: `width:${pct}%` })]));
      cell.classList.add('clickable');
      cell.onclick = () => openDayDetail(iso);
      cell.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDayDetail(iso); } };
      cells.push(cell);
    }
    grid.appendChild(el('div', { class: 'cal-grid' }, cells));
    const petLabel = filterPet ? ` (ห้อง${PET_TYPES.find(p => p.id === filterPet)?.label})` : '';
    const capText = `${filterRoom ? (getSettings()?.roomPrices?.[filterRoom]?.label + ' ' + totalCap) : totalCap} ห้อง${petLabel}`;
    subtitle.textContent = `ห้องที่ถูกจอง / ความจุรวม ${capText}`;
    legend.innerHTML = '';
    legend.append(
      ...[['low', 'ว่างเยอะ'], ['mid', 'เริ่มเต็ม'], ['full', 'เต็ม/เกิน']].map(([k, t]) => el('span', { class: `cal-occ lg-${k}`, text: t })),
      el('span', { text: '· ตัวเลข = ห้องที่จอง / ความจุ · กดวันเพื่อดูรายชื่อ · ปรับความจุแยกห้องสุนัข/แมวได้ที่หน้า "ตั้งค่า"' }),
    );
  };

  prev.onclick = () => { _view = new Date(_view.getFullYear(), _view.getMonth() - 1, 1); draw(); };
  next.onclick = () => { _view = new Date(_view.getFullYear(), _view.getMonth() + 1, 1); draw(); };
  roomSel.onchange = draw;
  petSel.onchange = draw;

  // ── กดวันในปฏิทิน → รายชื่อผู้เข้าพักวันนั้น แยกสุนัข/แมว ──
  function openDayDetail(iso) {
    const s = getSettings();
    // พักค้างคืนวันนั้น [checkIn, checkOut) + คนที่เช็คเอาท์วันนั้น (ยังอยู่ช่วงเช้า)
    const guests = _bookings
      .filter(b => b.depositStatus !== 'ยกเลิก' && b.checkIn && b.checkOut)
      .filter(b => (b.checkIn <= iso && iso < b.checkOut) || b.checkOut === iso)
      .sort((a, b) => (a.checkIn || '').localeCompare(b.checkIn || ''));

    const wrap = el('div', {});
    wrap.appendChild(el('h2', { text: `ผู้เข้าพักวันที่ ${formatDateTH(iso)}` }));

    // สรุปรวมสุนัข/แมว (นับห้อง)
    const perPet = { dog: 0, cat: 0 };
    guests.forEach(b => {
      if (b.checkOut === iso && !(b.checkIn <= iso && iso < b.checkOut)) return; // ออกวันนั้น ไม่นับห้องค้างคืน
      b.lineItems.forEach(li => { perPet[li.petType || 'dog'] += Number(li.rooms) || 0; });
    });
    wrap.appendChild(el('div', { class: 'row', style: 'gap:8px;margin-bottom:12px' }, [
      el('span', { class: 'pet-chip pet-dog pet-chip-lg', html: `${icons.dog} สุนัข ${perPet.dog} ห้อง` }),
      el('span', { class: 'pet-chip pet-cat pet-chip-lg', html: `${icons.cat} แมว ${perPet.cat} ห้อง` }),
    ]));

    if (!guests.length) {
      wrap.appendChild(el('p', { class: 'muted', style: 'padding:16px;text-align:center', text: 'ว่าง — ไม่มีลูกค้าเข้าพักวันนี้' }));
    }

    const m = openModal(wrap);
    guests.forEach(b => {
      const statusMap = { 'จ่ายครบแล้ว': 'green', 'มัดจำแล้ว': 'yellow', 'ยกเลิก': 'red' };
      const head = el('div', { class: 'li-head' }, [
        el('div', {}, [
          el('strong', { text: b.customerName || '-' }),
          el('span', { class: 'muted', style: 'font-size:12px;margin-left:8px', text: b.phone || '' }),
        ]),
        el('div', { class: 'row', style: 'gap:6px;align-items:center' }, [
          b.checkIn === iso ? el('span', { class: 'pill green', text: 'เช็คอินวันนี้' }) : null,
          b.checkOut === iso ? el('span', { class: 'pill yellow', text: 'เช็คเอาท์วันนี้' }) : null,
          // สถานะมัดจำ = ข้อมูลการเงิน → เจ้าของร้านเท่านั้น
          el('span', { class: 'pill ' + (statusMap[b.depositStatus] || 'grey'), text: b.depositStatus || '-' }),
        ].filter(Boolean)),
      ]);
      // ห้องแต่ละรายการ — ชิปสี+ไอคอนตามชนิดสัตว์
      const roomChips = el('div', { class: 'row', style: 'gap:6px;margin:8px 0 6px;flex-wrap:wrap' },
        b.lineItems.map(li => el('span', {
          class: `pet-chip pet-${li.petType || 'dog'} pet-chip-lg`,
          html: `${PET_ICONS[li.petType] || icons.paw} ${escapeHtml(s?.roomPrices?.[li.roomType]?.label || li.roomType)} × ${Number(li.rooms) || 1} ห้อง`,
        })));
      const nights = nightsBetween(b.checkIn, b.checkOut);
      // พี่เลี้ยงไม่เห็นยอดเงิน
      const money = ` · ยอด ${formatBaht(b.grandTotal)} · ค้างชำระ ${formatBaht(owedOf(b))}`;
      const info = el('div', { class: 'muted', style: 'font-size:13px', text:
        `${formatDateTH(b.checkIn)} → ${formatDateTH(b.checkOut)} · ${nights} คืน${money}` });
      const row = el('div', { class: 'lineitem day-guest' }, [
        head, roomChips, info,
        b.notes ? el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px', text: `หมายเหตุ: ${b.notes}` }) : null,
      ].filter(Boolean));
      if (canSeeReg()) row.onclick = () => { m.close(); openGuest(b, () => _bookings, reg); };
      else row.style.cursor = 'default';
      wrap.appendChild(row);
    });
  }

  _unsub.push(listen('bookings', arr => { _bookings = arr.map(computeBooking); draw(); mobile.draw(); }));
  _unsub.push(listen('checkinForms', arr => { reg.forms = arr; mobile.draw(); }, { orderBy: null }));
  _unsub.push(listen('customers', arr => { reg.customers = arr; }));
}

// แขกที่พัก → ข้อมูลเช็คอิน (ต้องรู้ว่าหมาหรือแมว) · ยังไม่ลงทะเบียน → แผ่นส่งลิงก์ให้ลูกค้า
// เจ้าของร้านมีปุ่ม "เปิดใบจอง" ในแผ่นนั้นด้วย (พี่เลี้ยงไม่เห็นใบจอง — มีราคา/ส่วนลด)
const canSeeReg = () => !isStaff() || staffCan('registrations');
function openGuest(b, getBookings, reg) {
  openGuestCheckin(b, { forms: reg.forms, bookings: getBookings(), customers: reg.customers },
    isStaff() ? null : () => openBookingForm(b));
}

// ═══════════ มือถือ: ปฏิทินห้องว่าง ═══════════
// ตัวเลขในช่อง = "ห้องที่ยังว่าง" (คำถามหน้าเคาน์เตอร์คือ "ว่างไหม" ไม่ใช่ "จองไปกี่ห้อง")
// แตะวัน → ใต้ปฏิทินแสดงห้องว่างแยกประเภท + รายชื่อแขกวันนั้น (ไม่ต้องเปิดหน้าต่างซ้อน)
function buildMobileCalendar(getBookings, reg) {
  const node = el('div', { class: 'mcal' });
  const now = new Date();
  let y = now.getFullYear(), mth = now.getMonth();
  let selected = todayISO();
  let pet = '';

  function occupancy() {
    const occ = {};
    getBookings().filter(b => b.depositStatus !== 'ยกเลิก' && b.checkIn && b.checkOut).forEach(b => {
      b.lineItems.forEach(li => {
        const key = `${li.roomType}|${li.petType || 'dog'}`;
        eachDate(b.checkIn, b.checkOut, iso => {
          occ[iso] = occ[iso] || {};
          occ[iso][key] = (occ[iso][key] || 0) + (Number(li.rooms) || 0);
        });
      });
    });
    return occ;
  }

  function draw() {
    const s = getSettings();
    const cap = s?.roomCapacity || {};
    const roomTypes = Object.keys(s?.roomPrices || {});
    const occ = occupancy();
    const today = todayISO();
    const capOf = (rt) => capacityOf(cap, rt, pet || undefined);
    const usedOf = (iso, rt) => Object.entries(occ[iso] || {}).reduce((sum, [k, n]) => {
      const [r, p] = k.split('|');
      return (r === rt && (!pet || p === pet)) ? sum + n : sum;
    }, 0);
    const freeOf = (iso) => roomTypes.reduce((sum, rt) => sum + (capOf(rt) - usedOf(iso, rt)), 0);
    const totalCap = roomTypes.reduce((sum, rt) => sum + capOf(rt), 0);

    node.innerHTML = '';
    node.appendChild(el('div', { class: 'm-ptitle' }, [el('h1', { text: 'ปฏิทินห้องว่าง' })]));

    // ชิปเลือกชนิดสัตว์ — ห้องสุนัข/แมวนับความจุแยกกัน
    const chips = el('div', { class: 'm-chips' }, [['', 'ทุกห้อง'], ...PET_TYPES.map(p => [p.id, `ห้อง${p.label}`])].map(([id, label]) => {
      const c = el('button', { class: 'm-chipf' + (id === pet ? ' on' : ''), text: label });
      c.onclick = () => { pet = id; draw(); };
      return c;
    }));
    node.appendChild(chips);

    const prev = el('button', { class: 'm-arr', html: icons.chevronLeft, 'aria-label': 'เดือนก่อนหน้า' });
    const next = el('button', { class: 'm-arr', html: icons.chevronRight, 'aria-label': 'เดือนถัดไป' });
    prev.onclick = () => { mth--; if (mth < 0) { mth = 11; y--; } draw(); };
    next.onclick = () => { mth++; if (mth > 11) { mth = 0; y++; } draw(); };
    node.appendChild(el('div', { class: 'm-mhead' }, [
      el('b', { text: `${MONTHS[mth]} ${y + 543}` }),
      el('span', { class: 'm-arrs' }, [prev, next]),
    ]));

    const grid = el('div', { class: 'm-cal' }, ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map(d => el('div', { class: 'm-cal-wd', text: d })));
    const pad = new Date(y, mth, 1).getDay();
    for (let i = 0; i < pad; i++) grid.appendChild(el('div', {}));
    const days = new Date(y, mth + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const iso = isoOf(y, mth, d);
      const free = freeOf(iso);
      // เกณฑ์สี: เต็ม = ไม่เหลือ · ใกล้เต็ม = เหลือไม่ถึง 1 ใน 4 ของความจุ
      const level = !totalCap ? 'lo' : free <= 0 ? 'full' : free <= totalCap / 4 ? 'mid' : 'lo';
      const cell = el('button', {
        class: `m-cc ${level}` + (iso < today ? ' past' : '') + (iso === selected ? ' sel' : '') + (iso === today ? ' today' : ''),
        'aria-label': `${d} ${MONTHS[mth]} ${free <= 0 ? 'เต็ม' : 'ว่าง ' + free + ' ห้อง'}`,
      }, [el('span', { text: String(d) }), el('small', { text: free <= 0 ? (free < 0 ? `เกิน ${-free}` : 'เต็ม') : `ว่าง ${free}` })]);
      cell.onclick = () => { selected = iso; draw(); };
      grid.appendChild(cell);
    }
    node.appendChild(el('div', { class: 'm-calcard' }, [
      grid,
      el('div', { class: 'm-legend' }, [
        el('span', {}, [el('i', { class: 'lo' }), 'ว่างมาก']),
        el('span', {}, [el('i', { class: 'mid' }), 'ใกล้เต็ม']),
        el('span', {}, [el('i', { class: 'full' }), 'เต็ม']),
      ]),
    ]));

    // ── รายละเอียดวันที่เลือก ──
    const free = freeOf(selected);
    node.appendChild(el('div', { class: 'm-sec' }, [
      el('h3', { text: `${longDate(selected)} · ${free <= 0 ? 'เต็ม' : `ว่าง ${free} ห้อง`}` }),
    ]));
    const guests = getBookings().filter(b => b.depositStatus !== 'ยกเลิก' && b.checkIn && b.checkOut)
      .filter(b => (b.checkIn <= selected && selected < b.checkOut) || b.checkOut === selected)
      .filter(b => !pet || b.lineItems.some(li => (li.petType || 'dog') === pet));
    node.appendChild(el('div', { class: 'm-list' }, roomTypes.map(rt => {
      const c = capOf(rt);
      const f = c - usedOf(selected, rt);
      const ins = guests.filter(b => b.checkIn === selected && b.lineItems.some(li => li.roomType === rt)).length;
      const outs = guests.filter(b => b.checkOut === selected && b.lineItems.some(li => li.roomType === rt)).length;
      return el('div', { class: 'm-rt' }, [
        el('div', { class: 'm-tx' }, [
          el('b', { text: s?.roomPrices?.[rt]?.label || rt }),
          el('small', { text: [ins ? `เข้า ${ins}` : '', outs ? `ออก ${outs}` : ''].filter(Boolean).join(' · ') || `ความจุ ${c} ห้อง` }),
        ]),
        el('span', { class: 'm-free' + (f <= 0 ? ' z' : '') }, [String(Math.max(f, 0)), el('small', { text: f <= 0 ? 'เต็ม' : 'ว่าง' })]),
      ]);
    })));

    node.appendChild(el('div', { class: 'm-sec' }, [el('h3', {}, [selected === today ? 'แขกวันนี้' : 'แขกที่พัก', el('span', { class: 'm-n', text: String(guests.length) })])]));
    if (!guests.length) { node.appendChild(el('div', { class: 'm-empty', text: 'ไม่มีลูกค้าเข้าพักวันนั้น' })); return; }
    node.appendChild(el('div', { class: 'm-list' }, guests.map(b => {
      const tag = b.checkIn === selected ? el('span', { class: 'pill green', text: 'เข้า' })
        : b.checkOut === selected ? el('span', { class: 'pill yellow', text: 'ออก' }) : null;
      // ชนิดสัตว์จากใบลงทะเบียน (ถ้ามี) แม่นกว่าห้องที่จอง · ยังไม่ลงทะเบียน = ป้ายเตือนให้ส่งลิงก์
      const f = formForBooking(b, reg.forms);
      const pets = f ? mapFormToPets(parseRaw(f)) : [];
      const cat = pets.length ? pets.every(p => p.species === 'cat') : isCat(b);
      const petTxt = pets.length ? [['dog', 'สุนัข'], ['cat', 'แมว']].map(([k, t]) => {
        const n = pets.filter(p => p.species === k).length; return n ? `${t} ${n}` : '';
      }).filter(Boolean).join(' · ') : '';
      const row = el('div', { class: 'm-row' }, [
        el('span', { class: 'm-pet' + (cat ? ' cat' : ''), html: cat ? icons.cat : icons.dog }),
        el('div', { class: 'm-tx' }, [
          el('b', { text: b.customerName || '-' }),
          el('small', { text: `${roomsOf(b)} · ${rangeOf(b)}` }),
          el('small', { class: f ? 'm-reg ok' : 'm-reg', text: f ? `ลงทะเบียนแล้ว${petTxt ? ' · ' + petTxt : ''}` : 'ยังไม่ลงทะเบียน · แตะเพื่อส่งลิงก์' }),
        ]),
        tag,
      ]);
      if (canSeeReg()) {
        row.setAttribute('role', 'button'); row.setAttribute('tabindex', '0');
        row.onclick = () => openGuest(b, getBookings, reg);
        row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openGuest(b, getBookings, reg); } };
      }
      else row.style.cursor = 'default';
      return row;
    })));
  }

  return { node, draw };
}
