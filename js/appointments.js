// ═══════════════════════════════════════════════════════════════
// appointments.js — จองคิว Grooming และโซนออกกำลังกาย
//
// ทำไมแยกจาก bookings.js:
//   การจองห้องพักเป็น "ช่วงวัน" (เข้า-ออก คิดเป็นคืน มีมัดจำ)
//   ส่วนนี้เป็น "รอบเวลา" (วัน + เวลาเริ่ม + ความยาวรอบ จ่ายจบครั้งเดียว)
//   ยัดสองอย่างรวมกันจะทำให้ calc/calendar/reports เต็มไปด้วย if แยกประเภท
// ═══════════════════════════════════════════════════════════════
import { listen, save, remove } from './db.js';
import { el, toast, openModal, confirmDialog, getSettings, currentUser, isStaff, escapeHtml, bfGroup, chipGroup } from './ui.js';
import { formatBaht, formatDateTH, todayISO, addDaysISO } from './calc.js';
import {
  APPOINTMENT_TYPES, APPOINTMENT_STATUSES,
  EXERCISE_SIZES, EXERCISE_ZONES, EXERCISE_SLOTS, EXERCISE_CAPACITY, EXERCISE_DURATION_MIN,
  GROOMING_SIZES, COAT_TYPES, GROOMING_SLOTS, GROOMING_CUT_LAST_SLOT,
  groomingDurationLabel,
  DEFAULT_GROOMING_CAPACITY,
  PET_TYPES,
  GROOMING_SERVICES, groomServiceOf, groomServiceLabel, groomingDuration,
  petsOf, petCountOf, petPrice, petDuration,
  EXERCISE_ADDON_NONE, EXERCISE_ADDON_OPTIONS, addonIsSet, addonHasBath,
  exerciseGroomTime, addonGroomIssue,
  exerciseAddOnPrice, addonGroomPet,
} from './config-shop.js';
import {
  buildAppointmentCard, buildAppointmentText, downloadCardPNG, shareCard, copyText,
} from './summary-card.js';
import { icons } from './icons.js';
import { DOW, dateOf, longDate, MONTHS } from './mobile-kit.js';

let _appts = [];
let _unsub = [];

// ── ตัวช่วยเฉพาะประเภท — รวมความต่างของสองโซนไว้ที่เดียว ──
// งานที่มีตัดขนใช้เวลานานกว่า จึงเริ่มได้ไม่เกิน GROOMING_CUT_LAST_SLOT (18:00)
// ส่วนอาบน้ำอย่างเดียวรับได้ถึงรอบสุดท้าย 19:00
// (เทียบสตริง 'HH:MM' ตรงๆ ได้ เพราะเป็นเลขสองหลักเรียงตามเวลาอยู่แล้ว)
export function slotsFor(type, service = 'bath') {
  if (type === 'exercise') return EXERCISE_SLOTS;
  const hasCut = service === 'cut' || service === 'bathCut' || service === true;
  return hasCut ? GROOMING_SLOTS.filter(t => t <= GROOMING_CUT_LAST_SLOT) : GROOMING_SLOTS;
}
// คืน "เวลาที่ต้องกันไว้" = ค่ามากสุดของงานนั้น เพื่อไม่ให้รับคิวถี่เกินจริง
// (อาบน้ำ 2 ชม. · อาบน้ำ+ตัดขน 3 ชม. · โซนออกกำลังกาย 1 ชม.)
export function durationFor(type, service = 'bath') {
  if (type === 'exercise') return EXERCISE_DURATION_MIN;
  return groomingDuration(service);
}
export function capacityFor(type, settings) {
  if (type === 'exercise') return EXERCISE_CAPACITY;
  return Number(settings?.groomingCapacity) || DEFAULT_GROOMING_CAPACITY;
}

// จำนวน "ตัว" ที่จองแล้วในรอบนั้น (ไม่นับใบที่ยกเลิก และไม่นับตัวเองตอนแก้ไข)
// นับตามจำนวนน้องจริง เพราะ 1 การ์ดอาจมีหลายตัว (petCountOf) — ใบเก่านับเป็น 1
export function countInSlot(list, { type, date, time, excludeId }) {
  return list.filter(a =>
    a.type === type && a.date === date && a.time === time &&
    a.status !== 'ยกเลิก' && a.id !== excludeId
  ).reduce((sum, a) => sum + petCountOf(a), 0);
}

// น้องเปล่า 1 ตัวตามประเภทโซน — ใช้ตอนเริ่มการ์ดใหม่/กด "เพิ่มน้อง"
function blankPet(type) {
  return type === 'exercise'
    ? { petName: '', exSize: 'S', zone: 'field', addOn: EXERCISE_ADDON_NONE, gSize: '', coatType: 'short' }
    : { petName: '', petType: 'dog', size: '', coatType: 'short', groomService: 'bath' };
}
// รูปแบบบริการรวมของทั้งการ์ด (ใช้เลือกรอบเวลาที่ทำได้) — ถ้ามีตัวใดตัดขน
// ทั้งการ์ดต้องจำกัดรอบ ≤ 18:00 เหมือนงานตัดขน
function cardService(d) {
  return (d.pets || []).some(p => p.groomService === 'cut' || p.groomService === 'bathCut')
    ? 'bathCut' : 'bath';
}
// ประกอบเอกสารที่จะบันทึก: เก็บ pets[] + ฟิลด์เดี่ยว "mirror" ของตัวแรก + ยอดรวม
// mirror ไว้เพื่อให้จอ/ใบเก่าที่ยังอ่าน petName/price/durationMin เดี่ยว ทำงานต่อได้
function mirrorRec(draft, settings) {
  const pets = (draft.pets || []).map(p => ({ ...p }));
  const first = pets[0] || {};
  const price = pets.reduce((s, p) => s + petPrice(p, draft.type, settings), 0);
  const durationMin = pets.reduce((s, p) => s + petDuration(p, draft.type), 0);
  const petName = pets.map(p => p.petName).filter(Boolean).join(', ');
  const rec = { ...draft, pets, price, durationMin, petCount: pets.length, petName };
  if (draft.type === 'exercise') {
    rec.petType = 'dog'; rec.exSize = first.exSize; rec.zone = first.zone;
    // ยอดค่าเสริม (อาบน้ำ/ตัดขน) — เก็บไว้โชว์บนการ์ด/ชิป ไม่รวมใน price (price = ค่าเล่นล้วน)
    // ราคางานกรูมจริงไปอยู่บน "คิว Grooming ที่ผูกกัน" เพื่อให้รายงานแยกยอดถูก
    rec.addOnTotal = pets.reduce((sum, p) => sum + exerciseAddOnPrice(p), 0);
  } else {
    rec.petType = first.petType; rec.size = first.size;
    rec.coatType = first.coatType; rec.groomService = first.groomService;
  }
  return rec;
}

// น้องออกกำลังกายที่เลือก add-on (อาบน้ำ/ตัดขน)
function addOnPetsOf(draft) {
  return draft.type === 'exercise' ? (draft.pets || []).filter(p => addonIsSet(p.addOn)) : [];
}
// ประกอบ "คิว Grooming ที่ผูกกัน" จากน้องที่เลือก add-on — เป็นนัดหมาย type='grooming' เต็มตัว
//   จึงโผล่ในบอร์ด Grooming, นับความจุช่าง และเข้ารายงานรายได้ Grooming ด้วยกลไกเดิมทั้งหมด
//   time = รอบเล่น + 1 ชม. · price = ค่ากรูมล้วน (รายงานจึงแยกยอดถูก ไม่ซ้ำกับค่าเล่น)
function buildCompanionGroom(draft, exerciseId, priorGroomId, settings) {
  const addPets = addOnPetsOf(draft).map(addonGroomPet);
  const price = addPets.reduce((sum, p) => sum + petPrice(p, 'grooming', settings), 0);
  const durationMin = addPets.reduce((sum, p) => sum + petDuration(p, 'grooming'), 0);
  const petName = addPets.map(p => p.petName).filter(Boolean).join(', ');
  const first = addPets[0] || {};
  const rec = {
    type: 'grooming',
    date: draft.date, time: exerciseGroomTime(draft.time),
    customerName: draft.customerName || '', phone: draft.phone || '',
    pets: addPets, price, durationMin, petCount: addPets.length, petName,
    petType: 'dog', size: first.size, coatType: first.coatType, groomService: first.groomService,
    status: draft.status,
    notes: (draft.notes ? draft.notes + ' · ' : '') + 'บริการเสริมต่อจากโซนออกกำลังกาย',
    source: 'exercise-addon',
    linkedApptId: exerciseId,
    createdBy: draft.createdBy || currentUser()?.email || '',
  };
  if (priorGroomId) rec.id = priorGroomId; // แก้คิวเดิมที่ผูกไว้ ไม่สร้างใหม่ซ้ำ
  return rec;
}

