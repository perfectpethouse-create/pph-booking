// ═══════════════════════════════════════════════════════════════
// booking-cockpit.js — การ์ด "รับลูกค้าเข้าพัก" (modal จบงานในจอเดียว)
// เปิดจากแดชบอร์ด (คลิกแถวโซนโรงแรม) → เห็นข้อมูลครบ + กดจบงาน + ลิงก์ข้ามหน้า
// ตอนลูกค้ายืนอยู่หน้าเคาน์เตอร์ จะได้ไม่ต้องเปิดหลายหน้า
//
// เนื้อในเรียงตาม "สิ่งที่ต้องเห็นตอนน้องเดินเข้าประตู":
//   หัว(ชื่อ/เบอร์/สถานะ) → เงินต้องเก็บ → การเข้าพัก → ข้อมูลน้อง → บริการเสริม → ลิงก์ → ปุ่มท้าย
// ═══════════════════════════════════════════════════════════════
import { listen } from './db.js';
import { el, openModal, getSettings } from './ui.js';
import { computeBooking, computeAddOn, formatBaht, formatDateTH, nightsBetween } from './calc.js';
import { PET_TYPES } from './config-shop.js';
import { matchCustomer, vaccineStatus, isLoyal, openCustomerForm } from './customers.js';
import { openBookingForm } from './bookings.js';
import { buildCustomerCard, shareCard } from './summary-card.js';
import { runCheckin, runCollectBalance, runCheckout } from './booking-actions.js';
import { parseRaw, mapFormToPets, importToCustomer } from './registrations.js';
import { icons } from './icons.js';

const norm = (t) => String(t ?? '').replace(/\D/g, '');

function petLabel(id) { return (PET_TYPES.find(p => p.id === id) || {}).label || id || ''; }
function fmtTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
}
function isPaid(b) { return b.depositStatus === 'จ่ายครบแล้ว' || b.balanceDue <= 0; }
function isCheckedIn(b) { return b.stayStatus === 'checked-in' || b.stayStatus === 'checked-out'; }

function roomsDesc(b) {
  const s = getSettings();
  return (b.lineItems || [])
    .map(li => `${li.rooms || 1}×${(s?.roomPrices?.[li.roomType]?.label || li.roomType)}`)
    .join(', ');
}

// แถวคีย์-ค่า ใช้คลาสเดียวกับการ์ดลูกค้าเดิม (.cc-row)
function kv(k, v) {
  return el('div', { class: 'cc-row' }, [
    el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v }),
  ]);
}
// กล่องกลุ่ม 1 บล็อก (หัวข้อ + ไอคอน)
function block(title, ico, children) {
  return el('div', { class: 'card section-card', style: 'margin:12px 0' }, [
    el('h2', { class: 'sec-title' }, [
      el('span', { class: 'sec-ico', html: ico || '' }),
      el('span', { text: title }),
    ]),
    ...children.filter(Boolean),
  ]);
}

