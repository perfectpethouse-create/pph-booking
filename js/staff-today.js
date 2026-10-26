// ═══════════════════════════════════════════════════════════════
// staff-today.js — หน้า "งานวันนี้" สำหรับพี่เลี้ยง (ไม่มีข้อมูลยอดเงินใดๆ)
// เน้นสิ่งที่คนดูแลสัตว์ต้องรู้: ใครเข้า/ออก/พักอยู่ · น้องชื่ออะไร · ต้องระวังอะไร
// ═══════════════════════════════════════════════════════════════
import { listen } from './db.js';
import { el, getSettings, escapeHtml, staffCan } from './ui.js';
import { computeBooking, formatDateTH, todayISO, addDaysISO } from './calc.js';
import { resolvePetInfo, worstVaccine, regStateOf } from './pet-info.js';
import { groomServiceOf, groomServiceLabel, petCountOf, exerciseZoneLabel } from './config-shop.js';
import { icons, brandLogo } from './icons.js';
import { mountNewsCard } from './announcements.js';
import { shortDate, longDate, rangeOf, roomsOf, isCat } from './mobile-kit.js';
import { openGuestCheckin, openFormDetail, printRegistration } from './registrations.js';
import { buildIntakeSheet, printSheet } from './intake-form.js';
import { apptStatusControl } from './appointments.js';

let _unsub = [];
let _customers = [];
let _appts = [];
let _checkinForms = []; // ใบลงทะเบียนเช็คอิน — ใช้ดึงข้อมูลน้องแม้ยังไม่นำเข้าโปรไฟล์

const PET_ICONS = { dog: icons.dog, cat: icons.cat };

// ห้องที่ต้องดูแลแยกสุนัข/แมว ของรายการจองชุดหนึ่ง
function roomsByPet(list) {
  const n = { dog: 0, cat: 0 };
  list.forEach(b => b.lineItems.forEach(li => { n[li.petType === 'cat' ? 'cat' : 'dog'] += Number(li.rooms) || 0; }));
  return n;
}

