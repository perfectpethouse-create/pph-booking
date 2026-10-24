// ═══════════════════════════════════════════════════════════════
// dashboard-mobile.js — หน้าหลักแบบแอปบนมือถือ (แสดงเฉพาะจอ ≤760px)
// ใช้ข้อมูลชุดเดียวกับแดชบอร์ดคอม (dashboard.js ส่งมาให้) — ไม่ฟังฐานข้อมูลเอง
// ปุ่มทุกปุ่มเรียกฟังก์ชันเดิม (runCheckin / runCheckout / cockpit) ไม่มีตรรกะใหม่
// ═══════════════════════════════════════════════════════════════
import { el, getSettings } from './ui.js';
import { DOW, dateOf, shortDate, longDate, rangeOf, roomsOf, isCat, roomsUsed } from './mobile-kit.js';
import { formatBaht, todayISO, addDaysISO, nightsBetween } from './calc.js';
import { capacityOf, groomServiceOf, groomServiceLabel, exerciseZoneLabel } from './config-shop.js';
import { icons, brandLogo } from './icons.js';
import { runCheckin, runCheckout, runCollectBalance, runMarkDeposit } from './booking-actions.js';
import { openBookingCockpit } from './booking-cockpit.js';

const go = (r) => window.__go && window.__go(r);
const range = rangeOf;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'สวัสดีตอนเช้า' : h < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
}

