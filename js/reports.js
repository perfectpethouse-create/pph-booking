// ═══════════════════════════════════════════════════════════════
// reports.js — รายงานรายเดือน: ยอดจอง/มัดจำ/รายได้ + อัตราเข้าพัก + ช่องทางรับเงิน
//
// หมายเหตุสำคัญเรื่องการนับ (ต่างกัน 2 แบบโดยตั้งใจ):
//  · ยอดเงิน (รายได้/มัดจำ) อิง "เดือนของวัน Check-in" — 1 การจอง = 1 ก้อน ไม่ซอย
//  · อัตราเข้าพัก (Occupancy) อิง "คืนที่นอนจริงรายวัน" — การจองคร่อมเดือนถูกกระจาย
//    เข้าแต่ละเดือนตามจริงด้วย eachDate ไม่งั้นเดือนที่คร่อมจะถูกนับเกิน
// ═══════════════════════════════════════════════════════════════
import { listen } from './db.js';
import { el, getSettings } from './ui.js';
import { computeBooking, formatBaht, eachDate } from './calc.js';
import { capacityOf, PAYMENT_METHODS } from './config-shop.js';
import { icons } from './icons.js';

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
    // เดือนที่มีข้อมูล — รวมเดือนที่การจอง "กินเข้าไป" ด้วย (จอง 28 ก.ค.→3 ส.ค. ต้องมี ส.ค. ให้เลือก)
    const monthSet = new Set();
    active.forEach(b => {
      monthSet.add(b.checkIn.slice(0, 7));
      if (b.checkOut) eachDate(b.checkIn, b.checkOut, iso => monthSet.add(iso.slice(0, 7)));
    });
    const months = [...monthSet].sort().reverse();
    const cur = monthSel.value || months[0] || '';
    monthSel.innerHTML = '';
    months.forEach(mk => monthSel.appendChild(el('option', { value: mk, text: thMonth(mk) })));
    if (cur) monthSel.value = cur;

    // ── เงิน: อิงเดือนของ check-in ──
    const inMonth = active.filter(b => b.checkIn.slice(0, 7) === cur);
    const revenue = inMonth.reduce((s, b) => s + b.grandTotal, 0);
    const deposit = inMonth.reduce((s, b) => s + b.depositAmount, 0);
    const balance = inMonth.reduce((s, b) => s + b.balanceDue, 0);
    const discount = inMonth.reduce((s, b) => s + (b.totalDiscount || 0), 0);

    // ── อัตราเข้าพัก: นับคืนที่นอนจริงในเดือนนี้ (กระจายรายวัน) ──
    const s = getSettings();
    const roomNightsInMonth = {}; // roomType -> ห้อง-คืนที่ตกในเดือน cur
    let totalRoomNights = 0;
    active.forEach(b => {
      if (!b.checkOut) return;
      eachDate(b.checkIn, b.checkOut, iso => {
        if (iso.slice(0, 7) !== cur) return; // นับเฉพาะคืนที่ตกในเดือนที่เลือก
        b.lineItems.forEach(li => {
          const n = Number(li.rooms) || 0;
          roomNightsInMonth[li.roomType] = (roomNightsInMonth[li.roomType] || 0) + n;
          totalRoomNights += n;
        });
      });
    });

    const daysInMonth = cur ? new Date(Number(cur.slice(0, 4)), Number(cur.slice(5, 7)), 0).getDate() : 0;
    const capacity = s?.roomCapacity || {};
    const roomTypes = Object.keys(s?.roomPrices || {});
    const totalCapacity = roomTypes.reduce((sum, rt) => sum + capacityOf(capacity, rt), 0);
    const capacityNights = totalCapacity * daysInMonth; // ห้อง-คืนที่ขายได้ทั้งเดือน
    const occupancy = capacityNights > 0 ? (totalRoomNights / capacityNights) * 100 : 0;

    summary.innerHTML = '';
    [
      ['จำนวนการจอง', String(inMonth.length), icons.bookings, 'blue'],
      ['รายได้รวม (ยอดเต็ม)', formatBaht(revenue), icons.banknote, 'green'],
      ['รับมัดจำแล้ว', formatBaht(deposit), icons.check, 'green'],
      ['ยอดค้างรับ', formatBaht(balance), icons.alert, 'red'],
      ['รวมส่วนลด', formatBaht(discount), icons.star, 'orange'],
      ['อัตราเข้าพัก', `${occupancy.toFixed(1)}%`, icons.chart, 'purple'],
    ].forEach(([l, n, ico, color]) => summary.appendChild(
      el('div', { class: `stat stat--${color}` }, [
        el('div', { class: 'stat-ico', html: ico }),
        el('div', {}, [el('div', { class: 'n', text: n }), el('div', { class: 'l', text: l })]),
      ])
    ));

    detail.innerHTML = '';

    // ── อัตราเข้าพักแยกประเภทห้อง ──
    const occCard = el('div', { class: 'card' }, [el('h2', { text: 'อัตราเข้าพักแยกประเภทห้อง' })]);
    const occRows = roomTypes.map(rt => {
      const capN = capacityOf(capacity, rt) * daysInMonth;
      const used = roomNightsInMonth[rt] || 0;
      const pct = capN > 0 ? (used / capN) * 100 : 0;
      return el('tr', {}, [
        el('td', { text: s?.roomPrices?.[rt]?.label || rt }),
        el('td', { class: 'num', text: `${used} / ${capN}` }),
        el('td', {}, [el('div', { class: 'bar' }, [el('div', { class: 'bar-fill', style: `width:${Math.min(100, pct)}%` })])]),
        el('td', { class: 'num', text: `${pct.toFixed(1)}%` }),
      ]);
    });
    if (occRows.length && daysInMonth) {
      occCard.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'ประเภทห้อง' }), el('th', { class: 'num', text: 'ห้อง-คืน / ขายได้' }),
          el('th', { text: '' }), el('th', { class: 'num', text: 'อัตรา' }),
        ])]),
        el('tbody', {}, occRows),
      ])]));
      occCard.appendChild(el('p', { class: 'muted', style: 'font-size:12px', text:
        `* ขายได้ = ความจุรวม ${totalCapacity} ห้อง × ${daysInMonth} วัน = ${capacityNights} ห้อง-คืน · ปรับความจุที่หน้า "ตั้งค่า" · คืนที่คร่อมเดือนถูกนับเข้าเดือนที่นอนจริง` }));
    } else {
      occCard.appendChild(el('p', { class: 'muted', text: 'ยังไม่มีข้อมูลในเดือนนี้' }));
    }
    detail.appendChild(occCard);

    // ── รับเงินตามช่องทาง (ไว้กระทบยอดกับบัญชี/เงินสดหน้าร้าน) ──
    const payCard = el('div', { class: 'card' }, [el('h2', { text: 'รับเงินตามช่องทาง' })]);
    const byMethod = {};
    const addPay = (method, amount) => {
      if (!amount) return;
      const k = method || 'ไม่ระบุ';
      byMethod[k] = (byMethod[k] || 0) + amount;
    };
    inMonth.forEach(b => {
      // มัดจำ: รับแล้วเมื่อสถานะ "มัดจำแล้ว" หรือ "จ่ายครบแล้ว"
      if (b.depositStatus === 'มัดจำแล้ว' || b.depositStatus === 'จ่ายครบแล้ว') {
        addPay(b.depositMethod, b.depositAmount);
      }
      // ยอดคงเหลือ: รับแล้วเมื่อ "จ่ายครบแล้ว" เท่านั้น
      if (b.depositStatus === 'จ่ายครบแล้ว') addPay(b.balanceMethod, b.balanceDue);
    });
    const methodKeys = [...PAYMENT_METHODS, 'ไม่ระบุ'].filter(k => byMethod[k]);
    if (methodKeys.length) {
      const totalPaid = methodKeys.reduce((sum, k) => sum + byMethod[k], 0);
      payCard.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'ช่องทาง' }), el('th', { class: 'num', text: 'ยอดรับ' }), el('th', { class: 'num', text: 'สัดส่วน' }),
        ])]),
        el('tbody', {}, methodKeys.map(k => el('tr', {}, [
          el('td', { text: k }),
          el('td', { class: 'num', text: formatBaht(byMethod[k]) }),
          el('td', { class: 'num', text: `${((byMethod[k] / totalPaid) * 100).toFixed(1)}%` }),
        ]))),
        el('tfoot', {}, [el('tr', {}, [
          el('td', {}, [el('strong', { text: 'รวมรับจริง' })]),
          el('td', { class: 'num' }, [el('strong', { text: formatBaht(totalPaid) })]),
          el('td', {}),
        ])]),
      ])]));
      payCard.appendChild(el('p', { class: 'muted', style: 'font-size:12px', text:
        '* นับเฉพาะเงินที่รับแล้วจริง (มัดจำ + ยอดคงเหลือที่ปิดแล้ว) · "ไม่ระบุ" = รายการเก่าก่อนมีระบบบันทึกช่องทาง' }));
    } else {
      payCard.appendChild(el('p', { class: 'muted', text: 'ยังไม่มีการรับเงินในเดือนนี้' }));
    }
    detail.appendChild(payCard);

    // ── รายได้แยกประเภทห้อง ──
    const byRoom = {};
    inMonth.forEach(b => b.lineItems.forEach(li => {
      byRoom[li.roomType] = byRoom[li.roomType] || { rooms: 0, revenue: 0 };
      byRoom[li.roomType].rooms += (Number(li.rooms) || 0) * (Number(li.nights) || 0);
      byRoom[li.roomType].revenue += li.subtotal || 0;
    }));
    const rows = Object.entries(byRoom).map(([rt, v]) => el('tr', {}, [
      el('td', { text: s?.roomPrices?.[rt]?.label || rt }),
      el('td', { class: 'num', text: String(v.rooms) }),
      el('td', { class: 'num', text: formatBaht(v.revenue) }),
    ]));
    const card = el('div', { class: 'card' }, [el('h2', { text: 'รายได้แยกประเภทห้อง' })]);
    if (rows.length) {
      const head = el('tr', {}, [el('th', { text: 'ประเภทห้อง' }), el('th', { class: 'num', text: 'คืน-ห้อง' }), el('th', { class: 'num', text: 'ยอด (หลังลด)' })]);
      card.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [el('thead', {}, [head]), el('tbody', {}, rows)])]));
    } else {
      card.appendChild(el('p', { class: 'muted', text: 'ยังไม่มีข้อมูลในเดือนนี้' }));
    }
    detail.appendChild(card);
    detail.appendChild(el('p', { class: 'muted', style: 'font-size:12px', text: '* ยอดเงินคิดจากการจองที่มี Check-in ในเดือนที่เลือก · ไม่รวมการจองที่ยกเลิก' }));
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