export function renderAppointments(container) {
  _unsub.forEach(u => u()); _unsub = [];

  // 'day' = ตารางรอบเวลาละเอียดของวันเดียว · 'week' = ภาพรวม 7 วัน ตอบลูกค้าว่า "ว่างวันไหน"
  let mode = 'day';

  const dateInput = el('input', { type: 'date', value: todayISO(), 'aria-label': 'เลือกวันที่' });
  const typeFilter = el('select', { 'aria-label': 'กรองประเภทบริการ' }, [
    el('option', { value: '', text: 'ทุกประเภท' }),
    ...APPOINTMENT_TYPES.map(t => el('option', { value: t.id, text: t.label })),
  ]);
  const addBtn = el('button', { class: 'btn primary', html: icons.plus + ' จองคิว' });
  addBtn.onclick = () => openAppointmentForm(null, dateInput.value);

  const dayBtn = el('button', { class: 'seg-btn active', text: 'รายวัน' });
  const weekBtn = el('button', { class: 'seg-btn', text: '7 วัน' });
  const seg = el('div', { class: 'seg' }, [dayBtn, weekBtn]);
  const setMode = (m) => {
    mode = m;
    dayBtn.classList.toggle('active', m === 'day');
    weekBtn.classList.toggle('active', m === 'week');
    draw();
  };
  dayBtn.onclick = () => setMode('day');
  weekBtn.onclick = () => setMode('week');

  // เลื่อนทีละวันในโหมดรายวัน · ทีละสัปดาห์ในโหมด 7 วัน
  const prevBtn = el('button', { class: 'btn sm ghost', html: icons.chevronLeft, 'aria-label': 'ก่อนหน้า' });
  const nextBtn = el('button', { class: 'btn sm ghost', html: icons.chevronRight, 'aria-label': 'ถัดไป' });
  const shift = (n) => {
    dateInput.value = addDaysISO(dateInput.value || todayISO(), n * (mode === 'week' ? 7 : 1));
    draw();
  };
  prevBtn.onclick = () => shift(-1);
  nextBtn.onclick = () => shift(1);
  const todayBtn = el('button', { class: 'btn sm ghost', text: 'วันนี้' });
  todayBtn.onclick = () => { dateInput.value = todayISO(); draw(); };

  const board = el('div', {});
  const subtitle = el('div', { class: 'd-date' });

  // มือถือ = ไทม์ไลน์แบบแอป (.mappt) · คอม = บอร์ดเต็ม (.appt-full) — สลับด้วย CSS
  const mobile = buildMobileQueue();
  container.appendChild(mobile.node);
  container.appendChild(el('div', { class: 'appt-full' }, [
    el('div', { class: 'd-top' }, [el('h1', { text: 'Grooming & โซนออกกำลังกาย' }), subtitle]),
    el('div', { class: 'd-card d-qbar' }, [
      seg,
      el('div', { class: 'd-datenav' }, [prevBtn, dateInput, nextBtn]),
      todayBtn, typeFilter, el('span', { class: 'd-sp' }), addBtn,
    ]),
    board,
  ]));

  const draw = () => {
    const date = dateInput.value || todayISO();
    const only = typeFilter.value;
    board.innerHTML = '';
    // รายวัน = 2 โซนวางคู่กัน (ตาม mockup) · 7 วัน = เรียงลงมาเต็มความกว้าง
    board.className = mode === 'day' && !only ? 'd-zgrid' : 'd-zstack';
    subtitle.textContent = mode === 'day' ? 'ตารางคิวรายวัน' : 'ภาพรวม 7 วัน — กดวันที่เพื่อดูรอบเวลา';
    const types = only ? APPOINTMENT_TYPES.filter(t => t.id === only) : APPOINTMENT_TYPES;
    types.forEach(t => board.appendChild(
      mode === 'week'
        ? buildWeekBoard(t, date, (d) => { dateInput.value = d; setMode('day'); })
        : buildSlotBoard(t, date)));
  };
  dateInput.onchange = draw;
  typeFilter.onchange = draw;

  _unsub.push(listen('appointments', arr => { _appts = arr; draw(); mobile.draw(); }));
}

// ═══════════ มือถือ: สลับโซน + แถบ 7 วัน + ไทม์ไลน์รอบเวลา ═══════════
// รอบว่างแสดงเป็นกรอบเส้นประพร้อมปุ่ม "เพิ่มคิว" — แตะแล้วเปิดฟอร์มเดิมพร้อมเวลานั้น
function buildMobileQueue() {
  let type = APPOINTMENT_TYPES[0].id;
  let date = todayISO();
  let weekStart = todayISO();
  const node = el('div', { class: 'mappt' });

  function draw() {
    const s = getSettings();
    const cap = capacityFor(type, s);
    const today = todayISO();
    node.innerHTML = '';

    node.appendChild(el('div', { class: 'm-ptitle' }, [el('h1', { text: 'คิวบริการ' })]));

    const seg = el('div', { class: 'm-seg', role: 'tablist' }, APPOINTMENT_TYPES.map(t => {
      const b = el('button', { class: t.id === type ? 'on' : '', role: 'tab', 'aria-selected': String(t.id === type),
        text: t.id === 'exercise' ? 'ออกกำลังกาย' : 'Grooming' });
      b.onclick = () => { type = t.id; draw(); };
      return b;
    }));
    node.appendChild(seg);

    // หัวเดือน + ลูกศรเลื่อนทีละสัปดาห์ (ตอบลูกค้าที่ถามคิวล่วงหน้าหลายวัน)
    const ws = dateOf(weekStart);
    const prev = el('button', { class: 'm-arr', html: icons.chevronLeft, 'aria-label': 'สัปดาห์ก่อน' });
    const next = el('button', { class: 'm-arr', html: icons.chevronRight, 'aria-label': 'สัปดาห์ถัดไป' });
    prev.onclick = () => { weekStart = addDaysISO(weekStart, -7); date = weekStart; draw(); };
    next.onclick = () => { weekStart = addDaysISO(weekStart, 7); date = weekStart; draw(); };
    node.appendChild(el('div', { class: 'm-mhead' }, [
      el('b', { text: `${MONTHS[ws.getMonth()]} ${ws.getFullYear() + 543}` }),
      el('span', { class: 'm-arrs' }, [prev, next]),
    ]));

    const week = el('div', { class: 'm-week', role: 'tablist' });
    for (let i = 0; i < 7; i++) {
      const iso = addDaysISO(weekStart, i);
      const d = dateOf(iso);
      const n = _appts.filter(a => a.type === type && a.date === iso && a.status !== 'ยกเลิก').length;
      const btn = el('button', { class: 'm-day' + (iso === date ? ' on' : '') + (iso === today ? ' today' : ''), role: 'tab', 'aria-selected': String(iso === date) }, [
        el('span', { text: DOW[d.getDay()] }), el('b', { text: String(d.getDate()) }),
        el('span', { class: 'm-dots' }, Array.from({ length: Math.min(n, 3) }, () => el('i', { class: 'q' }))),
      ]);
      btn.onclick = () => { date = iso; draw(); };
      week.appendChild(btn);
    }
    node.appendChild(week);

    const dayList = _appts.filter(a => a.type === type && a.date === date && a.status !== 'ยกเลิก');
    node.appendChild(el('div', { class: 'm-sec' }, [
      el('h3', {}, [(date === today ? 'วันนี้ · ' : '') + longDate(date), el('span', { class: 'm-n', text: String(dayList.length) })]),
      el('span', { class: 'm-capnote', text: `รับได้รอบละ ${cap} ตัว` }),
    ]));

    slotsFor(type).forEach(time => {
      const inSlot = dayList.filter(a => a.time === time);
      const n = inSlot.reduce((sum, a) => sum + petCountOf(a), 0);
      const bathOnly = type === 'grooming' && !slotsFor('grooming', true).includes(time);
      const addBtn = el('button', { class: 'm-addq', html: icons.plus + '<span>เพิ่มคิว</span>' });
      addBtn.onclick = () => openAppointmentForm(null, date, { type, time });

      let box;
      if (!inSlot.length) {
        box = el('div', { class: 'm-slot-free' }, [
          el('span', { text: `ว่าง ${cap} ที่${bathOnly ? ' · อาบน้ำเท่านั้น' : ''}` }), addBtn,
        ]);
      } else {
        const full = n >= cap;
        box = el('div', { class: 'm-slot-box' + (full ? ' full' : '') }, [
          el('div', { class: 'm-capbar' }, [
            el('span', { text: full ? `เต็ม ${n}/${cap}` : `จองแล้ว ${n}/${cap}` }),
            el('i', {}, Array.from({ length: cap }, (_, k) => el('em', { class: k < n ? 'f' : '' }))),
          ]),
          ...inSlot.map(a => {
            const pets = petsOf(a);
            const first = pets[0]?.petName || a.customerName || '-';
            const detail = a.type === 'exercise'
              ? (a.zone ? exerciseZoneLabelSafe(a) : 'ออกกำลังกาย')
              : groomServiceLabel(groomServiceOf(a));
            const row = el('div', { class: 'm-appt', role: 'button', tabindex: '0' }, [
              el('span', { class: 'm-pet' + (a.petType === 'cat' ? ' cat' : ''), html: a.petType === 'cat' ? icons.cat : icons.dog }),
              el('div', { class: 'm-tx' }, [
                el('b', { text: pets.length > 1 ? `${first} ×${pets.length}` : first }),
                el('small', { text: `${detail} · ${a.customerName || ''}` }),
              ]),
              a.status === 'เสร็จแล้ว' ? el('span', { class: 'pill green', text: 'เสร็จ' }) : null,
            ]);
            row.onclick = () => openAppointmentForm(a);
            return row;
          }),
          full ? null : addBtn,
        ]);
      }
      node.appendChild(el('div', { class: 'm-slot' }, [
        el('div', { class: 'm-slot-t', text: time }),
        box,
      ]));
    });
  }

  return { node, draw };
}

