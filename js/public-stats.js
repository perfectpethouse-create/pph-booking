// ═══════════════════════════════════════════════════════════════
// public-stats.js — ส่ง "ยอดสมาชิก" ให้หน้าเว็บ perfectbkk.com (กล่องตัวเลขใน hero)
//
// ทำงานเบื้องหลังเมื่อพนักงาน/เจ้าของเปิดแอป (แบบเดียวกับ public-availability.js):
//   ฟังลูกค้าทั้งหมด → เขียน publicAvailability/stats { memberCount, updatedAt } เฉพาะตอนยอดเปลี่ยน
// ลูกค้าถูกเพิ่มผ่านแอปนี้เท่านั้น ยอดบนเว็บจึงตรงกับระบบทันทีที่มีคนเพิ่มลูกค้า
// ═══════════════════════════════════════════════════════════════
import { listen, savePublicStats, MODE } from './db.js';

let _started = false;

export function startMemberCountPublisher() {
  if (_started || MODE !== 'firestore') return;
  _started = true;
  let last = null;
  // orderBy: null — นับครบแม้เอกสารเก่าไม่มี createdAt
  listen('customers', arr => {
    if (arr.length === last) return;
    savePublicStats(arr.length)
      .then(() => { last = arr.length; })
      .catch(e => console.warn('[stats] ส่งยอดสมาชิกให้หน้าเว็บไม่สำเร็จ', e));
  }, { orderBy: null });
}
