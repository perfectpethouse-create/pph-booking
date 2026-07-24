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

// รูปแบบบริการ Grooming ที่ร้านรับ
// (ยืนยันกับเจ้าของร้าน 19 ก.ค. 2569: ตัดขนอย่างเดียวคิดเท่าค่าตัดขนในตาราง)
export const GROOMING_SERVICES = [
  { id: 'bath', label: 'อาบน้ำอย่างเดียว' },
  { id: 'cut', label: 'ตัดขนอย่างเดียว' },
  { id: 'bathCut', label: 'อาบน้ำ + ตัดขน' },
];

// อ่านรูปแบบบริการจากนัดหมาย — รองรับข้อมูลเก่าที่เก็บเป็น includeCut (true/false)
// ก่อนจะมีตัวเลือก "ตัดขนอย่างเดียว" จึงต้องแปลงให้ใบเก่ายังแสดงถูก
export function groomServiceOf(a) {
  if (a?.groomService) return a.groomService;
  return a?.includeCut ? 'bathCut' : 'bath';
}

export function groomServiceLabel(service) {
  return (GROOMING_SERVICES.find(s => s.id === service) || {}).label || 'อาบน้ำอย่างเดียว';
}

// ราคา Grooming (บาท/ตัว) ตามสัตว์ + ไซส์ + ขน + รูปแบบบริการ
//   bath    = ราคาอาบน้ำตามชนิดขน
//   cut     = ค่าตัดขนในตาราง (ใช้เป็นราคาตัดขนอย่างเดียวด้วย)
//   bathCut = อาบน้ำ + ค่าตัดขน
export function groomingPrice(pet, size, coat, service = 'bath') {
  const row = GROOMING_PRICES[pet]?.[size];
  if (!row) return 0;
  const bath = row[coat] ?? row.short ?? 0;
  const cut = row.cut || 0;
  // รองรับโค้ดเดิมที่ส่ง boolean มา (true = อาบน้ำ+ตัดขน)
  if (service === true) return bath + cut;
  if (service === 'cut') return cut;
  if (service === 'bathCut') return bath + cut;
  return bath;
}

// โปรของแถม: พักครบ N คืนขึ้นไป ได้อาบน้ำฟรี 1 สิทธิ์/ห้อง
export const FREE_BATH_MIN_NIGHTS = 5;
export const FREE_BATH_ADDON_NAME = 'อาบน้ำฟรี (โปรพัก 5 คืนขึ้นไป)';

// มัดจำเริ่มต้น = 50% (นโยบายร้าน: จ่ายครึ่งตอนจอง เหลือครึ่งวันเข้าพัก)
export const DEFAULT_DEPOSIT_PCT = 50;

// เวลาเช็คอิน/เอาท์เริ่มต้น
export const DEFAULT_CHECKIN_TIME = '09:00';
export const DEFAULT_CHECKOUT_TIME = '14:00';

// ═══ แมปคำขอจองจากเว็บ perfectbkk.com → ระบบภายใน ═══
// ฟอร์มบนเว็บส่ง service เป็นข้อความ (จาก <option> จริงในหน้าเว็บ)
// ต้องแมปเป็นประเภทเพื่อติดป้ายและตัดสินว่าเป็นการจองห้องพักไหม
// ⚠️ ถ้าเว็บเพิ่ม/แก้ตัวเลือกบริการ ต้องอัปเดตที่นี่ด้วย
export const REQUEST_TYPES = {
  boarding: { label: 'ฝากเลี้ยง (ค้างคืน)', color: 'blue', isStay: true },
  boardingGroom: { label: 'ฝากเลี้ยง + อาบน้ำตัดขน', color: 'blue', isStay: true },
  daycare: { label: 'Day Care', color: 'orange', isStay: false },
  grooming: { label: 'อาบน้ำตัดขน', color: 'purple', isStay: false },
  bath: { label: 'อาบน้ำ', color: 'purple', isStay: false },
  exercise: { label: 'โซนออกกำลังกาย', color: 'green', isStay: false },
  other: { label: 'อื่นๆ', color: 'grey', isStay: false },
};

