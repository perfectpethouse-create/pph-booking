// ═══════════════════════════════════════════════════════════════
// staff-today.js — หน้า "งานวันนี้" สำหรับพี่เลี้ยง (ไม่มีข้อมูลยอดเงินใดๆ)
// เน้นสิ่งที่คนดูแลสัตว์ต้องรู้: ใครเข้า/ออก/พักอยู่ · น้องชื่ออะไร · ต้องระวังอะไร
// ═══════════════════════════════════════════════════════════════
import { listen } from './db.js';
import { el, getSettings, escapeHtml } from './ui.js';
import { computeBooking, formatDateTH, todayISO, addDaysISO } from './calc.js';
import { resolvePetInfo, worstVaccine } from './pet-info.js';
import { groomServiceOf, groomServiceLabel } from './config-shop.js';
import { icons } from './icons.js';

let _unsub = [];
let _customers = [];
let _appts = [];
let _checkinForms = []; // ใบลงทะเบียนเช็คอิน — ใช้ดึงข้อมูลน้องแม้ยังไม่นำเข้าโปรไฟล์

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
    const tomorrow = addDaysISO(today, 1);
    const active = _bookings.filter(b => b.depositStatus !== 'ยกเลิก');
    const checkinToday = active.filter(b => b.checkIn === today);
    const checkoutToday = active.filter(b => b.checkOut === today);
    const checkinTomorrow = active.filter(b => b.checkIn === tomorrow);
    const checkoutTomorrow = active.filter(b => b.checkOut === tomorrow);
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

    // จัดเป็น 3 โซนตามงานจริงของร้าน — พี่เลี้ยงจะได้ไม่ต้องไล่อ่านทีละการ์ด
    // ว่าอันไหนงานโรงแรม อันไหนงานอาบน้ำ สีประจำโซนตรงกับหน้า "คิวบริการ"
    const hotelCount = checkinToday.length + checkoutToday.length + staying.length;
    // แสดงคิวพรุ่งนี้ด้วย เพื่อให้เตรียมของ/จัดคนล่วงหน้าได้ (โซนโรงแรมมีส่วนพรุ่งนี้อยู่แล้ว)
    const groomToday = apptsOfDay(today, 'grooming');
    const groomTomorrow = apptsOfDay(tomorrow, 'grooming');
    const exToday = apptsOfDay(today, 'exercise');
    const exTomorrow = apptsOfDay(tomorrow, 'exercise');

    body.innerHTML = '';
    body.append(
      zone('hotel', icons.home, 'โซนโรงแรม (ห้องพัก)', `${hotelCount} รายการ`, [
        section('เช็คอินวันนี้ — เตรียมรับน้อง', checkinToday, 'ไม่มีน้องเข้าพักวันนี้', icons.login),
        section('เช็คเอาท์วันนี้ — เตรียมส่งน้องกลับ', checkoutToday, 'ไม่มีน้องออกวันนี้', icons.logout),
        section('กำลังพักอยู่', staying, 'ยังไม่มีน้องพักอยู่', icons.home, { sortByCheckout: true, leaveTag: true }),
        section(`พรุ่งนี้เข้าพัก · ${formatDateTH(tomorrow)} — เตรียมห้อง`, checkinTomorrow, 'พรุ่งนี้ไม่มีน้องเข้าพัก', icons.calendar),
        section(`พรุ่งนี้เช็คเอาท์ · ${formatDateTH(tomorrow)} — เตรียมส่งน้องกลับ`, checkoutTomorrow, 'พรุ่งนี้ไม่มีน้องออก', icons.calendar),
      ]),
      zone('grooming', icons.star, 'โซน Grooming (อาบน้ำ-ตัดขน)',
        `วันนี้ ${groomToday.length} · พรุ่งนี้ ${groomTomorrow.length}`, [
        apptSection('คิววันนี้', groomToday, 'วันนี้ยังไม่มีคิวอาบน้ำ-ตัดขน', icons.star),
        apptSection(`คิวพรุ่งนี้ · ${formatDateTH(tomorrow)}`, groomTomorrow, 'พรุ่งนี้ยังไม่มีคิวอาบน้ำ-ตัดขน', icons.calendar),
      ]),
      zone('exercise', icons.paw, 'โซนออกกำลังกาย',
        `วันนี้ ${exToday.length} · พรุ่งนี้ ${exTomorrow.length}`, [
        apptSection('คิววันนี้', exToday, 'วันนี้ยังไม่มีคิวออกกำลังกาย', icons.paw),
        apptSection(`คิวพรุ่งนี้ · ${formatDateTH(tomorrow)}`, exTomorrow, 'พรุ่งนี้ยังไม่มีคิวออกกำลังกาย', icons.calendar),
      ]),
    );
  };

  // กล่องครอบ 1 โซน — หัวแถบสี + ไอคอน + จำนวนงาน แล้วตามด้วยการ์ดย่อยข้างใน
  function zone(id, ico, title, countText, children) {
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

  // คิวของโซนหนึ่ง เรียงตามรอบเวลาเพื่อใช้เป็นลำดับงานจริง
  function apptSection(title, list, emptyText, ico) {
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
  function section(title, list, emptyText, ico, opts = {}) {
    const card = el('div', { class: 'card section-card' }, [
      el('h2', { class: 'sec-title' }, [
        el('span', { class: 'sec-ico', html: ico || '' }),
        el('span', { text: `${title} (${list.length})` }),
      ]),
    ]);
    if (!list.length) { card.appendChild(el('p', { class: 'muted', text: emptyText })); return card; }
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
      const tags = [
        vac === 'expired' ? el('span', { class: 'pill red', text: 'วัคซีนหมดอายุ' })
          : vac === 'soon' ? el('span', { class: 'pill yellow', text: 'วัคซีนใกล้หมด' }) : null,
        (opts.leaveTag && b.checkOut === tomorrow) ? el('span', { class: 'pill yellow', text: 'ออกพรุ่งนี้' }) : null,
        b.stayStatus === 'checked-in' ? el('span', { class: 'pill green', text: 'เช็คอินแล้ว' })
          : b.stayStatus === 'checked-out' ? el('span', { class: 'pill grey', text: 'เช็คเอาท์แล้ว' }) : null,
      ].filter(Boolean);
      const box = el('div', { class: 'lineitem' }, [
        el('div', { class: 'li-head' }, [
          el('div', {}, [
            el('strong', { text: b.customerName || '-' }),
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
      card.appendChild(box);
    });
    return card;
  }

  _unsub.push(listen('customers', arr => { _customers = arr; draw(); }));
  _unsub.push(listen('bookings', raw => { _bookings = raw.map(computeBooking); draw(); }));
  _unsub.push(listen('appointments', arr => { _appts = arr; draw(); }));
  _unsub.push(listen('checkinForms', arr => { _checkinForms = arr; draw(); }, { orderBy: null }));
}
