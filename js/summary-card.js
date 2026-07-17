// ═══════════════════════════════════════════════════════════════
// summary-card.js — การ์ด "สรุปการเข้าพัก" สำหรับส่งลูกค้า + ดาวน์โหลด PNG
// ═══════════════════════════════════════════════════════════════
import { el, toast, getSettings } from './ui.js';
import { computeBooking, computeAddOn, formatBaht, formatDateTH, nightsBetween } from './calc.js';
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
  if (b.phone) push('เบอร์โทร', b.phone); // เบอร์ลูกค้า — ไว้ยืนยันว่าจองถูกคน
  push('Check-in', `${formatDateTH(b.checkIn)}  ${inTime} น.`);
  push('Check-out', `${formatDateTH(b.checkOut)}  ${outTime} น.`);
  push('จำนวนคืน', `${nights} คืน`);

  // รายการห้อง (อาจหลายบรรทัด)
  b.lineItems.forEach(li => push('ห้องพัก', describeLine(li)));

  const totalRooms = b.lineItems.reduce((n, li) => n + (Number(li.rooms) || 0), 0);
  push('จำนวนห้อง', `${totalRooms} ห้อง`);

  if (b.addOns?.length) {
    b.addOns.forEach(a => {
      const c = computeAddOn(a);
      const label = c.qty > 1 ? `${a.name} ×${c.qty}` : a.name;
      push('บริการเสริม', c.total > 0 ? `${label} ${formatBaht(c.total)}` : `${label} — ฟรี`);
    });
  } else {
    push('Add on', 'ไม่มี');
  }

  if (b.totalDiscount > 0) push('ยอดเต็ม (ก่อนส่วนลด)', formatBaht(b.grossTotal));
  if (b.billDiscountAmount > 0) {
    const pct = (b.billDiscountType || 'percent') === 'percent' ? ` ${Number(b.billDiscountValue) || 0}%` : '';
    push(`ส่วนลดทั้งบิล${pct}`, `− ${formatBaht(b.billDiscountAmount)}`);
  }
  if (b.totalDiscount > 0) push('ส่วนลดรวม', `− ${formatBaht(b.totalDiscount)}`);

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
    // เบอร์ร้าน — ลูกค้าจะได้โทรกลับได้ทันทีจากการ์ด (ตั้งเบอร์ที่หน้า "ตั้งค่า")
    ...(s?.shopInfo?.phone ? [el('div', { class: 'cc-contact' }, [
      el('span', { class: 'cc-contact-ico', html: icons.phone }),
      el('span', { text: `โทรสอบถาม ${s.shopInfo.phone}` }),
    ])] : []),
    el('div', { class: 'cc-foot', text: s?.shopInfo?.note || 'ขอบคุณที่ไว้วางใจ Perfect Pet House' }),
  ]);
  return card;
}

// สร้าง "ข้อความสรุป" สำหรับก็อปวางส่งทาง Line (คู่กับการ์ดรูป)
export function buildSummaryText(bookingRaw) {
  const b = computeBooking(bookingRaw);
  const s = getSettings();
  const nights = nightsBetween(b.checkIn, b.checkOut) || (b.lineItems[0]?.nights ?? 0);
  const totalRooms = b.lineItems.reduce((n, li) => n + (Number(li.rooms) || 0), 0);
  const L = [];
  L.push(`🐾 สรุปการเข้าพัก — ${s?.shopInfo?.name || 'Perfect Pet House'}`);
  L.push(`ชื่อลูกค้า: ${b.customerName || '-'}`);
  if (b.phone) L.push(`เบอร์โทร: ${b.phone}`);
  L.push(`Check-in: ${formatDateTH(b.checkIn)} เวลา ${b.checkInTime || '09:00'} น.`);
  L.push(`Check-out: ${formatDateTH(b.checkOut)} เวลา ${b.checkOutTime || '14:00'} น.`);
  L.push(`จำนวนคืน: ${nights} คืน · จำนวนห้อง: ${totalRooms} ห้อง`);
  b.lineItems.forEach(li => L.push(`ห้องพัก: ${describeLine(li)}`));
  (b.addOns || []).forEach(a => {
    const c = computeAddOn(a);
    const label = c.qty > 1 ? `${a.name} ×${c.qty}` : a.name;
    L.push(`บริการเสริม: ${label} ${c.total > 0 ? formatBaht(c.total) : '— ฟรี'}`);
  });
  if (b.totalDiscount > 0) {
    L.push(`ยอดเต็ม (ก่อนส่วนลด): ${formatBaht(b.grossTotal)}`);
    L.push(`ส่วนลดรวม: −${formatBaht(b.totalDiscount)}`);
  }
  L.push(`ยอดทั้งหมด: ${formatBaht(b.grandTotal)}`);
  L.push(`มัดจำ ${b.depositPct}%: ${formatBaht(b.depositAmount)}`);
  L.push(`จ่ายเพิ่มวัน Check-in: ${formatBaht(b.balanceDue)}`);
  if (s?.shopInfo?.phone) L.push(`📞 โทรสอบถาม ${s.shopInfo.phone}`);
  if (s?.shopInfo?.note) L.push(s.shopInfo.note);
  return L.join('\n');
}

// คัดลอกข้อความเข้าคลิปบอร์ด (มี fallback สำหรับเบราว์เซอร์เก่า)
export async function copySummaryText(bookingRaw) {
  const text = buildSummaryText(bookingRaw);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('คัดลอกข้อความแล้ว — วางส่งใน Line ได้เลย');
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

// แชร์การ์ดเป็นรูปตรงเข้า Line/แอปอื่น (มือถือ) — ลดขั้นตอนจาก ดาวน์โหลด→เปิด Line→แนบรูป
// เหลือกดปุ่มเดียว · ถ้าเบราว์เซอร์ไม่รองรับแชร์ไฟล์ → ถอยไปแชร์เป็นข้อความผ่าน Line
export async function shareCard(cardEl, bookingRaw) {
  const filename = `สรุป-${bookingRaw.customerName || 'ลูกค้า'}.png`;
  const text = buildSummaryText(bookingRaw);

  // 1) พยายามแชร์เป็นรูปก่อน (สวยที่สุด ลูกค้าเห็นการ์ดเต็มใบ)
  if (typeof html2canvas !== 'undefined' && navigator.canShare) {
    try {
      const canvas = await html2canvas(cardEl, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      if (blob) {
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'สรุปการเข้าพัก', text });
          return;
        }
      }
    } catch (e) {
      if (e?.name === 'AbortError') return; // ผู้ใช้กดยกเลิกเอง ไม่ต้องเด้ง fallback
    }
  }

  // 2) แชร์เป็นข้อความ (Web Share ทั่วไป)
  if (navigator.share) {
    try {
      await navigator.share({ title: 'สรุปการเข้าพัก', text });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }

  // 3) เปิด Line share บนเดสก์ท็อป
  window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  toast('เปิดหน้าต่างแชร์ Line แล้ว');
}
