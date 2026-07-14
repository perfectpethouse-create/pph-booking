// ═══════════════════════════════════════════════════════════════
// config-shop.js — ค่าตั้งต้นของร้าน Perfect Pet House
// ค่าเหล่านี้เป็น "ค่าเริ่มต้น" เท่านั้น เจ้าของร้านแก้ได้ในหน้า "ตั้งค่า"
// (ค่าที่แก้จะถูกเก็บใน settings แล้วใช้ทับค่าตรงนี้)
// ─── กฎแบรนด์: ราคาทั้งหมดอิงไฟล์จริง/ที่เจ้าของยืนยัน ห้ามสมมติ ───
// ═══════════════════════════════════════════════════════════════

export const PET_TYPES = [
  { id: 'dog', label: 'สุนัข' },
  { id: 'cat', label: 'แมว' },
];

// ราคาห้องต่อคืน (บาท) แยกตามสัตว์ — ยืนยันกับเจ้าของร้านเมื่อ 14 ก.ค. 2026
export const DEFAULT_ROOM_PRICES = {
  cozy:   { label: 'Cozy Room',     dog: 790,  cat: 690  },
  deluxe: { label: 'Deluxe Room',   dog: 990,  cat: 990  },
  vip:    { label: 'VIP Villa Room', dog: 1890, cat: 1890 },
};

// ราคาโปร VIP เฉพาะลูกค้าที่จองภายในวันที่สอบถาม (ปุ่มลัดในฟอร์ม)
export const VIP_PROMO_PRICE = 1590;

// จำนวนห้องที่ร้านมี (capacity) ต่อประเภท — สำหรับปฏิทิน/เตือนจองเกิน
// *** เจ้าของร้านต้องแก้ให้ตรงจำนวนจริงในหน้า "ตั้งค่า" ***
export const DEFAULT_ROOM_CAPACITY = {
  cozy:   4,
  deluxe: 3,
  vip:    2,
};

// บริการเสริมที่ใช้บ่อย (เลือกใส่ในการจองได้) — ราคาอ้างอิง context ร้าน
export const DEFAULT_ADDON_SERVICES = [
  { name: 'อาบน้ำ/ตัดขน (Grooming)', price: 0 },
  { name: 'Day Care (เหมาวัน)',        price: 450 },
  { name: 'สปาโอโซน',                  price: 150 },
  { name: 'Late check-out (ต่อชั่วโมง/ตัว)', price: 100 },
];

// มัดจำเริ่มต้น = 50% (นโยบายร้าน: จ่ายครึ่งตอนจอง เหลือครึ่งวันเข้าพัก)
export const DEFAULT_DEPOSIT_PCT = 50;

// เวลาเช็คอิน/เอาท์เริ่มต้น
export const DEFAULT_CHECKIN_TIME = '09:00';
export const DEFAULT_CHECKOUT_TIME = '14:00';

export const DEPOSIT_STATUSES = ['ยังไม่มัดจำ', 'มัดจำแล้ว', 'จ่ายครบแล้ว', 'ยกเลิก'];
export const RECORD_STATUSES = ['ยังไม่ลงระบบ', 'ลงระบบ'];

export const SHOP_INFO = {
  name: 'Perfect Pet House',
  phone: '',
  note: 'Check-in 9:00–18:00 · Check-out 14:00',
};

// รวมค่าตั้งต้นทั้งหมดเป็น settings หนึ่งก้อน (ใช้ตอนยังไม่มีใน DB)
export function defaultSettings() {
  return {
    roomPrices: structuredClone(DEFAULT_ROOM_PRICES),
    roomCapacity: structuredClone(DEFAULT_ROOM_CAPACITY),
    addOnServices: structuredClone(DEFAULT_ADDON_SERVICES),
    depositPctDefault: DEFAULT_DEPOSIT_PCT,
    vipPromoPrice: VIP_PROMO_PRICE,
    shopInfo: structuredClone(SHOP_INFO),
  };
}