// จำแนกประเภทคำขอจากข้อความ service ที่เว็บส่งมา
export function classifyRequest(service = '') {
  const t = String(service);
  if (/โซนออกกำลังกาย|Dog Park|Paw Splash/i.test(t)) return 'exercise';
  if (/ฝากเลี้ยง/.test(t) && /ตัดขน|อาบน้ำ/.test(t)) return 'boardingGroom';
  if (/ฝากเลี้ยง/.test(t)) return 'boarding';
  if (/Day\s*Care/i.test(t)) return 'daycare';
  if (/ตัดขน/.test(t)) return 'grooming';
  if (/อาบน้ำ/.test(t)) return 'bath';
  return 'other';
}

// เว็บส่งชนิดสัตว์เป็น "น้องหมา"/"น้องแมว"/"อื่นๆ" → แปลงเป็น id ในระบบ
export function petIdFromWeb(pet = '') {
  return /แมว|cat/i.test(String(pet)) ? 'cat' : 'dog';
}

// ช่องทางรับเงินของร้าน — ยืนยันกับเจ้าของร้าน 16 ก.ค. 2026
export const PAYMENT_METHODS = ['โอนธนาคาร', 'เงินสด', 'QR/พร้อมเพย์', 'บัตรเครดิต/เดบิต'];
export const DEFAULT_DEPOSIT_METHOD = 'โอนธนาคาร'; // มัดจำส่วนใหญ่โอนเข้าบัญชี

// เกณฑ์ "ลูกค้าประจำ" — ยืนยันกับเจ้าของร้าน: พักครบ 5 ครั้งขึ้นไป
// (เป็นป้ายสถานะไว้ดูแลลูกค้า ไม่ใช่ส่วนลด — กฎแบรนด์ห้ามแข่งราคา)
export const LOYAL_CUSTOMER_MIN_STAYS = 5;

export const DEPOSIT_STATUSES = ['ยังไม่มัดจำ', 'มัดจำแล้ว', 'จ่ายครบแล้ว', 'ยกเลิก'];
export const RECORD_STATUSES = ['ยังไม่ลงระบบ', 'ลงระบบ'];

