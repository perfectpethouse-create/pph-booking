// ═══════════════════════════════════════════════════════════════
// calendar.js — ปฏิทินห้องว่างรายเดือน + เตือน (soft) เมื่อจองเกิน capacity
// ห้องถูกจองในช่วง [checkIn, checkOut) — วันเช็คเอาท์นับว่าห้องว่าง
// ═══════════════════════════════════════════════════════════════
import { listen } from './db.js';
import { el, getSettings, toast, openModal } from './ui.js';
import { computeBooking, todayISO, formatDateTH, formatBaht, nightsBetween } from './calc.js';
import { PET_TYPES, capacityOf } from './config-shop.js';
import { openBookingForm } from './bookings.js';
import { icons } from './icons.js';

const PET_ICONS = { dog: icons.dog, cat: icons.cat };

let _unsub = [];
let _view = new Date(); // เดือนที่กำลังดู

export function renderCalendar(container) {
  _unsub.forEach(u => u()); _unsub = [];
  _view = new Date();

  const title = el('h1', {});
  const prev = el('button', { class: 'btn ghost sm', html: icons.chevronLeft + ' ก่อนหน้า', 'aria-label': 'เดือนก่อนหน้า' });
  const next = el('button', { class: 'btn ghost sm', html: 'ถัดไป ' + icons.chevronRight, 'aria-label': 'เดือนถัดไป' });
  const roomSel = el('select', { style: 'max-width:180px' });
  const petSel = el('select', { style: 'max-width:130px' }, [
    el('option', { value: '', text: 'ทุกสัตว์' }),
    ...PET_TYPES.map(p => el('option', { value: p.id, text: `ห้อง${p.label}` })),
  ]);
  const grid = el('div', {});
  const legend = el('div', { class: 'muted', style: 'font-size:12px;margin-top:8px' });

  container.appendChild(el('div', { class: 'page-title' }, [
    title, el('div', { class: 'row', style: 'gap:8px;align-items:center' }, [roomSel, petSel, prev, next]),
  ]));
  container.appendChild(el('div', { class: 'card' }, [grid, legend]));

  let _bookings = [];
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
      const cell = el('div', { class: 'cal-cell' + (iso === todayISO() ? ' today' : ''), role: 'button', tabindex: '0' }, [
        el('div', { class: 'd', text: String(d) }),
      ]);
      if (used > 0) {
        cell.appendChild(el('span', { class: 'cal-occ' + (over ? ' over' : ''), text: `${used}/${totalCap || '∞'} ห้อง${over ? ' ⚠️เกิน' : ''}` }));
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
      cell.classList.add('clickable');
      cell.onclick = () => openDayDetail(iso);
      cell.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDayDetail(iso); } };
      cells.push(cell);
    }
    grid.appendChild(el('div', { class: 'cal-grid' }, cells));
    const petLabel = filterPet ? ` (ห้อง${PET_TYPES.find(p => p.id === filterPet)?.label})` : '';
    legend.textContent = `ตัวเลข = ห้องที่ถูกจอง/ความจุ · สีแดง = จองเกินความจุ (ปรับความจุแยกห้องสุนัข/แมวได้ที่หน้า "ตั้งค่า") · ความจุรวม ${filterRoom ? (getSettings()?.roomPrices?.[filterRoom]?.label + ' ' + totalCap) : totalCap} ห้อง${petLabel}`;
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
          el('span', { class: 'pill ' + (statusMap[b.depositStatus] || 'grey'), text: b.depositStatus || '-' }),
        ].filter(Boolean)),
      ]);
      // ห้องแต่ละรายการ — ชิปสี+ไอคอนตามชนิดสัตว์
      const roomChips = el('div', { class: 'row', style: 'gap:6px;margin:8px 0 6px;flex-wrap:wrap' },
        b.lineItems.map(li => el('span', {
          class: `pet-chip pet-${li.petType || 'dog'} pet-chip-lg`,
          html: `${PET_ICONS[li.petType] || icons.paw} ${(s?.roomPrices?.[li.roomType]?.label || li.roomType)} × ${li.rooms || 1} ห้อง`,
        })));
      const nights = nightsBetween(b.checkIn, b.checkOut);
      const info = el('div', { class: 'muted', style: 'font-size:13px', text:
        `${formatDateTH(b.checkIn)} → ${formatDateTH(b.checkOut)} · ${nights} คืน · ยอด ${formatBaht(b.grandTotal)} · ค้างชำระ ${formatBaht(b.balanceDue)}` });
      const row = el('div', { class: 'lineitem day-guest' }, [
        head, roomChips, info,
        b.notes ? el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px', text: `หมายเหตุ: ${b.notes}` }) : null,
      ].filter(Boolean));
      row.onclick = () => { m.close(); openBookingForm(b); };
      wrap.appendChild(row);
    });
  }

  _unsub.push(listen('bookings', arr => { _bookings = arr.map(computeBooking); draw(); }));
}

// วนทุกวันในช่วง [start, end) — end ไม่รวม (วันเช็คเอาท์ห้องว่าง)
// ใช้เวลาท้องถิ่นในการฟอร์แมต (ไม่ใช้ toISOString ที่เป็น UTC — กัน off-by-one)
function eachDate(startISO, endISO, cb) {
  let d = new Date(startISO + 'T00:00:00');
  const end = new Date(endISO + 'T00:00:00');
  let guard = 0;
  while (d < end && guard++ < 400) {
    cb(isoOf(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setDate(d.getDate() + 1);
  }
}
function isoOf(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