// ชื่อโซนออกกำลังกายของใบนั้น (สนาม/สระ) — ใบเก่าที่ไม่มี zone แสดงระดับแทน
function exerciseZoneLabelSafe(a) {
  const z = EXERCISE_ZONES.find(x => x.id === a.zone);
  return z ? z.label : `ระดับ ${a.level || '-'}`;
}

const THAI_DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

// ภาพรวม 7 วันนับจากวันที่เลือก — ตอบคำถามหน้าเคาน์เตอร์ว่า "อาทิตย์หน้าว่างวันไหน"
// โดยไม่ต้องกดเปลี่ยนวันทีละวัน กดที่วันไหนแล้วเด้งเข้าตารางรอบเวลาของวันนั้น
function buildWeekBoard(type, startDate, onPickDay) {
  const s = getSettings();
  const cap = capacityFor(type.id, s);
  const slots = slotsFor(type.id);
  const today = todayISO();

  const weekCount = _appts.filter(a => a.type === type.id && a.status !== 'ยกเลิก'
    && a.date >= startDate && a.date <= addDaysISO(startDate, 6)).length;
  const wrap = el('div', { class: `slot-board slot-board--${type.id}` }, [
    boardHeader(type, `${formatDateTH(startDate)} – ${formatDateTH(addDaysISO(startDate, 6))}`,
      weekCount ? `${weekCount} คิว` : 'ยังว่าง', `รับได้รอบละ ${cap}`),
  ]);
  const grid = el('div', { class: 'week-grid' });

  for (let i = 0; i < 7; i++) {
    const date = addDaysISO(startDate, i);
    const dow = THAI_DAYS[new Date(date + 'T00:00:00').getDay()];
    const booked = _appts.filter(a => a.type === type.id && a.date === date && a.status !== 'ยกเลิก');
    // นับตามจำนวนตัวจริง (1 การ์ดอาจมีหลายตัว) — ทั้งการวัดความเต็มและรอบที่ยังว่าง
    const petsIn = t => booked.filter(a => a.time === t).reduce((sum, a) => sum + petCountOf(a), 0);
    const openSlots = slots.filter(t => petsIn(t) < cap).length;
    const total = slots.length;
    // แถบวัดจาก "จำนวนตัวที่รับได้ทั้งวัน" ไม่ใช่จำนวนรอบที่เต็ม
    // เพราะรอบที่มี 2/3 ยังนับว่าว่าง ทำให้แถบขึ้น 0% ทั้งที่วันนั้นมีงานแล้ว
    const seats = total * cap;
    const petsBooked = booked.reduce((sum, a) => sum + petCountOf(a), 0);
    const pct = seats ? Math.round((petsBooked / seats) * 100) : 0;
    const state = openSlots === 0 ? 'full' : (booked.length ? 'part' : 'free');

    const cell = el('button', { class: `week-day week-day--${state}` + (date === today ? ' is-today' : '') }, [
      el('div', { class: 'wd-top' }, [
        el('span', { class: 'wd-dow', text: dow }),
        el('span', { class: 'wd-date', text: formatDateTH(date).slice(0, 5) }),
      ]),
      el('div', { class: 'wd-bar' }, [el('span', { style: `width:${pct}%` })]),
      el('div', { class: 'wd-free', text: openSlots === 0 ? 'เต็ม' : `ว่าง ${openSlots} รอบ` }),
      el('div', { class: 'wd-count', text: booked.length ? `จอง ${booked.length}` : '—' }),
    ]);
    cell.onclick = () => onPickDay(date);
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);
  return wrap;
}

// ตารางรอบเวลาของวันที่เลือก — เห็นทันทีว่ารอบไหนเต็ม รอบไหนยังว่าง
// หัวข้อของแต่ละโซน — ไอคอน+สีประจำหมวด ทำให้แยกออกทันทีว่ากำลังดูโซนไหน
// (เดิมสองโซนหน้าตาเหมือนกันหมด ต้องอ่านตัวหนังสือถึงจะรู้)
function boardHeader(type, subtitle, booked, capText) {
  return el('div', { class: 'sb-head' }, [
    el('span', { class: 'sb-ico', html: type.id === 'exercise' ? icons.paw : icons.star }),
    el('div', { class: 'sb-text' }, [
      el('div', { class: 'sb-title', text: type.label }),
      el('div', { class: 'sb-sub', text: subtitle }),
    ]),
    el('span', { class: 'sb-count', text: booked }),
    capText ? el('span', { class: 'sb-cap', text: capText }) : null,
  ]);
}

