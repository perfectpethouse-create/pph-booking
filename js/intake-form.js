// ═══════════════════════════════════════════════════════════════
// intake-form.js — "ใบรับฝากสัตว์เลี้ยง" สำหรับพิมพ์/บันทึกเป็น PDF ให้ลูกค้าเซ็นตอนเช็คอิน
//
// ทำไมใช้ window.print() แทนไลบรารี PDF:
//   jsPDF/pdf-lib ไม่รองรับฟอนต์ไทยในตัว ต้อง embed ฟอนต์เป็น base64 (ไฟล์ใหญ่หลาย MB)
//   การพิมพ์ผ่านเบราว์เซอร์ใช้ฟอนต์ระบบ → ภาษาไทยสมบูรณ์ + ผู้ใช้เลือก "Save as PDF" ได้เอง
//
// ⚠️ ข้อตกลงในใบมาจาก INTAKE_TERMS (config-shop.js) ซึ่งคัดจากกฎระเบียบจริงของร้าน
//    ห้ามแก้ข้อความในไฟล์นี้ — ถ้าร้านเปลี่ยนนโยบายให้แก้ที่ต้นฉบับแล้วซิงก์
// ═══════════════════════════════════════════════════════════════
import { el, getSettings, isStaff } from './ui.js';
import { computeBooking, computeAddOn, formatBaht, formatDateTH, nightsBetween } from './calc.js';
import { PET_TYPES, INTAKE_TERMS, INTAKE_CONSENT } from './config-shop.js';
import { matchCustomer } from './customers.js';
import { icons } from './icons.js';

function petLabel(id) { return (PET_TYPES.find(p => p.id === id) || {}).label || id || ''; }

function row(k, v) {
  return el('div', { class: 'intake-row' }, [
    el('span', { class: 'k', text: k }),
    el('span', { class: 'v', text: v || '-' }),
  ]);
}

