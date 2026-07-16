// ═══════════════════════════════════════════════════════════════
// registrations.js — กล่องรับ "ใบลงทะเบียนเข้าพัก" จาก perfectbkk.com/checkin.html
// ลูกค้ากรอกเองก่อนมาถึง → พนักงานเปิดดูรายละเอียด + กดนำเข้าเป็นลูกค้า/สัตว์เลี้ยง
// ═══════════════════════════════════════════════════════════════
import { listen, save, remove } from './db.js';
import { el, toast, openModal, confirmDialog } from './ui.js';
import { formatDateTH } from './calc.js';
import { icons } from './icons.js';

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
function parseRaw(f) {
  try { return JSON.parse(f.raw || '{}'); } catch { return {}; }
}

export function renderRegistrations(container) {
  _unsub.forEach(u => u()); _unsub = [];

  const listWrap = el('div', {});
  container.appendChild(el('div', { class: 'page-title' }, [
    el('h1', { text: 'ลงทะเบียนเช็คอิน' }),
    el('span', { class: 'muted', style: 'font-size:13px', text: 'จากฟอร์ม perfectbkk.com/checkin.html' }),
  ]));
  container.appendChild(listWrap);

  const draw = () => {
    listWrap.innerHTML = '';
    const forms = [..._forms].sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
    if (!forms.length) {
      listWrap.appendChild(el('div', { class: 'card' }, [
        el('p', { class: 'muted', style: 'padding:16px;text-align:center', text: 'ยังไม่มีใบลงทะเบียนเข้ามา — ลูกค้ากรอกฟอร์มบนเว็บแล้วจะเด้งมาที่นี่อัตโนมัติ' }),
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
        el('div', { class: 'muted', style: 'font-size:13px;margin-top:4px', text:
          `เข้าพัก ${formatDateTH(f.checkIn)} → ${formatDateTH(f.checkOut)} · สัตว์ ${f.petCount || '?'} ตัว · ส่งเมื่อ ${f.submittedAt ? new Date(f.submittedAt).toLocaleString('th-TH') : '-'}` }),
      ]);
      card.onclick = () => openDetail(f);
      listWrap.appendChild(card);
    });
  };

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
        el('span', { class: `pet-chip pet-${cat ? 'cat' : 'dog'} pet-chip-lg`, html: `${cat ? icons.cat : icons.dog} ${p.name || `ตัวที่ ${i + 1}`}` }),
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

  // ปุ่ม
  const importBtn = el('button', { class: 'btn primary', html: icons.users + ' นำเข้าลูกค้า & สัตว์เลี้ยง' });
  const delBtn = el('button', { class: 'btn danger', html: icons.trash + ' ลบใบนี้' });
  wrap.appendChild(el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px;gap:8px' }, [delBtn, importBtn]));

  const m = openModal(wrap);

  importBtn.onclick = async () => {
    await importToCustomer(f, d);
    m.close();
  };
  delBtn.onclick = async () => {
    if (!await confirmDialog('ลบใบลงทะเบียนนี้?', { danger: true, okText: 'ลบ' })) return;
    await remove('checkinForms', f.id); m.close(); toast('ลบแล้ว');
  };
}

// ── นำเข้าเป็นลูกค้า + สัตว์เลี้ยง (จับคู่ด้วยเบอร์โทรก่อน) ──
async function importToCustomer(f, d) {
  const owner = d.owner || {};
  const pets = d.pets || [];
  const norm = (t) => (t || '').replace(/\D/g, '');

  const existing = _customers.find(c =>
    (owner.phone && c.phone && norm(c.phone) === norm(owner.phone)) ||
    (c.name && c.name === owner.fullname));

  // รวมข้อมูลสุขภาพเป็นโน้ตอ่านง่าย — วันหมดอายุวัคซีนให้พนักงานกรอกเอง
  // (ฟอร์มเก็บ "วันที่ฉีดล่าสุด" ระยะคุ้มกันแต่ละเข็มไม่เท่ากัน เดาไม่ได้)
  const mappedPets = pets.map(p => ({
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