// ตารางรอบเวลาของวันที่เลือก แบบแถว (ตาม appointments-mockup): ซ้าย = เวลา+ความจุ · ขวา = คิวในรอบ
// รอบว่างย่อเหลือบรรทัดเดียว ทั้งวันจึงกวาดตาดูได้ในจอเดียว
function buildSlotBoard(type, date) {
  const s = getSettings();
  const cap = capacityFor(type.id, s);
  const dayCount = _appts.filter(a => a.type === type.id && a.date === date && a.status !== 'ยกเลิก').length;
  const wrap = el('div', { class: `slot-board slot-board--${type.id} d-zone` }, [
    boardHeader(type, `${formatDateTH(date)} · รับได้รอบละ ${cap} ตัว`, dayCount ? `${dayCount} คิว` : 'ยังว่าง'),
  ]);

  slotsFor(type.id).forEach(time => {
    const inSlot = _appts.filter(a => a.type === type.id && a.date === date && a.time === time && a.status !== 'ยกเลิก');
    const n = inSlot.reduce((sum, a) => sum + petCountOf(a), 0); // นับตัวจริง (การ์ดอาจมีหลายตัว)
    const state = n === 0 ? 'free' : (n >= cap ? 'full' : 'part');
    // รอบดึกที่รับเฉพาะอาบน้ำ — บอกไว้บนช่อง กันพนักงานรับงานตัดขนแล้วมาพบทีหลังว่าจองไม่ได้
    const bathOnly = type.id === 'grooming' && !slotsFor('grooming', true).includes(time);
    const add = el('button', { class: 'd-slot-add', html: icons.plus, 'aria-label': `จองรอบ ${time}`, title: `จองรอบ ${time}` });
    add.onclick = () => openAppointmentForm(null, date, { type: type.id, time });

    const body = el('div', { class: 'd-slot-b' }, [
      ...inSlot.map(a => {
        // 1 การ์ดอาจมีหลายตัว → ป้ายเดียวติด "×N ตัว" · ตัวเลข n/cap ด้านซ้ายนับตัวจริง
        const pets = petsOf(a);
        const pcount = pets.length;
        const firstName = pets[0]?.petName || a.customerName || '-';
        const hasCut = a.type === 'grooming' && pets.some(p => groomServiceOf(p) !== 'bath');
        const tags = [
          a.type === 'exercise' ? exerciseZoneLabelSafe(a)
            : hasCut ? (pcount > 1 ? 'มีตัดขน' : (groomServiceOf(a) === 'cut' ? 'ตัดขน' : 'อาบน้ำ+ตัดขน')) : 'อาบน้ำ',
          // โซนออกกำลังกายที่มี add-on → มีคิวกรูมผูกอยู่ · คิวกรูมที่มาจากการเล่น → บอกที่มา
          (a.type === 'exercise' && Number(a.addOnTotal) > 0) ? '+ กรูม' : null,
          (a.type === 'grooming' && a.source === 'exercise-addon') ? 'เสริมจากเล่น' : null,
        ].filter(Boolean);
        const chip = el('button', {
          class: 'd-appt' + (a.status === 'เสร็จแล้ว' ? ' done' : ''),
          title: `${a.customerName || ''} · ประมาณ ${Math.round((a.durationMin || 60) / 60)} ชม.`,
        }, [
          el('b', { text: pcount > 1 ? `${firstName} ×${pcount} ตัว` : firstName }),
          ...tags.map(t => el('span', { class: 'd-atag', text: t })),
          a.status === 'เสร็จแล้ว' ? el('span', { class: 'd-ap', text: 'เสร็จแล้ว' })
            : Number(a.price) > 0 ? el('span', { class: 'd-ap', text: formatBaht(a.price) }) : null,
        ].filter(Boolean));
        chip.onclick = () => openAppointmentForm(a);
        return chip;
      }),
      n < cap ? el('div', { class: 'd-slot-free' }, [
        el('span', { text: n ? `รับเพิ่มได้ ${cap - n} ตัว` : `ว่าง — รับได้ ${cap} ตัว` }),
        bathOnly ? el('span', { class: 'd-atag', text: 'อาบน้ำเท่านั้น' }) : null,
        add,
      ].filter(Boolean)) : null,
    ].filter(Boolean));

    wrap.appendChild(el('div', { class: `d-slot d-slot--${state}` }, [
      el('div', { class: 'd-slot-t' }, [
        el('b', { text: time }),
        el('span', { class: 'd-cap', text: n >= cap ? `${n}/${cap} เต็ม` : `${n}/${cap}` }),
      ]),
      body,
    ]));
  });
  return wrap;
}