// สร้างใบรับฝาก 1 ใบจากการจอง + ข้อมูลสัตว์ของลูกค้า (ถ้าจับคู่ได้)
export function buildIntakeSheet(bookingRaw, customers = []) {
  const b = computeBooking(bookingRaw);
  const s = getSettings();
  const staff = isStaff();
  const nights = nightsBetween(b.checkIn, b.checkOut) || (b.lineItems[0]?.nights ?? 0);
  const cust = customers.find(c => matchCustomer(b, c));

  const sheet = el('div', { class: 'intake-sheet', id: 'intake-print' });

  // ── หัวกระดาษ ──
  sheet.appendChild(el('div', { class: 'intake-head' }, [
    el('div', { class: 'intake-brand' }, [
      el('span', { class: 'intake-logo', html: icons.paw }),
      el('div', {}, [
        el('div', { class: 'intake-shop', text: s?.shopInfo?.name || 'Perfect Pet House' }),
        el('div', { class: 'intake-sub', text: 'ใบรับฝากสัตว์เลี้ยง · Pet Boarding Intake Form' }),
      ]),
    ]),
    el('div', { class: 'intake-meta' }, [
      el('div', { text: `วันที่ออกใบ: ${formatDateTH(new Date().toISOString().slice(0, 10))}` }),
      el('div', { text: `เลขที่: ${(bookingRaw.id || '-').toString().slice(-8).toUpperCase()}` }),
    ]),
  ]));

  // ── ผู้ฝาก + การเข้าพัก ──
  const grid = el('div', { class: 'intake-grid' });
  const left = el('div', { class: 'intake-box' }, [el('h3', { text: 'ข้อมูลผู้ฝาก' })]);
  left.appendChild(row('ชื่อ-นามสกุล', b.customerName));
  left.appendChild(row('เบอร์โทร', b.phone));
  if (cust?.notes) left.appendChild(row('หมายเหตุ', cust.notes.split('\n')[0]));
  grid.appendChild(left);

  const right = el('div', { class: 'intake-box' }, [el('h3', { text: 'การเข้าพัก' })]);
  right.appendChild(row('Check-in', `${formatDateTH(b.checkIn)}  ${b.checkInTime || '09:00'} น.`));
  right.appendChild(row('Check-out', `${formatDateTH(b.checkOut)}  ${b.checkOutTime || '14:00'} น.`));
  right.appendChild(row('จำนวนคืน', `${nights} คืน`));
  grid.appendChild(right);
  sheet.appendChild(grid);

  // ── ห้องพัก + สัตว์ที่ฝาก ──
  const roomsBox = el('div', { class: 'intake-box' }, [el('h3', { text: 'ห้องพักที่ฝาก' })]);
  b.lineItems.forEach(li => {
    roomsBox.appendChild(row(
      `${s?.roomPrices?.[li.roomType]?.label || li.roomType} · ${petLabel(li.petType)}`,
      `${li.rooms || 1} ห้อง × ${li.nights || nights} คืน`));
  });
  (b.addOns || []).forEach(a => {
    const c = computeAddOn(a);
    roomsBox.appendChild(row(`บริการเสริม: ${a.name}`, c.qty > 1 ? `× ${c.qty}` : 'มี'));
  });
  sheet.appendChild(roomsBox);

  // ── ข้อมูลสัตว์ (สำคัญต่อการดูแล) ──
  if (cust?.pets?.length) {
    const petsBox = el('div', { class: 'intake-box' }, [el('h3', { text: 'ข้อมูลสัตว์เลี้ยงที่รับฝาก' })]);
    cust.pets.forEach(p => {
      const line = el('div', { class: 'intake-pet' }, [
        el('div', { class: 'intake-pet-name', text: `${petLabel(p.species)} · ${p.name || '-'}${p.breed ? ` (${p.breed})` : ''}${p.weight ? ` · ${p.weight} กก.` : ''}` }),
      ]);
      if (p.healthNotes) line.appendChild(el('div', { class: 'intake-pet-note', text: `สุขภาพ/ข้อควรระวัง: ${p.healthNotes}` }));
      if (p.vaccineNotes) line.appendChild(el('div', { class: 'intake-pet-note', text: `วัคซีน: ${p.vaccineNotes}` }));
      petsBox.appendChild(line);
    });
    sheet.appendChild(petsBox);
  }

  // ── ยอดเงิน (พี่เลี้ยงไม่เห็น) ──
  if (!staff) {
    const payBox = el('div', { class: 'intake-box' }, [el('h3', { text: 'ค่าบริการ' })]);
    if (b.totalDiscount > 0) payBox.appendChild(row('ยอดเต็ม (ก่อนส่วนลด)', formatBaht(b.grossTotal)));
    if (b.totalDiscount > 0) payBox.appendChild(row('ส่วนลดรวม', `− ${formatBaht(b.totalDiscount)}`));
    payBox.appendChild(row('ยอดทั้งหมด', formatBaht(b.grandTotal)));
    payBox.appendChild(row(`มัดจำ ${b.depositPct}% (ชำระแล้ว)`, `${formatBaht(b.depositAmount)}${b.depositMethod ? ` · ${b.depositMethod}` : ''}`));
    payBox.appendChild(row('ยอดชำระวันเช็คอิน', formatBaht(b.balanceDue)));
    sheet.appendChild(payBox);
  }

  // ── ข้อตกลง (verbatim จากกฎระเบียบร้าน) ──
  const termsBox = el('div', { class: 'intake-box intake-terms' }, [
    el('h3', { text: 'กฎระเบียบและนโยบายการเข้าพัก' }),
  ]);
  INTAKE_TERMS.forEach(sec => {
    termsBox.appendChild(el('h4', { text: sec.title }));
    termsBox.appendChild(el('ul', {}, sec.items.map(t => el('li', { text: t }))));
  });
  termsBox.appendChild(el('h4', { text: 'ข้าพเจ้ายืนยันและยินยอมว่า' }));
  termsBox.appendChild(el('ul', {}, INTAKE_CONSENT.map(t => el('li', { text: t }))));
  sheet.appendChild(termsBox);

  // ── ลงชื่อ 2 ฝ่าย ──
  sheet.appendChild(el('div', { class: 'intake-signs' }, [
    el('div', { class: 'intake-sign' }, [
      el('div', { class: 'sign-line' }),
      el('div', { class: 'sign-label', text: 'ลงชื่อเจ้าของสัตว์เลี้ยง' }),
      el('div', { class: 'sign-date', text: 'วันที่ ......... / ......... / .........' }),
    ]),
    el('div', { class: 'intake-sign' }, [
      el('div', { class: 'sign-line' }),
      el('div', { class: 'sign-label', text: 'ลงชื่อเจ้าหน้าที่ผู้รับฝาก' }),
      el('div', { class: 'sign-date', text: 'วันที่ ......... / ......... / .........' }),
    ]),
  ]));

  sheet.appendChild(el('div', { class: 'intake-foot', text:
    `${s?.shopInfo?.name || 'Perfect Pet House'}${s?.shopInfo?.phone ? ` · โทร ${s.shopInfo.phone}` : ''} · ${s?.shopInfo?.note || 'Check-in 9:00–18:00 · Check-out 14:00'}` }));

  return sheet;
}

// เปิดใบรับฝากในหน้าต่างพิมพ์ (ผู้ใช้กด "Save as PDF" หรือสั่งพิมพ์ได้)
export function openIntakeForm(bookingRaw, customers = []) {
  const sheet = buildIntakeSheet(bookingRaw, customers);
  const host = el('div', { id: 'intake-host' }, [sheet]);
  document.body.appendChild(host);
  document.body.classList.add('printing-intake');

  const cleanup = () => {
    document.body.classList.remove('printing-intake');
    host.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // รอให้ browser เรนเดอร์ก่อนเรียก print (กันใบว่าง)
  setTimeout(() => window.print(), 100);
  // กันเหนียวถ้า afterprint ไม่ยิง (บางเบราว์เซอร์)
  setTimeout(cleanup, 60000);
}