// สร้างครั้งเดียวต่อการเปิดหน้า · คืน { node, update(data) }
// วันที่เลือกในแถบสัปดาห์ต้องอยู่รอดตอนข้อมูลเรียลไทม์เข้ามาใหม่ จึงเก็บไว้ในตัวแปรนี้
export function createMobileHome() {
  const node = el('div', { class: 'mhome' });
  let selected = todayISO();
  let last = null;

  function update(data) { last = data; draw(); }

  function draw() {
    if (!last) return;
    const { bookings, appts, newRequests, newForms } = last;
    const today = todayISO();
    const active = bookings.filter(b => b.depositStatus !== 'ยกเลิก');
    const ins = (d) => active.filter(b => b.checkIn === d);
    const outs = (d) => active.filter(b => b.checkOut === d);
    const stayingOn = (d) => active.filter(b => b.checkIn <= d && d < b.checkOut);

    const s = getSettings();
    const cap = Object.keys(s?.roomPrices || {}).reduce((sum, rt) => sum + capacityOf(s?.roomCapacity, rt), 0);

    const day = selected;
    const next = addDaysISO(day, 1);
    const inList = ins(day), outList = outs(day), stay = stayingOn(day);
    const used = stay.reduce((sum, b) => sum + roomsUsed(b), 0);
    const isToday = day === today;

    node.innerHTML = '';

    // ── หัว: โลโก้ + คำทักทาย + กล่องคำขอจากเว็บ ──
    const inboxN = newRequests + newForms;
    const inboxBtn = el('button', { class: 'm-icbtn', 'aria-label': `คำขอใหม่จากเว็บ ${inboxN} รายการ`, html: icons.inbox });
    if (inboxN) inboxBtn.appendChild(el('span', { class: 'm-bdg', text: String(inboxN) }));
    inboxBtn.onclick = () => go(newRequests ? 'requests' : 'registrations');
    node.appendChild(el('div', { class: 'm-head' }, [
      el('span', { class: 'm-logo', html: brandLogo }),
      el('div', { class: 'm-hi' }, [el('small', { text: greeting() }), el('b', { text: 'Perfect Pet House' })]),
      inboxBtn,
    ]));

    // ── แถบเลือกวัน 7 วัน (เริ่มวันนี้) — จุดเขียว=มีเข้า · จุดส้ม=มีออก ──
    const week = el('div', { class: 'm-week', role: 'tablist', 'aria-label': 'เลือกวัน' });
    for (let i = 0; i < 7; i++) {
      const iso = addDaysISO(today, i);
      const d = dateOf(iso);
      const dots = el('span', { class: 'm-dots' }, [
        ins(iso).length ? el('i', { class: 'in' }) : null,
        outs(iso).length ? el('i', { class: 'out' }) : null,
      ]);
      const btn = el('button', { class: 'm-day' + (iso === day ? ' on' : ''), role: 'tab', 'aria-selected': String(iso === day) }, [
        el('span', { text: DOW[d.getDay()] }), el('b', { text: String(d.getDate()) }), dots,
      ]);
      btn.onclick = () => { selected = iso; draw(); };
      week.appendChild(btn);
    }
    node.appendChild(week);

    // ── การ์ดหลัก: เข้า / ออก / พักอยู่ ของวันที่เลือก ──
    const pct = cap ? Math.min(100, Math.round(used / cap * 100)) : 0;
    node.appendChild(el('div', { class: 'm-hero' }, [
      el('div', { class: 'm-hero-top' }, [
        el('span', { text: (isToday ? 'วันนี้ · ' : '') + longDate(day) }),
        el('b', { text: 'ห้องพัก' }),
      ]),
      el('div', { class: 'm-nums' }, [
        el('div', {}, [el('b', { text: String(inList.length) }), el('span', { text: 'เช็คอิน' })]),
        el('div', {}, [el('b', { text: String(outList.length) }), el('span', { text: 'เช็คเอาท์' })]),
        el('div', {}, [el('b', { text: String(stay.length) }), el('span', { text: 'พักอยู่' })]),
      ]),
      cap ? el('div', { class: 'm-occ' }, [
        el('div', { class: 'm-bar' }, [el('i', { style: `width:${pct}%` })]),
        el('div', { class: 'm-occ-lb' }, [
          el('span', { text: `ใช้ ${used} จาก ${cap} ห้อง` }),
          el('span', { text: used > cap ? `เกิน ${used - cap}` : `ว่าง ${cap - used}` }),
        ]),
      ]) : null,
    ]));

    // ── แถวสรุปวันถัดไป ──
    node.appendChild(el('div', { class: 'm-next' }, [
      el('div', { class: 'm-next-l' }, [
        el('span', { text: isToday ? 'พรุ่งนี้' : 'วันถัดไป' }),
        el('small', { text: longDate(next) }),
      ]),
      el('span', { class: 'm-chip in', text: `เข้า ${ins(next).length}` }),
      el('span', { class: 'm-chip out', text: `ออก ${outs(next).length}` }),
    ]));

    // ── แจ้งเตือนเรื่องเงินที่ต้องตามวันนี้ ──
    const newToday = active.filter(b => localDateISO(b.createdAt) === today);
    const pendingDeposit = newToday.filter(b => b.depositStatus === 'ยังไม่มัดจำ');
    if (isToday && pendingDeposit.length) {
      node.appendChild(sectionHead('รอโอนมัดจำ', pendingDeposit.length));
      node.appendChild(list(pendingDeposit, b => {
        const btn = el('button', { class: 'm-act', text: 'รับมัดจำแล้ว' });
        btn.onclick = (e) => { e.stopPropagation(); runMarkDeposit(b); };
        return btn;
      }, b => `${roomsOf(b)} · มัดจำ ${formatBaht(b.depositAmount)}`));
    }

    // ── รายชื่อเช็คอิน / เช็คเอาท์ ของวันที่เลือก ──
    node.appendChild(sectionHead(isToday ? 'เช็คอินวันนี้' : `เช็คอิน ${shortDate(day)}`, inList.length));
    node.appendChild(inList.length ? list(inList, b => checkinAction(b, isToday)) : empty('ไม่มีลูกค้าเข้าพัก'));

    node.appendChild(sectionHead(isToday ? 'เช็คเอาท์วันนี้' : `เช็คเอาท์ ${shortDate(day)}`, outList.length));
    node.appendChild(outList.length ? list(outList, b => checkoutAction(b, isToday)) : empty('ไม่มีลูกค้าออก'));

    // ── เรื่องเงิน/งานค้างทั้งร้าน (ไม่ขึ้นกับวันที่เลือก) — เกณฑ์เดียวกับแดชบอร์ดคอม ──
    // ค้างจริง: ยังไม่มัดจำ = ค้างทั้งก้อน · มัดจำแล้ว = ค้างครึ่งหลัง
    const owedOf = (b) => b.depositStatus === 'มัดจำแล้ว' ? b.balanceDue : b.grandTotal;
    const unpaid = active.filter(b => b.depositStatus !== 'จ่ายครบแล้ว' && b.grandTotal > 0)
      .sort((a, b) => String(a.checkIn).localeCompare(String(b.checkIn)));
    const owedSum = unpaid.reduce((sum, b) => sum + owedOf(b), 0);
    node.appendChild(sectionHead(`ค้างชำระ · ${formatBaht(owedSum)}`, unpaid.length));
    node.appendChild(unpaid.length
      ? list(unpaid, b => payBtn(b), b => [`ค้าง ${formatBaht(owedOf(b))} · ${b.depositStatus}`, `${roomsOf(b)} · ${range(b)}`])
      : empty('ไม่มียอดค้าง'));

    const notRecorded = active.filter(b => b.recordStatus === 'ยังไม่ลงระบบ');
    if (notRecorded.length) {
      node.appendChild(sectionHead('ยังไม่ลงระบบ', notRecorded.length));
      node.appendChild(list(notRecorded, () => el('span', { class: 'pill yellow', text: 'ยังไม่ลง' }),
        b => `${roomsOf(b)} · ${range(b)}`));
    }

    // ── คิวบริการของวันที่เลือก (เลื่อนแนวนอน) ──
    const q = appts.filter(a => a.date === day && a.status !== 'ยกเลิก')
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const qHead = sectionHead(isToday ? 'คิวบริการวันนี้' : `คิวบริการ ${shortDate(day)}`, q.length, 'ดูคิว', () => go('appointments'));
    node.appendChild(qHead);
    if (!q.length) node.appendChild(empty('ไม่มีคิว Grooming / ออกกำลังกาย'));
    else node.appendChild(el('div', { class: 'm-hscroll' }, q.map(a => el('div', { class: 'm-qcard' }, [
      el('div', { class: 'm-qt', text: a.time || '—' }),
      el('div', { class: 'm-qz ' + (a.type === 'exercise' ? 'ex' : 'gr'), text: a.type === 'exercise' ? 'ออกกำลังกาย' : 'Grooming' }),
      el('b', { text: a.petName || a.customerName || '-' }),
      el('small', { text: a.type === 'exercise'
        ? (a.zone ? exerciseZoneLabel(a.zone) : `ระดับ ${a.level || '-'}`)
        : groomServiceLabel(groomServiceOf(a)) }),
    ]))));
  }

  function sectionHead(title, n, linkText, onLink) {
    const head = el('div', { class: 'm-sec' }, [el('h3', {}, [title, el('span', { class: 'm-n', text: String(n) })])]);
    if (linkText) {
      const a = el('button', { class: 'm-link', text: linkText });
      a.onclick = onLink;
      head.appendChild(a);
    }
    return head;
  }

  function empty(text) { return el('div', { class: 'm-empty', text }); }

  // แถวลูกค้า: ไอคอนสัตว์ · ชื่อ · ห้อง+วัน · ปุ่มด้านขวา — แตะแถวเปิดการ์ดรับลูกค้า
  function list(items, actionOf, subOf) {
    return el('div', { class: 'm-list' }, items.map(b => {
      const nights = nightsBetween(b.checkIn, b.checkOut) || 1;
      const row = el('div', { class: 'm-row', role: 'button', tabindex: '0' }, [
        el('span', { class: 'm-pet' + (isCat(b) ? ' cat' : ''), html: isCat(b) ? icons.cat : icons.dog }),
        el('div', { class: 'm-tx' }, [
          el('b', { text: b.customerName || '-' }),
          // subOf คืนข้อความเดียว หรือ [บรรทัด1, บรรทัด2] เมื่อมีข้อมูลสำคัญที่ห้ามโดนตัดท้าย
          ...[].concat(subOf ? subOf(b) : [roomsOf(b), `${range(b)} · ${nights} คืน`])
            .map(t => el('small', { text: t })),
        ]),
        actionOf(b),
      ]);
      row.onclick = () => openBookingCockpit(b);
      // คีย์บอร์ด (แท็บเล็ต+คีย์บอร์ดหน้าเคาน์เตอร์) — Enter/Space เปิดเหมือนแตะ · ไม่ดักตอนโฟกัสอยู่ที่ปุ่มในแถว
      row.onkeydown = (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); openBookingCockpit(b); }
      };
      return row;
    }));
  }

  const timeOf = (ts) => ts ? new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
  const done = (text) => el('span', { class: 'm-done', html: icons.check + `<span>${text}</span>` });

  // ปุ่มเช็คอิน/เช็คเอาท์ โผล่เฉพาะ "วันนี้" — วันอื่นแสดงสถานะการเงินแทน กันกดล่วงหน้าผิดวัน
  function checkinAction(b, isToday) {
    if (b.stayStatus === 'checked-in' || b.stayStatus === 'checked-out') {
      if (b.depositStatus !== 'จ่ายครบแล้ว' && b.balanceDue > 0) return payBtn(b);
      return done(timeOf(b.checkedInAt) || 'เข้าแล้ว');
    }
    if (!isToday) return payPill(b);
    const btn = el('button', { class: 'm-act', text: 'เช็คอิน' });
    btn.onclick = (e) => { e.stopPropagation(); runCheckin(b); };
    return btn;
  }
  function checkoutAction(b, isToday) {
    if (b.stayStatus === 'checked-out') return done(timeOf(b.checkedOutAt) || 'ออกแล้ว');
    if (!isToday) return payPill(b);
    const btn = el('button', { class: 'm-act ghost', text: 'เช็คเอาท์' });
    btn.onclick = (e) => { e.stopPropagation(); runCheckout(b); };
    return btn;
  }
  // ยังไม่มัดจำ → ปุ่ม "รับมัดจำแล้ว" (balanceDue ตอนนี้คือแค่ครึ่งหลัง จึงไม่ตรงกับยอดค้างจริง)
  // มัดจำแล้ว → "รับ ฿ยอดที่เหลือ" ตามเดิม
  function payBtn(b) {
    if (b.depositStatus === 'ยังไม่มัดจำ') {
      const dep = el('button', { class: 'm-act warn', text: 'รับมัดจำแล้ว' });
      dep.onclick = (e) => { e.stopPropagation(); runMarkDeposit(b); };
      return dep;
    }
    const btn = el('button', { class: 'm-act warn', text: `รับ ${formatBaht(b.balanceDue)}` });
    btn.onclick = (e) => { e.stopPropagation(); runCollectBalance(b); };
    return btn;
  }
  function payPill(b) {
    if (b.depositStatus === 'จ่ายครบแล้ว') return el('span', { class: 'pill green', text: 'จ่ายครบ' });
    if (b.depositStatus === 'มัดจำแล้ว') return el('span', { class: 'pill yellow', text: 'มัดจำแล้ว' });
    return el('span', { class: 'pill red', text: 'ยังไม่มัดจำ' });
  }

  return { node, update };
}

// เหมือนใน dashboard.js — createdAt (UTC) → วันที่ท้องถิ่น
function localDateISO(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
