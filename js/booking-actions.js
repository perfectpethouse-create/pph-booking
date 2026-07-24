// ═══════════════════════════════════════════════════════════════
// booking-actions.js — ตรรกะ "จบงานเข้าพัก" (เช็คอิน / รับยอดคงเหลือ / เช็คเอาท์)
// ใช้ร่วมกันระหว่างแดชบอร์ด (ปุ่มในแถว) และการ์ดรับลูกค้า (booking-cockpit.js)
// แยกออกมาเพื่อไม่ให้ตรรกะรับเงินซ้ำ 2 ที่ — แก้ที่เดียวมีผลทั้งคู่
// หมายเหตุ: การอัปเดต bookings ทำได้เฉพาะบัญชีเจ้าของร้าน (firestore.rules)
// ═══════════════════════════════════════════════════════════════
import { save } from './db.js';
import { el, toast, confirmDialog, openModal } from './ui.js';
import { formatBaht } from './calc.js';
import { PAYMENT_METHODS } from './config-shop.js';

// เลือกช่องทางรับเงิน — ใช้ร่วมกันทุกจุดที่ปิดยอด
export function methodSelect(value = PAYMENT_METHODS[0]) {
  const sel = el('select', {}, PAYMENT_METHODS.map(m => el('option', { value: m, text: m })));
  sel.value = value;
  return sel;
}

// ถามช่องทางรับเงิน → คืน Promise<ชื่อช่องทาง | null> (null = ยกเลิก)
export function askPayMethod(b, okText = 'รับแล้ว') {
  return new Promise(resolve => {
    // เก็บค่าไว้ก่อนปิด แล้วให้ onClose เป็นคนตอบทางเดียว
    // (ปิดด้วยการคลิกฉากหลังก็จะได้ null = ยกเลิก โดยไม่ต้องมี resolve ซ้อน)
    let picked = null;
    const sel = methodSelect();
    const okBtn = el('button', { class: 'btn primary', text: okText });
    const cancelBtn = el('button', { class: 'btn ghost', text: 'ยกเลิก' });
    const m = openModal(el('div', {}, [
      el('h2', { text: `รับยอดคงเหลือ ${formatBaht(b.balanceDue)}` }),
      el('p', { class: 'muted', style: 'margin-top:-6px', text: `จาก ${b.customerName} — ระบบจะบันทึกเป็น "จ่ายครบแล้ว"` }),
      el('div', { class: 'field' }, [el('label', { text: 'รับเงินทางช่องทางไหน' }), sel]),
      el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px' }, [cancelBtn, okBtn]),
    ]), { onClose: () => resolve(picked) });
    okBtn.onclick = () => { picked = sel.value; m.close(); };
    cancelBtn.onclick = () => m.close();
  });
}

// เช็คอิน: นโยบายร้านคือลูกค้าจ่ายส่วนที่เหลือ "วันเช็คอิน"
// → ถามตอนกดเช็คอินเลย จะได้ไม่ลืมอัปเดตยอด
export function runCheckin(b) {
  const unpaid = b.depositStatus !== 'จ่ายครบแล้ว' && b.balanceDue > 0;
  if (!unpaid) {
    // จ่ายครบแล้ว → เช็คอินได้เลย
    return save('bookings', { ...b, stayStatus: 'checked-in', checkedInAt: Date.now() })
      .then(() => toast(`เช็คอิน ${b.customerName} แล้ว`));
  }
  const sel = methodSelect();
  const paidBtn = el('button', { class: 'btn primary block', text: `รับเงิน ${formatBaht(b.balanceDue)} แล้ว — เช็คอิน` });
  const laterBtn = el('button', { class: 'btn block', text: 'ยังไม่รับเงิน — เช็คอินก่อน' });
  const cancelBtn = el('button', { class: 'btn ghost block', text: 'ยกเลิก' });
  const m = openModal(el('div', {}, [
    el('h2', { text: `เช็คอิน ${b.customerName}` }),
    el('div', { class: 'summary-box', style: 'margin:12px 0' }, [
      el('div', { class: 'line' }, [el('span', { text: 'ยอดทั้งหมด' }), el('span', { text: formatBaht(b.grandTotal) })]),
      el('div', { class: 'line' }, [el('span', { text: `มัดจำแล้ว ${b.depositPct}%` }), el('span', { text: formatBaht(b.depositAmount) })]),
      el('div', { class: 'line grand' }, [el('span', { text: 'ต้องเก็บวันนี้' }), el('span', { text: formatBaht(b.balanceDue) })]),
    ]),
    el('div', { class: 'field' }, [el('label', { text: 'รับเงินทางช่องทางไหน' }), sel]),
    el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [paidBtn, laterBtn, cancelBtn]),
  ]));
  paidBtn.onclick = async () => {
    const method = sel.value;
    await save('bookings', {
      ...b, stayStatus: 'checked-in', checkedInAt: Date.now(),
      depositStatus: 'จ่ายครบแล้ว', balancePaidAt: Date.now(), balanceMethod: method,
    });
    m.close(); toast(`เช็คอิน ${b.customerName} + รับ ${formatBaht(b.balanceDue)} (${method})`);
  };
  laterBtn.onclick = async () => {
    await save('bookings', { ...b, stayStatus: 'checked-in', checkedInAt: Date.now() });
    m.close(); toast(`เช็คอินแล้ว — ยอด ${formatBaht(b.balanceDue)} ยังค้างอยู่ (จะเตือนในหน้านี้)`);
  };
  cancelBtn.onclick = () => m.close();
}