// ═══════════ ฟอร์มจองคิว ═══════════
// prefill: { type, time } เมื่อกดปุ่ม + ในช่องรอบเวลานั้นโดยตรง
export function openAppointmentForm(existing, dateHint = todayISO(), prefill = {}) {
  const s = getSettings();
  const isNew = !existing?.id;
  let draft;
  if (existing) {
    draft = structuredClone(existing);
    // ใบเก่า/ร่างจากหน้าอื่นที่ยังไม่มี pets[] → สังเคราะห์เป็น 1 ตัวจากฟิลด์เดี่ยว
    if (!Array.isArray(draft.pets) || !draft.pets.length) draft.pets = petsOf(draft);
  } else {
    const type = prefill.type || 'grooming';
    draft = {
      type, date: dateHint, time: prefill.time || '',
      customerName: '', phone: '',
      pets: [blankPet(type)],
      status: 'จองแล้ว', notes: '', source: 'counter',
    };
  }

  // พนักงานเห็นราคาได้ — ต้องแจ้งลูกค้าหน้าเคาน์เตอร์
  // ใช้โครงเดียวกับฟอร์มจองห้อง (.bk-form): เลขขั้น · ชิป · แผงสรุปขวา (ดู styles.css)
  const form = el('div', { class: 'bk-form ap-form' });

  // ฟังรายการนัดหมายตลอดเวลาที่ฟอร์มเปิดอยู่ — ต้องทำแม้เปิดฟอร์มจากหน้าอื่น
  // (เช่น "คำขอจองจากเว็บ → สร้างนัดหมาย") ไม่งั้น _appts ว่าง แล้วนับคิวได้ 0
  // ทำให้จองทับรอบที่เต็มแล้วโดยไม่มีการเตือน
  // ฟังต่อเนื่องแทนการอ่านครั้งเดียว เพราะ Firestore ส่งข้อมูลแบบ async
  // และพนักงานอีกเครื่องอาจจองรอบเดียวกันเข้ามาระหว่างกำลังกรอกฟอร์ม
  let notifyCapacity = () => {};
  const unsubAppts = listen('appointments', arr => { _appts = arr; notifyCapacity(); });
  // รายชื่อลูกค้า — ไว้เด้ง "ลูกค้าเก่า" ตอนพิมพ์เบอร์/ชื่อ
  let custs = [];
  let refreshCust = () => {};
  const unsubCust = listen('customers', arr => { custs = arr; refreshCust(); });

  const m = openModal(form, { onClose: () => { unsubAppts(); unsubCust(); } });
  m.el.classList.add('modal--full'); // มือถือเปิดเต็มจอ · คอม 2 แผง (เหมือนฟอร์มจองห้อง)

  // สถานะหน้าจอที่ต้องอยู่รอดข้าม rerender (ไม่บันทึกลงฐานข้อมูล)
  let usedPrev = false; // กด "ใช้ข้อมูลเดิม" แล้ว
  let saving = false;   // กำลังบันทึก → กดซ้ำไม่ทำอะไร (ใบใหม่ยังไม่มี id ยิงซ้ำ = คิวซ้ำ)
  let saveNow = () => {};
  // ⌘/Ctrl + Enter = บันทึก (ผูกครั้งเดียวที่ตัวฟอร์ม) · e.repeat = กดค้าง → ไม่นับ
  form.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (!e.repeat) saveNow(); }
  });
  build();

  function rerender() { form.innerHTML = ''; build(); }

  function build() {
    const isEx = draft.type === 'exercise';
    const cap = capacityFor(draft.type, s);

    // ── 1 บริการ: การ์ด 2 ใบ ──
    const typeCards = el('div', { class: 'ap-types', role: 'radiogroup', 'aria-label': 'ประเภทบริการ' }, APPOINTMENT_TYPES.map(t => {
      const on = t.id === draft.type;
      const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: 'ap-type' + (on ? ' on' : '') }, [
        el('span', { class: 'ic', html: t.id === 'exercise' ? icons.paw : icons.star }),
        el('span', {}, [
          el('b', { text: t.id === 'exercise' ? 'ออกกำลังกาย' : 'Grooming' }),
          el('small', { text: t.id === 'exercise' ? 'สนาม · สระว่ายน้ำ' : 'อาบน้ำ · ตัดขน' }),
        ]),
      ]);
      b.onclick = () => {
        if (on) return;
        draft.type = t.id;
        // ช่องข้อมูลน้องของสองโซนคนละชุด (อาบน้ำ vs ออกกำลังกาย) — เริ่มใหม่ 1 ตัว
        draft.pets = [blankPet(t.id)];
        // รอบเวลาของสองโซนไม่เหมือนกัน — ถ้าเวลาเดิมไม่มีในโซนใหม่ต้องล้างทิ้ง
        if (!slotsFor(t.id, cardService(draft)).includes(draft.time)) draft.time = '';
        rerender();
      };
      return b;
    }));

    // ── 2 วันและรอบ: วันที่ + ชิปลัด · ตารางรอบบอกที่ว่างของวันนั้น ──
    const dateInp = el('input', { type: 'date', value: draft.date || '', 'aria-label': 'วันที่' });
    dateInp.onchange = () => { draft.date = dateInp.value; rerender(); };
    const dayChips = chipGroup([[todayISO(), 'วันนี้'], [addDaysISO(todayISO(), 1), 'พรุ่งนี้'], [addDaysISO(todayISO(), 2), 'มะรืน']],
      draft.date, 'วันลัด', v => { draft.date = v; rerender(); });
    const slotsWrap = el('div', {});
    const drawSlots = () => {
      slotsWrap.innerHTML = '';
      // ทั้งการ์ดมีตัดขน → รอบดึกที่รับเฉพาะอาบน้ำเลือกไม่ได้ (เดิมซ่อนจากดรอปดาวน์)
      const allowed = slotsFor(draft.type, cardService(draft));
      const tile = (t) => {
        const n = draft.date ? countInSlot(_appts, { type: draft.type, date: draft.date, time: t, excludeId: existing?.id }) : 0;
        const bathOnly = !isEx && !slotsFor('grooming', 'bathCut').includes(t);
        const ok = allowed.includes(t);
        const full = n >= cap;
        const on = t === draft.time;
        const sub = !ok || (bathOnly && !full) ? 'อาบน้ำเท่านั้น' : full ? 'เต็ม' : cap > 1 ? (n ? `${n}/${cap} ตัว` : `ว่าง ${cap}`) : 'ว่าง';
        const b = el('button', {
          type: 'button', role: 'radio', 'aria-checked': String(on), disabled: ok ? null : '',
          class: 'ap-slot' + (on ? ' on' : full ? ' full' : n ? ' part' : '') + (bathOnly ? ' bathonly' : ''),
          'aria-label': `รอบ ${t} · ${sub}`,
        }, [el('b', { text: t }), el('small', { text: sub })]);
        // รอบเต็มยังกดได้ — ร้านตัดสินใจเองว่าจะรับเกินไหม (ถามยืนยันตอนบันทึก)
        b.onclick = () => { draft.time = t; rerender(); };
        return b;
      };
      const grid = (list) => el('div', { class: 'ap-slots', role: 'radiogroup', 'aria-label': 'รอบเวลา' }, list.map(tile));
      const slots = isEx ? EXERCISE_SLOTS : GROOMING_SLOTS;
      if (isEx) { slotsWrap.appendChild(grid(slots)); return; }
      // Grooming 19 รอบ → แบ่งช่วงให้กวาดตาง่าย
      [['เช้า', t => t < '12:00'], ['บ่าย', t => t >= '12:00' && t < '18:00'], ['เย็น', t => t >= '18:00']].forEach(([label, inRange], i) => {
        const list = slots.filter(inRange);
        if (!list.length) return;
        slotsWrap.append(
          el('div', { class: 'ap-slots-h' }, [el('span', { text: label }), i === 2 ? el('span', { text: `งานตัดขนเริ่มได้ไม่เกิน ${GROOMING_CUT_LAST_SLOT}` }) : null]),
          grid(list));
      });
    };
    drawSlots();
    const slotBadge = el('span', { class: 'nights-badge', text: isEx ? `รอบละ 50 นาที · ${cap} ตัว` : `ช่างรับรอบละ ${cap} ตัว` });

    // ── 3 ลูกค้า: พิมพ์เบอร์/ชื่อ → เจอลูกค้าเก่า แตะเติมน้องจากครั้งก่อน ──
    const digits = (t) => String(t || '').replace(/\D/g, '');
    const phoneInp = el('input', { value: draft.phone || '', placeholder: 'เบอร์โทร', type: 'tel', inputmode: 'tel', autocomplete: 'off' });
    const nameInp = el('input', { value: draft.customerName || '', placeholder: 'ชื่อลูกค้า', autocomplete: 'off' });
    phoneInp.oninput = () => { draft.phone = phoneInp.value; usedPrev = false; refreshCust(); };
    nameInp.oninput = () => { draft.customerName = nameInp.value; usedPrev = false; refreshCust(); };
    const custCard = el('div', { class: 'bf-cust hidden', style: 'margin-top:10px' });
    refreshCust = () => {
      const p = digits(draft.phone);
      const c = custs.find(c => (p.length >= 9 && digits(c.phone) === p) || (draft.customerName && c.name === draft.customerName));
      // คิวล่าสุดของลูกค้ารายนี้ (ไม่นับที่ยกเลิก/ตัวเอง) — ไว้เติมน้อง+บริการแบบครั้งก่อน
      const key = c ? digits(c.phone) : p;
      const last = _appts
        .filter(a => a.id !== existing?.id && a.status !== 'ยกเลิก' &&
          ((key.length >= 9 && digits(a.phone) === key) || (c && a.customerName === c.name)))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      custCard.innerHTML = '';
      custCard.classList.toggle('hidden', !c && !last);
      if (!c && !last) return;
      const name = c?.name || last.customerName || '';
      const phone = c?.phone || last.phone || '';
      const lastTxt = last
        ? `ครั้งก่อน ${formatDateTH(last.date)} · ${petsOf(last).map(pt => pt.petName).filter(Boolean).join(', ') || 'ไม่ระบุชื่อน้อง'} · ${last.type === 'exercise' ? 'ออกกำลังกาย' : groomServiceLabel(groomServiceOf(petsOf(last)[0]))}`
        : (c.pets || []).map(pt => pt.name).filter(Boolean).join(', ');
      custCard.append(
        el('div', { class: 'bf-cust-txt' }, [
          el('b', { text: `ลูกค้าเก่า · ${name}${phone ? ' · ' + phone : ''}` }),
          el('span', { text: lastTxt || 'ยังไม่มีข้อมูลน้อง' }),
        ]),
        usedPrev ? el('span', { class: 'bf-cust-ok', html: icons.check + ' ใช้ข้อมูลเดิมแล้ว' }) : (() => {
          const b = el('button', { type: 'button', class: 'bf-chip on', text: 'ใช้ข้อมูลเดิม' });
          b.onclick = () => {
            draft.customerName = name || draft.customerName;
            draft.phone = phone || draft.phone;
            // ใบใหม่เท่านั้นที่เติมน้องให้ — ใบเดิมไม่ไปแก้รายการที่บันทึกไว้แล้ว
            if (isNew && last && last.type === draft.type) {
              draft.pets = petsOf(last).map(pt => ({ ...blankPet(draft.type), ...pt }));
            } else if (isNew && c?.pets?.length && !draft.pets.some(pt => pt.petName)) {
              draft.pets[0].petName = c.pets[0].name || '';
              if (!isEx && c.pets[0].species === 'cat') { draft.pets[0].petType = 'cat'; draft.pets[0].size = ''; }
            }
            // รอบที่เลือกไว้อาจใช้ไม่ได้กับบริการครั้งก่อน (เช่นมีตัดขน แต่เลือกรอบ 19:00)
            if (draft.time && !slotsFor(draft.type, cardService(draft)).includes(draft.time)) draft.time = '';
            usedPrev = true;
            rerender();
          };
          return b;
        })(),
      );
    };
    refreshCust();

    // ── 4 น้อง (หลายตัวในการ์ดเดียว) ──
    // แตะชิป/ช่อง → rerender เพื่ออัปเดตราคา+สรุป · ช่องพิมพ์ชื่อไม่ rerender จะได้ไม่หลุดโฟกัส
    const petRow = (pet, idx) => {
      const nameI = el('input', { value: pet.petName || '', placeholder: 'ชื่อน้อง', 'aria-label': `ชื่อน้องตัวที่ ${idx + 1}` });
      nameI.oninput = () => { pet.petName = nameI.value; refreshSide(); };
      const rm = draft.pets.length > 1 ? el('button', { type: 'button', class: 'btn sm ghost bf-rm', html: icons.trash, 'aria-label': `ลบน้องตัวที่ ${idx + 1}` }) : null;
      if (rm) rm.onclick = () => { draft.pets.splice(idx, 1); rerender(); };
      const sub = (t) => el('div', { class: 'ap-sub', text: t });
      const body = [];
      let head, foot;

      if (isEx) {
        head = el('div', { class: 'ap-pet-head' }, [nameI, rm]);
        // โซน = ตัวกำหนดราคา (ราคาเดียวทุกไซส์) ตรงกับหน้าเว็บ
        body.push(el('div', { class: 'ap-zones', role: 'radiogroup', 'aria-label': 'โซน' }, EXERCISE_ZONES.map(z => {
          const on = (pet.zone || 'field') === z.id;
          const [zName, zSub] = splitParen(z.label);
          const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: 'bf-room' + (on ? ' on' : '') }, [
            el('b', { text: zName }), el('span', { text: `${zSub ? zSub + ' · ' : ''}${formatBaht(petPrice({ ...pet, zone: z.id }, 'exercise', s))}` }),
          ]);
          b.onclick = () => { pet.zone = z.id; rerender(); };
          return b;
        })));
        // ขนาดน้อง = เก็บไว้ดูแล/ประเมินหน้าร้าน ไม่มีผลกับราคา
        body.push(sub('ขนาดน้อง (บันทึกไว้ดูแล ไม่มีผลกับราคา)'),
          chipGroup(EXERCISE_SIZES.map(x => [x.id, x.id]), pet.exSize, 'ขนาดน้อง', v => { pet.exSize = v; refreshSide(); }));
        // ── บริการเสริม: อาบน้ำ/ตัดขน ต่อจากรอบเล่น 1 ชม. ──
        if (!EXERCISE_ADDON_OPTIONS.some(o => o.id === (pet.addOn || EXERCISE_ADDON_NONE))) pet.addOn = EXERCISE_ADDON_NONE;
        body.push(sub('อาบน้ำ/ตัดขนต่อหลังเล่น'),
          chipGroup(EXERCISE_ADDON_OPTIONS.map(o => [o.id, o.id === EXERCISE_ADDON_NONE ? 'ไม่เพิ่ม' : SERVICE_SHORT[o.id] || o.label]),
            pet.addOn || EXERCISE_ADDON_NONE, 'บริการเสริม', v => { pet.addOn = v; rerender(); }));
        if (addonIsSet(pet.addOn)) {
          if (addonHasBath(pet.addOn)) {
            body.push(sub('ลักษณะขน'), chipGroup(COAT_TYPES.dog.map(x => [x.id, x.label]), pet.coatType || 'short', 'ลักษณะขน', v => { pet.coatType = v; rerender(); }));
          }
          body.push(sub('ไซส์ Grooming'), sizeGrid(GROOMING_SIZES.dog, pet.gSize, id => exerciseAddOnPrice({ ...pet, gSize: id }), id => { pet.gSize = id; rerender(); }));
          const issue = addonGroomIssue(draft.time, pet.addOn);
          body.push(issue
            ? el('div', { class: 'ap-note warn', role: 'alert', html: icons.alert + `<span>${escapeHtml(issue)}</span>` })
            : el('div', { class: 'ap-note', html: icons.calendar + (draft.time
              ? `<span>ระบบจะจองคิว Grooming รอบ <b>${exerciseGroomTime(draft.time)} น.</b> ต่อให้อัตโนมัติ</span>`
              : '<span>เลือกรอบเล่นก่อน — ระบบจะจองคิว Grooming ต่อหลังเล่น 1 ชม. ให้อัตโนมัติ</span>') }));
        }
        const play = petPrice(pet, 'exercise', s), extra = exerciseAddOnPrice(pet);
        foot = [extra ? `${pet.petName || 'น้องตัวนี้'} · เล่น ${formatBaht(play)} + ${SERVICE_SHORT[pet.addOn]} ${formatBaht(extra)}` : `${pet.petName || 'น้องตัวนี้'} · รอบละ 50 นาที`, play + extra];
      } else {
        head = el('div', { class: 'ap-pet-head' }, [
          nameI,
          chipGroup(PET_TYPES.map(p => [p.id, p.label]), pet.petType, 'ชนิดสัตว์', v => {
            pet.petType = v; pet.size = ''; pet.coatType = 'short'; rerender(); // ตารางไซส์หมา/แมวคนละชุด
          }),
          rm,
        ]);
        body.push(chipGroup(GROOMING_SERVICES.map(x => [x.id, SERVICE_SHORT[x.id] || x.label]), pet.groomService || 'bath', 'รูปแบบบริการ', v => {
          pet.groomService = v;
          // ตัวนี้เพิ่มงานตัดขน แต่รอบที่เลือกไว้เป็นรอบดึก → ทั้งการ์ดจำกัด ≤18:00 ต้องล้างรอบ
          if (draft.time && !slotsFor('grooming', cardService(draft)).includes(draft.time)) {
            toast(`รอบ ${draft.time} รับเฉพาะอาบน้ำ — งานตัดขนเริ่มได้ไม่เกิน ${GROOMING_CUT_LAST_SLOT} กรุณาเลือกรอบใหม่`);
            draft.time = '';
          }
          rerender();
        }));
        // ตัดขนอย่างเดียวไม่ต้องเลือกลักษณะขน เพราะราคาคิดจากไซส์อย่างเดียว
        if (pet.groomService !== 'cut') {
          body.push(sub('ลักษณะขน'), chipGroup((COAT_TYPES[pet.petType] || []).map(x => [x.id, x.label]), pet.coatType, 'ลักษณะขน', v => { pet.coatType = v; rerender(); }));
        }
        body.push(sub('ขนาด · ราคาตามบริการที่เลือก'),
          sizeGrid(GROOMING_SIZES[pet.petType] || [], pet.size, id => petPrice({ ...pet, size: id }, 'grooming', s), id => { pet.size = id; rerender(); }));
        foot = [`${pet.petName || 'น้องตัวนี้'} · ใช้เวลาประมาณ ${groomingDurationLabel(pet.groomService)}`, pet.size ? petPrice(pet, 'grooming', s) : null];
      }
      return el('div', { class: 'ap-pet' }, [
        head, ...body,
        el('div', { class: 'ap-pet-foot' }, [el('span', { text: foot[0] }), el('b', { text: foot[1] == null ? 'เลือกขนาด' : formatBaht(foot[1]) })]),
      ]);
    };
    const addPetBtn = el('button', { type: 'button', class: 'btn sm ghost', html: icons.plus + ' เพิ่มน้องอีกตัว' });
    addPetBtn.onclick = () => { draft.pets.push(blankPet(draft.type)); rerender(); };

    // ── 5 หมายเหตุ (+ สถานะ เฉพาะตอนแก้คิวเดิม — ใบใหม่เป็น "จองแล้ว" เสมอ) ──
    const notesInp = el('textarea', { placeholder: 'โรคประจำตัว / สายพันธุ์ / ข้อควรระวัง', 'aria-label': 'หมายเหตุ' });
    notesInp.value = draft.notes || '';
    notesInp.oninput = () => draft.notes = notesInp.value;
    const statusRow = isNew ? null : el('div', { class: 'field', style: 'margin:0 0 12px' }, [
      el('label', { text: 'สถานะ' }),
      chipGroup(APPOINTMENT_STATUSES.map(x => [x, x]), draft.status, 'สถานะ', v => { draft.status = v; }, 'dep-chips'),
    ]);

    // ── แผงสรุป: วัน-รอบ · รายการ · ความจุรอบ · ยอดชำระ · ปุ่มบันทึก ──
    const sumBox = el('div', { class: 'summary-box' });
    const stickyTotal = el('span', { class: 'ss-deposit' });
    const refreshSide = () => {
      // price = ค่าเล่นล้วน (คงไว้เพื่อให้รายงานออกกำลังกายถูก) · addOnTotal = ค่าอาบน้ำ/ตัดขน
      draft.price = computePrice(draft, s);
      draft.addOnTotal = isEx ? draft.pets.reduce((sum, p) => sum + exerciseAddOnPrice(p), 0) : 0;
      const total = draft.price + draft.addOnTotal;
      const lines = [];
      draft.pets.forEach((p, i) => {
        const nm = p.petName || `น้องตัวที่ ${i + 1}`;
        if (isEx) {
          lines.push([`${nm} · ${splitParen(EXERCISE_ZONES.find(z => z.id === (p.zone || 'field'))?.label || '')[0]}`, petPrice(p, 'exercise', s)]);
          if (addonIsSet(p.addOn)) lines.push([`${SERVICE_SHORT[p.addOn]} ${(p.gSize || '').toUpperCase()}${draft.time ? ` · ${exerciseGroomTime(draft.time)} น.` : ''}`, exerciseAddOnPrice(p)]);
        } else {
          lines.push([`${nm} · ${SERVICE_SHORT[p.groomService || 'bath']}${p.size ? ' ' + p.size.toUpperCase() : ''}`, petPrice(p, 'grooming', s)]);
        }
      });
      let capPill = null;
      if (draft.date && draft.time) {
        // เตือนแต่ไม่บล็อก — ร้านตัดสินใจเองได้ว่าจะรับเกินไหม
        const willBe = countInSlot(_appts, { type: draft.type, date: draft.date, time: draft.time, excludeId: existing?.id }) + petCountOf(draft);
        const over = willBe > cap;
        capPill = el('span', { class: 'ap-cap' + (over ? ' over' : ''), html: (over ? icons.alert : icons.check) + ' ' +
          (over ? `รอบนี้จะมี ${willBe} ตัว เกินที่รับได้ (${cap})` : `รอบนี้ ${willBe}/${cap} ตัวหลังจอง`) });
      }
      sumBox.innerHTML = '';
      sumBox.appendChild(el('div', { class: 'ap-sum' }, [
        draft.date && draft.time
          ? el('div', { class: 'when', text: `${longDate(draft.date)} · ${draft.time} น.` })
          : el('div', { class: 'when empty', text: draft.date ? 'ยังไม่ได้เลือกรอบเวลา' : 'ยังไม่ได้เลือกวัน' }),
        ...lines.map(([a, b]) => el('div', { class: 'ln' }, [el('span', { text: a }), el('span', { text: b ? formatBaht(b) : '—' })])),
        capPill,
        el('div', { class: 'bf-pay' }, [el('span', { class: 'bf-pay-k', text: 'ยอดชำระ (จ่ายจบครั้งเดียว)' }), el('b', { text: formatBaht(total) })]),
      ]));
      stickyTotal.textContent = formatBaht(total);
    };
    // ให้ listener ด้านบนอัปเดตตัวเลขในฟอร์มได้เมื่อข้อมูลมาถึง/มีคนอื่นจองแทรก
    notifyCapacity = () => { drawSlots(); refreshSide(); refreshCust(); };

    // พนักงานเปิดคิวเดิมมาดูได้ แต่แก้ไม่ได้ (firestore.rules บล็อก update)
    const readOnly = !isNew && isStaff();
    const saveBtn = el('button', {
      class: 'btn primary' + (readOnly ? ' disabled' : ''),
      html: icons.save + (readOnly ? ' แก้ไขได้เฉพาะเจ้าของร้าน' : isNew ? ' จองคิว' : ' บันทึก'),
    });
    saveNow = async () => {
      if (readOnly) return toast('คิวที่บันทึกแล้วแก้ได้เฉพาะเจ้าของร้าน — ถ้าต้องแก้ กรุณาแจ้งเจ้าของร้าน');
      if (saving) return;
      saving = true;
      try { await doSave(draft, isNew, m, existing?.id, s); } finally { saving = false; }
    };
    saveBtn.onclick = saveNow;
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    // ดูการ์ดก่อนบันทึกได้ เผื่อลูกค้ายืนรออยู่แล้วอยากเห็นก่อนตกลง
    const cardBtn = el('button', { class: 'btn ghost', html: icons.image + ' ดูการ์ดส่งลูกค้า' });
    cardBtn.onclick = () => openApptCard(mirrorRec(draft, s));
    // ลบได้เฉพาะเจ้าของร้าน (firestore.rules บล็อกฝั่ง server ด้วย)
    const delBtn = existing?.id && !isStaff() ? el('button', { class: 'btn sm ghost bf-del', html: icons.trash + ' ลบคิวนี้' }) : null;
    if (delBtn) delBtn.onclick = async () => {
      if (await confirmDialog('ลบนัดหมายนี้?', { danger: true, okText: 'ลบ' })) {
        // ลบคิว Grooming ที่ผูกกัน (ถ้ามี) ให้หายตามกัน — ไม่ทิ้งคิวค้าง
        if (existing.linkedGroomingId) await remove('appointments', existing.linkedGroomingId);
        await remove('appointments', existing.id); m.close(); toast('ลบแล้ว');
      }
    };

    form.append(
      el('h2', { text: isNew ? 'จองคิวใหม่' : 'แก้ไขนัดหมาย' }),
      el('div', { class: 'bf-main' }, [
        bfGroup('บริการ', null, typeCards),
        bfGroup('วันและรอบ', slotBadge, el('div', { class: 'ap-date' }, [dateInp, dayChips]), slotsWrap),
        bfGroup('ลูกค้า', null,
          el('div', { class: 'row' }, [labeled('เบอร์โทร', phoneInp), labeled('ชื่อลูกค้า', nameInp)]), custCard),
        bfGroup('น้อง', null, ...draft.pets.map(petRow), addPetBtn),
        bfGroup('หมายเหตุ', null, statusRow, el('div', { class: 'field', style: 'margin:0' }, [notesInp])),
      ]),
      el('aside', { class: 'bf-side' }, [
        el('h3', { class: 'bf-side-h', text: 'สรุปคิว' }),
        sumBox,
        el('div', { class: 'sticky-summary' }, [
          el('div', { class: 'ss-figures' }, [el('span', { class: 'ss-total', text: 'ยอดชำระ' }), stickyTotal]),
          saveBtn,
        ]),
        readOnly ? null : el('div', { class: 'bf-key', text: `กด ${isMac ? '⌘' : 'Ctrl'} + Enter เพื่อบันทึก` }),
        el('div', { class: 'bf-acts' }, [cardBtn]),
        delBtn ? el('div', { class: 'bf-acts bf-acts-sm' }, [delBtn]) : null,
      ].filter(Boolean)),
    );
    refreshSide();
  }
}

