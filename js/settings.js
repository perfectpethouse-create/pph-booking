// ═══════════════════════════════════════════════════════════════
// settings.js — ตั้งค่าราคาห้อง / จำนวนห้อง / บริการเสริม / มัดจำ% / ข้อมูลร้าน
// เจ้าของร้านแก้ได้เองโดยไม่ต้องแตะโค้ด (เก็บลง DB)
// ═══════════════════════════════════════════════════════════════
import { getSettings, saveSettings, savePublicPrices } from './db.js';
import { el, toast, getSettings as cachedSettings } from './ui.js';
import {
  PET_TYPES, STAFF_PERM_ITEMS, DEFAULT_STAFF_PERMS,
  EXERCISE_PRICES, EXERCISE_SIZES, EXERCISE_LEVELS, DEFAULT_GROOMING_CAPACITY,
} from './config-shop.js';
import { icons } from './icons.js';

export async function renderSettings(container) {
  const s = structuredClone(cachedSettings() || await getSettings());

  container.appendChild(el('div', { class: 'page-title' }, [el('h1', { text: 'ตั้งค่า' })]));

  // ── ราคาห้อง + ความจุ (แยกห้องสุนัข/ห้องแมว) ──
  // ข้อมูลเก่าเก็บความจุเป็นเลขเดียวรวมทุกสัตว์ → แปลงเป็น {dog, cat} ให้แก้ต่อได้
  s.roomCapacity = s.roomCapacity || {};
  Object.keys(s.roomPrices).forEach(rt => {
    const c = s.roomCapacity[rt];
    if (typeof c === 'number') s.roomCapacity[rt] = { dog: c, cat: c };
    else if (c == null) s.roomCapacity[rt] = { dog: 0, cat: 0 };
  });

  const priceCard = el('div', { class: 'card' }, [el('h2', { text: 'ราคาห้อง & จำนวนห้อง (ความจุ)' })]);
  const priceHead = el('tr', {}, [
    el('th', { text: 'ประเภทห้อง' }),
    ...PET_TYPES.map(p => el('th', { class: 'num', text: `฿/คืน (${p.label})` })),
    ...PET_TYPES.map(p => el('th', { class: 'num', text: `จำนวนห้อง${p.label}` })),
  ]);
  const priceRows = Object.entries(s.roomPrices).map(([rt, r]) => {
    const priceInputs = PET_TYPES.map(p => {
      const i = el('input', { type: 'number', min: 0, value: r[p.id] ?? 0, style: 'max-width:110px;text-align:right' });
      i.oninput = () => r[p.id] = Number(i.value) || 0;
      return el('td', { class: 'num' }, [i]);
    });
    const capInputs = PET_TYPES.map(p => {
      const i = el('input', { type: 'number', min: 0, value: s.roomCapacity[rt]?.[p.id] ?? 0, style: 'max-width:90px;text-align:right' });
      i.oninput = () => { s.roomCapacity[rt][p.id] = Number(i.value) || 0; };
      return el('td', { class: 'num' }, [i]);
    });
    return el('tr', {}, [el('td', {}, [el('strong', { text: r.label })]), ...priceInputs, ...capInputs]);
  });
  priceCard.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [el('thead', {}, [priceHead]), el('tbody', {}, priceRows)])]));
  // ราคาโปร VIP + มัดจำ%
  const vipPromo = el('input', { type: 'number', min: 0, value: s.vipPromoPrice ?? 1590, style: 'max-width:120px' });
  vipPromo.oninput = () => s.vipPromoPrice = Number(vipPromo.value) || 0;
  const depPct = el('input', { type: 'number', min: 0, max: 100, value: s.depositPctDefault ?? 50, style: 'max-width:120px' });
  depPct.oninput = () => s.depositPctDefault = Number(depPct.value) || 0;
  priceCard.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [
    el('div', { class: 'field' }, [el('label', { text: 'ราคาโปร VIP (จองภายในวันนี้)' }), vipPromo]),
    el('div', { class: 'field' }, [el('label', { text: 'มัดจำเริ่มต้น (%)' }), depPct]),
  ]));
  container.appendChild(priceCard);

  // ── ราคาโซนออกกำลังกาย + ความจุ Grooming ──
  // ⚠️ ราคาเริ่มต้นคัดมาจากตารางบน public/exercise-zone.html — ถ้าแก้ที่นี่ อย่าลืมแก้บนเว็บให้ตรงกัน
  s.exercisePrices = s.exercisePrices || structuredClone(EXERCISE_PRICES);
  const exCard = el('div', { class: 'card' }, [
    el('h2', { text: 'โซนออกกำลังกาย & Grooming' }),
    el('p', { class: 'muted', style: 'font-size:13px;margin-top:-6px', text:
      'ราคาต่อรอบของโซนออกกำลังกาย (60 นาที · พี่เลี้ยง 1 ต่อ 3 ตัว) — ตรงกับตารางราคาบนหน้าเว็บ ถ้าแก้ที่นี่อย่าลืมแก้บนเว็บด้วย' }),
  ]);
  const exHead = el('tr', {}, [
    el('th', { text: 'ขนาดน้อง' }),
    ...EXERCISE_LEVELS.map(l => el('th', { class: 'num', text: l.label })),
  ]);
  const exRows = EXERCISE_SIZES.map(sz => {
    s.exercisePrices[sz.id] = s.exercisePrices[sz.id] || {};
    const inputs = EXERCISE_LEVELS.map(l => {
      const i = el('input', { type: 'number', min: 0, value: s.exercisePrices[sz.id][l.id] ?? 0, style: 'max-width:110px;text-align:right' });
      i.oninput = () => { s.exercisePrices[sz.id][l.id] = Number(i.value) || 0; };
      return el('td', { class: 'num' }, [i]);
    });
    return el('tr', {}, [el('td', {}, [el('strong', { text: sz.label })]), ...inputs]);
  });
  exCard.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [el('thead', {}, [exHead]), el('tbody', {}, exRows)])]));
  // ความจุ Grooming = จำนวนช่างที่รับพร้อมกันได้ต่อรอบ (ใช้เป็นเกณฑ์เตือน ไม่บล็อกการจอง)
  const groomCap = el('input', { type: 'number', min: 1, value: s.groomingCapacity ?? DEFAULT_GROOMING_CAPACITY, style: 'max-width:120px' });
  groomCap.oninput = () => s.groomingCapacity = Number(groomCap.value) || 1;
  exCard.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [
    el('div', { class: 'field' }, [
      el('label', { text: 'จำนวนคิว Grooming ต่อรอบ (จำนวนช่าง)' }),
      groomCap,
      el('p', { class: 'muted', style: 'font-size:12px;margin:4px 0 0', text: 'ใช้เตือนเมื่อจองเกิน — ยังจองเพิ่มได้ถ้ายืนยัน' }),
    ]),
  ]));
  container.appendChild(exCard);

  // ── บริการเสริม ──
  const svcCard = el('div', { class: 'card' }, [el('h2', { text: 'บริการเสริม' })]);
  const svcWrap = el('div', {});
  const drawSvc = () => {
    svcWrap.innerHTML = '';
    (s.addOnServices || []).forEach((svc, idx) => {
      const nameInp = el('input', { value: svc.name || '', placeholder: 'ชื่อบริการ' });
      nameInp.oninput = () => svc.name = nameInp.value;
      const priceInp = el('input', { type: 'number', min: 0, value: svc.price ?? 0, style: 'max-width:120px' });
      priceInp.oninput = () => svc.price = Number(priceInp.value) || 0;
      const rm = el('button', { class: 'btn sm danger', html: icons.x, 'aria-label': 'ลบ' });
      rm.onclick = () => { s.addOnServices.splice(idx, 1); drawSvc(); };
      svcWrap.appendChild(el('div', { class: 'row', style: 'align-items:flex-end;margin-bottom:8px' }, [
        el('div', { class: 'field', style: 'flex:2' }, [nameInp]), el('div', { class: 'field' }, [priceInp]), rm,
      ]));
    });
  };
  drawSvc();
  const addSvc = el('button', { class: 'btn sm ghost', html: icons.plus + ' เพิ่มบริการ' });
  addSvc.onclick = () => { s.addOnServices = s.addOnServices || []; s.addOnServices.push({ name: '', price: 0 }); drawSvc(); };
  svcCard.append(svcWrap, addSvc);
  container.appendChild(svcCard);

  // ── สิทธิ์พนักงาน (พี่เลี้ยง) ──
  // อีเมลในลิสต์นี้จะเห็นเฉพาะ: งานวันนี้ / ปฏิทินห้องว่าง / ลูกค้า & สัตว์เลี้ยง / ลงทะเบียนเช็คอิน
  // (ไม่เห็นราคา ยอดเงิน รายงาน ตั้งค่า สำรองข้อมูล) — ลิสต์ว่าง = ทุกคนเป็นเจ้าของร้าน
  s.staffEmails = s.staffEmails || [];
  const staffCard = el('div', { class: 'card' }, [
    el('h2', { text: 'สิทธิ์พนักงาน (พี่เลี้ยง)' }),
    el('p', { class: 'muted', style: 'font-size:13px;margin-top:-6px', text:
      'อีเมลในลิสต์นี้ = พี่เลี้ยง จะเห็นเฉพาะเมนูที่ติ๊กเปิดไว้ข้างล่าง และไม่เห็นราคา/ยอดเงินในหน้าการจอง ' +
      '(ต้องสร้างบัญชีให้เขาใน Firebase Console ก่อน) — ลิสต์ว่าง = ทุกคนเป็นเจ้าของร้าน' }),
  ]);
  const staffWrap = el('div', {});
  const drawStaff = () => {
    staffWrap.innerHTML = '';
    if (!s.staffEmails.length) {
      staffWrap.appendChild(el('p', { class: 'muted', text: 'ยังไม่มีพนักงาน — ตอนนี้ทุกคนที่ล็อกอินเห็นทุกเมนู' }));
    }
    s.staffEmails.forEach((email, idx) => {
      const inp = el('input', { value: email, placeholder: 'staff@example.com', type: 'email' });
      inp.oninput = () => s.staffEmails[idx] = inp.value.trim();
      const rm = el('button', { class: 'btn sm danger', html: icons.x, 'aria-label': 'ลบ' });
      rm.onclick = () => { s.staffEmails.splice(idx, 1); drawStaff(); };
      staffWrap.appendChild(el('div', { class: 'row', style: 'align-items:flex-end;margin-bottom:8px' }, [
        el('div', { class: 'field', style: 'flex:2' }, [inp]), rm,
      ]));
    });
  };
  drawStaff();
  const addStaff = el('button', { class: 'btn sm ghost', html: icons.plus + ' เพิ่มอีเมลพนักงาน' });
  addStaff.onclick = () => { s.staffEmails.push(''); drawStaff(); };
  staffCard.append(staffWrap, addStaff);

  // ── สวิตช์เปิด-ปิดเมนูของพี่เลี้ยง (มีผลกับพี่เลี้ยงทุกคนพร้อมกัน) ──
  s.staffPerms = { ...DEFAULT_STAFF_PERMS, ...(s.staffPerms || {}) };
  const permWrap = el('div', { class: 'perm-list' });
  STAFF_PERM_ITEMS.forEach(item => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = s.staffPerms[item.route] === true;
    cb.onchange = () => { s.staffPerms[item.route] = cb.checked; };
    permWrap.appendChild(el('label', { class: 'perm-row' }, [
      cb,
      el('span', {}, [
        el('span', { class: 'perm-name', text: item.label }),
        el('span', { class: 'perm-hint', text: item.hint }),
      ]),
    ]));
  });
  staffCard.append(
    el('h3', { style: 'margin:20px 0 2px;font-size:15px', text: 'เมนูที่พี่เลี้ยงใช้ได้' }),
    el('p', { class: 'muted', style: 'font-size:13px;margin:0 0 10px', text:
      'ติ๊กเพื่อเปิดสิทธิ์ — มีผลกับพี่เลี้ยงทุกคนพร้อมกัน และมีผลทันทีโดยไม่ต้องให้เขาล็อกอินใหม่ ' +
      '(หน้า "ตั้งค่า" กับ "สำรองข้อมูล" เปิดให้ไม่ได้ เพราะพี่เลี้ยงจะแก้สิทธิ์ตัวเองหรือดึงข้อมูลเงินออกได้)' }),
    permWrap,
  );
  container.appendChild(staffCard);

  // ── ข้อมูลร้าน ──
  const shopCard = el('div', { class: 'card' }, [el('h2', { text: 'ข้อมูลร้าน (แสดงบนการ์ดลูกค้า)' })]);
  s.shopInfo = s.shopInfo || {};
  const shopName = el('input', { value: s.shopInfo.name || '', placeholder: 'ชื่อร้าน' });
  shopName.oninput = () => s.shopInfo.name = shopName.value;
  // เบอร์โทรร้าน — แสดงบนการ์ดที่ส่งให้ลูกค้า ลูกค้าจะได้ติดต่อกลับได้ทันที
  const shopPhone = el('input', { value: s.shopInfo.phone || '', placeholder: 'เช่น 02-xxx-xxxx', type: 'tel' });
  shopPhone.oninput = () => s.shopInfo.phone = shopPhone.value;
  const shopNote = el('input', { value: s.shopInfo.note || '', placeholder: 'ข้อความท้ายการ์ด' });
  shopNote.oninput = () => s.shopInfo.note = shopNote.value;
  shopCard.appendChild(el('div', { class: 'row' }, [
    el('div', { class: 'field' }, [el('label', { text: 'ชื่อร้าน' }), shopName]),
    el('div', { class: 'field' }, [el('label', { text: 'เบอร์โทรร้าน (แสดงบนการ์ด)' }), shopPhone]),
    el('div', { class: 'field' }, [el('label', { text: 'ข้อความท้ายการ์ด' }), shopNote]),
  ]));
  container.appendChild(shopCard);

  // ── บันทึก ──
  const saveBtn = el('button', { class: 'btn primary', html: icons.save + ' บันทึกการตั้งค่า' });
  saveBtn.onclick = async () => {
    s.staffEmails = (s.staffEmails || []).map(e => String(e).trim()).filter(Boolean);
    await saveSettings(s);
    // ดันราคาโซนออกกำลังกายไปให้หน้าเว็บสาธารณะด้วย — ถ้าล้มเหลวไม่ต้องล้มการบันทึกทั้งหมด
    // (การตั้งค่าหลักบันทึกไปแล้ว แค่เว็บอาจยังแสดงราคาเดิมจนกว่าจะบันทึกสำเร็จรอบหน้า)
    try {
      await savePublicPrices(s);
      toast('บันทึกการตั้งค่าแล้ว — ราคาบนหน้าเว็บอัปเดตตามแล้ว');
    } catch (e) {
      console.error(e);
      toast('บันทึกการตั้งค่าแล้ว (แต่ยังส่งราคาไปหน้าเว็บไม่สำเร็จ)');
    }
  };
  container.appendChild(el('div', { class: 'row', style: 'justify-content:flex-end' }, [saveBtn]));
}
