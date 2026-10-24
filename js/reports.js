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
import { capacityOf, PAYMENT_METHODS, petCountOf, APPOINTMENT_TYPES } from './config-shop.js';
import { icons } from './icons.js';

let _unsub = [];

export function renderReports(container) {
  _unsub.forEach(u => u()); _unsub = [];

  const monthSel = el('select', { style: 'max-width:200px' });
  const summary = el('div', { class: 'd-stats rep-kpis' });
  const detail = el('div', {});

  // มือถือ: การ์ดสรุปใหญ่ด้านบน (.rep-hero แสดงเฉพาะจอแคบ) · ตาราง/ตัวเลขชุดเดิมทั้งหมดอยู่ใต้การ์ด
  const hero = el('div', { class: 'rep-hero' });
  const page = el('div', { class: 'rep-page' });
  container.appendChild(page);
  page.appendChild(el('div', { class: 'page-title' }, [
    el('div', {}, [el('h1', { text: 'รายงานรายเดือน' }), el('div', { class: 'd-date rep-sub', text: 'สรุปยอดขาย · รายได้ · อัตราเข้าพัก' })]),
    monthSel,
  ]));
  page.append(hero, summary, detail);

  let _bookings = [];
  let _appts = []; // คิว Grooming/ออกกำลังกาย (รายได้บริการ)

  const draw = () => {
    const active = _bookings.filter(b => b.depositStatus !== 'ยกเลิก' && b.checkIn);
    // เดือนที่มีข้อมูล — รวมเดือนที่การจอง "กินเข้าไป" ด้วย (จอง 28 ก.ค.→3 ส.ค. ต้องมี ส.ค. ให้เลือก)
    const monthSet = new Set();
    active.forEach(b => {
      monthSet.add(b.checkIn.slice(0, 7));
      if (b.checkOut) eachDate(b.checkIn, b.checkOut, iso => monthSet.add(iso.slice(0, 7)));
    });
    // รวมเดือนที่มีคิวบริการด้วย — เดือนที่มีแต่ Grooming/ออกกำลังกาย (ไม่มีจองห้อง) ต้องเลือกได้
    const apptActive = _appts.filter(a => a.status !== 'ยกเลิก' && a.date);
    apptActive.forEach(a => monthSet.add(a.date.slice(0, 7)));
    const months = [...monthSet].sort().reverse();
    const cur = monthSel.value || months[0] || '';
    monthSel.innerHTML = '';
    months.forEach(mk => monthSel.appendChild(el('option', { value: mk, text: thMonth(mk) })));
    if (cur) monthSel.value = cur;

    // ── เงิน: อิงเดือนของ check-in ──
    // นับตาม "สถานะที่รับจริง" ไม่ใช่ตัวเลขตามสูตร:
    //   ยังไม่มัดจำ → รับ 0 · ค้างทั้งก้อน
    //   มัดจำแล้ว   → รับมัดจำ · ค้างครึ่งหลัง
    //   จ่ายครบแล้ว → รับเต็ม · ไม่ค้าง
    const inMonth = active.filter(b => b.checkIn.slice(0, 7) === cur);
    const revenue = inMonth.reduce((s, b) => s + b.grandTotal, 0);
    const paidFull = b => b.depositStatus === 'จ่ายครบแล้ว';
    const paidDeposit = b => b.depositStatus === 'มัดจำแล้ว' || paidFull(b);
    const deposit = inMonth.reduce((s, b) => s + (paidDeposit(b) ? b.depositAmount : 0), 0);
    const balance = inMonth.reduce((s, b) =>
      s + (paidFull(b) ? 0 : paidDeposit(b) ? b.balanceDue : b.grandTotal), 0);
    const received = inMonth.reduce((s, b) =>
      s + (paidFull(b) ? b.grandTotal : paidDeposit(b) ? b.depositAmount : 0), 0);
    const discount = inMonth.reduce((s, b) => s + (b.totalDiscount || 0), 0);

    // ── รายได้บริการ (Grooming/ออกกำลังกาย): อิงเดือนของวันนัด ──
    // บริการจ่ายจบครั้งเดียว ไม่มีมัดจำ/ช่องทาง → นับยอดขายจากคิวที่ไม่ถูกยกเลิก
    // "จำนวนตัว" นับตาม petCountOf (1 คิวอาจมีหลายน้อง)
    const apptInMonth = apptActive.filter(a => a.date.slice(0, 7) === cur);
    const serviceRevenue = apptInMonth.reduce((sum, a) => sum + (Number(a.price) || 0), 0);
    const svcByType = {};
    apptInMonth.forEach(a => {
      const t = a.type || 'grooming';
      const g = svcByType[t] || (svcByType[t] = { queues: 0, pets: 0, revenue: 0 });
      g.queues += 1; g.pets += petCountOf(a); g.revenue += Number(a.price) || 0;
    });
    const svcPets = apptInMonth.reduce((sum, a) => sum + petCountOf(a), 0);
    const svcDone = apptInMonth.filter(a => a.status === 'เสร็จแล้ว').length;
    const svcCancelled = _appts.filter(a => a.status === 'ยกเลิก' && a.date && a.date.slice(0, 7) === cur).length;

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

    // การ์ดสรุปบนมือถือ — ใช้ตัวเลขชุดเดียวกับกล่องสถิติด้านล่าง ไม่มีการคำนวณใหม่
    const recvPct = revenue > 0 ? Math.min(100, Math.round(received / revenue * 100)) : 0;
    hero.innerHTML = '';
    hero.append(
      el('div', { class: 'rep-hero-top' }, [el('span', { text: `ยอดขายทั้งร้าน · ${thMonth(cur)}` })]),
      el('div', { class: 'rep-hero-n', text: formatBaht(revenue + serviceRevenue) }),
      el('div', { class: 'rep-hero-split' }, [
        el('div', {}, [el('span', { text: 'ห้องพัก' }), el('b', { text: formatBaht(revenue) })]),
        el('div', {}, [el('span', { text: 'บริการ' }), el('b', { text: formatBaht(serviceRevenue) })]),
        el('div', {}, [el('span', { text: 'เข้าพัก' }), el('b', { text: `${occupancy.toFixed(1)}%` })]),
      ]),
      el('div', { class: 'm-occ' }, [
        el('div', { class: 'm-bar' }, [el('i', { style: `width:${recvPct}%` })]),
        el('div', { class: 'm-occ-lb' }, [
          el('span', { text: `รับแล้ว ${formatBaht(received)}` }),
          el('span', { text: `ค้าง ${formatBaht(balance)}` }),
        ]),
      ]),
    );

    // ── การ์ด KPI 4 ใบ (ตาม reports-mockup) — ใบแรกสีหลัก · ตัวเลขอื่นย้ายไปอยู่ในการ์ดด้านล่างครบทุกตัว ──
    summary.innerHTML = '';
    [
      ['hero', icons.chart, thShort(cur), formatBaht(revenue + serviceRevenue), 'ยอดขายทั้งร้าน · ห้องพัก + บริการ'],
      ['blue', icons.bookings, null, String(inMonth.length), 'การจองห้องพัก'],
      ['green', icons.home, 'เข้าพัก', `${occupancy.toFixed(1)}%`, 'อัตราเข้าพักเฉลี่ย'],
      ['red', icons.alert, balance > 0 ? 'ค้าง' : null, formatBaht(balance), 'ยอดค้างรับ (ห้องพัก)'],
    ].forEach(([tone, ico, tag, n, l]) => summary.appendChild(
      el('div', { class: `d-stat ${tone}` }, [
        el('div', { class: 'd-stat-h' }, [
          el('span', { class: 'd-stat-i', html: ico }),
          tag ? el('span', { class: 'd-stat-tag', text: tag }) : null,
        ].filter(Boolean)),
        el('div', { class: 'd-stat-n', text: n }),
        el('div', { class: 'd-stat-l', text: l }),
      ])
    ));

    detail.innerHTML = '';
    const left = el('div', { class: 'd-col' });
    const right = el('div', { class: 'd-col' });
    detail.appendChild(el('div', { class: 'd-grid' }, [left, right]));

    // ── รายได้แยกหมวด: ห้องพัก vs บริการ (โดนัท 2 สี) ──
    const total = revenue + serviceRevenue;
    const roomPct = total > 0 ? Math.round(revenue / total * 100) : 0;
    const donut = el('div', { class: 'd-donut', html:
      `<svg viewBox="0 0 42 42" width="118" height="118" aria-hidden="true">
        <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--fill)" stroke-width="5"></circle>
        ${total > 0 ? `<circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--accent)" stroke-width="5" stroke-dasharray="${roomPct} ${100 - roomPct}" stroke-dashoffset="25"></circle>
        <circle cx="21" cy="21" r="15.915" fill="none" stroke="#0A84FF" stroke-width="5" stroke-dasharray="${100 - roomPct} ${roomPct}" stroke-dashoffset="${25 - roomPct}"></circle>` : ''}
      </svg>` });
    donut.appendChild(el('div', { class: 'd-donut-c' }, [
      el('b', { style: 'font-size:18px', text: shortBaht(total) }), el('small', { text: 'รายได้รวม' }),
    ]));
    left.appendChild(repCard(icons.chart, 'รายได้แยกหมวด', [el('div', { class: 'd-occ' }, [donut, el('div', { class: 'd-occ-leg' }, [
      el('div', { class: 'r' }, [el('i', { class: 'sw on' }), el('span', { text: 'ห้องพัก' }), el('b', { text: formatBaht(revenue) })]),
      el('div', { class: 'r' }, [el('i', { class: 'sw', style: 'background:#0A84FF' }), el('span', { text: 'บริการ (Grooming/เล่น)' }), el('b', { text: formatBaht(serviceRevenue) })]),
    ])])]));

    // ── อัตราเข้าพักแยกประเภทห้อง ──
    const occRows = roomTypes.map(rt => {
      const capN = capacityOf(capacity, rt) * daysInMonth;
      const used = roomNightsInMonth[rt] || 0;
      const pct = capN > 0 ? (used / capN) * 100 : 0;
      return el('tr', {}, [
        el('td', { text: s?.roomPrices?.[rt]?.label || rt }),
        el('td', { class: 'num', text: `${used} / ${capN}` }),
        // แถบกราฟซ่อนบนมือถือ (จอแคบ ตารางจะล้น) — ตัวเลข % ยังอยู่ครบ
        el('td', { class: 'bar-cell' }, [el('div', { class: 'bar' }, [el('div', { class: 'bar-fill', style: `width:${Math.min(100, pct)}%` })])]),
        el('td', { class: 'num', text: `${pct.toFixed(1)}%` }),
      ]);
    });
    left.appendChild(repCard(icons.home, 'อัตราเข้าพักแยกประเภทห้อง', occRows.length && daysInMonth ? [
      tableOf(['ประเภทห้อง', '#ห้อง-คืน / ขายได้', '', '#อัตรา'], occRows),
      note(`* ขายได้ = ความจุรวม ${totalCapacity} ห้อง × ${daysInMonth} วัน = ${capacityNights} ห้อง-คืน · ปรับความจุที่หน้า "ตั้งค่า" · คืนที่คร่อมเดือนถูกนับเข้าเดือนที่นอนจริง`),
    ] : [note('ยังไม่มีข้อมูลในเดือนนี้')]));

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
    left.appendChild(repCard(icons.bookings, 'รายได้แยกประเภทห้อง', rows.length ? [
      tableOf(['ประเภทห้อง', '#คืน-ห้อง', '#ยอด (หลังลด)'], rows),
      note('* ยอดเงินคิดจากการจองที่มี Check-in ในเดือนที่เลือก · ไม่รวมการจองที่ยกเลิก'),
    ] : [note('ยังไม่มีข้อมูลในเดือนนี้')]));

    // ── รายได้บริการ (Grooming & ออกกำลังกาย) ──
    const svcRows = APPOINTMENT_TYPES.filter(t => svcByType[t.id]).map(t => {
      const v = svcByType[t.id];
      return el('tr', {}, [
        el('td', { text: t.label }),
        el('td', { class: 'num', text: String(v.queues) }),
        el('td', { class: 'num', text: String(v.pets) }),
        el('td', { class: 'num', text: formatBaht(v.revenue) }),
      ]);
    });
    left.appendChild(repCard(icons.star, 'รายได้บริการ (Grooming & ออกกำลังกาย)', svcRows.length ? [
      tableOf(['ประเภทบริการ', '#จำนวนคิว', '#จำนวนตัว', '#ยอดขาย'], svcRows, [
        el('td', {}, [el('strong', { text: 'รวมบริการ' })]),
        el('td', { class: 'num' }, [el('strong', { text: String(apptInMonth.length) })]),
        el('td', { class: 'num' }, [el('strong', { text: String(svcPets) })]),
        el('td', { class: 'num' }, [el('strong', { text: formatBaht(serviceRevenue) })]),
      ]),
      note(`* นับจากคิวที่ไม่ถูกยกเลิก · อ้างเดือนของวันนัด · เสร็จแล้ว ${svcDone} คิว`
        + `${svcCancelled ? ` · ยกเลิก ${svcCancelled} คิว (ไม่นับในยอด)` : ''}`
        + ' · บริการจ่ายจบครั้งเดียว จึงไม่แยกช่องทางรับเงิน'),
    ] : [note('ยังไม่มีคิวบริการในเดือนนี้')]));

    // ── การเงิน (ห้องพัก) — ตัวเลขชุดเดิม: รับจริง / รับมัดจำ / ค้างรับ / ส่วนลด ──
    const fin = (dot, label, v, cls) => el('div', { class: 'd-fin' }, [
      el('span', {}, [el('i', { class: 'd-dot', style: `background:${dot}` }), label]),
      el('b', { class: cls || '', text: formatBaht(v) }),
    ]);
    right.appendChild(repCard(icons.banknote, 'การเงิน (ห้องพัก)', [el('div', { class: 'd-fins' }, [
      fin('var(--green)', 'รับเงินแล้วจริง', received),
      fin('#0A84FF', 'รับมัดจำแล้ว', deposit),
      fin('var(--red)', 'ยอดค้างรับ', balance, balance > 0 ? 'owe' : ''),
      fin('var(--orange)', 'รวมส่วนลด', discount),
    ])]));

    // ── รับเงินตามช่องทาง (ไว้กระทบยอดกับบัญชี/เงินสดหน้าร้าน) ──
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
      right.appendChild(repCard(icons.banknote, 'ช่องทางรับเงิน', [
        el('div', { class: 'd-bars' }, methodKeys.map(k => {
          const pct = (byMethod[k] / totalPaid) * 100;
          return el('div', { class: 'd-barrow' }, [
            el('span', { class: 'bl', text: k }),
            el('span', { class: 'bt' }, [el('i', { style: `width:${pct}%` })]),
            el('span', { class: 'bv', text: `${pct.toFixed(1)}%` }),
            el('b', { text: formatBaht(byMethod[k]) }),
          ]);
        })),
        el('div', { class: 'd-io-foot' }, [el('span', { text: 'รวมรับจริง' }), el('b', { text: formatBaht(totalPaid) })]),
        note('* นับเฉพาะเงินที่รับแล้วจริง (มัดจำ + ยอดคงเหลือที่ปิดแล้ว) · "ไม่ระบุ" = รายการเก่าก่อนมีระบบบันทึกช่องทาง'),
      ]));
    } else {
      right.appendChild(repCard(icons.banknote, 'ช่องทางรับเงิน', [note('ยังไม่มีการรับเงินในเดือนนี้')]));
    }
  };

  monthSel.onchange = draw;
  _unsub.push(listen('bookings', arr => { _bookings = arr.map(computeBooking); draw(); }));
  _unsub.push(listen('appointments', arr => { _appts = arr; draw(); }));
}