// เปิดการ์ดรับลูกค้า — booking อาจเป็น raw หรือ computed ก็ได้ (computeBooking ซ้ำได้)
export function openBookingCockpit(booking) {
  const body = el('div', { class: 'booking-cockpit' });
  let cur = computeBooking(booking);   // ใบจองล่าสุด (คำนวณยอดแล้ว)
  let customers = [];                  // เพื่อจับคู่ข้อมูลน้อง
  let allBookings = [];                // เพื่อดูว่าเป็นลูกค้าประจำไหม
  let checkinForms = [];               // ใบเช็คอินจากเว็บ (เผื่อยังไม่นำเข้าเป็นโปรไฟล์)

  const unsubs = [
    // ฟังใบจอง เพื่อให้การ์ดอัปเดตสดหลังกดเช็คอิน/รับเงินจากในการ์ดเอง
    listen('bookings', arr => {
      const found = arr.find(x => x.id === cur.id);
      if (found) cur = computeBooking(found);
      allBookings = arr.map(computeBooking);
      render();
    }),
    // ฟังลูกค้า เพื่อให้ข้อมูลน้องอัปเดตสดหลังกดสร้าง/แก้โปรไฟล์
    listen('customers', arr => { customers = arr; render(); }),
    // ฟังใบเช็คอิน เพื่อดึงข้อมูลน้องจากใบที่ "ยังไม่นำเข้า" มาโชว์ + ปุ่มนำเข้า
    listen('checkinForms', arr => { checkinForms = arr; render(); }, { orderBy: null }),
  ];

  const m = openModal(body, { onClose: () => unsubs.forEach(u => u()) });

  function render() {
    const b = cur;
    const c = customers.find(x => matchCustomer(b, x)) || null;
    body.innerHTML = '';
    // กรอง null ก่อน (addonBlock คืน null เมื่อไม่มีบริการเสริม) — native append(null) จะพิมพ์คำว่า "null"
    [
      header(b, c),
      moneyBlock(b),
      stayBlock(b),
      petBlock(b, c),
      addonBlock(b),
      linksRow(b, c),
      footer(b),
    ].filter(Boolean).forEach(n => body.appendChild(n));
  }

  // ── หัวการ์ด: ชื่อ + ป้ายลูกค้าประจำ + เบอร์กดโทร + สถานะ ──
  function statusPill(b) {
    if (b.stayStatus === 'checked-out') return el('span', { class: 'pill grey', text: `เช็คเอาท์แล้ว ${fmtTime(b.checkedOutAt)}` });
    if (b.stayStatus === 'checked-in') return el('span', { class: 'pill green', text: `เช็คอินแล้ว ${fmtTime(b.checkedInAt)}` });
    return el('span', { class: 'pill yellow', text: 'ยังไม่เช็คอิน' });
  }
  function header(b, c) {
    return el('div', {}, [
      el('div', { class: 'row', style: 'align-items:center;gap:8px;flex-wrap:wrap' }, [
        el('h2', { style: 'margin:0', text: b.customerName || '-' }),
        (c && isLoyal(c, allBookings)) ? el('span', { class: 'pill gold', text: 'ลูกค้าประจำ' }) : null,
        el('span', { style: 'margin-left:auto' }, [statusPill(b)]),
      ]),
      b.phone ? el('a', {
        class: 'muted', href: `tel:${b.phone}`,
        style: 'display:inline-flex;align-items:center;gap:6px;font-size:14px;margin-top:4px;text-decoration:none',
      }, [el('span', { class: 'sec-ico', html: icons.phone }), b.phone]) : null,
    ]);
  }

  // ── บล็อกเงิน (เด่นสุด): จ่ายครบ = เขียว · ค้าง = แดง + ปุ่มรับเงิน/เช็คอิน ──
  function moneyBlock(b) {
    if (isPaid(b)) {
      return el('div', { class: 'summary-box', style: 'border-left:4px solid #16a34a;margin:12px 0' }, [
        el('div', { class: 'line grand' }, [el('span', { text: 'จ่ายครบแล้ว' }), el('span', { text: formatBaht(b.grandTotal) })]),
      ]);
    }
    const box = el('div', { class: 'summary-box', style: 'border-left:4px solid #dc2626;margin:12px 0' }, [
      el('div', { class: 'line' }, [el('span', { text: 'ยอดทั้งหมด' }), el('span', { text: formatBaht(b.grandTotal) })]),
      el('div', { class: 'line' }, [el('span', { text: `มัดจำแล้ว ${b.depositPct}%` }), el('span', { text: formatBaht(b.depositAmount) })]),
      el('div', { class: 'line grand' }, [el('span', { text: 'ต้องเก็บวันนี้' }), el('span', { text: formatBaht(b.balanceDue) })]),
    ]);
    // ยังไม่เช็คอิน → ปุ่มเดียวจบ (รับเงิน+เช็คอิน) · เช็คอินไปแล้วแต่ค้าง → รับเงินอย่างเดียว
    const notIn = !isCheckedIn(b);
    const btn = el('button', {
      class: 'btn primary block', style: 'margin-top:8px',
      text: notIn ? `รับเงิน ${formatBaht(b.balanceDue)} + เช็คอิน` : `รับเงิน ${formatBaht(b.balanceDue)}`,
    });
    btn.onclick = () => (notIn ? runCheckin(b) : runCollectBalance(b));
    box.appendChild(btn);
    return box;
  }

  // ── บล็อกการเข้าพัก ──
  function stayBlock(b) {
    const nights = nightsBetween(b.checkIn, b.checkOut) || (b.lineItems[0]?.nights ?? 0);
    return block('การเข้าพัก', icons.home, [
      kv('เข้าพัก', `${formatDateTH(b.checkIn)}  ${b.checkInTime || '09:00'} น.`),
      kv('ออก', `${formatDateTH(b.checkOut)}  ${b.checkOutTime || '14:00'} น.`),
      kv('จำนวนคืน', `${nights} คืน`),
      kv('ห้อง', roomsDesc(b) || '-'),
    ]);
  }

  // แถวข้อมูลน้อง 1 ตัว — ใช้ทั้งจากโปรไฟล์ลูกค้าและจากใบเช็คอิน (รูปแบบ pets เดียวกัน)
  function petRow(p) {
    const vs = vaccineStatus(p);
    const head = el('div', { class: 'li-head' }, [
      el('strong', { text: `${petLabel(p.species)} ${p.name || ''}`.trim() }),
      vs === 'expired' ? el('span', { class: 'pill red', text: 'วัคซีนหมดอายุ' })
        : vs === 'soon' ? el('span', { class: 'pill yellow', text: 'วัคซีนใกล้หมด' })
          : (p.vaccineExpiry ? el('span', { class: 'pill green', text: 'วัคซีนปกติ' }) : null),
    ]);
    const detail = [p.breed, p.weight ? `${p.weight} กก.` : ''].filter(Boolean).join(' · ');
    return el('div', { class: 'lineitem' }, [
      head,
      detail ? el('div', { class: 'muted', style: 'font-size:13px', text: detail }) : null,
      p.healthNotes ? kv('สุขภาพ', p.healthNotes) : null,
      p.vaccineNotes ? kv('วัคซีน', p.vaccineNotes) : null,
      p.vaccineExpiry ? kv('วัคซีนหมดอายุ', formatDateTH(p.vaccineExpiry)) : null,
    ].filter(Boolean));
  }

  // ใบเช็คอินจากเว็บของลูกค้ารายนี้ที่ "ยังไม่นำเข้า" (จับด้วยเบอร์)
  function unimportedFormFor(b) {
    const bp = norm(b.phone);
    if (!bp) return null;
    return checkinForms.find(f => (f.status || 'new') !== 'imported' && norm(f.phone) === bp) || null;
  }

  // ── บล็อกน้อง: โปรไฟล์ลูกค้า → ใบเช็คอินที่ยังไม่นำเข้า → ข้อมูลจากใบจอง ──
  function petBlock(b, c) {
    const children = [];
    if (c && (c.pets || []).length) {
      // 1) มีโปรไฟล์ลูกค้าพร้อมข้อมูลน้อง → ใช้เลย (แม่นสุด)
      c.pets.forEach(p => children.push(petRow(p)));
    } else {
      const form = unimportedFormFor(b);
      if (form) {
        // 2) ยังไม่มีโปรไฟล์ แต่ลูกค้ากรอกใบเช็คอินบนเว็บไว้ (ยังไม่นำเข้า) → โชว์จากใบ + ปุ่มนำเข้า
        const d = parseRaw(form);
        children.push(el('div', {
          class: 'pill yellow', style: 'align-self:flex-start;margin-bottom:2px',
          text: 'จากใบเช็คอิน — ยังไม่นำเข้าเป็นโปรไฟล์',
        }));
        mapFormToPets(d).forEach(p => children.push(petRow(p)));
        const impBtn = el('button', {
          class: 'btn sm primary', style: 'margin-top:6px',
          html: icons.download + ' นำเข้าเป็นโปรไฟล์ลูกค้า',
        });
        // นำเข้าแล้ว listener customers/checkinForms จะรีเฟรชการ์ดเป็นข้อมูลจากโปรไฟล์เอง
        impBtn.onclick = async () => { impBtn.disabled = true; await importToCustomer(form, d, customers); };
        children.push(impBtn);
      } else {
        // ชนิดสัตว์จากใบจอง (เห็นเสมอ ไม่ว่าจะมีโปรไฟล์หรือไม่)
        const species = [...new Set((b.lineItems || []).map(li => petLabel(li.petType)).filter(Boolean))].join(', ');
        children.push(el('div', { class: 'muted', text: species ? `ชนิดสัตว์ (จากใบจอง): ${species}` : 'ยังไม่มีข้อมูลสัตว์ในใบจอง' }));
        if (c) {
          // 3) มีโปรไฟล์แล้ว แต่ยังไม่มีข้อมูลน้อง (มักเป็นลูกค้าที่จองหน้าเคาน์เตอร์ ไม่มีใบเช็คอินเว็บ)
          children.push(el('p', { class: 'muted', style: 'font-size:12px;margin:6px 0 0', text: 'มีโปรไฟล์ลูกค้าแล้ว แต่ยังไม่มีข้อมูลน้อง — กดเพิ่มได้เลย' }));
          const editBtn = el('button', { class: 'btn sm ghost', style: 'margin-top:6px', html: icons.plus + ' เพิ่มข้อมูลน้องในโปรไฟล์' });
          editBtn.onclick = () => openCustomerForm(c);
          children.push(editBtn);
        } else {
          // 4) ไม่มีทั้งโปรไฟล์และใบเช็คอิน → ปุ่มสร้างโปรไฟล์ (prefill ชื่อ+เบอร์)
          children.push(el('p', { class: 'muted', style: 'font-size:12px;margin:6px 0 0', text: 'ยังไม่มีโปรไฟล์ลูกค้าในระบบ — สร้างไว้เพื่อเก็บวัคซีน/โน้ตสุขภาพ' }));
          const addBtn = el('button', { class: 'btn sm ghost', style: 'margin-top:6px', html: icons.plus + ' สร้างโปรไฟล์ลูกค้า' });
          addBtn.onclick = () => openCustomerForm(null, { name: b.customerName, phone: b.phone });
          children.push(addBtn);
        }
      }
    }
    // โน้ตอิสระจากใบจอง (พันธุ์/สุขภาพ/เงื่อนไขพิเศษ) — สำคัญตอนรับน้อง
    if (b.notes) children.push(el('div', { class: 'summary-box', style: 'margin-top:8px' }, [
      el('div', { class: 'cc-row', style: 'border:none' }, [
        el('span', { class: 'k', text: 'โน้ตใบจอง' }), el('span', { class: 'v', text: b.notes }),
      ]),
    ]));
    return block('ข้อมูลน้อง', icons.paw, children);
  }

  // ── บริการเสริม (ถ้ามี) ──
  function addonBlock(b) {
    if (!(b.addOns || []).length) return null;
    return block('บริการเสริม', icons.star, b.addOns.map(a => {
      const cc = computeAddOn(a);
      const label = cc.qty > 1 ? `${a.name} ×${cc.qty}` : a.name;
      return kv(label, cc.total > 0 ? formatBaht(cc.total) : 'ฟรี');
    }));
  }

  // ── แถวลิงก์ข้ามหน้า ──
  function linksRow(b, c) {
    const wrap = el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin:12px 0' });
    if (c) {
      const btn = el('button', { class: 'btn sm ghost', html: icons.users + ' โปรไฟล์ลูกค้า' });
      btn.onclick = () => openCustomerForm(c);
      wrap.appendChild(btn);
    }
    const bkBtn = el('button', { class: 'btn sm ghost', html: icons.bookings + ' แก้ใบจองเต็ม' });
    bkBtn.onclick = () => openBookingForm(b);
    wrap.appendChild(bkBtn);

    const cardBtn = el('button', { class: 'btn sm ghost', html: icons.share + ' ส่งการ์ดให้ลูกค้า' });
    cardBtn.onclick = () => shareCustomerCard(b);
    wrap.appendChild(cardBtn);
    return wrap;
  }

  // สร้างการ์ดสรุปให้ลูกค้าแล้วแชร์ (reuse ของเดิม) — ต้องอยู่ใน DOM ให้จับภาพได้
  async function shareCustomerCard(b) {
    const cardEl = buildCustomerCard(b);
    cardEl.style.position = 'fixed';
    cardEl.style.left = '-9999px';
    cardEl.style.top = '0';
    document.body.appendChild(cardEl);
    try { await shareCard(cardEl, b); } finally { cardEl.remove(); }
  }

  // ── ปุ่มท้ายการ์ด: เช็คอิน/เช็คเอาท์ ตามสถานะ ──
  // (กรณีค้างยอด+ยังไม่เช็คอิน ปุ่มรับเงินอยู่บนบล็อกเงินแล้ว จึงไม่ซ้ำตรงนี้)
  function footer(b) {
    const wrap = el('div', { class: 'row', style: 'gap:8px;justify-content:flex-end;margin-top:8px' });
    if (b.stayStatus === 'checked-out') {
      wrap.appendChild(el('span', { class: 'pill grey', text: `เช็คเอาท์แล้ว ${fmtTime(b.checkedOutAt)}` }));
    } else if (b.stayStatus === 'checked-in') {
      const out = el('button', { class: 'btn primary', text: 'เช็คเอาท์' });
      out.onclick = () => runCheckout(b);
      wrap.appendChild(out);
    } else if (isPaid(b)) {
      const inn = el('button', { class: 'btn primary', text: 'เช็คอิน' });
      inn.onclick = () => runCheckin(b);
      wrap.appendChild(inn);
    }
    return wrap;
  }

  render();
  return m;
}
