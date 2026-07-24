// ═══════════════════════════════════════════════════════════════
// dashboard.js — แดชบอร์ดวันนี้: เช็คอิน/เอาท์วันนี้ + ยอดค้าง/ยังไม่ลงระบบ
// ═══════════════════════════════════════════════════════════════
import { listen } from './db.js';
import { el, getSettings } from './ui.js';
import { computeBooking, formatBaht, formatDateTH, todayISO, addDaysISO, nightsBetween } from './calc.js';
import { groomServiceOf, groomServiceLabel } from './config-shop.js';
import { matchCustomer, vaccineStatus } from './customers.js';
import { icons } from './icons.js';
import { runCheckin, runCollectBalance, runCheckout, runMarkDeposit } from './booking-actions.js';
import { openBookingCockpit } from './booking-cockpit.js';

let _unsub = [];
let _appts = [];
let _customers = []; // สำหรับธงวัคซีนในกล่อง "กำลังพักอยู่"

export function renderDashboard(container) {
  _unsub.forEach(u => u()); _unsub = [];

  container.appendChild(el('div', { class: 'page-title' }, [
    el('h1', { text: 'แดชบอร์ดวันนี้' }),
    el('span', { class: 'muted', text: formatDateTH(todayISO()) }),
  ]));
  // แจ้งเตือนใบลงทะเบียนใหม่จากเว็บ (perfectbkk.com/checkin.html)
  const regBanner = el('div', { class: 'promo-banner hidden', style: 'margin-bottom:14px;cursor:pointer' });
  regBanner.onclick = () => window.__go && window.__go('registrations');

  // แจ้งเตือนคำขอจองใหม่จากฟอร์มจองบนเว็บ
  const reqBanner = el('div', { class: 'promo-banner hidden', style: 'margin-bottom:14px;cursor:pointer' });
  reqBanner.onclick = () => window.__go && window.__go('requests');
  _unsub.push(listen('bookingRequests', reqs => {
    const n = reqs.filter(r => (r.status || 'new') === 'new').length;
    reqBanner.innerHTML = '';
    if (!n) { reqBanner.classList.add('hidden'); return; }
    reqBanner.classList.remove('hidden');
    reqBanner.appendChild(el('span', { class: 'promo-text', html:
      `${icons.bookings} มีคำขอจองใหม่จากเว็บ <strong>${n} รายการ</strong> — รอตรวจและสร้างการจอง` }));
    reqBanner.appendChild(el('span', { class: 'btn sm primary', text: 'เปิดดู' }));
  }, { orderBy: null }));

  // แจ้งเตือน "จองใหม่วันนี้ที่ยังรอโอนมัดจำ 50%" — เนื้อหาอัปเดตใน draw()
  // กดแล้วเลื่อนไปที่การ์ด "จองใหม่วันนี้" ในโซนโรงแรม (อยู่หน้าเดียวกัน)
  const depositBanner = el('div', { class: 'promo-banner warn hidden', style: 'margin-bottom:14px;cursor:pointer' });

  const statGrid = el('div', { class: 'stat-grid', style: 'margin-bottom:16px' });
  const body = el('div', {});
  container.append(regBanner, reqBanner, depositBanner, statGrid, body);

  _unsub.push(listen('checkinForms', forms => {
    const n = forms.filter(f => (f.status || 'new') === 'new').length;
    regBanner.innerHTML = '';
    if (!n) { regBanner.classList.add('hidden'); return; }
    regBanner.classList.remove('hidden');
    regBanner.appendChild(el('span', { class: 'promo-text', html:
      `${icons.inbox} มีใบลงทะเบียนเข้าพักใหม่จากเว็บ <strong>${n} ใบ</strong> — กดเพื่อเปิดดู` }));
    regBanner.appendChild(el('span', { class: 'btn sm primary', text: 'เปิดดู' }));
  }, { orderBy: null }));

  // เก็บ bookings ล่าสุดไว้ เพื่อให้ listener ของ appointments วาดใหม่ได้โดยไม่ต้องรอ bookings มาอีกรอบ
  let _bookings = [];
  _unsub.push(listen('bookings', raw => { _bookings = raw.map(computeBooking); draw(_bookings); }));
  _unsub.push(listen('appointments', arr => { _appts = arr; draw(_bookings); }));
  _unsub.push(listen('customers', arr => { _customers = arr; draw(_bookings); }));

  function draw(bookings) {
    const today = todayISO();
    const tomorrow = addDaysISO(today, 1);
    const active = bookings.filter(b => b.depositStatus !== 'ยกเลิก');
    const checkinToday = active.filter(b => b.checkIn === today);
    const checkoutToday = active.filter(b => b.checkOut === today);
    const checkinTomorrow = active.filter(b => b.checkIn === tomorrow);
    const checkoutTomorrow = active.filter(b => b.checkOut === tomorrow);
    const staying = active.filter(b => b.checkIn <= today && today < b.checkOut);
    const unpaid = active.filter(b => b.depositStatus !== 'จ่ายครบแล้ว' && b.grandTotal > 0);
    const notRecorded = active.filter(b => b.recordStatus === 'ยังไม่ลงระบบ');
    // จองใหม่วันนี้ = บันทึกเข้าระบบวันนี้ (เทียบด้วยวันที่ท้องถิ่น กัน off-by-one)
    const newToday = active.filter(b => localDateISO(b.createdAt) === today);
    const pendingDeposit = newToday.filter(b => b.depositStatus === 'ยังไม่มัดจำ');
    // ค้างเท่าไหร่จริง: ยังไม่มัดจำ = ค้างทั้งก้อน · มัดจำแล้ว = ค้างครึ่งหลัง
    const owedOf = b => b.depositStatus === 'มัดจำแล้ว' ? b.balanceDue : b.grandTotal;
    const balanceSum = unpaid.reduce((s, b) => s + owedOf(b), 0);

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

    // แถบเตือนบนสุด: มีจองใหม่วันนี้ที่ยังรอโอนมัดจำ 50% — กันหลุดตอนมีหลายห้อง
    depositBanner.innerHTML = '';
    if (pendingDeposit.length) {
      depositBanner.classList.remove('hidden');
      depositBanner.appendChild(el('span', { class: 'promo-text', html:
        `${icons.banknote} จองใหม่วันนี้ <strong>${newToday.length} รายการ</strong> · รอโอนมัดจำ <strong>${pendingDeposit.length} ราย</strong> — ตรวจสลิปมัดจำ 50%` }));
      depositBanner.appendChild(el('span', { class: 'btn sm primary', text: 'ดูรายการ' }));
    } else {
      depositBanner.classList.add('hidden');
    }

    // จัดเป็นโซนเหมือนหน้า "งานวันนี้" — สีเดียวกันทั้งแอป
    // (เดิมการ์ดทุกใบหน้าตาเหมือนกัน แยกไม่ออกว่าอันไหนงานโรงแรม อันไหนงานอาบน้ำ)
    // แสดงคิวพรุ่งนี้ด้วย เพื่อให้เตรียมของ/จัดคนล่วงหน้าได้ (โซนโรงแรมมีส่วนพรุ่งนี้อยู่แล้ว)
    const groomToday = apptsOfDay(today, 'grooming');
    const groomTomorrow = apptsOfDay(tomorrow, 'grooming');
    const exToday = apptsOfDay(today, 'exercise');
    const exTomorrow = apptsOfDay(tomorrow, 'exercise');

    // การ์ด "จองใหม่วันนี้" — เก็บ ref ไว้ให้แถบเตือนกดแล้วเลื่อนมาหา
    const newCard = newBookingsSection(newToday);
    depositBanner.onclick = () => newCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

    body.innerHTML = '';
    body.append(
      zoneGroup('hotel', icons.home, 'โซนโรงแรม (ห้องพัก)',
        `${newToday.length + checkinToday.length + checkoutToday.length + staying.length} รายการ`, [
        newCard,
        stayingSection(staying),
        section('เช็คอินวันนี้ · เก็บยอดที่เหลือ', checkinToday, 'ไม่มีลูกค้าเข้าพักวันนี้', true, icons.login, 'checkin'),
        section('เช็คเอาท์วันนี้', checkoutToday, 'ไม่มีลูกค้าออกวันนี้', true, icons.logout, 'checkout'),
        section('ค้างชำระ / ยังไม่จ่ายครบ', unpaid, 'ไม่มียอดค้าง', true, icons.banknote, 'pay'),
        // ── ดูล่วงหน้า: เตรียมงานพรุ่งนี้ ──
        section(`พรุ่งนี้เข้าพัก · ${formatDateTH(tomorrow)} — เตรียมห้อง`, checkinTomorrow, 'พรุ่งนี้ไม่มีลูกค้าเข้าพัก', true, icons.calendar),
        section(`พรุ่งนี้เช็คเอาท์ · ${formatDateTH(tomorrow)} — เตรียมเก็บยอด`, checkoutTomorrow, 'พรุ่งนี้ไม่มีลูกค้าออก', true, icons.calendar),
        section('ยังไม่ลงระบบ', notRecorded, 'ลงระบบครบแล้ว', false, icons.alert),
      ]),
      zoneGroup('grooming', icons.star, 'โซน Grooming (อาบน้ำ-ตัดขน)',
        `วันนี้ ${groomToday.length} · พรุ่งนี้ ${groomTomorrow.length}`, [
        apptCard('คิววันนี้', groomToday, 'วันนี้ยังไม่มีคิวอาบน้ำ-ตัดขน', icons.star),
        apptCard(`คิวพรุ่งนี้ · ${formatDateTH(tomorrow)}`, groomTomorrow, 'พรุ่งนี้ยังไม่มีคิวอาบน้ำ-ตัดขน', icons.calendar),
      ]),
      zoneGroup('exercise', icons.paw, 'โซนออกกำลังกาย',
        `วันนี้ ${exToday.length} · พรุ่งนี้ ${exTomorrow.length}`, [
        apptCard('คิววันนี้', exToday, 'วันนี้ยังไม่มีคิวออกกำลังกาย', icons.paw),
        apptCard(`คิวพรุ่งนี้ · ${formatDateTH(tomorrow)}`, exTomorrow, 'พรุ่งนี้ยังไม่มีคิวออกกำลังกาย', icons.calendar),
      ]),
    );
  }

  // กล่องครอบ 1 โซน — หัวแถบสี + ไอคอน + จำนวนงาน
  function zoneGroup(id, ico, title, countText, children) {
    return el('div', { class: `zone-group zone--${id}` }, [
      el('div', { class: 'zone-head' }, [
        el('span', { class: 'zone-ico', html: ico }),
        el('div', { class: 'zone-title', text: title }),
        el('span', { class: 'zone-count', text: countText }),
      ]),
      el('div', { class: 'zone-body' }, children),
    ]);
  }

  function apptsOfDay(today, type) {
    return _appts
      .filter(a => a.date === today && a.type === type && a.status !== 'ยกเลิก')
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }

  // คิวของโซนหนึ่ง เรียงตามรอบเวลา — เจ้าของร้านเห็นยอดด้วย
  function apptCard(title, list, emptyText, ico) {
    const card = el('div', { class: 'card section-card' }, [
      el('h2', { class: 'sec-title' }, [
        el('span', { class: 'sec-ico', html: ico || '' }),
        el('span', { text: `${title} (${list.length})` }),
      ]),
    ]);
    if (!list.length) {
      card.appendChild(el('p', { class: 'muted', style: 'margin:0', text: emptyText }));
      return card;
    }
    list.forEach(a => {
      const detail = a.type === 'exercise'
        ? `ระดับ ${a.level || '-'}`
        : groomServiceLabel(groomServiceOf(a));
      card.appendChild(el('div', { class: 'lineitem' }, [
        el('div', { class: 'li-head' }, [
          el('div', {}, [
            el('strong', { text: `${a.time || '—'} · ${a.petName || a.customerName || '-'}` }),
            el('span', { class: 'muted', style: 'font-size:12px;margin-left:8px', text: a.customerName || '' }),
          ]),
          el('span', { class: 'pill ' + (a.status === 'เสร็จแล้ว' ? 'green' : 'grey'), text: a.status || 'จองแล้ว' }),
        ]),
        el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-top:4px;align-items:center' }, [
          el('span', { class: 'pet-chip pet-' + (a.petType || 'dog'), text: detail }),
          el('span', { class: 'muted', style: 'font-size:12px', text: `ประมาณ ${Math.round((a.durationMin || 60) / 60)} ชม.` }),
          el('strong', { style: 'margin-left:auto', text: formatBaht(a.price) }),
        ]),
      ]));
    });
    return card;
  }

  // ปุ่มลัดเปลี่ยนสถานะเข้าพักจริง — บันทึกเวลาไว้ด้วย (มุมมองแดชบอร์ดอัปเดตเอง)
  // ตรรกะจริงอยู่ที่ booking-actions.js (ใช้ร่วมกับการ์ดรับลูกค้า) — ตรงนี้แค่วางปุ่ม
  // stopPropagation กันไม่ให้กดปุ่มแล้วเผลอเปิดการ์ด cockpit ของทั้งแถวด้วย
  function actionCell(b, mode) {
    const td = el('td', { class: 'num' });
    const time = (ts) => ts ? new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
    if (mode === 'checkin') {
      if (b.stayStatus === 'checked-in' || b.stayStatus === 'checked-out') {
        td.appendChild(el('span', { class: 'pill green', text: `เช็คอินแล้ว ${time(b.checkedInAt)}` }));
        // เตือนถ้าเช็คอินไปแล้วแต่ยังไม่ได้อัปเดตยอด
        if (b.depositStatus !== 'จ่ายครบแล้ว' && b.balanceDue > 0) {
          td.appendChild(el('div', { style: 'margin-top:4px' }, [payNowBtn(b)]));
        }
      } else {
        const btn = el('button', { class: 'btn sm primary', text: 'เช็คอิน' });
        btn.onclick = (e) => { e.stopPropagation(); runCheckin(b); };
        td.appendChild(btn);
      }
    } else if (mode === 'checkout') {
      if (b.stayStatus === 'checked-out') {
        td.appendChild(el('span', { class: 'pill grey', text: `เช็คเอาท์แล้ว ${time(b.checkedOutAt)}` }));
      } else {
        const btn = el('button', { class: 'btn sm primary', text: 'เช็คเอาท์' });
        btn.onclick = (e) => { e.stopPropagation(); runCheckout(b); };
        td.appendChild(btn);
      }
    } else if (mode === 'pay') {
      td.appendChild(payNowBtn(b));
    }
    return td;
  }

  // ปุ่ม "รับเงิน" สำหรับคนที่เช็คอินไปแล้วแต่ยังไม่จ่ายครบ
  function payNowBtn(b) {
    const btn = el('button', { class: 'btn sm danger', text: `รับเงิน ${formatBaht(b.balanceDue)}` });
    btn.onclick = (e) => { e.stopPropagation(); runCollectBalance(b); };
    return btn;
  }

  // สีมาจากโซนที่ครอบอยู่ · ไอคอนบอกประเภทงาน (เดิมใช้สีบอกประเภท ทำให้ชนกับสีโซน)
  function section(title, list, emptyText, showBalance, ico = null, mode = null) {
    const card = el('div', { class: 'card section-card' }, [
      el('h2', { class: 'sec-title' }, [
        el('span', { class: 'sec-ico', html: ico || '' }),
        el('span', { text: `${title} (${list.length})` }),
      ]),
    ]);
    if (!list.length) { card.appendChild(el('p', { class: 'muted', text: emptyText })); return card; }
    // คลิกทั้งแถว → เปิดการ์ดรับลูกค้า (จบงานในจอเดียว) · ปุ่มในแถวมี stopPropagation กันเปิดซ้อน
    const rows = list.map(b => {
      const tr = el('tr', { style: 'cursor:pointer' }, [
        el('td', {}, [el('strong', { text: b.customerName || '-' }), el('div', { class: 'muted', style: 'font-size:12px', text: b.phone || '' })]),
        el('td', { text: `${formatDateTH(b.checkIn)} → ${formatDateTH(b.checkOut)}` }),
        el('td', { text: roomsDesc(b) }),
        el('td', { class: 'num', text: showBalance ? formatBaht(b.balanceDue) : formatBaht(b.grandTotal) }),
        ...(mode ? [actionCell(b, mode)] : []),
      ]);
      tr.onclick = () => openBookingCockpit(b);
      return tr;
    });
    card.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [el('tbody', {}, rows)])]));
    return card;
  }
}

