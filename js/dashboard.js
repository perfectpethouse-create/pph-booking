// ═══════════════════════════════════════════════════════════════
// dashboard.js — แดชบอร์ดวันนี้: เช็คอิน/เอาท์วันนี้ + ยอดค้าง/ยังไม่ลงระบบ
// ═══════════════════════════════════════════════════════════════
import { listen } from './db.js';
import { el, getSettings } from './ui.js';
import { computeBooking, formatBaht, formatDateTH, todayISO } from './calc.js';
import { icons } from './icons.js';

let _unsub = [];

export function renderDashboard(container) {
  _unsub.forEach(u => u()); _unsub = [];

  container.appendChild(el('div', { class: 'page-title' }, [
    el('h1', { text: 'แดชบอร์ดวันนี้' }),
    el('span', { class: 'muted', text: formatDateTH(todayISO()) }),
  ]));
  const statGrid = el('div', { class: 'stat-grid', style: 'margin-bottom:16px' });
  const body = el('div', {});
  container.append(statGrid, body);

  _unsub.push(listen('bookings', raw => draw(raw.map(computeBooking))));

  function draw(bookings) {
    const today = todayISO();
    const active = bookings.filter(b => b.depositStatus !== 'ยกเลิก');
    const checkinToday = active.filter(b => b.checkIn === today);
    const checkoutToday = active.filter(b => b.checkOut === today);
    const staying = active.filter(b => b.checkIn <= today && today < b.checkOut);
    const unpaid = active.filter(b => b.depositStatus !== 'จ่ายครบแล้ว' && b.balanceDue > 0);
    const notRecorded = active.filter(b => b.recordStatus === 'ยังไม่ลงระบบ');
    const balanceSum = unpaid.reduce((s, b) => s + b.balanceDue, 0);

    // สีสื่อความหมาย: เขียว=เข้าพัก · ส้ม=ออกวันนี้ · ฟ้า=กำลังพัก · แดง=ยอดค้าง
    statGrid.innerHTML = '';
    [
      ['เข้าพักวันนี้', checkinToday.length, icons.login, 'green'],
      ['ออกวันนี้', checkoutToday.length, icons.logout, 'orange'],
      ['กำลังพักอยู่', staying.length, icons.home, 'blue'],
      ['ยอดค้างรับรวม', formatBaht(balanceSum), icons.banknote, 'red'],
    ].forEach(([l, n, ico, color]) => statGrid.appendChild(
      el('div', { class: `stat stat--${color}` }, [
        el('div', { class: 'stat-ico', html: ico }),
        el('div', {}, [el('div', { class: 'n', text: String(n) }), el('div', { class: 'l', text: l })]),
      ])
    ));

    body.innerHTML = '';
    body.append(
      section('เช็คอินวันนี้', checkinToday, 'ไม่มีลูกค้าเข้าพักวันนี้', false, 'green'),
      section('เช็คเอาท์วันนี้ · เก็บยอดคงเหลือ', checkoutToday, 'ไม่มีลูกค้าออกวันนี้', true, 'orange'),
      section('ค้างชำระ / ยังไม่จ่ายครบ', unpaid, 'ไม่มียอดค้าง', true, 'red'),
      section('ยังไม่ลงระบบ', notRecorded, 'ลงระบบครบแล้ว', false, 'grey'),
    );
  }

  function section(title, list, emptyText, showBalance, color = 'grey') {
    const card = el('div', { class: `card section-card section--${color}` }, [el('h2', { text: `${title} (${list.length})` })]);
    if (!list.length) { card.appendChild(el('p', { class: 'muted', text: emptyText })); return card; }
    const rows = list.map(b => el('tr', {}, [
      el('td', {}, [el('strong', { text: b.customerName || '-' }), el('div', { class: 'muted', style: 'font-size:12px', text: b.phone || '' })]),
      el('td', { text: `${formatDateTH(b.checkIn)} → ${formatDateTH(b.checkOut)}` }),
      el('td', { text: roomsDesc(b) }),
      el('td', { class: 'num', text: showBalance ? formatBaht(b.balanceDue) : formatBaht(b.grandTotal) }),
    ]));
    card.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [el('tbody', {}, rows)])]));
    return card;
  }
}

function roomsDesc(b) {
  const s = getSettings();
  return b.lineItems.map(li => `${li.rooms || 1}×${(s?.roomPrices?.[li.roomType]?.label || li.roomType)}`).join(', ');
}
