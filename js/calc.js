// ═══════════════════════════════════════════════════════════════
// calc.js — สูตรคำนวณทั้งหมด (pure functions ไม่ยุ่งกับ DB/หน้าจอ)
// อิงจากตารางจริง เช่น แถว 4: 790 × 2 × 3 − 600 = 4,140 · มัดจำ 2,070
// ═══════════════════════════════════════════════════════════════

// ปัดเป็นทศนิยม 2 ตำแหน่งแบบปลอดภัย (กัน floating point เพี้ยน)
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// จำนวนคืนจากวันเข้า-ออก (ค.ศ. ISO 'YYYY-MM-DD') — คืน >= 0
export function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const a = new Date(checkIn + 'T00:00:00');
  const b = new Date(checkOut + 'T00:00:00');
  const diff = Math.round((b - a) / 86400000);
  return diff > 0 ? diff : 0;
}

// ยอดส่วนลดของ 1 รายการ: รองรับทั้ง % และจำนวนเงิน
// discountType: 'percent' | 'amount' ; discountValue: ตัวเลข
export function lineDiscountAmount(gross, discountType, discountValue) {
  const v = Number(discountValue) || 0;
  if (v <= 0) return 0;
  if (discountType === 'percent') return round2(gross * v / 100);
  return round2(v); // amount
}

// คำนวณ 1 line item ให้ครบ → คืน object เดิม + subtotal/discountAmount/gross
export function computeLineItem(item) {
  const price = Number(item.pricePerNight) || 0;
  const rooms = Number(item.rooms) || 0;
  const nights = Number(item.nights) || 0;
  const gross = round2(price * rooms * nights);
  const discountAmount = lineDiscountAmount(gross, item.discountType, item.discountValue);
  const subtotal = round2(Math.max(0, gross - discountAmount));
  return { ...item, gross, discountAmount, subtotal };
}

// ผลรวมบริการเสริม
export function addOnsTotal(addOns = []) {
  return round2(addOns.reduce((s, a) => s + (Number(a.price) || 0), 0));
}

// คำนวณยอดทั้งการจอง → grandTotal, deposit, balance, และ line items ที่คำนวณแล้ว
export function computeBooking(booking) {
  const lineItems = (booking.lineItems || []).map(computeLineItem);
  const itemsTotal = round2(lineItems.reduce((s, li) => s + li.subtotal, 0));
  const addonSum = addOnsTotal(booking.addOns);
  const grandTotal = round2(itemsTotal + addonSum);

  const depositPct = booking.depositPct == null ? 50 : Number(booking.depositPct);
  const depositAmount = round2(grandTotal * depositPct / 100);
  const balanceDue = round2(grandTotal - depositAmount); // จ่ายเพิ่มวันเข้าพัก

  const totalDiscount = round2(lineItems.reduce((s, li) => s + li.discountAmount, 0));

  return {
    ...booking,
    lineItems,
    itemsTotal,
    addOnsTotal: addonSum,
    totalDiscount,
    grandTotal,
    depositPct,
    depositAmount,
    balanceDue,
  };
}

// ─── ฟอร์แมตแสดงผล ───

export function formatBaht(n, withSymbol = true) {
  const num = Number(n) || 0;
  const s = num.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return withSymbol ? `฿${s}` : s;
}

// วันที่ ISO → รูปแบบไทยอ่านง่าย เช่น 13/07/2026
export function formatDateTH(iso) {
  if (!iso) return '-';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// วันนี้เป็น ISO 'YYYY-MM-DD' (โซนเวลาเครื่อง)
export function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}
