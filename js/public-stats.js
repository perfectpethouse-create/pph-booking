// ═══════════════════════════════════════════════════════════════
// public-stats.js — ส่ง "ยอดสมาชิก" ให้หน้าเว็บ perfectbkk.com (กล่องตัวเลขใน hero)
//
// ทำเบื้องหลังครั้งเดียวต่อการเปิดแอป เมื่อผู้ที่เปิดเป็น "เจ้าของร้าน"
//   (กฎ Firestore ให้เขียน publicInfo ได้เฉพาะเจ้าของ — พี่เลี้ยงจึงข้ามไปเลย ไม่ยิงให้โดนปฏิเสธ)
// นับลูกค้าทั้งหมดในระบบ → เขียน publicInfo/stats { memberCount, updatedAt }
//
// ⚠️ ตัวเลขบนเว็บ = ยอด ณ ตอนที่เจ้าของเปิดแอปครั้งล่าสุด
//    ถ้าเว็บยังไม่เคยได้ตัวเลข กล่องบนเว็บจะซ่อนตัวเอง (ไม่โชว์ตัวเลขสมมติ)
// ═══════════════════════════════════════════════════════════════
import { countCustomers, savePublicStats, MODE } from './db.js';
import { isOwner } from './ui.js';

let _done = false;

// เรียกหลังโหลด settings แล้ว (isOwner() ดูจาก staffEmails ใน settings)
export async function publishMemberCount() {
  if (_done || MODE !== 'firestore' || !isOwner()) return;
  _done = true;
  try {
    await savePublicStats(await countCustomers());
  } catch (e) {
    _done = false; // เปิดแอปรอบหน้าลองใหม่
    console.warn('[stats] ส่งยอดสมาชิกให้หน้าเว็บไม่สำเร็จ', e);
  }
}
