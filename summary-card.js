// ═══════════════════════════════════════════════════════════════
// summary-card.js — การ์ด "สรุปการเข้าพัก" สำหรับส่งลูกค้า + ดาวน์โหลด PNG
// ═══════════════════════════════════════════════════════════════
import { el, toast, getSettings } from './ui.js';
import { computeBooking, formatBaht, formatDateTH, nightsBetween } from './calc.js';
import { PET_TYPES } from './config-shop.js';
import { icons } from './icons.js';

function petLabel(id) { return (PET_TYPES.find(p => p.id === id) || {}).label || id; }
function roomLabel(typeId) {
  const s = getSettings();
  return (s?.roomPrices?.[typeId]?.label) || typeId;
}

// อธิบายรายการห้อง 1 บรรทัด เช่น "Cozy Room · สุนัข × 2 ห้อง"
function describeLine(li) {
  return `${roomLabel(li.roomType)} · ${petLabel(li.petType)} × ${li.rooms || 1} ห้อง`;
}

// สร้าง element การ์ดจาก booking (raw) — คำนวณยอดให้เอง
export function buildCustomerCard(bookingRaw) {
  const b = computeBooking(bookingRaw);
  const s = getSettings();
  const nights = nightsBetween(b.checkIn, b.checkOut) || (b.lineItems[0]?.nights ?? 0);
  const inTime = b.checkInTime || '09:00';
  const outTime = b.checkOutTime || '14:00';

  const rows = [];
  const push = (k, v) => rows.push(el('div', { class: 'cc-row' }, [
    el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v }),
  ]));

  push('ชื่อลูกค้า', b.customerName || '-');
  push('Check-in', `${formatDateTH(b.checkIn)}  ${inTime} น.`);
  push('Check-out', `${formatDateTH(b.checkOut)}  ${outTime} น.`);
  push('จำนวนคืน', `${nights} คืน`);

  // รายการห้อง (อาจหลายบรรทัด)
  b.lineItems.forEach(li => push('ห้องพัก', describeLine(li)));

  const totalRooms = b.lineItems.reduce((n, li) => n + (Number(li.rooms) || 0), 0);
  push('จำนวนห้อง', `${totalRooms} ห้อง`);

  if (b.addOns?.length) {
    b.addOns.forEach(a => push('บริการเสริม', `${a.name} ${formatBaht(a.price)}`));
  } else {
    push('Add on', 'ไม่มี');
  }

  if (b.totalDiscount > 0) push('ส่วนลด', `− ${formatBaht(b.totalDiscount)}`);

  const card = el('div', { class: 'cust-card', id: 'customer-card-capture' }, [
    el('div', { class: 'cc-head' }, [
      el('div', { class: 'logo', html: icons.paw }),
      el('div', { class: 'cc-title', text: 'สรุปการเข้าพัก' }),
      el('div', { class: 'cc-sub', text: s?.shopInfo?.name || 'Perfect Pet House' }),
    ]),
    ...rows,
    el('div', { class: 'cc-total' }, [
      el('span', { text: 'ยอดทั้งหมด' }), el('span', { text: formatBaht(b.grandTotal) }),
    ]),
    el('div', { class: 'cc-deposit' }, [
      el('span', { text: `มัดจำ ${b.depositPct}%` }), el('span', { text: formatBaht(b.depositAmount) }),
    ]),
    el('div', { class: 'cc-row', style: 'border:none' }, [
      el('span', { class: 'k', text: 'จ่ายเพิ่มวัน Check-in' }),
      el('span', { class: 'v', text: formatBaht(b.balanceDue) }),
    ]),
    el('div', { class: 'cc-foot', text: s?.shopInfo?.note || 'ขอบคุณที่ไว้วางใจ Perfect Pet House' }),
  ]);
  return card;
}

// ดาวน์โหลดการ์ดเป็น PNG
export async function downloadCardPNG(cardEl, filename = 'สรุปการเข้าพัก.png') {
  if (typeof html2canvas === 'undefined') {
    toast('กำลังโหลดตัวสร้างรูป… ลองใหม่อีกครั้งในอีกสักครู่');
    return;
  }
  const canvas = await html2canvas(cardEl, { scale: 2, backgroundColor: null, useCORS: true });
  const link = el('a', { download: filename, href: canvas.toDataURL('image/png') });
  link.click();
  toast('ดาวน์โหลดรูปแล้ว');
}