export function renderStaffToday(container) {
  _unsub.forEach(u => u()); _unsub = [];

  container.appendChild(el('div', { class: 'd-top today-full' }, [
    el('h1', { text: 'งานวันนี้' }),
    el('div', { class: 'd-date', text: new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }),
  ]));
  // หัวแบบแอป (มือถือ) — โลโก้ร้าน + ชื่อหน้า + วันที่
  container.appendChild(el('div', { class: 'mtoday m-head' }, [
    el('span', { class: 'm-logo', html: brandLogo }),
    el('div', { class: 'm-hi' }, [el('small', { text: longDate(todayISO()) }), el('b', { text: 'งานวันนี้' })]),
  ]));
  // การ์ด "ข่าวสารร้าน" บนสุด — ให้พี่เลี้ยงเห็นประกาศ/โปรฯ ก่อนเริ่มงาน (หน้าแรกของพี่เลี้ยง)
  // ใช้ร่วมกันทั้งคอมและมือถือ จึงอยู่นอกกล่องของทั้งสองแบบ
  const newsMount = el('div', { style: 'margin-bottom:16px' });
  // แถบเตือน "พรุ่งนี้ยังไม่ลงทะเบียน" — พี่เลี้ยงต้องรู้ข้อมูลน้องภายในคืนก่อนเข้าพัก
  const regAlert = el('div');
  const statGrid = el('div', { class: 'd-stats today-full' });
  // คอม: 2 คอลัมน์แบบแดชบอร์ด — ซ้าย = ห้องพัก (การ์ดน้อง) · ขวา = คิว Grooming / ออกกำลังกาย
  const body = el('div', { class: 'd-grid today-full' });
  const mbody = el('div', { class: 'mtoday' });
  container.append(newsMount, regAlert, statGrid, body, mbody);
  _unsub.push(mountNewsCard(newsMount));
  let mtab = 'hotel'; // แท็บโซนที่เลือกบนมือถือ — ต้องอยู่รอดตอนข้อมูลเรียลไทม์เข้ามาใหม่

  let _bookings = [];
  // สถานะลงทะเบียน — สูตรเดียวกับหน้าปฏิทิน (regStateOf) · 'previous' = รู้ข้อมูลน้องจากครั้งก่อนแล้ว ไม่ต้องตาม
  const regOf = (b) => regStateOf(b, _customers, _checkinForms);
  const isRegistered = (b) => regOf(b).state !== 'none';
  const ctx = () => ({ bookings: _bookings, customers: _customers });
  // เจ้าของร้านปิดสวิตช์ "ข้อมูลลงทะเบียน" ของพี่เลี้ยงได้ → เหลือแค่ป้ายสถานะ ไม่มีทางเข้าไปดูใบ
  const canReg = () => staffCan('registrations');
  // ลงทะเบียนแล้ว → เปิดใบลงทะเบียน · มีแค่ใบครั้งก่อน → เปิดใบนั้น · ยังไม่มีเลย → แผ่นส่งลิงก์ให้ลูกค้า
  const openReg = (b) => {
    const r = regOf(b);
    if (r.state === 'previous' && r.prev) return openFormDetail(r.prev, ctx());
    openGuestCheckin(b, { forms: _checkinForms, ...ctx(), known: r.state === 'previous' }, null);
  };
  // ชื่อลูกค้าบนการ์ด แตะแล้วเปิดใบลงทะเบียน (ปุ่มจริง กด Enter ได้)
  const nameBtn = (b, child) => {
    if (!canReg()) return child;
    const btn = el('button', { type: 'button', class: 'st-open', 'aria-label': `ดูใบลงทะเบียนของ ${b.customerName || 'ลูกค้า'}` }, [child]);
    btn.onclick = () => openReg(b);
    return btn;
  };
  // ป้ายสถานะลงทะเบียน + ปุ่มลัด (ใช้ทั้งการ์ดคอมและมือถือ)
  function regBits(b) {
    const r = regOf(b);
    // ลูกค้าเซ็นออนไลน์แล้ว → พี่เลี้ยงแค่เซ็นฝั่งตัวเองแล้วพิมพ์
    const tag2 = r.state === 'this' && r.form.signedOnlineAt ? el('span', { class: 'pill green', text: 'เซ็นออนไลน์แล้ว' }) : null;
    const tag = r.state === 'this' ? el('span', { class: 'pill green', text: 'ลงทะเบียนแล้ว' })
      : r.state === 'previous' ? el('span', { class: 'pill green', text: 'มีข้อมูลจากครั้งก่อน' })
      : el('span', { class: 'pill yellow', text: 'ยังไม่ลงทะเบียน' });
    if (!canReg()) return { tag, tag2, btn: null };
    const mk = (cls, html, fn) => { const x = el('button', { type: 'button', class: 'btn ' + cls, html }); x.onclick = fn; return x; };
    if (r.state === 'none') return { tag, tag2, btn: mk('st-sendreg', 'ส่งลิงก์ลงทะเบียนให้ลูกค้า', () => openReg(b)) };
    // ใบของรอบนี้ → พิมพ์ใบยืนยัน · ข้อมูลครั้งก่อนจากโปรไฟล์ → พิมพ์ใบรับฝาก (วันที่ของรอบนี้ + ข้อมูลน้องจากโปรไฟล์)
    // ใบครั้งก่อนที่ยังไม่นำเข้าโปรไฟล์ไม่มีปุ่มพิมพ์ — ใบนั้นเป็นวันเข้าพักเก่า ไม่ควรให้ลูกค้าเซ็น
    const print = r.state === 'this' ? () => printRegistration(r.form)
      : r.info.source.startsWith('profile') ? () => printSheet(buildIntakeSheet(b, _customers), { filename: `ใบรับฝาก-${b.customerName || ''}` })
      : null;
    const view = (r.state === 'this' || r.prev) ? mk('', `${icons.inbox} ${r.state === 'this' ? 'ดูใบลงทะเบียน' : 'ดูใบครั้งก่อน'}`, () => openReg(b)) : null;
    const acts = [view, print && mk('primary', `${icons.print} พิมพ์ให้ลูกค้าเซ็น`, print)].filter(Boolean);
    return { tag, tag2, btn: acts.length ? el('div', { class: 'st-regacts' + (acts.length === 1 ? ' one' : '') }, acts) : null };
  }

  // ปุ่มลัดไปหน้า "ข้อมูลลงทะเบียนเช็คอิน" ทั้งหมด
  const regLink = () => canReg() ? el('a', { class: 'st-alert-link', href: '#registrations', text: 'เปิดหน้าข้อมูลลงทะเบียนทั้งหมด →' }) : null;

  const draw = () => {
    const today = todayISO();
    const tomorrow = addDaysISO(today, 1);
    const active = _bookings.filter(b => b.depositStatus !== 'ยกเลิก');
    const checkinToday = active.filter(b => b.checkIn === today);
    const checkoutToday = active.filter(b => b.checkOut === today);
    const checkinTomorrow = active.filter(b => b.checkIn === tomorrow);
    const checkoutTomorrow = active.filter(b => b.checkOut === tomorrow);
    const staying = active.filter(b => b.checkIn <= today && today < b.checkOut);

    const perPet = roomsByPet(staying);
    const perPetTmr = roomsByPet(checkinTomorrow);
    const unregTmr = checkinTomorrow.filter(b => !isRegistered(b));

    // ลำดับความสำคัญของพี่เลี้ยง: 1) พรุ่งนี้ใครเข้า (ต้องรู้ข้อมูลน้องภายในคืนนี้) 2) งานวันนี้
    regAlert.innerHTML = '';
    if (checkinTomorrow.length) {
      regAlert.appendChild(unregTmr.length
        ? el('div', { class: 'st-alert' }, [
            el('b', { text: `พรุ่งนี้ (${shortDate(tomorrow)}) ยังไม่ลงทะเบียน ${unregTmr.length} จาก ${checkinTomorrow.length} บ้าน` }),
            el('span', { text: `${unregTmr.map(b => b.customerName || '-').join(', ')} · ส่งลิงก์ให้ลูกค้ากรอกภายในคืนนี้ จะได้รู้ข้อมูลน้องก่อนมาถึง` }),
            regLink(),
          ].filter(Boolean))
        : el('div', { class: 'st-alert ok' }, [
            el('b', { text: `พรุ่งนี้ (${shortDate(tomorrow)}) เข้าพัก ${checkinTomorrow.length} บ้าน · ลงทะเบียนครบแล้ว` }),
            el('span', { text: 'แตะชื่อลูกค้าเพื่อดูใบลงทะเบียน หรือพิมพ์ให้ลูกค้าเซ็น' }),
            regLink(),
          ].filter(Boolean)));
    }

    statGrid.innerHTML = '';
    [
      ['hero', icons.calendar, 'พรุ่งนี้', checkinTomorrow.length, `เข้าพักพรุ่งนี้ · ลงทะเบียนแล้ว ${checkinTomorrow.length - unregTmr.length}/${checkinTomorrow.length}`],
      ['blue', icons.login, 'วันนี้', checkinToday.length, 'เข้าพักวันนี้'],
      ['orange', icons.logout, null, checkoutToday.length, 'ออกวันนี้'],
      ['purple', icons.paw, null, `${perPet.dog + perPet.cat} ห้อง`, `ดูแลอยู่ · สุนัข ${perPet.dog} แมว ${perPet.cat}`],
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

    // จัดเป็น 3 โซนตามงานจริงของร้าน — พี่เลี้ยงจะได้ไม่ต้องไล่อ่านทีละการ์ด
    // ว่าอันไหนงานโรงแรม อันไหนงานอาบน้ำ สีประจำโซนตรงกับหน้า "คิวบริการ"
    // แสดงคิวพรุ่งนี้ด้วย เพื่อให้เตรียมของ/จัดคนล่วงหน้าได้ (โซนโรงแรมมีส่วนพรุ่งนี้อยู่แล้ว)
    const groomToday = apptsOfDay(today, 'grooming');
    const groomTomorrow = apptsOfDay(tomorrow, 'grooming');
    const exToday = apptsOfDay(today, 'exercise');
    const exTomorrow = apptsOfDay(tomorrow, 'exercise');

    body.innerHTML = '';
    body.append(
      el('div', { class: 'd-col' }, [
        section(`พรุ่งนี้เข้าพัก · ${formatDateTH(tomorrow)} — เตรียมรับน้อง`, checkinTomorrow, 'พรุ่งนี้ไม่มีน้องเข้าพัก', icons.calendar, { reg: true, hl: true }),
        section('เช็คอินวันนี้ — เตรียมรับน้อง', checkinToday, 'ไม่มีน้องเข้าพักวันนี้', icons.login, { reg: true }),
        section('เช็คเอาท์วันนี้ — เตรียมส่งน้องกลับ', checkoutToday, 'ไม่มีน้องออกวันนี้', icons.logout),
        section('กำลังพักอยู่', staying, 'ยังไม่มีน้องพักอยู่', icons.home, { sortByCheckout: true, leaveTag: true }),
        section(`พรุ่งนี้เช็คเอาท์ · ${formatDateTH(tomorrow)} — เตรียมส่งน้องกลับ`, checkoutTomorrow, 'พรุ่งนี้ไม่มีน้องออก', icons.calendar),
      ]),
      el('div', { class: 'd-col' }, [
        apptSection('คิว Grooming วันนี้', groomToday, 'วันนี้ยังไม่มีคิวอาบน้ำ-ตัดขน', icons.star),
        apptSection(`คิว Grooming พรุ่งนี้ · ${formatDateTH(tomorrow)}`, groomTomorrow, 'พรุ่งนี้ยังไม่มีคิวอาบน้ำ-ตัดขน', icons.calendar),
        apptSection('คิวออกกำลังกายวันนี้', exToday, 'วันนี้ยังไม่มีคิวออกกำลังกาย', icons.paw),
        apptSection(`คิวออกกำลังกายพรุ่งนี้ · ${formatDateTH(tomorrow)}`, exTomorrow, 'พรุ่งนี้ยังไม่มีคิวออกกำลังกาย', icons.calendar),
      ]),
    );

    drawMobile({ checkinToday, checkoutToday, staying, checkinTomorrow, checkoutTomorrow, perPet, perPetTmr, unregTmr,
      groomToday, groomTomorrow, exToday, exTomorrow, tomorrow });
  };

  // ── มือถือ: การ์ดสรุป + แท็บ 3 โซน (ห้องพัก / Grooming / ออกกำลังกาย) ──
  // ใช้รายการชุดเดียวกับฝั่งคอมที่ draw() คำนวณไว้ ไม่มีตรรกะคัดกรองใหม่
  function drawMobile(d) {
    mbody.innerHTML = '';
    // การ์ดหลัก = พรุ่งนี้ (เตรียมรับน้อง) · แถวล่าง = งานวันนี้
    mbody.appendChild(el('div', { class: 'm-hero' }, [
      el('div', { class: 'm-hero-top' }, [
        el('span', { text: `พรุ่งนี้เข้าพัก · ${shortDate(d.tomorrow)}` }),
        el('b', { text: `สุนัข ${d.perPetTmr.dog} · แมว ${d.perPetTmr.cat} ห้อง` }),
      ]),
      el('div', { class: 'm-nums' }, [
        el('div', {}, [el('b', { text: String(d.checkinTomorrow.length) }), el('span', { text: 'บ้านเข้าพัก' })]),
        el('div', {}, [el('b', { text: String(d.checkinTomorrow.length - d.unregTmr.length) }), el('span', { text: 'ลงทะเบียนแล้ว' })]),
        el('div', {}, [el('b', { text: String(d.unregTmr.length) }), el('span', { text: 'ยังไม่ลงทะเบียน' })]),
      ]),
      el('div', { class: 'm-hero-sub', text: `วันนี้: เข้า ${d.checkinToday.length} · กลับบ้าน ${d.checkoutToday.length} · พักอยู่ ${d.staying.length} (สุนัข ${d.perPet.dog} · แมว ${d.perPet.cat} ห้อง)` }),
    ]));

    const hotelN = d.checkinTomorrow.length + d.checkinToday.length + d.checkoutToday.length + d.staying.length;
    const tabs = [
      ['hotel', 'ห้องพัก', hotelN],
      ['grooming', 'Grooming', d.groomToday.length],
      ['exercise', 'ออกกำลังกาย', d.exToday.length],
    ];
    const seg = el('div', { class: 'm-seg m-seg--3', role: 'tablist', 'aria-label': 'เลือกโซนงาน' }, tabs.map(([id, label, n]) => {
      const b = el('button', { class: mtab === id ? 'on' : '', role: 'tab', 'aria-selected': String(mtab === id) },
        [label, el('span', { class: 'm-segn', text: String(n) })]);
      b.onclick = () => { mtab = id; drawMobile(d); };
      return b;
    }));
    mbody.appendChild(seg);

    const tmr = shortDate(d.tomorrow);
    if (mtab === 'hotel') {
      mSec(`พรุ่งนี้เข้าพัก · ${tmr} · เตรียมรับน้อง`, d.checkinTomorrow, 'พรุ่งนี้ไม่มีน้องเข้าพัก', { reg: true });
      mSec('เช็คอินวันนี้ · เตรียมรับน้อง', d.checkinToday, 'ไม่มีน้องเข้าพักวันนี้', { reg: true });
      mSec('เช็คเอาท์วันนี้ · เตรียมส่งน้องกลับ', d.checkoutToday, 'ไม่มีน้องออกวันนี้');
      mSec('กำลังพักอยู่', d.staying, 'ยังไม่มีน้องพักอยู่', { sortByCheckout: true, leaveTag: true });
      mSec(`พรุ่งนี้เช็คเอาท์ · ${tmr}`, d.checkoutTomorrow, 'พรุ่งนี้ไม่มีน้องออก');
    } else if (mtab === 'grooming') {
      mQueue('คิววันนี้', d.groomToday, 'วันนี้ยังไม่มีคิวอาบน้ำ-ตัดขน');
      mQueue(`คิวพรุ่งนี้ · ${tmr}`, d.groomTomorrow, 'พรุ่งนี้ยังไม่มีคิวอาบน้ำ-ตัดขน');
    } else {
      mQueue('คิววันนี้', d.exToday, 'วันนี้ยังไม่มีคิวออกกำลังกาย');
      mQueue(`คิวพรุ่งนี้ · ${tmr}`, d.exTomorrow, 'พรุ่งนี้ยังไม่มีคิวออกกำลังกาย');
    }
  }

  function mHead(title, n) {
    mbody.appendChild(el('div', { class: 'm-sec' }, [el('h3', {}, [title, el('span', { class: 'm-n', text: String(n) })])]));
  }

  // การ์ดน้อง 1 ใบต่อ 1 การจอง — ชื่อน้อง/สายพันธุ์/โน้ตการดูแลเด่นที่สุด เพราะเป็นสิ่งที่พี่เลี้ยงใช้จริง
  function mSec(title, list, emptyText, opts = {}) {
    mHead(title, list.length);
    if (!list.length) { mbody.appendChild(el('div', { class: 'm-empty', text: emptyText })); return; }
    const tomorrow = addDaysISO(todayISO(), 1);
    const ordered = opts.sortByCheckout
      ? [...list].sort((a, b) => String(a.checkOut).localeCompare(String(b.checkOut)))
      : list;
    ordered.forEach(b => {
      const info = resolvePetInfo(b, _customers, _checkinForms);
      const vac = worstVaccine(info.pets);
      const reg = opts.reg ? regBits(b) : {};
      const tags = [
        reg.tag, reg.tag2,
        vac === 'expired' ? el('span', { class: 'pill red', text: 'วัคซีนหมดอายุ' })
          : vac === 'soon' ? el('span', { class: 'pill yellow', text: 'วัคซีนใกล้หมด' }) : null,
        (opts.leaveTag && b.checkOut === tomorrow) ? el('span', { class: 'pill yellow', text: 'ออกพรุ่งนี้' }) : null,
        b.stayStatus === 'checked-in' ? el('span', { class: 'pill green', text: 'เช็คอินแล้ว' })
          : b.stayStatus === 'checked-out' ? el('span', { class: 'pill grey', text: 'เช็คเอาท์แล้ว' }) : null,
      ].filter(Boolean);
      const times = [b.checkInTime && `เข้า ${b.checkInTime}`, b.checkOutTime && `ออก ${b.checkOutTime}`].filter(Boolean).join(' · ');
      const call = b.phone
        ? el('a', { class: 'm-call', href: `tel:${String(b.phone).replace(/[^\d+]/g, '')}`, 'aria-label': `โทรหา ${b.customerName || 'ลูกค้า'}`, html: icons.phone })
        : null;

      const card = el('div', { class: 'm-care' }, [
        el('div', { class: 'm-care-top' }, [
          el('span', { class: 'm-pet' + (isCat(b) ? ' cat' : ''), html: isCat(b) ? icons.cat : icons.dog }),
          el('div', { class: 'm-tx' }, [
            nameBtn(b, el('b', { text: b.customerName || '-' })),
            el('small', { text: `${roomsOf(b)} · ${rangeOf(b)}` }),
            times ? el('small', { text: times }) : null,
          ].filter(Boolean)),
          call,
        ].filter(Boolean)),
        tags.length ? el('div', { class: 'm-care-tags' }, tags) : null,
      ].filter(Boolean));

      info.pets.forEach(p => {
        const cat = p.species === 'cat';
        card.appendChild(el('div', { class: 'm-care-pet' }, [
          el('div', { class: 'm-care-pn' }, [
            el('span', { class: 'm-pettag' + (cat ? ' cat' : ''), html: `${cat ? icons.cat : icons.dog}<b>${escapeHtml(p.name || '-')}</b>` }),
            p.breed ? el('small', { text: p.breed }) : null,
          ].filter(Boolean)),
          p.healthNotes ? el('div', { class: 'care-note', text: p.healthNotes }) : null,
        ].filter(Boolean)));
      });
      if (info.source === 'form' && !info.imported) {
        card.appendChild(el('div', { class: 'm-care-foot', text: 'ข้อมูลจากใบลงทะเบียนเช็คอิน (ยังไม่นำเข้าโปรไฟล์)' }));
      }
      if (b.notes) card.appendChild(el('div', { class: 'm-care-foot', text: `หมายเหตุการจอง: ${b.notes}` }));
      if (reg.btn) card.appendChild(reg.btn);
      mbody.appendChild(card);
    });
  }

  // คิวบริการ เรียงตามเวลา — เวลาตัวใหญ่ด้านซ้ายให้กวาดตาดูลำดับงานได้ทันที
  function mQueue(title, list, emptyText) {
    mHead(title, list.length);
    if (!list.length) { mbody.appendChild(el('div', { class: 'm-empty', text: emptyText })); return; }
    mbody.appendChild(el('div', { class: 'm-list' }, list.map(a => {
      const detail = a.type === 'exercise'
        ? (a.zone ? exerciseZoneLabel(a.zone) : `ระดับ ${a.level || '-'}`)
        : groomServiceLabel(groomServiceOf(a));
      const n = petCountOf(a);
      const cat = a.petType === 'cat';
      return el('div', { class: 'm-row m-qrow' }, [
        el('span', { class: 'm-qrow-t', text: a.time || '—' }),
        el('div', { class: 'm-tx' }, [
          el('b', { html: `${cat ? icons.cat : icons.dog}${escapeHtml(a.petName || a.customerName || '-')}${n > 1 ? ` (${n} ตัว)` : ''}` }),
          el('small', { text: `${detail} · ประมาณ ${Math.round((a.durationMin || 60) / 60)} ชม.` }),
          a.notes ? el('small', { text: a.notes.split('\n')[0] }) : null,
        ].filter(Boolean)),
        apptStatusControl(a),
      ]);
    })));
  }

  function apptsOfDay(today, type) {
    return _appts
      .filter(a => a.date === today && a.type === type && a.status !== 'ยกเลิก')
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }

  // คิวของโซนหนึ่ง เรียงตามรอบเวลาเพื่อใช้เป็นลำดับงานจริง
  function apptSection(title, list, emptyText, ico) {
    const card = stCard(ico, title, list.length);
    if (!list.length) {
      card.appendChild(el('p', { class: 'muted st-empty', text: emptyText }));
      return card;
    }
    list.forEach(a => {
      const detail = a.type === 'exercise'
        ? (a.zone ? exerciseZoneLabel(a.zone) : `ระดับ ${a.level || '-'}`)
        : groomServiceLabel(groomServiceOf(a));
      card.appendChild(el('div', { class: 'lineitem' }, [
        el('div', { class: 'li-head' }, [
          el('div', {}, [
            el('strong', { text: `${a.time || '—'} · ${a.petName || a.customerName || '-'}${petCountOf(a) > 1 ? ` (${petCountOf(a)} ตัว)` : ''}` }),
            el('span', { class: 'muted', style: 'font-size:12px;margin-left:8px', text: a.customerName || '' }),
          ]),
          apptStatusControl(a),
        ]),
        el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:4px' }, [
          el('span', { class: 'pet-chip pet-' + (a.petType || 'dog'), html: `${PET_ICONS[a.petType] || icons.paw} ${escapeHtml(detail)}` }),
          el('span', { class: 'muted', style: 'font-size:12px', text: `ประมาณ ${Math.round((a.durationMin || 60) / 60)} ชม.` }),
          a.notes ? el('span', { class: 'muted', style: 'font-size:12px', text: a.notes.split('\n')[0] }) : null,
        ].filter(Boolean)),
      ]));
    });
    return card;
  }

  // สีของการ์ดมาจากโซนที่ครอบอยู่ ส่วนไอคอนบอกว่าเป็นงานประเภทไหน
  // opts.sortByCheckout = เรียงตามใกล้ออกก่อน · opts.leaveTag = โชว์ป้าย "ออกพรุ่งนี้" (ใช้ในกล่องกำลังพัก)
  // opts.reg = ป้าย/ปุ่มลงทะเบียน · opts.hl = การ์ดเด่น (พรุ่งนี้เข้าพัก)
  function section(title, list, emptyText, ico, opts = {}) {
    const card = stCard(ico, title, list.length);
    if (opts.hl) card.classList.add('st-card--hl');
    if (!list.length) { card.appendChild(el('p', { class: 'muted st-empty', text: emptyText })); return card; }
    const s = getSettings();
    const tomorrow = addDaysISO(todayISO(), 1);
    const ordered = opts.sortByCheckout
      ? [...list].sort((a, b) => String(a.checkOut).localeCompare(String(b.checkOut)))
      : list;
    ordered.forEach(b => {
      // ข้อมูลน้องจากแหล่งที่ครบสุด (โปรไฟล์ → ใบเช็คอิน) — ตรรกะเดียวกับการ์ดฝั่งเจ้าของ
      const info = resolvePetInfo(b, _customers, _checkinForms);
      const pets = info.pets;
      const rooms = b.lineItems.map(li => el('span', {
        class: `pet-chip pet-${li.petType || 'dog'} pet-chip-lg`,
        html: `${PET_ICONS[li.petType] || icons.paw} ${escapeHtml(s?.roomPrices?.[li.roomType]?.label || li.roomType)} × ${Number(li.rooms) || 1}`,
      }));
      // ป้ายท้ายชื่อ: ธงวัคซีน · ออกพรุ่งนี้ · สถานะเช็คอิน (เรื่องที่ต้องระวัง/รู้ก่อน)
      const vac = worstVaccine(pets);
      const reg = opts.reg ? regBits(b) : {};
      const tags = [
        reg.tag, reg.tag2,
        vac === 'expired' ? el('span', { class: 'pill red', text: 'วัคซีนหมดอายุ' })
          : vac === 'soon' ? el('span', { class: 'pill yellow', text: 'วัคซีนใกล้หมด' }) : null,
        (opts.leaveTag && b.checkOut === tomorrow) ? el('span', { class: 'pill yellow', text: 'ออกพรุ่งนี้' }) : null,
        b.stayStatus === 'checked-in' ? el('span', { class: 'pill green', text: 'เช็คอินแล้ว' })
          : b.stayStatus === 'checked-out' ? el('span', { class: 'pill grey', text: 'เช็คเอาท์แล้ว' }) : null,
      ].filter(Boolean);
      const box = el('div', { class: 'lineitem' }, [
        el('div', { class: 'li-head' }, [
          el('div', {}, [
            nameBtn(b, el('strong', { text: b.customerName || '-' })),
            el('span', { class: 'muted', style: 'font-size:12px;margin-left:8px', text: b.phone || '' }),
          ]),
          tags.length ? el('div', { class: 'row', style: 'gap:4px;flex-wrap:wrap' }, tags) : null,
        ].filter(Boolean)),
        el('div', { class: 'row', style: 'gap:6px;margin:8px 0 6px;flex-wrap:wrap' }, rooms),
        el('div', { class: 'muted', style: 'font-size:13px', text:
          `${formatDateTH(b.checkIn)} ${b.checkInTime || ''} → ${formatDateTH(b.checkOut)} ${b.checkOutTime || ''}` }),
      ]);

      // ข้อมูลน้องแต่ละตัว + สิ่งที่ต้องระวัง (อาหาร/นิสัย/สุขภาพ อยู่ใน healthNotes)
      pets.forEach(p => {
        const cat = p.species === 'cat';
        box.appendChild(el('div', { class: 'row', style: 'gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap' }, [
          el('span', { class: `pet-chip pet-${cat ? 'cat' : 'dog'}`, html: `${cat ? icons.cat : icons.dog} ${escapeHtml(p.name || '-')}` }),
          p.breed ? el('span', { class: 'muted', style: 'font-size:12px', text: p.breed }) : null,
        ].filter(Boolean)));
        if (p.healthNotes) box.appendChild(el('div', { class: 'care-note', text: p.healthNotes }));
      });
      // บอกที่มาถ้าข้อมูลมาจากใบลงทะเบียนที่ยังไม่นำเข้า (พนักงานจะได้รู้ว่ายังไม่เข้าโปรไฟล์ถาวร)
      if (info.source === 'form' && !info.imported) {
        box.appendChild(el('div', { class: 'muted', style: 'font-size:12px;margin-top:6px', text: '· ข้อมูลจากใบลงทะเบียนเช็คอิน (ยังไม่นำเข้าโปรไฟล์)' }));
      }

      if (b.notes) box.appendChild(el('div', { class: 'muted', style: 'font-size:12px;margin-top:6px', text: `หมายเหตุการจอง: ${b.notes}` }));
      if (reg.btn) box.appendChild(reg.btn);
      card.appendChild(box);
    });
    return card;
  }

  _unsub.push(listen('customers', arr => { _customers = arr; draw(); }));
  _unsub.push(listen('bookings', raw => { _bookings = raw.map(computeBooking); draw(); }));
  _unsub.push(listen('appointments', arr => { _appts = arr; draw(); }));
  _unsub.push(listen('checkinForms', arr => { _checkinForms = arr; draw(); }, { orderBy: null }));
}

// การ์ดหัวข้อแบบเดียวกับแดชบอร์ดคอม (ชิปไอคอน + ชื่อ + จำนวน) · เนื้อหาเดิมต่อท้ายในการ์ด
function stCard(ico, title, n) {
  return el('div', { class: 'd-card st-card' }, [
    el('div', { class: 'd-card-h' }, [
      el('span', { class: 'd-ci', html: ico || '' }),
      el('h2', { text: title }),
      el('span', { class: 'd-cnt', text: `${n} รายการ` }),
    ]),
  ]);
}
