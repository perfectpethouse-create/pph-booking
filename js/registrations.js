// ═══════════════════════════════════════════════════════════════
// registrations.js — กล่องรับ "ใบลงทะเบียนเข้าพัก" จาก perfectbkk.com/checkin.html
// ลูกค้ากรอกเองก่อนมาถึง → พนักงานเปิดดูรายละเอียด + กดนำเข้าเป็นลูกค้า/สัตว์เลี้ยง
// ═══════════════════════════════════════════════════════════════
import { listen, save, remove } from './db.js';
import { el, toast, openModal, confirmDialog, escapeHtml, getSettings } from './ui.js';
import { formatDateTH } from './calc.js';
import { icons, brandLogo } from './icons.js';
import { printSheet } from './intake-form.js';
import { INTAKE_TERMS, INTAKE_CONSENT } from './config-shop.js';
import { qrSVG } from './qrcode.js';

let _unsub = [];
let _forms = [];
let _customers = [];

// ป้ายชื่อฟิลด์ของสัตว์ (จากฟอร์มบนเว็บ) — คีย์ไหนไม่รู้จักจะโชว์ชื่อคีย์ตรงๆ
const PET_LABELS = {
  name: 'ชื่อ', species: 'ชนิด', breed: 'พันธุ์', gender: 'เพศ', age: 'อายุ',
  weight: 'น้ำหนัก (กก.)', microchip: 'Microchip', neutered: 'ทำหมัน',
  health: 'สุขภาพโดยรวม', disease: 'โรคประจำตัว', medication: 'ยาที่ต้องกิน',
  vaccine: 'วัคซีน', vaccineDate: 'ฉีดวัคซีนล่าสุด', flea: 'ป้องกันเห็บหมัด',
  temperament: 'อุปนิสัย', socialize: 'เข้ากับสัตว์อื่น', behaviors: 'พฤติกรรมพิเศษ',
  stressTriggers: 'สิ่งที่ทำให้เครียด', behaviorNote: 'หมายเหตุพฤติกรรม',
  meals: 'มื้อ/วัน', feedTime: 'เวลาให้อาหาร', amount: 'ปริมาณต่อมื้อ',
  food: 'อาหาร', foodBrand: 'ยี่ห้ออาหาร', supplements: 'ยา & วิตามินเสริม',
  allergyFlag: 'มีอาหารที่แพ้/ห้ามกิน', allergyList: 'อาหารที่แพ้/ห้ามกิน',
  room: 'ห้องที่เลือก', items: 'สิ่งของที่นำมา', itemsDetail: 'รายละเอียดสิ่งของ',
};

// จัดกลุ่มฟิลด์สัตว์เป็นหมวด (ตามฟอร์มจริง) — พนักงานอ่านง่าย ไม่ตาลาย
const PET_SECTIONS = [
  { title: 'ข้อมูลตัว', color: 'blue', keys: ['species', 'breed', 'gender', 'age', 'weight', 'microchip', 'neutered'] },
  { title: 'สุขภาพ & วัคซีน', color: 'green', keys: ['health', 'disease', 'medication', 'vaccine', 'vaccineDate', 'flea'] },
  { title: 'อาหาร', color: 'orange', keys: ['meals', 'feedTime', 'amount', 'allergyFlag', 'allergyList', 'food', 'foodBrand', 'supplements'] },
  { title: 'พฤติกรรม & ข้อควรระวัง', color: 'purple', keys: ['temperament', 'socialize', 'behaviors', 'stressTriggers', 'behaviorNote'] },
  { title: 'ห้อง & สิ่งของ', color: 'grey', keys: ['room', 'items', 'itemsDetail'] },
];

// ฟิลด์ที่ "สำคัญต่อการดูแล" — เน้นสีให้พนักงานไม่พลาด (ถ้ามีข้อมูล)
const PET_CRITICAL = new Set(['disease', 'medication', 'allergyList', 'stressTriggers']);
const OWNER_LABELS = {
  fullname: 'ชื่อ-นามสกุล', nickname: 'ชื่อเล่น', phone: 'เบอร์โทร', line: 'Line',
  email: 'อีเมล', address: 'ที่อยู่', emgName: 'ผู้ติดต่อฉุกเฉิน', emgPhone: 'เบอร์ฉุกเฉิน',
  idcard: 'เลขบัตรประชาชน',
};

