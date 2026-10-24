// ═══════════════════════════════════════════════════════════════
// mobile-kit.js — ตัวช่วยจัดรูปแบบที่หน้ามือถือแบบแอปใช้ร่วมกัน
// (หน้าหลัก · การจอง · …) ให้วันที่/ห้อง/ไอคอนสัตว์ออกมาแบบเดียวกันทุกหน้า
// ═══════════════════════════════════════════════════════════════
import { getSettings, el, openModal } from './ui.js';
import { icons } from './icons.js';
import { isoOf, todayISO } from './calc.js';

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

// ปฏิทินเลือกวัน (แผ่นเด้งขึ้น) — แตะชื่อเดือนแล้วกระโดดไปวันไหนก็ได้ ไม่ต้องกดลูกศรทีละสัปดาห์
// countOf(iso) = จำนวนงานของวันนั้น (โชว์ใต้เลขวัน) · onPick(iso) เรียกหลังปิดแผ่น
export function openDatePicker(selectedISO, { title = 'เลือกวัน', countOf = () => 0, unit = 'คิว' } = {}, onPick) {
  const sel = dateOf(selectedISO);
  let y = sel.getFullYear(), m = sel.getMonth();
  const today = todayISO();
  const body = el('div', { class: 'm-picker' });
  const modal = openModal(body);

  function draw() {
    body.innerHTML = '';
    const prev = el('button', { type: 'button', class: 'm-arr', html: icons.chevronLeft, 'aria-label': 'เดือนก่อนหน้า' });
    const next = el('button', { type: 'button', class: 'm-arr', html: icons.chevronRight, 'aria-label': 'เดือนถัดไป' });
    prev.onclick = () => { m--; if (m < 0) { m = 11; y--; } draw(); };
    next.onclick = () => { m++; if (m > 11) { m = 0; y++; } draw(); };
    const toToday = el('button', { type: 'button', class: 'bf-chip', text: 'วันนี้' });
    toToday.onclick = () => pick(today);
    body.append(
      el('h2', { text: title }),
      el('div', { class: 'm-mhead' }, [el('b', { text: `${MONTHS_LONG[m]} ${y + 543}` }), el('span', { class: 'm-arrs' }, [toToday, prev, next])]),
    );
    const grid = el('div', { class: 'm-cal', role: 'grid' }, ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map(d => el('div', { class: 'm-cal-wd', text: d })));
    for (let i = 0, pad = new Date(y, m, 1).getDay(); i < pad; i++) grid.appendChild(el('div', {}));
    for (let d = 1, days = new Date(y, m + 1, 0).getDate(); d <= days; d++) {
      const iso = isoOf(y, m, d);
      const n = countOf(iso);
      const cell = el('button', {
        type: 'button', 'aria-label': `${d} ${MONTHS[m]}${n ? ` · ${n} ${unit}` : ''}`,
        class: 'm-cc' + (n ? ' mid' : '') + (iso < today ? ' past' : '') + (iso === today ? ' today' : '') + (iso === selectedISO ? ' sel' : ''),
      }, [el('span', { text: String(d) }), el('small', { text: n ? `${n} ${unit}` : '' })]);
      cell.onclick = () => pick(iso);
      grid.appendChild(cell);
    }
    body.appendChild(el('div', { class: 'm-calcard' }, [grid]));
  }
  function pick(iso) { modal.close(); onPick(iso); }
  draw();
}

export const MONTHS_LONG = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