function roomsDesc(b) {
  const s = getSettings();
  return b.lineItems.map(li => `${li.rooms || 1}×${(s?.roomPrices?.[li.roomType]?.label || li.roomType)}`).join(', ');
}

// createdAt เก็บเป็น ISO เวลา UTC → แปลงเป็นวันที่ท้องถิ่น 'YYYY-MM-DD'
// ใช้ trick เดียวกับ todayISO() กัน off-by-one ตอนจองช่วงดึก (เช่น ตี 5 ไทย = เมื่อวานแบบ UTC)
function localDateISO(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}

// กล่อง "จองใหม่วันนี้" — การจองที่เพิ่งเข้าระบบวันนี้ + สถานะมัดจำชัดเจน
// จุดสำคัญ: บอกให้รู้ทันทีว่ารายไหน "รอโอนมัดจำ 50%" อยู่ (แดง) กันหลุดตอนมีหลายห้อง
// แดง=รอโอนมัดจำ (+ปุ่มลัดรับมัดจำ) · เขียว=มัดจำแล้ว/จ่ายครบ · คลิกแถวเปิดการ์ดรับลูกค้า
function newBookingsSection(list) {
  const card = el('div', { class: 'card section-card' }, [
    el('h2', { class: 'sec-title' }, [
      el('span', { class: 'sec-ico', html: icons.bookings }),
      el('span', { text: `จองใหม่วันนี้ (${list.length})` }),
    ]),
  ]);
  if (!list.length) { card.appendChild(el('p', { class: 'muted', style: 'margin:0', text: 'วันนี้ยังไม่มีจองใหม่' })); return card; }

  // ใหม่สุดอยู่บน
  const sorted = [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const rows = sorted.map(b => {
    const statusCell = el('td', { class: 'num' });
    if (b.depositStatus === 'ยังไม่มัดจำ') {
      statusCell.appendChild(el('span', { class: 'pill red', text: 'รอโอนมัดจำ' }));
      const btn = el('button', { class: 'btn sm primary', style: 'margin-top:4px', text: 'รับมัดจำแล้ว' });
      btn.onclick = (e) => { e.stopPropagation(); runMarkDeposit(b); };
      statusCell.appendChild(el('div', {}, [btn]));
    } else if (b.depositStatus === 'จ่ายครบแล้ว') {
      statusCell.appendChild(el('span', { class: 'pill green', text: 'จ่ายครบ' }));
    } else {
      statusCell.appendChild(el('span', { class: 'pill green', text: 'มัดจำแล้ว' }));
    }
    const tr = el('tr', { style: 'cursor:pointer' }, [
      el('td', {}, [el('strong', { text: b.customerName || '-' }), el('div', { class: 'muted', style: 'font-size:12px', text: b.phone || '' })]),
      el('td', { text: roomsDesc(b) }),
      el('td', { text: `${formatDateTH(b.checkIn)} → ${formatDateTH(b.checkOut)}` }),
      el('td', { class: 'num', text: formatBaht(b.depositAmount) }),
      statusCell,
    ]);
    tr.onclick = () => openBookingCockpit(b);
    return tr;
  });
  card.appendChild(el('div', { class: 'table-wrap' }, [
    el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'ลูกค้า' }), el('th', { text: 'ห้อง' }), el('th', { text: 'เข้า–ออก' }),
        el('th', { class: 'num', text: 'มัดจำ 50%' }), el('th', { class: 'num', text: 'สถานะ' }),
      ])]),
      el('tbody', {}, rows),
    ]),
  ]));
  return card;
}

