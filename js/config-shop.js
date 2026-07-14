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

// จำนวนห้องที่ร้านมี (capacity) ต่อประเภท แยกห้องสุนัข/ห้องแมว
// *** เจ้าของร้านต้องแก้ให้ตรงจำนวนจริงในหน้า "ตั้งค่า" ***
export const DEFAULT_ROOM_CAPACITY = {
  cozy:   { dog: 4, cat: 4 },
  deluxe: { dog: 3, cat: 3 },
  vip:    { dog: 2, cat: 2 },
};

// อ่านความจุแบบปลอดภัย — รองรับข้อมูลเก่าที่เก็บเป็นตัวเลขเดียว (รวมทุกสัตว์)
// pet ระบุ = ความจุของสัตว์นั้น · ไม่ระบุ = รวมทุกสัตว์
export function capacityOf(capacity, roomType, pet) {
  const c = capacity?.[roomType];
  if (c == null) return 0;
  if (typeof c === 'number') return c; // ข้อมูลเก่า: ตัวเลขรวม
  if (pet) return Number(c[pet]) || 0;
  return (Number(c.dog) || 0) + (Number(c.cat) || 0);
}

// บริการเสริมราคาคงที่ — เจ้าของร้านยืนยันราคาเมื่อ 14 ก.ค. 2026
// unit ใช้เป็นหน่วยของ "จำนวน" (คูณราคาต่อหน่วย)
export const FIXED_ADDONS = [
  { name: 'พี่เลี้ยงนอนด้วย', unitPrice: 300, unit: 'คืน' },
  { name: 'กล้องวงจรปิด',    unitPrice: 100, unit: 'คืน' },
  { name: 'ป้อนยา',           unitPrice: 200, unit: 'ตัว' },
  { name: 'ต้มอาหารให้',      unitPrice: 50,  unit: 'มื้อ' },
];

// บริการเสริมอื่นๆ (แก้ไขได้ในหน้า "ตั้งค่า") — ราคาอ้างอิง context ร้าน
export const DEFAULT_ADDON_SERVICES = [
  { name: 'สปาโอโซน',                  price: 150 },
  { name: 'Late check-out (ต่อชั่วโมง/ตัว)', price: 100 },
];

// ─── Day Care เหมาเต็มวัน (9.00–20.00 น.) — ไซส์คนละชุดกับ Grooming ───
// อ้างอิง perfect-pet-house-context.md หมวด 4 (จากโปสเตอร์จริง)
export const DAYCARE_SIZES = {
  dog: [
    { id: 's',  label: 'S (<5 กก.)' },
    { id: 'm',  label: 'M (5-10 กก.)' },
    { id: 'l',  label: 'L (10-20 กก.)' },
    { id: 'xl', label: 'XL (>20 กก.)' },
  ],
  cat: [
    { id: 's',  label: 'S (<3 กก.)' },
    { id: 'm',  label: 'M (3-7 กก.)' },
    { id: 'l',  label: 'L (7-11 กก.)' },
    { id: 'xl', label: 'XL (>11 กก.)' },
  ],
};
export const DAYCARE_PRICES = {
  dog: { s: 450, m: 500, l: 550, xl: 600 },
  cat: { s: 400, m: 450, l: 500, xl: 550 },
};
export function daycarePrice(pet, size) {
  return DAYCARE_PRICES[pet]?.[size] || 0;
}

// ─── ตารางราคาอาบน้ำ/ตัดขน (Grooming) ───
// อ้างอิง perfect-pet-house-context.md (จากโปสเตอร์จริง อัปเดต 22 มิ.ย. 2569)
// bath = ราคาอาบน้ำตามขน · cut = ค่าตัดขนเพิ่มจากอาบน้ำ
export const GROOMING_SIZES = {
  dog: [
    { id: 'xs',  label: 'XS (<2 กก.)' },
    { id: 's',   label: 'S (2-5 กก.)' },
    { id: 'm',   label: 'M (5-10 กก.)' },
    { id: 'l',   label: 'L (10-15 กก.)' },
    { id: 'xl',  label: 'XL (15-20 กก.)' },
    { id: '2xl', label: '2XL (20-30 กก.)' },
    { id: '3xl', label: '3XL (30-40 กก.)' },
    { id: '4xl', label: '4XL (40-50 กก.)' },
    { id: '5xl', label: '5XL (>50 กก.)' },
  ],
  cat: [
    { id: 'xs',  label: 'XS (<2 กก.)' },
    { id: 's',   label: 'S (2-3 กก.)' },
    { id: 'm',   label: 'M (3-5 กก.)' },
    { id: 'l',   label: 'L (5-7 กก.)' },
    { id: 'xl',  label: 'XL (7-9 กก.)' },
    { id: '2xl', label: '2XL (9-11 กก.)' },
    { id: '3xl', label: '3XL (11-13 กก.)' },
    { id: '4xl', label: '4XL (13-15 กก.)' },
    { id: '5xl', label: '5XL (>15 กก.)' },
  ],
};

export const COAT_TYPES = {
  dog: [
    { id: 'short',   label: 'ขนสั้น' },
    { id: 'long',    label: 'ขนยาว' },
    { id: 'longSet', label: 'ขนยาวมีเซ็ต' },
  ],
  cat: [
    { id: 'short', label: 'ขนสั้น' },
    { id: 'long',  label: 'ขนยาว' },
  ],
};

export const GROOMING_PRICES = {
  dog: {
    xs:  { short: 350,  long: 400,  longSet: 450,  cut: 400 },
    s:   { short: 400,  long: 500,  longSet: 600,  cut: 500 },
    m:   { short: 500,  long: 700,  longSet: 900,  cut: 600 },
    l:   { short: 700,  long: 900,  longSet: 1000, cut: 700 },
    xl:  { short: 900,  long: 1100, longSet: 1400, cut: 900 },
    '2xl': { short: 1200, long: 1450, longSet: 1600, cut: 1200 },
    '3xl': { short: 1650, long: 1850, longSet: 1900, cut: 1600 },
    '4xl': { short: 2200, long: 2150, longSet: 2400, cut: 2200 },
    '5xl': { short: 2850, long: 3100, longSet: 3300, cut: 2800 },
  },
  cat: {
    xs:  { short: 450,  long: 550,  cut: 450 },
    s:   { short: 550,  long: 650,  cut: 550 },
    m:   { short: 750,  long: 850,  cut: 750 },
    l:   { short: 950,  long: 1100, cut: 950 },
    xl:  { short: 1250, long: 1400, cut: 1250 },
    '2xl': { short: 1400, long: 1600, cut: 1400 },
    '3xl': { short: 1750, long: 1850, cut: 1750 },
    '4xl': { short: 2100, long: 2250, cut: 2100 },
    '5xl': { short: 2650, long: 2800, cut: 2650 },
  },
};

// ราคาอาบน้ำ (บาท/ตัว) ตามสัตว์+ไซส์+ขน · includeCut = อาบน้ำตัดขน
export function groomingPrice(pet, size, coat, includeCut = false) {
  const row = GROOMING_PRICES[pet]?.[size];
  if (!row) return 0;
  const bath = row[coat] ?? row.short ?? 0;
  return bath + (includeCut ? (row.cut || 0) : 0);
}

// โปรของแถม: พักครบ N คืนขึ้นไป ได้อาบน้ำฟรี 1 สิทธิ์/ห้อง
export const FREE_BATH_MIN_NIGHTS = 5;
export const FREE_BATH_ADDON_NAME = 'อาบน้ำฟรี (โปรพัก 5 คืนขึ้นไป)';

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