// ราคารวมทั้งการ์ด = ผลรวมราคาต่อตัว (reuse ตารางราคาเดิมผ่าน petPrice)
// รับได้ทั้งร่างที่มี pets[] และใบเก่าฟิลด์เดี่ยว (petsOf สังเคราะห์ให้)
export function computePrice(d, settings) {
  return petsOf(d).reduce((sum, pet) => sum + petPrice(pet, d.type, settings), 0);
}

async function doSave(draft, isNew, modal, existingId, settings) {
  if (!draft.customerName?.trim()) return toast('กรุณากรอกชื่อลูกค้า');
  if (!draft.date) return toast('กรุณาเลือกวันที่');
  if (!draft.time) return toast('กรุณาเลือกรอบเวลา');
  if (draft.type === 'grooming' && draft.pets.some(p => !p.size)) return toast('กรุณาเลือกขนาดน้องให้ครบทุกตัว');
  // ด่านสุดท้าย — กันข้อมูลที่เป็นไปไม่ได้หลุดลงฐานข้อมูล เผื่อร่างมาจากหน้าอื่น
  // (เช่นแปลงจากคำขอเว็บ) ซึ่งไม่ได้ผ่านการล้างค่าในฟอร์ม
  // ทั้งการ์ดจำกัดรอบตาม cardService — ถ้ามีตัวใดตัดขน ต้อง ≤18:00
  const svc = cardService(draft);
  if (!slotsFor(draft.type, svc).includes(draft.time)) {
    return toast(svc !== 'bath'
      ? `งานตัดขนเริ่มได้ไม่เกิน ${GROOMING_CUT_LAST_SLOT} — กรุณาเลือกรอบใหม่`
      : `รอบ ${draft.time} ไม่มีในโซนนี้ — กรุณาเลือกรอบใหม่`);
  }

  // ── บริการเสริม (add-on) โซนออกกำลังกาย: ต้องกรอกไซส์ Grooming ครบ + รอบกรูมต้องทำได้จริง ──
  const addPets = addOnPetsOf(draft);
  const hasAddOn = addPets.length > 0;
  const priorGroomId = draft.linkedGroomingId || null;
  if (hasAddOn) {
    if (addPets.some(p => !p.gSize)) return toast('กรุณาเลือกไซส์ Grooming ให้น้องที่เพิ่มบริการทุกตัว');
    const issue = addPets.map(p => addonGroomIssue(draft.time, p.addOn)).find(Boolean);
    if (issue) return toast(issue); // ตกพักเที่ยง/เกินเวลาตัดขน — บล็อกตามที่ตกลง
  }

  // เกินความจุ = เตือนให้ยืนยัน ไม่ห้าม (ร้านอาจรับได้จริงในบางกรณี) — นับตามจำนวนตัว
  const cap = capacityFor(draft.type, settings);
  const n = countInSlot(_appts, { type: draft.type, date: draft.date, time: draft.time, excludeId: existingId });
  const add = petCountOf(draft);
  if (n + add > cap) {
    const ok = await confirmDialog(
      `รอบ ${draft.time} วันที่ ${formatDateTH(draft.date)} มีอยู่แล้ว ${n} ตัว จะเพิ่มอีก ${add} (รับได้ ${cap}) — จองเพิ่มเลยไหม?`,
      { okText: 'จองเพิ่ม' });
    if (!ok) return;
  }

  // เตือนความจุช่างที่รอบกรูม (เล่น + 1 ชม.) — ไม่บล็อก เผื่อร้านรับไหว
  if (hasAddOn) {
    const gTime = exerciseGroomTime(draft.time);
    const gCap = capacityFor('grooming', settings);
    const gN = countInSlot(_appts, { type: 'grooming', date: draft.date, time: gTime, excludeId: priorGroomId });
    if (gN + addPets.length > gCap) {
      const ok = await confirmDialog(
        `รอบกรูม ${gTime} วันที่ ${formatDateTH(draft.date)} ช่างรับได้ ${gCap} แต่จะมี ${gN + addPets.length} ตัว — จองเพิ่มเลยไหม?`,
        { okText: 'จองเพิ่ม' });
      if (!ok) return;
    }
  }

  const rec = {
    ...mirrorRec(draft, settings),
    createdBy: draft.createdBy || currentUser()?.email || '',
  };

  // ── ซิงก์ "คิว Grooming ที่ผูกกัน" ก่อน แล้วค่อยผูก id เข้าใบเล่น ──
  // ทำคิวกรูมก่อนเพื่อให้ "บันทึกใบเล่นครั้งเดียวจบ" (ไม่ต้อง update ตามหลัง)
  // firestore.rules อนุญาต create ให้พนักงาน แต่ update/delete เฉพาะเจ้าของร้าน —
  // ถ้าไป update ใบเล่นทีหลัง พนักงานที่จองใหม่จะโดนบล็อก จึงตั้ง linkedGroomingId ให้ครบก่อนบันทึก
  if (hasAddOn) {
    const groomRec = buildCompanionGroom(draft, existingId || '', priorGroomId, settings);
    rec.linkedGroomingId = await save('appointments', groomRec); // create (ใหม่) หรือ update (คิวเดิม)
  } else {
    rec.linkedGroomingId = null; // เผื่อเคยมี add-on แล้วเอาออก — ตัดตัวเชื่อมทิ้ง
    if (priorGroomId) await remove('appointments', priorGroomId);
  }
  await save('appointments', rec);

  modal.close();
  toast(isNew ? 'จองคิวแล้ว' : 'อัปเดตแล้ว');
  // เปิดการ์ดให้เลย — ลูกค้ายืนรออยู่หน้าเคาน์เตอร์ ส่งเข้า Line ต่อได้ทันที
  openApptCard(rec, true);
}