function isCat(species) { return /แมว|cat/i.test(species || ''); }
function fmtVal(v) { return Array.isArray(v) ? v.join(', ') : String(v ?? ''); }
export function parseRaw(f) {
  try { return JSON.parse(f.raw || '{}'); } catch { return {}; }
}

// แปลงสัตว์เลี้ยงในใบเช็คอิน → รูปแบบ pets ของโปรไฟล์ลูกค้า (healthNotes/vaccineNotes อ่านง่าย)
// แยกออกมาเพื่อให้การ์ดรับลูกค้า (booking-cockpit) เอาไปโชว์ข้อมูลน้องจากใบที่ "ยังไม่นำเข้า" ได้
// โดยไม่ต้องเขียนตรรกะประกอบโน้ตซ้ำ
export function mapFormToPets(d) {
  const pets = (d && d.pets) || [];
  return pets.map(p => ({
    name: p.name || '',
    species: isCat(p.species) ? 'cat' : 'dog',
    breed: p.breed || '',
    weight: p.weight || '',
    healthNotes: [
      p.health, p.disease && `โรค: ${p.disease}`, p.medication && `ยา: ${p.medication}`,
      p.allergyList && `แพ้: ${fmtVal(p.allergyList)}`,
      fmtVal(p.temperament) && `นิสัย: ${fmtVal(p.temperament)}`,
      fmtVal(p.behaviors) && `พฤติกรรม: ${fmtVal(p.behaviors)}`,
      p.stressTriggers && `เครียด: ${p.stressTriggers}`,
      p.feedTime && `อาหาร ${p.meals || ''} มื้อ เวลา ${p.feedTime}`,
      p.behaviorNote,
    ].filter(Boolean).join(' · '),
    vaccineNotes: [p.vaccine, p.vaccineDate && `ฉีดล่าสุด ${formatDateTH(p.vaccineDate)}`]
      .filter(Boolean).join(' · '),
    vaccineExpiry: '', // ให้พนักงานตรวจสมุดวัคซีนแล้วกรอกเอง
  }));
}

// รหัสการจองสำหรับค้นหา/พิมพ์บนหัวกระดาษ
// ใช้รหัสที่ฟอร์มส่งมา (f.ref) เป็นหลัก → ตรงกับอีเมล/Google Sheet/เอกสารพิมพ์ทุกที่
// ถ้าไม่มี (ใบเก่าก่อนอัปเดตฟอร์ม) จึง derive จากเวลาที่ส่ง — deterministic, เรียงตามเวลาได้
function bookingRef(f) {
  if (f.ref) return f.ref;
  const t = f.submittedAt ? new Date(f.submittedAt) : null;
  if (!t || isNaN(t)) return 'PPH-' + String(f.id || '').slice(-6).toUpperCase();
  const p = (n) => String(n).padStart(2, '0');
  return `PPH-${p(t.getFullYear() % 100)}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}`;
}

// เช็คลิสต์ "รับเข้า" — ช่องให้พนักงานกา/กรอกตอนลูกค้ามาถึงจริง (ไม่ใช่ข้อมูลจากฟอร์ม)
const INTAKE_CHECK_ITEMS = [
  'ปลอกคอ / สายจูง', 'ของเล่น', 'ที่นอน / ผ้าห่ม',
  'อาหารที่นำมาเอง', 'ยา / วิตามิน', 'ชามอาหาร / น้ำ', 'อื่นๆ',
];