// รับมัดจำ 50% — ใช้ตอนลูกค้าโอนสลิปมัดจำเข้ามาหลังจอง (จองใหม่ที่ยัง "ยังไม่มัดจำ")
// ปุ่มลัดในแดชบอร์ด "จองใหม่วันนี้" กดปุ่มเดียวปิดงานได้ไว — เลือกช่องทางแล้วบันทึก
export async function runMarkDeposit(b) {
  return new Promise(resolve => {
    let done = false;
    const sel = methodSelect(b.depositMethod || undefined);
    const okBtn = el('button', { class: 'btn primary', text: 'รับมัดจำแล้ว' });
    const cancelBtn = el('button', { class: 'btn ghost', text: 'ยกเลิก' });
    const m = openModal(el('div', {}, [
      el('h2', { text: `รับมัดจำ ${b.customerName || ''}` }),
      el('p', { class: 'muted', style: 'margin-top:-6px', text: `มัดจำ ${b.depositPct}% = ${formatBaht(b.depositAmount)} — ระบบจะบันทึกเป็น "มัดจำแล้ว"` }),
      el('div', { class: 'field' }, [el('label', { text: 'รับมัดจำทางช่องทางไหน' }), sel]),
      el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px' }, [cancelBtn, okBtn]),
    ]), { onClose: () => resolve(done) });
    okBtn.onclick = async () => {
      const method = sel.value;
      done = true;
      await save('bookings', { ...b, depositStatus: 'มัดจำแล้ว', depositPaidAt: Date.now(), depositMethod: method });
      m.close();
      toast(`รับมัดจำ ${b.customerName} แล้ว (${method})`);
    };
    cancelBtn.onclick = () => m.close();
  });
}

// รับยอดคงเหลือ สำหรับคนที่เช็คอินไปแล้วแต่ยังไม่จ่ายครบ
export async function runCollectBalance(b) {
  const method = await askPayMethod(b);
  if (!method) return;
  await save('bookings', { ...b, depositStatus: 'จ่ายครบแล้ว', balancePaidAt: Date.now(), balanceMethod: method });
  toast(`รับยอด ${b.customerName} แล้ว (${method})`);
}

// เช็คเอาท์ — ถ้ายังค้างยอดต้องเก็บเงิน + ระบุช่องทาง ก่อนเช็คเอาท์
export async function runCheckout(b) {
  const needPay = b.depositStatus !== 'จ่ายครบแล้ว' && b.balanceDue > 0;
  if (needPay) {
    const method = await askPayMethod(b, 'เช็คเอาท์');
    if (!method) return;
    await save('bookings', {
      ...b, stayStatus: 'checked-out', checkedOutAt: Date.now(),
      depositStatus: 'จ่ายครบแล้ว', balancePaidAt: Date.now(), balanceMethod: method,
    });
    toast(`เช็คเอาท์ ${b.customerName} + รับ ${formatBaht(b.balanceDue)} (${method})`);
    return;
  }
  if (!await confirmDialog(`เช็คเอาท์ ${b.customerName}?`, { okText: 'เช็คเอาท์' })) return;
  await save('bookings', { ...b, stayStatus: 'checked-out', checkedOutAt: Date.now() });
  toast(`เช็คเอาท์ ${b.customerName} เรียบร้อย`);
}
