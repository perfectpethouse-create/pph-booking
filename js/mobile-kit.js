// ═══════════════════════════════════════════════════════════════
// mobile-kit.js — ตัวช่วยจัดรูปแบบที่หน้ามือถือแบบแอปใช้ร่วมกัน
// (หน้าหลัก · การจอง · …) ให้วันที่/ห้อง/ไอคอนสัตว์ออกมาแบบเดียวกันทุกหน้า
// ═══════════════════════════════════════════════════════════════
import { getSettings } from './ui.js';

export const DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
export const DOW_FULL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
export const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export const dateOf = (iso) => new Date(iso + 'T00:00:00');
export const shortDate = (iso) => { const d = dateOf(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
// "22 ต.ค. 69" — มีปี พ.ศ. 2 หลัก ใช้กับวันที่เงินเข้า (กระทบยอดข้ามปีได้ไม่สับสน)
export const dateWithYear = (iso) => { const d = dateOf(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear() + 543).slice(-2)}`; };
export const longDate = (iso) => { const d = dateOf(iso); return `${DOW_FULL[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };

// "24–27 ต.ค." หรือ "30 ต.ค. – 2 พ.ย." เมื่อข้ามเดือน
export function rangeOf(b) {
  if (!b.checkIn || !b.checkOut) return '-';
  const a = dateOf(b.checkIn), z = dateOf(b.checkOut);
  return a.getMonth() === z.getMonth()
    ? `${a.getDate()}–${z.getDate()} ${MONTHS[z.getMonth()]}`
    : `${shortDate(b.checkIn)} – ${shortDate(b.checkOut)}`;
}

// ชื่อห้องแบบสั้น · ไม่มีห้อง = บริการรายวัน (เช่น Day Care) แสดงชื่อบริการแทน
export function roomsOf(b) {
  const s = getSettings();
  if (!(b.lineItems || []).length) return (b.addOns || []).map(a => a.name).filter(Boolean).join(', ') || 'บริการรายวัน';
  return b.lineItems.map(li => {
    const n = Number(li.rooms) || 1;
    const label = s?.roomPrices?.[li.roomType]?.label || li.roomType;
    return n > 1 ? `${n}×${label}` : label;
  }).join(', ');
}

export const isCat = (b) => (b.lineItems || []).length > 0 && b.lineItems.every(li => li.petType === 'cat');
export const roomsUsed = (b) => (b.lineItems || []).reduce((s, li) => s + (Number(li.rooms) || 1), 0);