function thMonth(mk) {
  if (!mk) return '-';
  const [y, m] = mk.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}

// "ต.ค. 69" — ป้ายเดือนบนการ์ด KPI
function thShort(mk) {
  if (!mk) return '';
  const [y, m] = mk.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
}

// "฿248.6k" — ตัวเลขกลางโดนัท (พื้นที่แคบ) · ยอดเต็มอยู่ในคำอธิบายข้างๆ เสมอ
function shortBaht(n) {
  return n >= 1000 ? `฿${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : formatBaht(n);
}

// การ์ดแบบเดียวกับแดชบอร์ดคอม: หัว (ชิปไอคอน + ชื่อ) แล้วตามด้วยเนื้อหา
function repCard(ico, title, children) {
  return el('div', { class: 'd-card' }, [
    el('div', { class: 'd-card-h' }, [el('span', { class: 'd-ci', html: ico }), el('h2', { text: title })]),
    ...children,
  ]);
}

// หัวคอลัมน์ที่ขึ้นต้นด้วย # = ชิดขวา · หัวว่าง = คอลัมน์แถบกราฟ (ซ่อนบนมือถือ)
function tableOf(heads, rows, footCells) {
  return el('div', { class: 'table-wrap d-tw' }, [el('table', {}, [
    el('thead', {}, [el('tr', {}, heads.map(h => h.startsWith('#') ? el('th', { class: 'num', text: h.slice(1) })
      : h ? el('th', { text: h }) : el('th', { class: 'bar-cell' })))]),
    el('tbody', {}, rows),
    footCells ? el('tfoot', {}, [el('tr', {}, footCells)]) : null,
  ].filter(Boolean))]);
}

function note(text) { return el('p', { class: 'd-note', text }); }
