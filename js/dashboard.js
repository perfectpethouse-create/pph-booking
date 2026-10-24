// ═══════════════════════════════════════════════════════════════
// dashboard.js — แดชบอร์ดวันนี้: เช็คอิน/เอาท์วันนี้ + ยอดค้าง/ยังไม่ลงระบบ
// ═══════════════════════════════════════════════════════════════
import { listen } from './db.js';
import { el, getSettings } from './ui.js';
import { computeBooking, formatBaht, todayISO, addDaysISO, nightsBetween } from './calc.js';
import { groomServiceOf, groomServiceLabel, petCountOf, exerciseZoneLabel, capacityOf } from './config-shop.js';
import { shortDate, rangeOf } from './mobile-kit.js';
import { matchCustomer, vaccineStatus } from './customers.js';
import { icons } from './icons.js';
import { runCheckin, runCollectBalance, runCheckout, runMarkDeposit } from './booking-actions.js';
import { openBookingCockpit } from './booking-cockpit.js';
import { mountNewsCard } from './announcements.js';
import { createMobileHome } from './dashboard-mobile.js';

let _unsub = [];
let _appts = [];
let _customers = []; // สำหรับธงวัคซีนในกล่อง "กำลังพักอยู่"

export function renderDashboard(container) {
  _unsub.forEach(u => u()); _unsub = [];

  // มือถือ = หน้าหลักแบบแอป (dashboard-mobile.js) · คอม = แดชบอร์ดเต็มด้านล่าง
  // สลับด้วย CSS (.mhome / .dash-full) — ข้อมูลชุดเดียวกัน ฟังฐานข้อมูลครั้งเดียว
  const mobile = createMobileHome();
  let _newReqs = 0, _newForms = 0;
  let _bookings = []; // ประกาศก่อน listener ใดๆ — mock โหมดยิง callback ทันที
  const full = el('div', { class: 'dash-full' });
  container.append(mobile.node, full);
  container = full;

  container.appendChild(el('div', { class: 'd-top' }, [
    el('h1', { text: 'แดชบอร์ดวันนี้' }),
    el('div', { class: 'd-date', text: new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }),
  ]));
  // แจ้งเตือนใบลงทะเบียนใหม่จากเว็บ (perfectbkk.com/checkin.html)
  const regBanner = el('div', { class: 'promo-banner hidden', style: 'margin-bottom:14px;cursor:pointer' });
  regBanner.onclick = () => window.__go && window.__go('registrations');

  // แจ้งเตือนคำขอจองใหม่จากฟอร์มจองบนเว็บ
  const reqBanner = el('div', { class: 'promo-banner hidden', style: 'margin-bottom:14px;cursor:pointer' });
  reqBanner.onclick = () => window.__go && window.__go('requests');
  _unsub.push(listen('bookingRequests', reqs => {
    const n = reqs.filter(r => (r.status || 'new') === 'new').length;
    _newReqs = n; pushMobile();
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

  const statGrid = el('div', { class: 'd-stats' });
  // 2 คอลัมน์แบบ mockup: ซ้าย = ตารางงานลูกค้า · ขวา = สรุป/ห้องว่าง/คิว/ข่าว
  // การ์ด "ข่าวสารร้าน" อยู่บนสุดของคอลัมน์ขวา (mount ครั้งเดียว ไม่วาดใหม่ตามข้อมูลจอง)
  // จัดการ subscription เอง คืน unsub มาให้เก็บใน _unsub (เคลียร์ตอนกลับเข้าหน้านี้)
  const newsMount = el('div', {});
  const body = el('div', { class: 'd-col' });
  const side = el('div', { class: 'd-col' });
  const sideBody = el('div', { class: 'd-col' });
  side.append(newsMount, sideBody);
  container.append(regBanner, reqBanner, depositBanner, statGrid, el('div', { class: 'd-grid' }, [body, side]));
  _unsub.push(mountNewsCard(newsMount));

  _unsub.push(listen('checkinForms', forms => {
    const n = forms.filter(f => (f.status || 'new') === 'new').length;
    _newForms = n; pushMobile();
    regBanner.innerHTML = '';
    if (!n) { regBanner.classList.add('hidden'); return; }
    regBanner.classList.remove('hidden');
    regBanner.appendChild(el('span', { class: 'promo-text', html:
      `${icons.inbox} มีใบลงทะเบียนเข้าพักใหม่จากเว็บ <strong>${n} ใบ</strong> — กดเพื่อเปิดดู` }));
    regBanner.appendChild(el('span', { class: 'btn sm primary', text: 'เปิดดู' }));
  }, { orderBy: null }));

  // เก็บ bookings ล่าสุดไว้ เพื่อให้ listener ของ appointments วาดใหม่ได้โดยไม่ต้องรอ bookings มาอีกรอบ
  _unsub.push(listen('bookings', raw => { _bookings = raw.map(computeBooking); draw(_bookings); }));
  _unsub.push(listen('appointments', arr => { _appts = arr; draw(_bookings); }));
  _unsub.push(listen('customers', arr => { _customers = arr; draw(_bookings); }));

  function pushMobile() {
    mobile.update({ bookings: _bookings, appts: _appts, newRequests: _newReqs, newForms: _newForms });
  }

  function draw(bookings) {
    pushMobile();
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

    // การ์ดสถิติ 4 ใบ — ใบแรกเป็นสีหลัก (งานสำคัญสุดของวัน) · สีที่เหลือสื่อความหมายเดิม
    // เขียว=เข้าพัก · ส้ม=ออกวันนี้ · ฟ้า=กำลังพัก · แดง=ยอดค้าง
    const inOwed = checkinToday.filter(b => b.depositStatus !== 'จ่ายครบแล้ว').reduce((s, b) => s + owedOf(b), 0);
    statGrid.innerHTML = '';
    [
      ['hero', icons.login, 'วันนี้', checkinToday.length, inOwed ? `เข้าพักวันนี้ · ต้องเก็บยอด ${formatBaht(inOwed)}` : 'เข้าพักวันนี้'],
      ['orange', icons.logout, null, checkoutToday.length, 'เช็คเอาท์วันนี้'],
      ['blue', icons.home, null, staying.length, 'กำลังพักอยู่'],
      ['red', icons.banknote, unpaid.length ? 'ค้าง' : null, formatBaht(balanceSum), `ยอดค้างรับรวม · ${unpaid.length} ราย`],
    ].forEach(([tone, ico, tag, n, l]) => statGrid.appendChild(
      el('div', { class: `d-stat ${tone}` }, [
        el('div', { class: 'd-stat-h' }, [
          el('span', { class: 'd-stat-i', html: ico }),
          tag ? el('span', { class: 'd-stat-tag', text: tag }) : null,
        ].filter(Boolean)),
        el('div', { class: 'd-stat-n', text: String(n) }),
        el('div', { class: 'd-stat-l', text: l }),
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

    const groomToday = apptsOfDay(today, 'grooming');
    const groomTomorrow = apptsOfDay(tomorrow, 'grooming');
    const exToday = apptsOfDay(today, 'exercise');
    const exTomorrow = apptsOfDay(tomorrow, 'exercise');

    // การ์ด "จองใหม่วันนี้" — เก็บ ref ไว้ให้แถบเตือนกดแล้วเลื่อนมาหา
    const newCard = newBookingsSection(newToday);
    depositBanner.onclick = () => newCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const tmr = shortDate(tomorrow);
    body.innerHTML = '';
    body.append(...[
      newCard,
      section('เช็คอินวันนี้ · เก็บยอดที่เหลือ', checkinToday, 'ไม่มีลูกค้าเข้าพักวันนี้', 'เก็บเพิ่ม', b => b.balanceDue, icons.login, 'checkin'),
      section('เช็คเอาท์วันนี้', checkoutToday, 'ไม่มีลูกค้าออกวันนี้', 'ยอดค้าง', b => b.balanceDue, icons.logout, 'checkout'),
      stayingSection(staying),
      section('ค้างชำระ / ยังไม่จ่ายครบ', unpaid, 'ไม่มียอดค้าง', 'ค้าง', owedOf, icons.banknote, 'pay'),
      // ── ดูล่วงหน้า: เตรียมงานพรุ่งนี้ ──
      section(`พรุ่งนี้เข้าพัก · ${tmr} — เตรียมห้อง`, checkinTomorrow, 'พรุ่งนี้ไม่มีลูกค้าเข้าพัก', 'เก็บเพิ่ม', b => b.balanceDue, icons.calendar),
      section(`พรุ่งนี้เช็คเอาท์ · ${tmr} — เตรียมเก็บยอด`, checkoutTomorrow, 'พรุ่งนี้ไม่มีลูกค้าออก', 'ยอดค้าง', b => b.balanceDue, icons.calendar),
      notRecorded.length ? section('ยังไม่ลงระบบ', notRecorded, '', 'ยอดรวม', b => b.grandTotal, icons.alert) : null,
    ].filter(Boolean));

    sideBody.innerHTML = '';
    sideBody.append(...[
      ioCard(checkinToday.length, checkoutToday.length, checkinTomorrow.length, checkoutTomorrow.length),
      roomsCard(staying),
      apptCard('คิวอาบน้ำ-ตัดขน', groomToday, groomTomorrow, 'วันนี้ยังไม่มีคิวอาบน้ำ-ตัดขน', icons.star),
      apptCard('คิวออกกำลังกาย', exToday, exTomorrow, 'วันนี้ยังไม่มีคิวออกกำลังกาย', icons.paw),
    ].filter(Boolean));
  }

  function apptsOfDay(today, type) {
    return _appts
      .filter(a => a.date === today && a.type === type && a.status !== 'ยกเลิก')
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }

  // สรุปจำนวนเข้า–ออก วันนี้เทียบพรุ่งนี้ (ตัวเลขจากรายการเดียวกับตารางฝั่งซ้าย)
  function ioCard(inT, outT, inN, outN) {
    const row = (dot, label, a, b) => el('div', { class: 'd-io-row' }, [
      el('span', { class: 'd-io-l' }, [el('i', { class: `d-dot ${dot}` }), label]),
      el('b', { text: String(a) }), el('b', { text: String(b) }),
    ]);
    return dCard(icons.calendar, 'สรุปเข้า–ออก', 'วันนี้ · พรุ่งนี้', [
      el('div', { class: 'd-io' }, [
        el('div', { class: 'd-io-row d-io-head' }, [el('span', { text: 'รายการ' }), el('span', { text: 'วันนี้' }), el('span', { text: 'พรุ่งนี้' })]),
        row('in', 'เข้าพัก (เช็คอิน)', inT, inN),
        row('out', 'เช็คเอาท์', outT, outN),
      ]),
      el('div', { class: 'd-io-foot' }, [
        el('span', { text: 'รวมงานเข้า–ออก' }),
        el('span', { html: `วันนี้ <b>${inT + outT}</b> · พรุ่งนี้ <b>${inN + outN}</b>` }),
      ]),
    ]);
  }

  // ห้องที่ใช้คืนนี้เทียบความจุใน "ตั้งค่า" — แยกตามประเภทห้อง (ไม่มีความจุ = ไม่แสดงการ์ด)
  function roomsCard(staying) {
    const s = getSettings();
    const types = Object.keys(s?.roomPrices || {});
    const cap = types.reduce((sum, rt) => sum + capacityOf(s?.roomCapacity, rt), 0);
    if (!cap) return null;
    const usedOf = (rt) => staying.reduce((sum, b) =>
      sum + (b.lineItems || []).filter(li => li.roomType === rt).reduce((n, li) => n + (Number(li.rooms) || 1), 0), 0);
    const used = types.reduce((sum, rt) => sum + usedOf(rt), 0);
    const pct = Math.min(100, Math.round(used / cap * 100));
    const donut = el('div', { class: 'd-donut', html:
      `<svg viewBox="0 0 42 42" width="118" height="118" aria-hidden="true">
        <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--fill)" stroke-width="5"></circle>
        <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--accent)" stroke-width="5"
          stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="25" stroke-linecap="${pct ? 'round' : 'butt'}"></circle>
      </svg>` });
    donut.appendChild(el('div', { class: 'd-donut-c' }, [
      el('b', { html: `${used}<span>/${cap}</span>` }), el('small', { text: 'ห้องที่ใช้' }),
    ]));
    const legend = el('div', { class: 'd-occ-leg' }, [
      el('div', { class: 'r' }, [el('i', { class: 'sw on' }), el('span', { text: 'ใช้อยู่' }), el('b', { text: `${used} ห้อง` })]),
      el('div', { class: 'r' }, [el('i', { class: 'sw' }), el('span', { text: used > cap ? 'เกิน' : 'ว่าง' }), el('b', { text: `${Math.abs(cap - used)} ห้อง` })]),
      el('hr'),
      ...types.filter(rt => capacityOf(s?.roomCapacity, rt)).map(rt => el('div', { class: 'r sub' }, [
        el('span', { text: s.roomPrices[rt]?.label || rt }),
        el('b', { html: `${usedOf(rt)}<span>/${capacityOf(s?.roomCapacity, rt)}</span>` }),
      ])),
    ]);
    return dCard(icons.home, 'ห้องพักคืนนี้', `ใช้ ${pct}%`, [el('div', { class: 'd-occ' }, [donut, legend])]);
  }

  // คิวของโซนหนึ่ง เรียงตามรอบเวลา — เจ้าของร้านเห็นยอดด้วย · บรรทัดท้ายบอกจำนวนคิวพรุ่งนี้
  function apptCard(title, list, tomorrowList, emptyText, ico) {
    const rows = list.length ? list.map(a => {
      const detail = a.type === 'exercise'
        ? (a.zone ? exerciseZoneLabel(a.zone) : `ระดับ ${a.level || '-'}`)
        : groomServiceLabel(groomServiceOf(a));
      const n = petCountOf(a);
      return el('div', { class: 'd-q' }, [
        el('span', { class: 'd-q-t', text: a.time || '—' }),
        el('div', { class: 'd-q-i' }, [
          el('b', { text: `${a.petName || a.customerName || '-'}${n > 1 ? ` (${n} ตัว)` : ''}` }),
          el('small', { text: [detail, a.customerName].filter(Boolean).join(' · ') }),
        ]),
        a.status === 'เสร็จแล้ว'
          ? el('span', { class: 'pill green', text: 'เสร็จแล้ว' })
          : Number(a.price) > 0 ? el('span', { class: 'd-q-p', text: formatBaht(a.price) }) : null,
      ].filter(Boolean));
    }) : [el('p', { class: 'd-empty', text: emptyText })];
    const tm = tomorrowList.length
      ? `พรุ่งนี้ ${tomorrowList.length} คิว · ${tomorrowList.map(a => a.time).filter(Boolean).join(', ')}`
      : 'พรุ่งนี้ยังไม่มีคิว';
    return dCard(ico, title, `วันนี้ ${list.length}`, [el('div', { class: 'd-qs' }, rows), el('div', { class: 'd-q-foot', text: tm })]);
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

  // ปุ่มรับเงิน — ยังไม่มัดจำ = "รับมัดจำแล้ว" (balanceDue ตอนนั้นคือแค่ครึ่งหลัง ไม่ใช่ยอดค้างจริง)
  // มัดจำแล้ว = "รับเงิน ฿ยอดที่เหลือ" · ตรงกับหน้าหลักมือถือ
  function payNowBtn(b) {
    if (b.depositStatus === 'ยังไม่มัดจำ') {
      const dep = el('button', { class: 'btn sm danger', text: 'รับมัดจำแล้ว' });
      dep.onclick = (e) => { e.stopPropagation(); runMarkDeposit(b); };
      return dep;
    }
    const btn = el('button', { class: 'btn sm danger', text: `รับเงิน ${formatBaht(b.balanceDue)}` });
    btn.onclick = (e) => { e.stopPropagation(); runCollectBalance(b); };
    return btn;
  }

  // ตารางงานลูกค้า 1 การ์ด — amountOf บอกว่าคอลัมน์เงินแสดงยอดไหน (เก็บเพิ่ม/ค้าง/ยอดรวม)
  function section(title, list, emptyText, amountLabel, amountOf, ico, mode = null) {
    if (!list.length) return dCard(ico, title, '0 รายการ', [el('p', { class: 'd-empty', text: emptyText })]);
    // คลิกทั้งแถว → เปิดการ์ดรับลูกค้า (จบงานในจอเดียว) · ปุ่มในแถวมี stopPropagation กันเปิดซ้อน
    const rows = list.map(b => {
      const tr = el('tr', { style: 'cursor:pointer' }, [
        nameCell(b),
        el('td', { text: roomsDesc(b) }),
        el('td', { text: rangeOf(b) }),
        el('td', { class: 'num', text: formatBaht(amountOf(b)) }),
        ...(mode ? [actionCell(b, mode)] : []),
      ]);
      tr.onclick = () => openBookingCockpit(b);
      return tr;
    });
    return dCard(ico, title, `${list.length} รายการ`, [table(['ลูกค้า', 'ห้อง', 'เข้า–ออก', `#${amountLabel}`, ...(mode ? ['#'] : [])], rows)]);
  }
}

// การ์ดแบบ mockup: หัว (ชิปไอคอน + ชื่อ + จำนวน) แล้วตามด้วยเนื้อหา
function dCard(ico, title, countText, children) {
  return el('div', { class: 'd-card' }, [
    el('div', { class: 'd-card-h' }, [
      el('span', { class: 'd-ci', html: ico || '' }),
      el('h2', { text: title }),
      countText ? el('span', { class: 'd-cnt', text: countText }) : null,
    ].filter(Boolean)),
    ...children.filter(Boolean),
  ]);
}

// หัวคอลัมน์ที่ขึ้นต้นด้วย # = ชิดขวา (ตัวเลข/ปุ่ม)
function table(heads, rows) {
  return el('div', { class: 'table-wrap d-tw' }, [
    el('table', {}, [
      el('thead', {}, [el('tr', {}, heads.map(h => h.startsWith('#')
        ? el('th', { class: 'num', text: h.slice(1) }) : el('th', { text: h })))]),
      el('tbody', {}, rows),
    ]),
  ]);
}

function nameCell(b, extra) {
  return el('td', {}, [
    el('div', { class: 'd-nm' }, [el('strong', { text: b.customerName || '-' }), extra].filter(Boolean)),
    el('div', { class: 'd-sub', text: b.phone || '' }),
  ]);
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
  if (!list.length) return dCard(icons.bookings, 'จองใหม่วันนี้', '0 รายการ', [el('p', { class: 'd-empty', text: 'วันนี้ยังไม่มีจองใหม่' })]);

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
      nameCell(b),
      el('td', { text: roomsDesc(b) }),
      el('td', { text: rangeOf(b) }),
      el('td', { class: 'num', text: formatBaht(b.depositAmount) }),
      statusCell,
    ]);
    tr.onclick = () => openBookingCockpit(b);
    return tr;
  });
  return dCard(icons.bookings, 'จองใหม่วันนี้', `${list.length} รายการ`,
    [table(['ลูกค้า', 'ห้อง', 'เข้า–ออก', '#มัดจำ 50%', '#สถานะ'], rows)]);
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
  if (!list.length) return dCard(icons.home, 'กำลังพักอยู่ตอนนี้', '0 ห้อง', [el('p', { class: 'd-empty', text: 'ตอนนี้ไม่มีแขกพักอยู่' })]);

  const sorted = [...list].sort((a, b) => String(a.checkOut).localeCompare(String(b.checkOut)));
  const rows = sorted.map(b => {
    const total = nightsBetween(b.checkIn, b.checkOut) || 1;
    const nightNo = Math.min(total, Math.max(1, nightsBetween(b.checkIn, today) + 1));
    const paid = b.depositStatus === 'จ่ายครบแล้ว' || b.balanceDue <= 0;

    const outCell = el('td', {}, [
      el('span', { text: shortDate(b.checkOut) }),
      b.checkOut === tomorrow ? el('span', { class: 'pill yellow', style: 'margin-left:6px', text: 'ออกพรุ่งนี้' }) : null,
    ].filter(Boolean));
    const statusCell = el('td', { class: 'num' }, [
      paid ? el('span', { class: 'pill green', text: 'จ่ายครบ' })
        // ยังไม่มัดจำ = ค้างทั้งก้อน (balanceDue คือแค่ครึ่งหลัง) — สูตรเดียวกับยอดค้างรับรวม
        : el('span', { class: 'pill red', text: `ค้าง ${formatBaht(b.depositStatus === 'มัดจำแล้ว' ? b.balanceDue : b.grandTotal)}` }),
    ]);
    const tr = el('tr', { style: 'cursor:pointer' }, [
      nameCell(b, vaccineFlag(b)),
      el('td', { text: roomsDesc(b) }),
      outCell,
      el('td', { text: `คืนที่ ${nightNo}/${total}` }),
      statusCell,
    ]);
    tr.onclick = () => openBookingCockpit(b);
    return tr;
  });
  const rooms = list.reduce((n, b) => n + (b.lineItems || []).reduce((m, li) => m + (Number(li.rooms) || 1), 0), 0);
  return dCard(icons.home, 'กำลังพักอยู่ตอนนี้', `${rooms} ห้อง`,
    [table(['ลูกค้า', 'ห้อง', 'ออก', 'คืนที่', '#สถานะ'], rows)]);
}