// ธงวัคซีนของลูกค้ารายนี้ (แดง=หมดอายุ · เหลือง=ใกล้หมด) — จับคู่ด้วยเบอร์/ชื่อ
function vaccineFlag(b) {
  const c = _customers.find(x => matchCustomer(b, x));
  if (!c) return null;
  const st = (c.pets || []).map(p => vaccineStatus(p));
  if (st.includes('expired')) return el('span', { class: 'pill red', style: 'margin-left:6px', text: 'วัคซีนหมดอายุ' });
  if (st.includes('soon')) return el('span', { class: 'pill yellow', style: 'margin-left:6px', text: 'วัคซีนใกล้หมด' });
  return null;
}

// กล่อง "กำลังพักอยู่ตอนนี้" — แขกที่อยู่ในร้านวันนี้ เรียงตามใกล้ออกก่อน
// รายละเอียดที่ต้องรู้: อยู่ห้องไหน · ออกวันไหน · คืนที่เท่าไหร่ · ยอดค้างไหม · ธงวัคซีน
// คลิกแถวเปิดการ์ดรับลูกค้า (cockpit) เหมือน section อื่น
function stayingSection(list) {
  const today = todayISO();
  const tomorrow = addDaysISO(today, 1);
  const card = el('div', { class: 'card section-card' }, [
    el('h2', { class: 'sec-title' }, [
      el('span', { class: 'sec-ico', html: icons.home }),
      el('span', { text: `กำลังพักอยู่ตอนนี้ (${list.length})` }),
    ]),
  ]);
  if (!list.length) { card.appendChild(el('p', { class: 'muted', style: 'margin:0', text: 'ตอนนี้ไม่มีแขกพักอยู่' })); return card; }

  const sorted = [...list].sort((a, b) => String(a.checkOut).localeCompare(String(b.checkOut)));
  const rows = sorted.map(b => {
    const total = nightsBetween(b.checkIn, b.checkOut) || 1;
    const nightNo = Math.min(total, Math.max(1, nightsBetween(b.checkIn, today) + 1));
    const paid = b.depositStatus === 'จ่ายครบแล้ว' || b.balanceDue <= 0;

    const nameCell = el('td', {}, [
      el('div', {}, [el('strong', { text: b.customerName || '-' }), vaccineFlag(b)].filter(Boolean)),
      el('div', { class: 'muted', style: 'font-size:12px', text: b.phone || '' }),
    ]);
    const outCell = el('td', {}, [
      el('span', { text: formatDateTH(b.checkOut) }),
      b.checkOut === tomorrow ? el('span', { class: 'pill yellow', style: 'margin-left:6px', text: 'ออกพรุ่งนี้' }) : null,
    ].filter(Boolean));
    const statusCell = el('td', { class: 'num' }, [
      paid ? el('span', { class: 'pill green', text: 'จ่ายครบ' })
        : el('span', { class: 'pill red', text: `ค้าง ${formatBaht(b.balanceDue)}` }),
    ]);
    const tr = el('tr', { style: 'cursor:pointer' }, [
      nameCell,
      el('td', { text: roomsDesc(b) }),
      outCell,
      el('td', { text: `คืนที่ ${nightNo}/${total}` }),
      statusCell,
    ]);
    tr.onclick = () => openBookingCockpit(b);
    return tr;
  });
  card.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [el('tbody', {}, rows)])]));
  return card;
}