export function renderRegistrations(container) {
  _unsub.forEach(u => u()); _unsub = [];

  const searchInput = el('input', { placeholder: 'ค้นหารหัสจอง / ชื่อ / เบอร์', style: 'max-width:260px' });
  const listWrap = el('div', {});
  container.appendChild(el('div', { class: 'page-title' }, [
    el('h1', { text: 'ลงทะเบียนเช็คอิน' }),
    el('span', { class: 'muted', style: 'font-size:13px', text: 'จากฟอร์ม perfectbkk.com/checkin.html' }),
  ]));
  container.appendChild(el('div', { class: 'toolbar', style: 'margin-bottom:14px' }, [searchInput]));
  container.appendChild(listWrap);

  const draw = () => {
    listWrap.innerHTML = '';
    const q = searchInput.value.trim().toLowerCase();
    const forms = [..._forms]
      .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''))
      .filter(f => !q || `${bookingRef(f)} ${f.name || ''} ${f.phone || ''}`.toLowerCase().includes(q));
    if (!forms.length) {
      listWrap.appendChild(el('div', { class: 'card' }, [
        el('p', { class: 'muted', style: 'padding:16px;text-align:center', text:
          q ? 'ไม่พบใบลงทะเบียนที่ตรงกับคำค้น' : 'ยังไม่มีใบลงทะเบียนเข้ามา — ลูกค้ากรอกฟอร์มบนเว็บแล้วจะเด้งมาที่นี่อัตโนมัติ' }),
      ]));
      return;
    }
    forms.forEach(f => {
      const isNew = (f.status || 'new') === 'new';
      const card = el('div', { class: 'card day-guest', style: 'padding:16px 18px' }, [
        el('div', { class: 'li-head' }, [
          el('div', {}, [
            el('strong', { text: f.name || '-' }),
            el('span', { class: 'muted', style: 'font-size:12px;margin-left:8px', text: f.phone || '' }),
          ]),
          el('span', { class: 'pill ' + (isNew ? 'yellow' : 'green'), text: isNew ? 'ใหม่ — ยังไม่นำเข้า' : 'นำเข้าแล้ว' }),
        ]),
        el('div', { style: 'margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
          el('span', { class: 'reg-ref', text: bookingRef(f) }),
          f.signedAt ? el('span', { class: 'pill green', style: 'font-size:11px', text: '✓ เซ็นรับแล้ว' }) : null,
        ].filter(Boolean)),
        el('div', { class: 'muted', style: 'font-size:13px;margin-top:4px', text:
          `เข้าพัก ${formatDateTH(f.checkIn)} → ${formatDateTH(f.checkOut)} · สัตว์ ${f.petCount || '?'} ตัว · ส่งเมื่อ ${f.submittedAt ? new Date(f.submittedAt).toLocaleString('th-TH') : '-'}` }),
      ]);
      card.onclick = () => openDetail(f);
      listWrap.appendChild(card);
    });
  };
  searchInput.oninput = draw;

  _unsub.push(listen('checkinForms', arr => { _forms = arr; draw(); }, { orderBy: null }));
  _unsub.push(listen('customers', arr => { _customers = arr; }));
}