// การ์ดยืนยันคิวสำหรับส่งลูกค้า (แคปหน้าจอ / แชร์เข้า Line / ดาวน์โหลด PNG)
// savedMode = เปิดหลังบันทึกเสร็จ → มีปุ่ม "เสร็จแล้ว" ให้รู้ว่าจบงาน
export function openApptCard(appt, savedMode = false) {
  if (!appt.date || !appt.time) return toast('เลือกวันที่และรอบเวลาก่อนสร้างการ์ด');
  const card = buildAppointmentCard(appt);
  const text = buildAppointmentText(appt);
  const fileBase = `คิว-${appt.petName || appt.customerName || 'ลูกค้า'}`;

  const shareBtn = el('button', { class: 'btn primary', html: icons.share + ' แชร์เข้า Line' });
  const dlBtn = el('button', { class: 'btn', html: icons.download + ' ดาวน์โหลด PNG' });
  const copyBtn = el('button', { class: 'btn', html: icons.copy + ' คัดลอกข้อความ' });
  const doneBtn = el('button', { class: 'btn primary block', html: icons.check + ' เสร็จแล้ว' });

  const m = openModal(el('div', {}, [
    el('h2', { text: savedMode ? 'จองคิวแล้ว ✓' : 'การ์ดยืนยันคิว' }),
    el('p', { class: 'muted', style: 'margin-top:-6px', text:
      'แคปหน้าจอส่งให้ลูกค้าได้เลย หรือกดแชร์/ดาวน์โหลด/คัดลอกข้อความ' }),
    el('div', { style: 'display:flex;justify-content:center;margin:10px 0' }, [card]),
    el('div', { class: 'row', style: 'justify-content:center;gap:8px;flex-wrap:wrap' }, [copyBtn, dlBtn, shareBtn]),
    ...(savedMode ? [el('div', { style: 'margin-top:14px' }, [doneBtn])] : []),
  ]));

  shareBtn.onclick = () => shareCard(card, appt, { text, filename: fileBase + '.png' });
  dlBtn.onclick = () => downloadCardPNG(card, fileBase + '.png');
  copyBtn.onclick = () => copyText(text);
  doneBtn.onclick = () => m.close();
}

