// ═══════════════════════════════════════════════════════════════
// staff-today.js — หน้า "งานวันนี้" สำหรับพี่เลี้ยง (ไม่มีข้อมูลยอดเงินใดๆ)
// เน้นสิ่งที่คนดูแลสัตว์ต้องรู้: ใครเข้า/ออก/พักอยู่ · น้องชื่ออะไร · ต้องระวังอะไร
// ═══════════════════════════════════════════════════════════════
import { listen } from './db.js';
import { el, getSettings, escapeHtml } from './ui.js';
import { computeBooking, formatDateTH, todayISO } from './calc.js';
import { icons } from './icons.js';

let _unsub = [];
let _customers = [];

const PET_ICONS = { dog: icons.dog, cat: icons.cat };

export function renderStaffToday(container) {
  _unsub.forEach(u => u()); _unsub = [];

  container.appendChild(el('div', { class: 'page-title' }, [
    el('h1', { text: 'งานวันนี้' }),
    el('span', { class: 'muted', text: formatDateTH(todayISO()) }),
  ]));
  const statGrid = el('div', { class: 'stat-grid', style: 'margin-bottom:16px' });
  const body = el('div', {});
  container.append(statGrid, body);

  let _bookings = [];
  const draw = () => {
    const today = todayISO();
    const active = _bookings.filter(b => b.depositStatus !== 'ยกเลิก');
    const checkinToday = active.filter(b => b.checkIn === today);
    const checkoutToday = active.filter(b => b.checkOut === today);
    const staying = active.filter(b => b.checkIn <= today && today < b.checkOut);

    // นับจำนวนห้องแยกสุนัข/แมวที่ต้องดูแลวันนี้
    const perPet = { dog: 0, cat: 0 };
    staying.forEach(b => b.lineItems.forEach(li => {
      perPet[li.petType || 'dog'] += Number(li.rooms) || 0;
    }));

    statGrid.innerHTML = '';
    [
      ['เข้าพักวันนี้', checkinToday.length, icons.login, 'green'],
      ['ออกวันนี้', checkoutToday.length, icons.logout, 'orange'],
      ['สุนัขที่ดูแล', `${perPet.dog} ห้อง`, icons.dog, 'blue'],
      ['แมวที่ดูแล', `${perPet.cat} ห้อง`, icons.cat, 'purple'],
    ].forEach(([l, n, ico, color]) => statGrid.appendChild(
      el('div', { class: `stat stat--${color}` }, [
        el('div', { class: 'stat-ico', html: ico }),
        el('div', {}, [el('div', { class: 'n', text: String(n) }), el('div', { class: 'l', text: l })]),
      ])
    ));

    body.innerHTML = '';
    body.append(
      section('เช็คอินวันนี้ — เตรียมรับน้อง', checkinToday, 'ไม่มีน้องเข้าพักวันนี้', 'green'),
      section('เช็คเอาท์วันนี้ — เตรียมส่งน้องกลับ', checkoutToday, 'ไม่มีน้องออกวันนี้', 'orange'),
      section('กำลังพักอยู่', staying, 'ยังไม่มีน้องพักอยู่', 'blue'),
    );
  };

  // จับคู่ลูกค้าเพื่อดึงข้อมูลสัตว์ (ชื่อน้อง/โน้ตสุขภาพ) มาแสดงให้พี่เลี้ยง
  function petsOf(b) {
    const norm = (t) => (t || '').replace(/\D/g, '');
    const c = _customers.find(c =>
      (b.phone && c.phone && norm(c.phone) === norm(b.phone)) ||
      (c.name && c.name === b.customerName));
    return c?.pets || [];
  }

  function section(title, list, emptyText, color) {
    const card = el('div', { class: `card section-card section--${color}` }, [
      el('h2', { text: `${title} (${list.length})` }),
    ]);
    if (!list.length) { card.appendChild(el('p', { class: 'muted', text: emptyText })); return card; }
    const s = getSettings();
    list.forEach(b => {
      const rooms = b.lineItems.map(li => el('span', {
        class: `pet-chip pet-${li.petType || 'dog'} pet-chip-lg`,
        html: `${PET_ICONS[li.petType] || icons.paw} ${escapeHtml(s?.roomPrices?.[li.roomType]?.label || li.roomType)} × ${Number(li.rooms) || 1}`,
      }));
      const box = el('div', { class: 'lineitem' }, [
        el('div', { class: 'li-head' }, [
          el('div', {}, [
            el('strong', { text: b.customerName || '-' }),
            el('span', { class: 'muted', style: 'font-size:12px;margin-left:8px', text: b.phone || '' }),
          ]),
          b.stayStatus === 'checked-in' ? el('span', { class: 'pill green', text: 'เช็คอินแล้ว' })
            : b.stayStatus === 'checked-out' ? el('span', { class: 'pill grey', text: 'เช็คเอาท์แล้ว' }) : null,
        ].filter(Boolean)),
        el('div', { class: 'row', style: 'gap:6px;margin:8px 0 6px;flex-wrap:wrap' }, rooms),
        el('div', { class: 'muted', style: 'font-size:13px', text:
          `${formatDateTH(b.checkIn)} ${b.checkInTime || ''} → ${formatDateTH(b.checkOut)} ${b.checkOutTime || ''}` }),
      ]);

      // ข้อมูลน้องแต่ละตัว + สิ่งที่ต้องระวัง (จากฐานข้อมูลลูกค้า)
      petsOf(b).forEach(p => {
        const cat = p.species === 'cat';
        const line = el('div', { class: 'row', style: 'gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap' }, [
          el('span', { class: `pet-chip pet-${cat ? 'cat' : 'dog'}`, html: `${cat ? icons.cat : icons.dog} ${escapeHtml(p.name || '-')}` }),
          p.breed ? el('span', { class: 'muted', style: 'font-size:12px', text: p.breed }) : null,
        ].filter(Boolean));
        box.appendChild(line);
        if (p.healthNotes) {
          box.appendChild(el('div', { class: 'care-note', text: p.healthNotes }));
        }
      });

      if (b.notes) box.appendChild(el('div', { class: 'muted', style: 'font-size:12px;margin-top:6px', text: `หมายเหตุการจอง: ${b.notes}` }));
      card.appendChild(box);
    });
    return card;
  }

  _unsub.push(listen('customers', arr => { _customers = arr; draw(); }));
  _unsub.push(listen('bookings', raw => { _bookings = raw.map(computeBooking); draw(); }));
}