// ═══════════════════════════════════════════════════════════════
// ข้อตกลง/กฎระเบียบสำหรับ "ใบรับฝากสัตว์เลี้ยง" (พิมพ์ให้ลูกค้าเซ็นตอนเช็คอิน)
//
// ⚠️ แหล่งความจริง (source of truth) คือไฟล์:
//    สร้างเว็บ app ให้ร้าน/apps-script/กฎระเบียบและนโยบาย-เข้าพัก.md
//    ซึ่งถอดความ verbatim จากรูปฟอร์มจริงของร้าน และใช้ในหน้า perfectbkk.com/checkin.html
//    👉 ถ้าร้านแก้นโยบาย ต้องแก้ที่ไฟล์ต้นฉบับนั้น แล้วซิงก์มาที่นี่ด้วย (2 ที่)
//
// ห้ามแต่ง/เพิ่มข้อกฎหมายเองเด็ดขาด — ต้องตรงกับที่ลูกค้ายอมรับตอนลงทะเบียนออนไลน์
// ═══════════════════════════════════════════════════════════════
export const INTAKE_TERMS = [
  {
    title: '1. การจองห้องพักและบริการ',
    items: [
      'ลูกค้าชำระค่าบริการครึ่งราคา (50%) เพื่อยืนยันการจองห้องพัก',
      'เมื่อลูกค้ามาถึงโรงแรมต้องชำระอีกครึ่งราคา (50%) เพื่อเข้าพักและรับบริการต่างๆ',
      'การจองถือว่าสำเร็จเมื่อได้รับการชำระเงินเท่านั้น',
      'กรุณาเก็บหลักฐานการชำระเงินไว้ทุกครั้ง',
    ],
  },
  {
    title: '2. นโยบายการยกเลิก / เลื่อนการเข้าพัก',
    items: [
      'Low season: ยกเลิกต้องแจ้งล่วงหน้าอย่างน้อย 3 วัน · ไม่มีนโยบายคืนเงิน แต่เก็บยอดเป็นเครดิตใช้ภายใน 6 เดือนนับจากวันจอง หักได้เฉพาะค่าห้องพักเท่านั้น',
      'High season (5–20 เม.ย. และ 15 ธ.ค.–5 ม.ค.): ไม่มีนโยบายคืนเงิน และไม่เก็บยอดเป็นเครดิต หากยกเลิก',
      'การรับสุนัขออกก่อนกำหนด: ไม่มีนโยบายคืนเงินหรือเก็บยอดคงเหลือไว้ ไม่ว่ากรณีใด',
      'การเพิ่มคืนเข้าพัก: กรุณาแจ้งล่วงหน้า หากห้องพักเต็มทางโรงแรมจะจัดให้เข้าพักในห้องสำรอง',
    ],
  },
  {
    title: '3. เงื่อนไขการเข้าพัก',
    items: [
      'สุนัข/แมวต้องไม่มีเห็บหมัด และได้รับยาป้องกันเห็บหมัดอย่างสม่ำเสมอ',
      'ต้องได้รับวัคซีนพื้นฐานครบและต่อเนื่อง',
      'ต้องมีสุขภาพแข็งแรง ไม่เป็นโรคติดต่อ, โรคผิวหนัง หรืออยู่ในช่วงพักฟื้น',
      'ต้องมีพฤติกรรมเป็นมิตร ไม่ดุ ไม่เคยมีพฤติกรรมทำร้ายคนหรือสุนัข/แมวอื่น',
      'เจ้าของต้องรับผิดชอบความเสียหายหากสุนัข/แมวทำร้ายเจ้าหน้าที่หรือทำลายทรัพย์สินของโรงแรม',
    ],
  },
  {
    title: '4. เหตุฉุกเฉินและสุขภาพ',
    items: [
      'โรงแรมจะดูแลสุนัข/แมวทุกตัวอย่างดีที่สุดโดยเน้นเรื่องสุขอนามัยเป็นอันดับหนึ่ง',
      'เนื่องจากสุนัข/แมวหลายตัวใช้พื้นที่ร่วมกัน จึงไม่สามารถหลีกเลี่ยงโรคภัยต่างๆ ที่เกิดจากสุนัข/แมวได้',
      'หากสุนัข/แมวเจ็บป่วย โรงแรมสามารถนำส่งโรงพยาบาลสัตว์ได้ในทุกช่วงเวลา เจ้าของเป็นผู้รับผิดชอบค่ารักษาพยาบาล',
      'โรงแรมจะรับผิดชอบเฉพาะค่าใช้จ่ายเบื้องต้นกรณีเกิดอุบัติเหตุหรือเหตุสุดวิสัยที่เกิดจากความบกพร่องของทางโรงแรมเท่านั้น',
      'การจัดห้องพักใหม่ กรุณาแจ้งก่อนเวลา 20.00 น. · หลัง 20.00 น. จะขึ้นไปกรณีฉุกเฉินเท่านั้น เพื่อลดการรบกวนและความเครียดของสัตว์ตัวอื่น',
    ],
  },
  {
    title: '5. การรับ-ส่งสุนัข/แมว',
    items: [
      'เช็คอิน 9:00–18:00 น. · เช็คเอาท์ 14:00 น. (เลทได้ 30 นาที)',
      'เช็คเอาท์หลัง 14.00 น. คิดค่าบริการ Day care (ฝากเลี้ยงระหว่างวัน)',
      'เปิดบริการรับ-ส่งระหว่าง 10:00–20:00 น.',
      'ส่งก่อนเวลาทำการ ส่งได้ตั้งแต่ 08:30 น. คิดค่าล่วงเวลา 100 บาท/ตัว',
      'รับกลับหลัง 20:00 น. คิดเพิ่ม 50% ของห้องพักหลังเช็คเอาท์ในคืนนั้นๆ · มารับไม่เกิน 21:00 น. หากเกินเวลากรุณารับในวันถัดไป',
      'กรุณาระบุเวลานัดรับ-ส่งล่วงหน้า',
    ],
  },
  {
    title: '6. การใช้ภาพถ่าย / วิดีโอ',
    items: [
      'ทางโรงแรมอาจถ่ายภาพและวิดีโอเพื่อใช้ในการประชาสัมพันธ์ผ่านช่องทางออนไลน์',
      'หากไม่สะดวก กรุณาแจ้งล่วงหน้าว่าไม่ต้องการให้ใช้ภาพสุนัขของท่าน',
    ],
  },
];