// ────────── helpers ──────────
// ชื่อบริการแบบสั้นสำหรับชิป/สรุป (ป้ายเต็มใน config ยาวเกินชิป)
const SERVICE_SHORT = { bath: 'อาบน้ำ', cut: 'ตัดขน', bathCut: 'อาบน้ำ + ตัดขน' };

// "โซนสนาม (Dog Park)" → ['โซนสนาม', 'Dog Park'] · "S (2-5 กก.)" → ['S', '2–5 กก.']
function splitParen(label) {
  const mm = String(label || '').match(/^(.*?)\s*\((.*)\)\s*$/);
  return mm ? [mm[1], mm[2].replace(/(\d)-(\d)/g, '$1–$2')] : [String(label || ''), ''];
}

// ช่องเลือกขนาด: ไซส์ · น้ำหนัก · ราคา (ตามบริการ/ขนที่เลือกอยู่) — ตอบลูกค้าได้โดยไม่ต้องเปิดตาราง
function sizeGrid(sizes, value, priceOf, onPick) {
  return el('div', { class: 'ap-sizes', role: 'radiogroup', 'aria-label': 'ขนาด' }, sizes.map(z => {
    const on = z.id === value;
    const kg = splitParen(z.label)[1];
    const price = priceOf(z.id);
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: 'ap-size' + (on ? ' on' : '') }, [
      el('b', { text: z.id.toUpperCase() }), el('small', { text: kg }), price ? el('em', { text: formatBaht(price) }) : null,
    ]);
    b.onclick = () => onPick(z.id);
    return b;
  }));
}

function labeled(label, node) { return el('div', { class: 'field', style: 'margin:0' }, [el('label', { text: label }), node]); }
