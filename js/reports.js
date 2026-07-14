// ═══════════════════════════════════════════════════════════════
// reports.js — รายงานรายเดือน: ยอดจอง/มัดจำ/รายได้ แยกตามเดือน
// อ้างอิงเดือนจาก "วันที่ Check-in" (เดือนที่เกิดการเข้าพัก)
// ═══════════════════════════════════════════════════════════════
import { listen } from './db.js';
import { el, getSettings } from './ui.js';
import { computeBooking, formatBaht } from './calc.js';

let _unsub = [];

export function renderReports(container) {
  _unsub.forEach(u => u()); _unsub = [];

  const monthSel = el('select', { style: 'max-width:200px' });
  const summary = el('div', { class: 'stat-grid', style: 'margin-bottom:16px' });
  const detail = el('div', {});

  container.appendChild(el('div', { class: 'page-title' }, [
    el('h1', { text: 'รายงานรายเดือน' }), monthSel,
  ]));
  container.append(summary, detail);

  let _bookings = [];

  const draw = () => {
    const active = _bookings.filter(b => b.depositStatus !== 'ยกเลิก' && b.checkIn);
    // เดือนที่มีข้อมูล
    const months = [...new Set(active.map(b => b.checkIn.slice(0, 7)))].sort().reverse();
    const cur = monthSel.value || months[0] || '';
    monthSel.innerHTML = '';
    months.forEach(mk => monthSel.appendChild(el('option', { value: mk, text: thMonth(mk), ...(mk === cur ? { selected: '' } : {}) })));
    if (cur) monthSel.value = cur;

    const inMonth = active.filter(b => b.checkIn.slice(0, 7) === cur);
    const revenue = inMonth.reduce((s, b) => s + b.grandTotal, 0);
    const deposit = inMonth.reduce((s, b) => s + b.depositAmount, 0);
    const balance = inMonth.reduce((s, b) => s + b.balanceDue, 0);
    const discount = inMonth.reduce((s, b) => s + (b.totalDiscount || 0), 0);
    const nights = inMonth.reduce((s, b) => s + b.lineItems.reduce((n, li) => n + (Number(li.rooms) || 0) * (Number(li.nights) || 0), 0), 0);

    summary.innerHTML = '';
    [
      ['จำนวนการจอง', inMonth.length],
      ['รายได้รวม (ยอดเต็ม)', formatBaht(revenue)],
      ['รับมัดจำแล้ว', formatBaht(deposit)],
      ['ยอดค้างรับ', formatBaht(balance)],
      ['รวมส่วนลด', formatBaht(discount)],
      ['คืน-ห้อง รวม', nights],
    ].forEach(([l, n]) => summary.appendChild(
      el('div', { class: 'stat' }, [el('div', { class: 'n', text: String(n) }), el('div', { class: 'l', text: l })])
    ));

    // แยกตามประเภทห้อง
    const s = getSettings();
    const byRoom = {};
    inMonth.forEach(b => b.lineItems.forEach(li => {
      byRoom[li.roomType] = byRoom[li.roomType] || { rooms: 0, revenue: 0 };
      byRoom[li.roomType].rooms += (Number(li.rooms) || 0) * (Number(li.nights) || 0);
      byRoom[li.roomType].revenue += li.subtotal || 0;
    }));

    detail.innerHTML = '';
    const rows = Object.entries(byRoom).map(([rt, v]) => el('tr', {}, [
      el('td', { text: s?.roomPrices?.[rt]?.label || rt }),
      el('td', { class: 'num', text: String(v.rooms) }),
      el('td', { class: 'num', text: formatBaht(v.revenue) }),
    ]));
    const card = el('div', { class: 'card' }, [el('h2', { text: 'แยกตามประเภทห้อง' })]);
    if (rows.length) {
      const head = el('tr', {}, [el('th', { text: 'ประเภทห้อง' }), el('th', { class: 'num', text: 'คืน-ห้อง' }), el('th', { class: 'num', text: 'ยอด (หลังลด)' })]);
      card.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [el('thead', {}, [head]), el('tbody', {}, rows)])]));
    } else {
      card.appendChild(el('p', { class: 'muted', text: 'ยังไม่มีข้อมูลในเดือนนี้' }));
    }
    detail.appendChild(card);
    detail.appendChild(el('p', { class: 'muted', style: 'font-size:12px', text: '* รายได้คิดจากยอดเต็มของการจองที่มี Check-in ในเดือนที่เลือก · ไม่รวมการจองที่ยกเลิก' }));
  };

  monthSel.onchange = draw;
  _unsub.push(listen('bookings', arr => { _bookings = arr.map(computeBooking); draw(); }));
}

function thMonth(mk) {
  if (!mk) return '-';
  const [y, m] = mk.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}