// ข้อความยืนยันที่ลูกค้ารับทราบ (ตรงกับหน้า checkin.html ส่วน renderConsent)
export const INTAKE_CONSENT = [
  'ข้อมูลทั้งหมดที่กรอกถูกต้องและเป็นความจริง',
  'ในกรณีฉุกเฉิน โรงแรมมีสิทธิ์นำสัตว์เลี้ยงไปรับการรักษาจากสัตวแพทย์ โดยค่าใช้จ่ายเป็นของเจ้าของ',
  'ยินยอมให้โรงแรมถ่ายภาพ/วิดีโอสัตว์เลี้ยงเพื่ออัพเดทรายงาน',
  'ข้าพเจ้าอ่านกฎระเบียบและนโยบายของ Perfect Pet House เรียบร้อยแล้ว',
];

export const SHOP_INFO = {
  name: 'Perfect Pet House',
  phone: '',
  note: 'Check-in 9:00–18:00 · Check-out 14:00',
};

// รวมค่าตั้งต้นทั้งหมดเป็น settings หนึ่งก้อน (ใช้ตอนยังไม่มีใน DB)
// ═══════════ โซนออกกำลังกาย (Dog Park + Paw Splash) ═══════════
// ⚠️ ที่มาของราคา: public/exercise-zone.html บนเว็บจริง (ตาราง "ดูตารางราคาทั้งหมด")
//    ตัวเลขที่นี่เป็นเพียง "ค่าเริ่มต้น" — เจ้าของร้านแก้ได้ในหน้าตั้งค่า (settings.exercisePrices)
//    ถ้าแก้ราคาในแอป อย่าลืมแก้บนหน้าเว็บให้ตรงกันด้วย
export const EXERCISE_SIZES = [
  { id: 'S', label: 'S (0–10 กก.)' },
  { id: 'M', label: 'M (10–20 กก.)' },
  { id: 'L', label: 'L (20–30 กก.)' },
  { id: 'XL', label: 'XL (30 กก. ขึ้นไป)' },
];

export const EXERCISE_LEVELS = [
  { id: '1', label: 'ระดับ 1 — สนาม' },
  { id: '2', label: 'ระดับ 2 — สระ + สนาม' },
  { id: '3', label: 'ระดับ 3 — สระ + สนาม + อาบน้ำ' },
];

export const EXERCISE_PRICES = {
  S: { 1: 690, 2: 890, 3: 990 },
  M: { 1: 790, 2: 1090, 3: 1290 },
  L: { 1: 890, 2: 1290, 3: 1490 },
  XL: { 1: 990, 2: 1490, 3: 1790 },
};

// รอบเวลา 60 นาที — เว้น 12:00 (พักกลางวัน) ตรงกับตัวเลือกบนหน้าเว็บ
export const EXERCISE_SLOTS = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
export const EXERCISE_DURATION_MIN = 60;
// อัตราพี่เลี้ยง 1 : 3 ตัว — น้องตัวที่ 2 ของบ้านเดียวกันในรอบเดียวกันก็นับเป็นอีก 1 ที่
export const EXERCISE_CAPACITY = 3;

// เวลาที่ใช้จริงต่อตัว (ยืนยันกับเจ้าของร้าน 19 ก.ค. 2569):
//   อาบน้ำอย่างเดียว 1–2 ชม. · อาบน้ำ+ตัดขน 2–3 ชม.
// ระบบจองเวลาบล็อกตาม "ค่ามากสุด" เพื่อไม่ให้รับคิวถี่เกินจนงานล้น
// ส่วนช่วงเวลาที่แสดงให้พนักงานใช้ค่าต่ำ–สูง ตามที่บอกลูกค้าจริง
export const GROOMING_BATH_MIN = 60;
export const GROOMING_BATH_MAX = 120;
export const GROOMING_CUT_MIN = 120;
export const GROOMING_CUT_MAX = 180;
// ค่าเดิมที่โค้ดอื่นอาจอ้างถึง — เท่ากับกรณีอาบน้ำ+ตัดขนแบบเร็วสุด
export const GROOMING_DURATION_MIN = GROOMING_CUT_MIN;

