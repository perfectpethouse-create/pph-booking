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

// คำนวณบริการเสริม 1 รายการ — รองรับทั้งแบบใหม่ (qty × unitPrice)
// และแบบเก่า (price ก้อนเดียว) เพื่อไม่ให้ข้อมูลเดิมใน DB พัง
export function computeAddOn(a) {
  const qty = a.qty == null ? 1 : (Number(a.qty) || 0);
  const hasUnit = a.unitPrice != null;
  const unitPrice = hasUnit ? (Number(a.unitPrice) || 0) : (Number(a.price) || 0);
  const total = hasUnit ? round2(unitPrice * qty) : round2(Number(a.price) || 0);
  return { ...a, qty, unitPrice, total };
}

// ผลรวมบริการเสริม
export function addOnsTotal(addOns = []) {
  return round2(addOns.reduce((s, a) => s + computeAddOn(a).total, 0));
}

// จำนวนสิทธิ์อาบน้ำฟรี: 1 สิทธิ์/ห้อง ที่พักครบ minNights คืน
export function freeBathRights(lineItems = [], minNights = 5) {
  return lineItems.reduce((n, li) =>
    n + ((Number(li.nights) || 0) >= minNights ? (Number(li.rooms) || 0) : 0), 0);
}

// คำนวณยอดทั้งการจอง → grandTotal, deposit, balance, และ line items ที่คำนวณแล้ว
export function computeBooking(booking) {
  const lineItems = (booking.lineItems || []).map(computeLineItem);
  const itemsTotal = round2(lineItems.reduce((s, li) => s + li.subtotal, 0));
  const addonSum = addOnsTotal(booking.addOns);
  // ยอดเต็มก่อนหักส่วนลดใดๆ (ค่าห้องเต็ม + บริการเสริม)
  const grossTotal = round2(lineItems.reduce((s, li) => s + li.gross, 0) + addonSum);
  const beforeBillDiscount = round2(itemsTotal + addonSum);

  // ส่วนลดทั้งบิล (คิดจากยอดรวมค่าห้อง+บริการเสริม) — % หรือบาท
  const billDiscountAmount = lineDiscountAmount(
    beforeBillDiscount, booking.billDiscountType || 'percent', booking.billDiscountValue);
  const grandTotal = round2(Math.max(0, beforeBillDiscount - billDiscountAmount));

  const depositPct = booking.depositPct == null ? 50 : Number(booking.depositPct);
  const depositAmount = round2(grandTotal * depositPct / 100);
  const balanceDue = round2(grandTotal - depositAmount); // จ่ายเพิ่มวันเข้าพัก

  const lineDiscounts = round2(lineItems.reduce((s, li) => s + li.discountAmount, 0));
  const totalDiscount = round2(lineDiscounts + billDiscountAmount);

  return {
    ...booking,
    lineItems,
    itemsTotal,
    addOnsTotal: addonSum,
    grossTotal,
    beforeBillDiscount,
    billDiscountAmount,
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