// ── รายละเอียดใบลงทะเบียน ──
function openDetail(f) {
  const d = parseRaw(f);
  const owner = d.owner || {};
  const stay = d.stay || {};
  const pets = d.pets || [];

  const wrap = el('div', {});
  wrap.appendChild(el('h2', { text: `ใบลงทะเบียน — ${owner.fullname || f.name || '-'}` }));

  // เจ้าของ
  const ownerBox = el('div', { class: 'lineitem' }, [
    el('div', { class: 'li-head' }, [el('strong', { text: 'ข้อมูลเจ้าของ' })]),
  ]);
  Object.entries(OWNER_LABELS).forEach(([k, label]) => {
    if (!owner[k]) return;
    ownerBox.appendChild(el('div', { class: 'cc-row' }, [
      el('span', { class: 'k', text: label }), el('span', { class: 'v', text: fmtVal(owner[k]) }),
    ]));
  });
  wrap.appendChild(ownerBox);

  // การเข้าพัก
  wrap.appendChild(el('div', { class: 'lineitem' }, [
    el('div', { class: 'li-head' }, [el('strong', { text: 'การเข้าพัก' })]),
    el('div', { class: 'cc-row' }, [el('span', { class: 'k', text: 'Check-in' }), el('span', { class: 'v', text: `${formatDateTH(stay.checkin)} ${stay.checkinTime || ''}` })]),
    el('div', { class: 'cc-row' }, [el('span', { class: 'k', text: 'Check-out' }), el('span', { class: 'v', text: `${formatDateTH(stay.checkout)} ${stay.checkoutTime || ''}` })]),
    stay.specialRequest ? el('div', { class: 'cc-row' }, [el('span', { class: 'k', text: 'คำขอพิเศษ' }), el('span', { class: 'v', text: stay.specialRequest })]) : null,
  ].filter(Boolean)));

  // สัตว์แต่ละตัว — จัดกลุ่มเป็นหมวด + เน้นจุดสำคัญ
  const hasVal = (v) => !(v == null || v === '' || (Array.isArray(v) && !v.length));
  pets.forEach((p, i) => {
    const cat = isCat(p.species);
    const box = el('div', { class: 'lineitem pet-detail' }, [
      el('div', { class: 'li-head' }, [
        el('span', { class: `pet-chip pet-${cat ? 'cat' : 'dog'} pet-chip-lg`, html: `${cat ? icons.cat : icons.dog} ${escapeHtml(p.name || `ตัวที่ ${i + 1}`)}` }),
      ]),
    ]);

    const shown = new Set(['name']);
    const rowFor = (k) => {
      const v = p[k];
      if (!hasVal(v)) return null;
      shown.add(k);
      const val = k === 'vaccineDate' ? formatDateTH(v) : fmtVal(v);
      const critical = PET_CRITICAL.has(k);
      return el('div', { class: 'cc-row' + (critical ? ' cc-row-critical' : '') }, [
        el('span', { class: 'k', text: PET_LABELS[k] || k }),
        el('span', { class: 'v', style: 'white-space:normal;max-width:60%', text: val }),
      ]);
    };

    PET_SECTIONS.forEach(sec => {
      const rows = sec.keys.map(rowFor).filter(Boolean);
      if (!rows.length) return;
      box.appendChild(el('div', { class: `reg-sec reg-sec-${sec.color}`, text: sec.title }));
      rows.forEach(r => box.appendChild(r));
    });
    // ฟิลด์อื่นที่ไม่อยู่ในหมวด (กันข้อมูลตกหล่นเมื่อฟอร์มเพิ่มฟิลด์ใหม่)
    const extra = Object.keys(p).filter(k => !shown.has(k)).map(rowFor).filter(Boolean);
    if (extra.length) {
      box.appendChild(el('div', { class: 'reg-sec reg-sec-grey', text: 'อื่นๆ' }));
      extra.forEach(r => box.appendChild(r));
    }
    wrap.appendChild(box);
  });

  if (d.consent?.agreed) {
    wrap.appendChild(el('p', { class: 'muted', style: 'font-size:12px', text: `ยอมรับเงื่อนไขแล้ว · ลงชื่อ: ${d.consent.signName || '-'} · ส่งเมื่อ ${d.submittedAt || '-'}` }));
  }

  // สถานะเซ็นรับ (ถ้าเซ็นบนจอมาแล้ว)
  if (f.signedAt) {
    wrap.appendChild(el('p', { class: 'muted', style: 'font-size:12px;margin-top:8px', text:
      `✓ เซ็นรับทราบบนจอแล้ว เมื่อ ${new Date(f.signedAt).toLocaleString('th-TH')}` }));
  }

  // ปุ่ม
  const signBtn = el('button', { class: 'btn', html: icons.check + ' เซ็นบนจอ' });
  const pdfBtn = el('button', { class: 'btn', html: icons.download + ' บันทึก PDF' });
  const printBtn = el('button', { class: 'btn', html: icons.print + ' พิมพ์ใบยืนยัน' });
  const importBtn = el('button', { class: 'btn primary', html: icons.users + ' นำเข้าลูกค้า & สัตว์เลี้ยง' });
  const delBtn = el('button', { class: 'btn danger', html: icons.trash + ' ลบใบนี้' });
  wrap.appendChild(el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px;gap:8px;flex-wrap:wrap' }, [delBtn, signBtn, pdfBtn, printBtn, importBtn]));

  const m = openModal(wrap);

  const storedOpts = () => ({ signOwner: f.signOwner, signStaff: f.signStaff, intakePhoto: f.intakePhoto, signedAt: f.signedAt });
  const pdfName = () => `ใบยืนยันเข้าพัก-${bookingRef(f)}`;
  printBtn.onclick = () => printSheet(buildRegSheet(f, d, storedOpts()), { filename: pdfName() });
  pdfBtn.onclick = () => {
    toast('เลือกปลายทาง "บันทึกเป็น PDF" ในหน้าต่างที่เปิดขึ้น');
    printSheet(buildRegSheet(f, d, storedOpts()), { filename: pdfName() });
  };
  signBtn.onclick = () => { m.close(); openSignPad(f, d); };
  importBtn.onclick = async () => {
    await importToCustomer(f, d);
    m.close();
  };
  delBtn.onclick = async () => {
    if (!await confirmDialog('ลบใบลงทะเบียนนี้?', { danger: true, okText: 'ลบ' })) return;
    await remove('checkinForms', f.id); m.close(); toast('ลบแล้ว');
  };
}

// ── ใบยืนยันข้อมูลการเข้าพัก (พิมพ์ให้ลูกค้า + พี่เลี้ยงเซ็นตอนรับเข้า) ──
// ใช้คลาส .intake-* ร่วมกับใบรับฝาก → พิมพ์ผ่าน @media print เดิมได้เลย
// opts.signOwner / opts.signStaff / opts.intakePhoto = data-URL รูป (โหมดเซ็นดิจิทัล) ถ้ามี
function buildRegSheet(f, d, opts = {}) {
  const owner = d.owner || {};
  const stay = d.stay || {};
  const pets = d.pets || [];
  const s = getSettings();
  const ref = bookingRef(f);
  const hasVal = (v) => !(v == null || v === '' || (Array.isArray(v) && !v.length));
  const irow = (k, v, crit) => el('div', { class: 'intake-row' + (crit ? ' crit' : '') }, [
    el('span', { class: 'k', text: k }),
    el('span', { class: 'v', text: hasVal(v) ? fmtVal(v) : '-' }),
  ]);

  const sheet = el('div', { class: 'intake-sheet', id: 'intake-print' });

  // ── หัวกระดาษ + รหัสจอง + QR (สแกนค้นหาเร็ว) ──
  let qrHtml = '';
  try { qrHtml = qrSVG(ref, { size: 96, margin: 1 }); } catch (e) { qrHtml = ''; }
  sheet.appendChild(el('div', { class: 'intake-head' }, [
    el('div', { class: 'intake-brand' }, [
      el('span', { class: 'intake-logo', html: brandLogo }),
      el('div', {}, [
        el('div', { class: 'intake-shop', text: s?.shopInfo?.name || 'Perfect Pet House' }),
        el('div', { class: 'intake-sub', text: 'ใบยืนยันข้อมูลการเข้าพัก · Check-in Confirmation' }),
      ]),
    ]),
    el('div', { class: 'intake-meta intake-meta-qr' }, [
      qrHtml ? el('div', { class: 'reg-qr', html: qrHtml }) : null,
      el('div', {}, [
        el('div', {}, [el('span', { class: 'reg-ref', text: ref })]),
        el('div', { text: `วันที่พิมพ์: ${formatDateTH(new Date().toISOString().slice(0, 10))}` }),
      ]),
    ].filter(Boolean)),
  ]));

  // ── ข้อมูลเจ้าของ ──
  const ownerBox = el('div', { class: 'intake-box' }, [el('h3', { text: 'ข้อมูลเจ้าของ' })]);
  Object.entries(OWNER_LABELS).forEach(([k, label]) => {
    if (hasVal(owner[k])) ownerBox.appendChild(irow(label, owner[k]));
  });
  sheet.appendChild(ownerBox);

  // ── การเข้าพัก ──
  const stayBox = el('div', { class: 'intake-box' }, [el('h3', { text: 'การเข้าพัก' })]);
  stayBox.appendChild(irow('Check-in', `${formatDateTH(stay.checkin)} ${stay.checkinTime || ''}`.trim()));
  stayBox.appendChild(irow('Check-out', `${formatDateTH(stay.checkout)} ${stay.checkoutTime || ''}`.trim()));
  if (hasVal(stay.specialRequest)) stayBox.appendChild(irow('คำขอพิเศษ', stay.specialRequest));
  sheet.appendChild(stayBox);

  // ── ข้อมูลสัตว์แต่ละตัว (เน้นโรค/ยา/อาหารที่แพ้/สิ่งที่ทำให้เครียด) ──
  pets.forEach((p, i) => {
    const cat = isCat(p.species);
    const box = el('div', { class: 'intake-box' }, [
      el('h3', { html: `${cat ? icons.cat : icons.dog} ${escapeHtml(p.name || `สัตว์ตัวที่ ${i + 1}`)}` }),
    ]);
    const shown = new Set(['name']);
    PET_SECTIONS.forEach(sec => {
      const rows = sec.keys.filter(k => hasVal(p[k])).map(k => {
        shown.add(k);
        const val = k === 'vaccineDate' ? formatDateTH(p[k]) : fmtVal(p[k]);
        return irow(PET_LABELS[k] || k, val, PET_CRITICAL.has(k));
      });
      if (!rows.length) return;
      box.appendChild(el('div', { class: `reg-sec reg-sec-${sec.color}`, text: sec.title }));
      rows.forEach(r => box.appendChild(r));
    });
    const extra = Object.keys(p).filter(k => !shown.has(k) && hasVal(p[k]));
    if (extra.length) {
      box.appendChild(el('div', { class: 'reg-sec reg-sec-grey', text: 'อื่นๆ' }));
      extra.forEach(k => box.appendChild(irow(PET_LABELS[k] || k, fmtVal(p[k]))));
    }
    sheet.appendChild(box);
  });

  // ── เช็คลิสต์รับเข้า (พนักงานกรอกตอนลูกค้ามาถึงจริง) ──
  const checkBox = el('div', { class: 'intake-box' }, [el('h3', { text: 'บันทึกตอนรับเข้า (เจ้าหน้าที่กรอก)' })]);
  checkBox.appendChild(el('div', { class: 'intake-check-fill' }, [
    el('span', { text: 'น้ำหนักจริง' }), el('span', { class: 'blank' }), el('span', { text: 'กก.' }),
    el('span', { text: 'สภาพร่างกายโดยรวม' }), el('span', { class: 'blank grow' }),
  ]));
  checkBox.appendChild(el('div', { class: 'intake-check-note', text: 'ของที่ลูกค้าฝากมาด้วย:' }));
  const grid = el('div', { class: 'intake-check-grid' });
  INTAKE_CHECK_ITEMS.forEach(it => grid.appendChild(el('div', { class: 'intake-check-line' }, [
    el('span', { class: 'box', text: '☐' }), el('span', { text: it }),
  ])));
  checkBox.appendChild(grid);
  sheet.appendChild(checkBox);

  // ── ภาพถ่าย / จุดสังเกต-ตำหนิ ตอนรับเข้า ──
  const photoBox = el('div', { class: 'intake-box' }, [
    el('h3', { text: 'ภาพถ่าย / จุดสังเกต-ตำหนิ ตอนรับเข้า' }),
  ]);
  if (opts.intakePhoto) {
    photoBox.appendChild(el('div', { class: 'intake-photo' }, [
      el('img', { src: opts.intakePhoto, alt: 'ภาพสัตว์ตอนรับเข้า' }),
    ]));
  } else {
    photoBox.appendChild(el('div', { class: 'intake-photo-blank', text: 'พื้นที่ติดรูป / วาดจุดสังเกต-ตำหนิ' }));
  }
  photoBox.appendChild(el('div', { class: 'intake-check-note', style: 'margin-top:6px', text: 'บันทึกจุดสังเกต/ตำหนิ (ข้อความ):' }));
  photoBox.appendChild(el('div', { class: 'intake-check-fill' }, [el('span', { class: 'blank grow' }), el('span', { class: 'blank grow' })]));
  sheet.appendChild(photoBox);

  // ── กฎระเบียบ/ข้อตกลง (verbatim จาก config-shop.js) ──
  const termsBox = el('div', { class: 'intake-box intake-terms' }, [
    el('h3', { text: 'กฎระเบียบและนโยบายการเข้าพัก' }),
  ]);
  INTAKE_TERMS.forEach(sec => {
    termsBox.appendChild(el('h4', { text: sec.title }));
    termsBox.appendChild(el('ul', {}, sec.items.map(t => el('li', { text: t }))));
  });
  termsBox.appendChild(el('h4', { text: 'ข้าพเจ้ายืนยันและยินยอมว่า' }));
  termsBox.appendChild(el('ul', {}, INTAKE_CONSENT.map(t => el('li', { text: t }))));
  sheet.appendChild(termsBox);

  // ── ข้อความยืนยันเหนือช่องเซ็น ──
  sheet.appendChild(el('p', { class: 'intake-confirm', text:
    'ข้าพเจ้าได้ตรวจสอบข้อมูลข้างต้นแล้ว และยืนยันว่าข้อมูลทั้งหมดถูกต้องตรงตามความเป็นจริง' }));

  // ── ช่องเซ็น 2 ฝ่าย (ฝังภาพลายเซ็นถ้าเซ็นบนจอมาแล้ว) ──
  const signedDate = opts.signedAt ? formatDateTH(new Date(opts.signedAt).toISOString().slice(0, 10)) : null;
  const signBlock = (img, label) => el('div', { class: 'intake-sign' }, [
    img
      ? el('div', { class: 'sign-line has-img' }, [el('img', { class: 'sign-img', src: img, alt: label })])
      : el('div', { class: 'sign-line' }),
    el('div', { class: 'sign-label', text: label }),
    el('div', { class: 'sign-date', text: signedDate ? `วันที่ ${signedDate}` : 'วันที่ ......... / ......... / .........' }),
  ]);
  sheet.appendChild(el('div', { class: 'intake-signs' }, [
    signBlock(opts.signOwner, 'ลงชื่อเจ้าของสัตว์เลี้ยง'),
    signBlock(opts.signStaff, 'ลงชื่อพี่เลี้ยง / เจ้าหน้าที่ผู้รับเข้า'),
  ]));

  sheet.appendChild(el('div', { class: 'intake-foot', text:
    `${s?.shopInfo?.name || 'Perfect Pet House'}${s?.shopInfo?.phone ? ` · โทร ${s.shopInfo.phone}` : ''} · ${s?.shopInfo?.note || 'Check-in 9:00–18:00 · Check-out 14:00'}` }));

  return sheet;
}

// ── แผ่นเซ็นบนจอ (canvas) — คืน object ควบคุม 1 ช่อง ──
function attachSignaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false, dirty = false, last = null;
  const initSize = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor((rect.width || 300) * ratio));
    canvas.height = Math.max(1, Math.floor((rect.height || 120) * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  };
  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e) => { e.preventDefault(); drawing = true; last = pos(e); if (canvas.setPointerCapture && e.pointerId != null) try { canvas.setPointerCapture(e.pointerId); } catch (x) {} };
  const move = (e) => { if (!drawing) return; e.preventDefault(); const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; dirty = true; };
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointerleave', end);
  return {
    initSize,
    isEmpty: () => !dirty,
    clear: () => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore(); dirty = false; },
    dataURL: () => dirty ? canvas.toDataURL('image/png') : null,
  };
}