// เวลาที่ต้องกันไว้ต่อรูปแบบบริการ (ค่ามากสุด เพื่อไม่ให้รับคิวถี่เกินจริง)
export function groomingDuration(service) {
  return (service === 'cut' || service === 'bathCut' || service === true)
    ? GROOMING_CUT_MAX : GROOMING_BATH_MAX;
}

// ข้อความช่วงเวลาที่ใช้บอกพนักงาน/ลูกค้า
export function groomingDurationLabel(service) {
  return (service === 'cut' || service === 'bathCut' || service === true)
    ? '2–3 ชั่วโมง' : '1–2 ชั่วโมง';
}
// รอบ Grooming ทุกครึ่งชั่วโมง — รอบสุดท้าย 19:00 (ยืนยันกับเจ้าของร้าน 19 ก.ค. 2569)
// เว้นช่วง 12:00–12:30 เป็นเวลาพักกลางวัน
// (โซนออกกำลังกายยังเป็นรอบเต็มชั่วโมงตามที่ประกาศบนหน้าเว็บ — อย่าเปลี่ยนโดยไม่แก้เว็บด้วย)
export const GROOMING_SLOTS = (() => {
  const out = [];
  for (let m = 9 * 60; m <= 19 * 60; m += 30) {
    const h = Math.floor(m / 60);
    if (h === 12) continue; // พักกลางวัน
    out.push(`${String(h).padStart(2, '0')}:${m % 60 === 0 ? '00' : '30'}`);
  }
  return out;
})();
// งานตัดขนใช้เวลานานกว่า จึงต้องเริ่มไม่เกิน 18:00 — รอบ 19:00 รับเฉพาะอาบน้ำ
export const GROOMING_CUT_LAST_SLOT = '18:00';
// จำนวนคิว Grooming ที่รับพร้อมกันต่อรอบ = จำนวนช่าง — ตั้งได้ในหน้าตั้งค่า
export const DEFAULT_GROOMING_CAPACITY = 1;

export const APPOINTMENT_TYPES = [
  { id: 'grooming', label: 'Grooming (อาบน้ำ-ตัดขน)' },
  { id: 'exercise', label: 'โซนออกกำลังกาย' },
];

export const APPOINTMENT_STATUSES = ['จองแล้ว', 'มาแล้ว', 'เสร็จแล้ว', 'ยกเลิก'];

// ราคา 1 รอบของโซนออกกำลังกาย — อ่านจากค่าที่เจ้าของร้านตั้งไว้ก่อน แล้วค่อย fallback
export function exercisePrice(size, level, settings) {
  const table = settings?.exercisePrices || EXERCISE_PRICES;
  return table?.[size]?.[level] ?? EXERCISE_PRICES?.[size]?.[level] ?? 0;
}

// ── หลายน้องในคิวเดียว (appointment.pets[]) ──
// อ่านรายการน้องแบบเข้ากันได้กับข้อมูลเก่า: ถ้าไม่มี pets[] ให้สังเคราะห์เป็น 1 ตัว
// จากฟิลด์เดี่ยวเดิม (petName/size/coat/... หรือ exSize/level) → คิวเก่าทำงานได้หมด
export function petsOf(a) {
  if (Array.isArray(a?.pets) && a.pets.length) return a.pets;
  if (a?.type === 'exercise') {
    return [{ petName: a.petName || '', exSize: a.exSize || 'S', level: a.level || '1' }];
  }
  return [{
    petName: a?.petName || '', petType: a?.petType || 'dog',
    size: a?.size || '', coatType: a?.coatType || 'short', groomService: groomServiceOf(a),
  }];
}
// จำนวนน้องในคิว = ความจุที่กินไปในรอบ (ใบเก่าไม่มี pets[] = 1 ตัว)
export function petCountOf(a) {
  return Array.isArray(a?.pets) && a.pets.length ? a.pets.length : 1;
}
// ราคาต่อน้อง 1 ตัว — reuse ตารางราคาเดิม (grooming/exercise)
export function petPrice(pet, type, settings) {
  if (type === 'exercise') return exercisePrice(pet.exSize, pet.level, settings);
  if (!pet.size) return 0;
  return groomingPrice(pet.petType, pet.size, pet.coatType, groomServiceOf(pet));
}
// เวลาที่ต้องกันไว้ต่อน้อง 1 ตัว
export function petDuration(pet, type) {
  if (type === 'exercise') return EXERCISE_DURATION_MIN;
  return groomingDuration(groomServiceOf(pet));
}

// ── สิทธิ์พี่เลี้ยง: เมนูที่เจ้าของร้านเปิด-ปิดได้เอง ──
// ⚠️ "ตั้งค่า" และ "สำรองข้อมูล" ไม่อยู่ในลิสต์นี้โดยตั้งใจ และห้ามเพิ่มเข้ามา:
//    · เปิด "ตั้งค่า" = พี่เลี้ยงลบอีเมลตัวเองออกจาก staffEmails แล้วกลายเป็นเจ้าของร้านได้
//    · เปิด "สำรองข้อมูล" = ดึงยอดเงินทั้งร้านออกไปได้
export const STAFF_PERM_ITEMS = [
  { route: 'today', label: 'งานวันนี้', hint: 'รายการรับ-ส่งของวันนี้' },
  { route: 'calendar', label: 'ปฏิทินห้องว่าง', hint: 'ดูห้องว่างเพื่อรับจองหน้าร้าน' },
  { route: 'customers', label: 'ลูกค้า & สัตว์เลี้ยง', hint: 'แก้โน้ตสุขภาพ/วัคซีนได้' },
  { route: 'registrations', label: 'ลงทะเบียนเช็คอิน', hint: 'รับใบลงทะเบียน พิมพ์ใบยืนยัน' },
  { route: 'bookings', label: 'การจองทั้งหมด', hint: 'สร้างการจองและแจ้งราคาลูกค้าได้ · แก้/ลบใบเดิมไม่ได้' },
  { route: 'appointments', label: 'Grooming & โซนออกกำลังกาย', hint: 'จองคิวรายรอบหน้าเคาน์เตอร์' },
  { route: 'requests', label: 'คำขอจองจากเว็บ', hint: 'รับคำขอที่ลูกค้าส่งมาจากหน้าเว็บ' },
  { route: 'reports', label: 'รายงานรายเดือน', hint: '⚠️ เห็นรายได้ทั้งร้าน' },
];

// ค่าเริ่มต้น: เปิดเท่าที่จำเป็นต่องานหน้าเคาน์เตอร์ ส่วนที่เกี่ยวกับเงินปิดไว้ก่อน
export const DEFAULT_STAFF_PERMS = {
  today: true,
  calendar: true,
  customers: true,
  registrations: true,
  bookings: true,
  appointments: true,
  requests: false,
  reports: false,
};

export function defaultSettings() {
  return {
    roomPrices: structuredClone(DEFAULT_ROOM_PRICES),
    roomCapacity: structuredClone(DEFAULT_ROOM_CAPACITY),
    addOnServices: structuredClone(DEFAULT_ADDON_SERVICES),
    depositPctDefault: DEFAULT_DEPOSIT_PCT,
    vipPromoPrice: VIP_PROMO_PRICE,
    shopInfo: structuredClone(SHOP_INFO),
    staffEmails: [], // อีเมลพนักงาน (พี่เลี้ยง) — เห็นเฉพาะเมนูที่ไม่เกี่ยวกับเงิน
    staffPerms: structuredClone(DEFAULT_STAFF_PERMS),
    exercisePrices: structuredClone(EXERCISE_PRICES),
    groomingCapacity: DEFAULT_GROOMING_CAPACITY,
  };
}