// ย่อรูปก่อนเก็บ (กันไฟล์ใหญ่เกินขีดจำกัด Firestore) → data-URL JPEG
function readPhotoScaled(file, cb) {
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 900; let w = img.width, h = img.height;
      if (Math.max(w, h) > max) { const sc = max / Math.max(w, h); w = Math.round(w * sc); h = Math.round(h * sc); }
      const cv = el('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(cv.toDataURL('image/jpeg', 0.7));
    };
    img.src = rd.result;
  };
  rd.readAsDataURL(file);
}

// ── เซ็นรับทราบบนจอ (แท็บเล็ต): ลายเซ็น 2 ฝ่าย + รูปตอนรับเข้า → เก็บไฟล์ + พิมพ์ ──
function openSignPad(f, d) {
  const wrap = el('div', {});
  wrap.appendChild(el('h2', { text: `เซ็นรับทราบ — ${(d.owner && d.owner.fullname) || f.name || '-'}` }));
  wrap.appendChild(el('p', { class: 'muted', style: 'font-size:12px', text: `รหัสจอง ${bookingRef(f)} · เซ็นเพื่อยืนยันว่าข้อมูลถูกต้อง` }));

  // แนบรูปสัตว์ตอนรับเข้า (ไม่บังคับ)
  let photoData = f.intakePhoto || null;
  const photoPreview = el('div', { class: 'sign-photo-preview' });
  const renderPhoto = () => { photoPreview.innerHTML = ''; if (photoData) photoPreview.appendChild(el('img', { src: photoData, alt: 'ภาพสัตว์' })); };
  renderPhoto();
  const photoInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  const photoBtn = el('button', { class: 'btn', type: 'button', html: icons.image + ' แนบรูปสัตว์ตอนรับเข้า' });
  photoBtn.onclick = () => photoInput.click();
  photoInput.onchange = () => { const file = photoInput.files[0]; if (file) readPhotoScaled(file, url => { photoData = url; renderPhoto(); }); };
  wrap.appendChild(el('div', { style: 'margin-top:12px' }, [photoBtn, photoInput, photoPreview]));

  // ลายเซ็น 2 ช่อง
  const ownerCanvas = el('canvas', { class: 'sign-pad' });
  const staffCanvas = el('canvas', { class: 'sign-pad' });
  const ownerPad = attachSignaturePad(ownerCanvas);
  const staffPad = attachSignaturePad(staffCanvas);
  const clearBtn = (pad) => { const b = el('button', { class: 'btn', type: 'button', style: 'padding:3px 10px;font-size:12px', text: 'ล้าง' }); b.onclick = () => pad.clear(); return b; };
  wrap.appendChild(el('div', { class: 'sign-pad-grid' }, [
    el('div', { class: 'sign-pad-col' }, [
      el('div', { class: 'sign-pad-head' }, [el('span', { text: 'ลายเซ็นเจ้าของสัตว์เลี้ยง' }), clearBtn(ownerPad)]),
      el('div', { class: 'sign-pad-wrap' }, [ownerCanvas]),
    ]),
    el('div', { class: 'sign-pad-col' }, [
      el('div', { class: 'sign-pad-head' }, [el('span', { text: 'ลายเซ็นพี่เลี้ยง / เจ้าหน้าที่' }), clearBtn(staffPad)]),
      el('div', { class: 'sign-pad-wrap' }, [staffCanvas]),
    ]),
  ]));

  const saveBtn = el('button', { class: 'btn primary', html: icons.save + ' บันทึก & พิมพ์' });
  wrap.appendChild(el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px;gap:8px' }, [saveBtn]));

  const m = openModal(wrap);
  requestAnimationFrame(() => { ownerPad.initSize(); staffPad.initSize(); });

  saveBtn.onclick = async () => {
    const signOwner = ownerPad.dataURL() || f.signOwner || null;
    const signStaff = staffPad.dataURL() || f.signStaff || null;
    if (!signOwner && !signStaff && !photoData) { toast('กรุณาเซ็นอย่างน้อย 1 ฝ่าย หรือแนบรูป'); return; }
    const opts = { signOwner, signStaff, intakePhoto: photoData, signedAt: Date.now() };
    Object.assign(f, opts);
    saveBtn.disabled = true;
    await save('checkinForms', { ...f });
    m.close();
    toast('บันทึกลายเซ็นแล้ว');
    printSheet(buildRegSheet(f, d, opts), { filename: `ใบยืนยันเข้าพัก-${bookingRef(f)}` });
  };
}

// ── นำเข้าเป็นลูกค้า + สัตว์เลี้ยง (จับคู่ด้วยเบอร์โทรก่อน) ──
// customersList: ส่งลิสต์ลูกค้าปัจจุบันเข้ามาได้ (เช่นจากการ์ด cockpit ที่ไม่ได้เปิดหน้านี้)
// เพื่อหา "ลูกค้าเดิม" ให้เจอ ไม่งั้นอาจสร้างโปรไฟล์ซ้ำ · ค่าเริ่มต้นใช้ _customers ของหน้านี้
export async function importToCustomer(f, d, customersList = _customers) {
  const owner = d.owner || {};
  const norm = (t) => (t || '').replace(/\D/g, '');

  const existing = customersList.find(c =>
    (owner.phone && c.phone && norm(c.phone) === norm(owner.phone)) ||
    (c.name && c.name === owner.fullname));

  // รวมข้อมูลสุขภาพเป็นโน้ตอ่านง่าย — วันหมดอายุวัคซีนให้พนักงานกรอกเอง
  // (ฟอร์มเก็บ "วันที่ฉีดล่าสุด" ระยะคุ้มกันแต่ละเข็มไม่เท่ากัน เดาไม่ได้)
  const mappedPets = mapFormToPets(d);

  const rec = {
    ...(existing || {}),
    name: owner.fullname || existing?.name || '',
    phone: owner.phone || existing?.phone || '',
    pets: mappedPets.length ? mappedPets : (existing?.pets || []),
    notes: [
      existing?.notes,
      owner.line && `Line: ${owner.line}`,
      owner.email && `อีเมล: ${owner.email}`,
      owner.emgName && `ฉุกเฉิน: ${owner.emgName} ${owner.emgPhone || ''}`,
      d.stay?.specialRequest && `คำขอพิเศษ: ${d.stay.specialRequest}`,
    ].filter(Boolean).join('\n'),
  };
  await save('customers', rec);
  await save('checkinForms', { ...f, status: 'imported', importedAt: Date.now() });
  toast(existing
    ? `อัปเดตข้อมูล ${rec.name} + สัตว์เลี้ยง ${mappedPets.length} ตัวแล้ว`
    : `สร้างลูกค้าใหม่ ${rec.name} + สัตว์เลี้ยง ${mappedPets.length} ตัวแล้ว — อย่าลืมกรอกวันหมดอายุวัคซีน`);
}
