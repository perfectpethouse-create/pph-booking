// ═══════════════════════════════════════════════════════════════
// appointments.js — จองคิว Grooming และโซนออกกำลังกาย
//
// ทำไมแยกจาก bookings.js:
//   การจองห้องพักเป็น "ช่วงวัน" (เข้า-ออก คิดเป็นคืน มีมัดจำ)
//   ส่วนนี้เป็น "รอบเวลา" (วัน + เวลาเริ่ม + ความยาวรอบ จ่ายจบครั้งเดียว)
//   ยัดสองอย่างรวมกันจะทำให้ calc/calendar/reports เต็มไปด้วย if แยกประเภท
// ═══════════════════════════════════════════════════════════════
import { listen, save, remove } from './db.js';
import { el, toast, openModal, confirmDialog, getSettings, currentUser, isStaff } from './ui.js';
import { formatBaht, formatDateTH, todayISO, addDaysISO } from './calc.js';
import {
  APPOINTMENT_TYPES, APPOINTMENT_STATUSES,
  EXERCISE_SIZES, EXERCISE_LEVELS, EXERCISE_SLOTS, EXERCISE_CAPACITY, EXERCISE_DURATION_MIN, exercisePrice,
  GROOMING_SIZES, COAT_TYPES, GROOMING_SLOTS, GROOMING_CUT_LAST_SLOT,
  GROOMING_BATH_MAX, GROOMING_CUT_MAX, groomingDurationLabel,
  DEFAULT_GROOMING_CAPACITY, groomingPrice,
  PET_TYPES,
  GROOMING_SERVICES, groomServiceOf, groomServiceLabel, groomingDuration,
} from './config-shop.js';
import {
  buildAppointmentCard, buildAppointmentText, downloadCardPNG, shareCard, copyText,
} from './summary-card.js';
import { icons } from './icons.js';

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

// จำนวนที่จองแล้วในรอบนั้น (ไม่นับใบที่ยกเลิก และไม่นับตัวเองตอนแก้ไข)
export function countInSlot(list, { type, date, time, excludeId }) {
  return list.filter(a =>
    a.type === type && a.date === date && a.time === time &&
    a.status !== 'ยกเลิก' && a.id !== excludeId).length;
}

export function renderAppointments(container) {
  _unsub.forEach(u => u()); _unsub = [];

  // 'day' = ตารางรอบเวลาละเอียดของวันเดียว · 'week' = ภาพรวม 7 วัน ตอบลูกค้าว่า "ว่างวันไหน"
  let mode = 'day';

  const dateInput = el('input', { type: 'date', value: todayISO(), style: 'max-width:170px' });
  const typeFilter = el('select', { style: 'max-width:220px' }, [
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

  container.appendChild(el('div', { class: 'page-title' }, [
    el('h1', { text: 'Grooming & โซนออกกำลังกาย' }),
    addBtn,
  ]));
  container.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'toolbar' }, [seg, prevBtn, dateInput, nextBtn, todayBtn, typeFilter]),
    board,
  ]));

  const draw = () => {
    const date = dateInput.value || todayISO();
    const only = typeFilter.value;
    board.innerHTML = '';
    const types = only ? APPOINTMENT_TYPES.filter(t => t.id === only) : APPOINTMENT_TYPES;
    types.forEach(t => board.appendChild(
      mode === 'week'
        ? buildWeekBoard(t, date, (d) => { dateInput.value = d; setMode('day'); })
        : buildSlotBoard(t, date)));
  };
  dateInput.onchange = draw;
  typeFilter.onchange = draw;

  _unsub.push(listen('appointments', arr => { _appts = arr; draw(); }));
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
    const openSlots = slots.filter(t => booked.filter(a => a.time === t).length < cap).length;
    const total = slots.length;
    // แถบวัดจาก "จำนวนตัวที่รับได้ทั้งวัน" ไม่ใช่จำนวนรอบที่เต็ม
    // เพราะรอบที่มี 2/3 ยังนับว่าว่าง ทำให้แถบขึ้น 0% ทั้งที่วันนั้นมีงานแล้ว
    const seats = total * cap;
    const pct = seats ? Math.round((booked.length / seats) * 100) : 0;
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

function buildSlotBoard(type, date) {
  const s = getSettings();
  const cap = capacityFor(type.id, s);
  const dayCount = _appts.filter(a => a.type === type.id && a.date === date && a.status !== 'ยกเลิก').length;
  const wrap = el('div', { class: `slot-board slot-board--${type.id}` }, [
    boardHeader(type, formatDateTH(date), dayCount ? `${dayCount} คิว` : 'ยังว่าง', `รับได้รอบละ ${cap}`),
  ]);

  const grid = el('div', { class: 'slot-grid' });
  slotsFor(type.id).forEach(time => {
    const inSlot = _appts.filter(a => a.type === type.id && a.date === date && a.time === time && a.status !== 'ยกเลิก');
    const n = inSlot.length;
    const state = n === 0 ? 'free' : (n >= cap ? 'full' : 'part');
    // รอบดึกที่รับเฉพาะอาบน้ำ — บอกไว้บนช่อง กันพนักงานรับงานตัดขนแล้วมาพบทีหลังว่าจองไม่ได้
    const bathOnly = type.id === 'grooming' && !slotsFor('grooming', true).includes(time);
    const cell = el('div', { class: `slot slot--${state}` }, [
      el('div', { class: 'slot-time' }, [
        el('span', { text: time }),
        el('span', { class: 'slot-count', text: `${n}/${cap}` }),
      ]),
      bathOnly ? el('div', { class: 'slot-tag', text: 'อาบน้ำเท่านั้น' }) : null,
      ...inSlot.map(a => {
        // งานตัดขนกินเวลานานกว่าเท่าตัว — ติดป้ายไว้ให้เห็นตอนวางแผนคิวทั้งวัน
        const chip = el('button', {
          class: 'slot-chip',
          title: `${a.type === 'grooming' ? groomServiceLabel(groomServiceOf(a)) : 'ออกกำลังกาย'} · ประมาณ ${Math.round((a.durationMin || 60) / 60)} ชม.`,
        }, [
          el('span', { class: 'slot-pet', text: a.petName || a.customerName || '-' }),
          el('span', { class: 'slot-price', text: formatBaht(a.price) }),
          // ป้ายอยู่ท้ายสุดใน DOM เพื่อให้ตกลงบรรทัดใหม่ ไม่ไปบีบชื่อน้องจนอ่านไม่ออก
          a.type === 'grooming' && groomServiceOf(a) !== 'bath'
            ? el('span', { class: 'slot-tag slot-tag--inline', text: groomServiceOf(a) === 'cut' ? 'ตัดขน' : 'อาบน้ำ+ตัดขน' }) : null,
        ].filter(Boolean));
        chip.onclick = () => openAppointmentForm(a);
        return chip;
      }),
      (() => {
        const add = el('button', { class: 'slot-add', html: icons.plus, 'aria-label': `จองรอบ ${time}` });
        add.onclick = () => openAppointmentForm(null, date, { type: type.id, time });
        return add;
      })(),
    ]);
    grid.appendChild(cell);
  });
  wrap.appendChild(grid);
  return wrap;
}

// ═══════════ ฟอร์มจองคิว ═══════════
// prefill: { type, time } เมื่อกดปุ่ม + ในช่องรอบเวลานั้นโดยตรง
export function openAppointmentForm(existing, dateHint = todayISO(), prefill = {}) {
  const s = getSettings();
  const isNew = !existing?.id;
  const draft = existing ? structuredClone(existing) : {
    type: prefill.type || 'grooming',
    date: dateHint,
    time: prefill.time || '',
    customerName: '', phone: '', petName: '', petType: 'dog',
    // grooming
    size: '', coatType: 'short', groomService: 'bath',
    // exercise
    exSize: 'S', level: '1',
    price: 0, status: 'จองแล้ว', notes: '',
    source: 'counter',
  };

  // พนักงานเห็นราคาได้ — ต้องแจ้งลูกค้าหน้าเคาน์เตอร์
  const form = el('div', {});

  // ฟังรายการนัดหมายตลอดเวลาที่ฟอร์มเปิดอยู่ — ต้องทำแม้เปิดฟอร์มจากหน้าอื่น
  // (เช่น "คำขอจองจากเว็บ → สร้างนัดหมาย") ไม่งั้น _appts ว่าง แล้วนับคิวได้ 0
  // ทำให้จองทับรอบที่เต็มแล้วโดยไม่มีการเตือน
  // ฟังต่อเนื่องแทนการอ่านครั้งเดียว เพราะ Firestore ส่งข้อมูลแบบ async
  // และพนักงานอีกเครื่องอาจจองรอบเดียวกันเข้ามาระหว่างกำลังกรอกฟอร์ม
  let notifyCapacity = () => {};
  const unsubAppts = listen('appointments', arr => { _appts = arr; notifyCapacity(); });

  const m = openModal(form, { onClose: () => unsubAppts() });
  build();

  function rerender() { form.innerHTML = ''; build(); }

  function build() {
    const priceBox = el('div', { class: 'summary-box owner-only' });
    const capacityNote = el('div', { class: 'capacity-note' });

    const recalc = () => {
      draft.price = computePrice(draft, s);
      priceBox.innerHTML = '';
      priceBox.appendChild(el('div', { class: 'sum-row sum-total' }, [
        el('span', { text: 'ราคา' }),
        el('strong', { text: formatBaht(draft.price) }),
      ]));
      refreshCapacity();
    };

    // เตือนแต่ไม่บล็อก — ร้านตัดสินใจเองได้ว่าจะรับเกินไหม
    const refreshCapacity = () => {
      capacityNote.innerHTML = '';
      if (!draft.date || !draft.time) return;
      const cap = capacityFor(draft.type, s);
      const n = countInSlot(_appts, { type: draft.type, date: draft.date, time: draft.time, excludeId: existing?.id });
      const willBe = n + 1;
      const over = willBe > cap;
      capacityNote.appendChild(el('p', {
        class: 'pill ' + (over ? 'yellow' : 'green'),
        text: over
          ? `รอบนี้จะมี ${willBe} ตัว เกินที่รับได้ (${cap}) — บันทึกได้แต่ต้องยืนยัน`
          : `รอบนี้จะมี ${willBe}/${cap} ตัว`,
      }));
    };
    // ให้ listener ด้านบนอัปเดตตัวเลขในฟอร์มได้เมื่อข้อมูลมาถึง/มีคนอื่นจองแทรก
    notifyCapacity = refreshCapacity;

    const typeSel = selectEl(APPOINTMENT_TYPES.map(t => [t.id, t.label]), draft.type, v => {
      draft.type = v;
      // รอบเวลาของสองโซนไม่เหมือนกัน — ถ้าเวลาเดิมไม่มีในโซนใหม่ต้องล้างทิ้ง
      if (!slotsFor(v, draft.groomService).includes(draft.time)) draft.time = '';
      rerender();
    });
    const dateInp = el('input', { type: 'date', value: draft.date || '' });
    dateInp.oninput = () => { draft.date = dateInp.value; recalc(); };
    const timeSel = selectEl(
      [['', '— เลือกรอบ —'], ...slotsFor(draft.type, draft.groomService).map(t => [t, t])],
      draft.time || '', v => { draft.time = v; recalc(); });

    const nameInp = el('input', { value: draft.customerName || '', placeholder: 'ชื่อลูกค้า' });
    nameInp.oninput = () => draft.customerName = nameInp.value;
    const phoneInp = el('input', { value: draft.phone || '', placeholder: 'เบอร์โทร', type: 'tel' });
    phoneInp.oninput = () => draft.phone = phoneInp.value;
    const petInp = el('input', { value: draft.petName || '', placeholder: 'ชื่อน้อง' });
    petInp.oninput = () => draft.petName = petInp.value;

    // ── ช่องเฉพาะประเภท ──
    let typeFields;
    if (draft.type === 'exercise') {
      // โซนออกกำลังกายรับเฉพาะน้องหมา (สระ + สนามออกแบบมาเพื่อสุนัข)
      draft.petType = 'dog';
      const sizeSel = selectEl(EXERCISE_SIZES.map(x => [x.id, x.label]), draft.exSize, v => { draft.exSize = v; recalc(); });
      const lvlSel = selectEl(EXERCISE_LEVELS.map(x => [x.id, x.label]), draft.level, v => { draft.level = v; recalc(); });
      typeFields = el('div', {}, [
        el('p', { class: 'muted', style: 'margin:0 0 10px;font-size:13px', text: 'โซนออกกำลังกายรับเฉพาะน้องหมา · รอบละ 60 นาที · พี่เลี้ยง 1 ต่อ 3 ตัว' }),
        el('div', { class: 'row' }, [labeled('ขนาดน้อง', sizeSel), labeled('ระดับบริการ', lvlSel)]),
      ]);
    } else {
      const petSel = selectEl(PET_TYPES.map(p => [p.id, p.label]), draft.petType, v => {
        draft.petType = v;
        draft.size = ''; // ตารางไซส์หมา/แมวคนละชุด ต้องเลือกใหม่
        draft.coatType = 'short';
        rerender();
      });
      const sizes = GROOMING_SIZES[draft.petType] || [];
      const sizeSel = selectEl([['', '— เลือกขนาด —'], ...sizes.map(x => [x.id, x.label])], draft.size || '', v => { draft.size = v; recalc(); });
      const coats = COAT_TYPES[draft.petType] || [];
      const coatSel = selectEl(coats.map(x => [x.id, x.label]), draft.coatType, v => { draft.coatType = v; recalc(); });
      // รูปแบบบริการ 3 แบบ — อาบน้ำอย่างเดียว / ตัดขนอย่างเดียว / อาบน้ำ+ตัดขน
      const svcSel = selectEl(GROOMING_SERVICES.map(x => [x.id, x.label]), draft.groomService || 'bath', v => {
        draft.groomService = v;
        // เลือกงานที่มีตัดขนทั้งที่จองรอบดึกไว้แล้ว → รอบนั้นใช้ไม่ได้ ต้องล้างและบอกเหตุผล
        // (ถ้าปล่อยไว้ ผู้ใช้จะเห็นเวลาค้างอยู่แต่ระบบบันทึกรอบที่ไม่มีอยู่จริง)
        if (draft.time && !slotsFor('grooming', v).includes(draft.time)) {
          toast(`รอบ ${draft.time} รับเฉพาะอาบน้ำ — งานตัดขนเริ่มได้ไม่เกิน ${GROOMING_CUT_LAST_SLOT} กรุณาเลือกรอบใหม่`);
          draft.time = '';
        }
        rerender();
      });
      // ตัดขนอย่างเดียวไม่ต้องเลือกลักษณะขน เพราะราคาคิดจากไซส์อย่างเดียว
      const cutOnly = draft.groomService === 'cut';
      typeFields = el('div', {}, [
        el('p', { class: 'muted', style: 'margin:0 0 10px;font-size:13px', text:
          `${groomServiceLabel(draft.groomService || 'bath')} ใช้เวลาประมาณ ${groomingDurationLabel(draft.groomService)}`
          + ` · อาบน้ำรับถึงรอบ ${GROOMING_SLOTS[GROOMING_SLOTS.length - 1]} · งานตัดขนเริ่มได้ไม่เกิน ${GROOMING_CUT_LAST_SLOT}` }),
        el('div', { class: 'row' }, [labeled('รูปแบบบริการ', svcSel)]),
        el('div', { class: 'row' }, [
          labeled('ชนิดสัตว์', petSel),
          labeled('ขนาด', sizeSel),
          cutOnly ? null : labeled('ลักษณะขน', coatSel),
        ].filter(Boolean)),
      ]);
    }

    const statusSel = selectEl(APPOINTMENT_STATUSES.map(x => [x, x]), draft.status, v => draft.status = v);
    const notesInp = el('textarea', { placeholder: 'โรคประจำตัว / สายพันธุ์ / ข้อควรระวัง' });
    notesInp.value = draft.notes || '';
    notesInp.oninput = () => draft.notes = notesInp.value;

    // พนักงานเปิดคิวเดิมมาดูได้ แต่แก้ไม่ได้ (firestore.rules บล็อก update)
    const readOnly = !isNew && isStaff();
    const saveBtn = el('button', {
      class: 'btn primary' + (readOnly ? ' disabled' : ''),
      html: icons.save + (readOnly ? ' แก้ไขได้เฉพาะเจ้าของร้าน' : ' บันทึก'),
    });
    saveBtn.onclick = () => readOnly
      ? toast('คิวที่บันทึกแล้วแก้ได้เฉพาะเจ้าของร้าน — ถ้าต้องแก้ กรุณาแจ้งเจ้าของร้าน')
      : doSave(draft, isNew, m, existing?.id, s);
    // ดูการ์ดก่อนบันทึกได้ เผื่อลูกค้ายืนรออยู่แล้วอยากเห็นก่อนตกลง
    const cardBtn = el('button', { class: 'btn ghost', html: icons.image + ' ดูการ์ด' });
    cardBtn.onclick = () => openApptCard({ ...draft, price: computePrice(draft, s), durationMin: durationFor(draft.type, draft.groomService) });
    // ลบได้เฉพาะเจ้าของร้าน (firestore.rules บล็อกฝั่ง server ด้วย)
    const delBtn = existing?.id && !isStaff() ? el('button', { class: 'btn danger', html: icons.trash + ' ลบ' }) : null;
    if (delBtn) delBtn.onclick = async () => {
      if (await confirmDialog('ลบนัดหมายนี้?', { danger: true, okText: 'ลบ' })) {
        await remove('appointments', existing.id); m.close(); toast('ลบแล้ว');
      }
    };

    form.append(
      el('h2', { text: isNew ? 'จองคิวใหม่' : 'แก้ไขนัดหมาย' }),
      formGroup(icons.star, 'ประเภทและรอบเวลา', 'orange',
        el('div', { class: 'row' }, [labeled('ประเภท', typeSel)]),
        el('div', { class: 'row' }, [labeled('วันที่', dateInp), labeled('รอบเวลา', timeSel)]),
        capacityNote),
      formGroup(icons.users, 'ลูกค้า & น้อง', 'blue',
        el('div', { class: 'row' }, [labeled('ชื่อลูกค้า', nameInp), labeled('เบอร์โทร', phoneInp)]),
        el('div', { class: 'row' }, [labeled('ชื่อน้อง', petInp)])),
      formGroup(icons.paw, 'รายละเอียดบริการ', 'purple', typeFields),
      formGroup(icons.bookings, 'สถานะ & หมายเหตุ', 'grey',
        el('div', { class: 'row' }, [labeled('สถานะ', statusSel)]),
        el('div', { class: 'field' }, [el('label', { text: 'หมายเหตุ' }), notesInp]),
        priceBox),
      el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:12px' },
        [delBtn, cardBtn, saveBtn].filter(Boolean)),
    );
    recalc();
  }
}

// ราคาคำนวณจากของที่มีอยู่แล้วใน config-shop — ไม่ตั้งราคาเองในไฟล์นี้
export function computePrice(d, settings) {
  if (d.type === 'exercise') return exercisePrice(d.exSize, d.level, settings);
  if (!d.size) return 0;
  return groomingPrice(d.petType, d.size, d.coatType, groomServiceOf(d));
}

async function doSave(draft, isNew, modal, existingId, settings) {
  if (!draft.customerName?.trim()) return toast('กรุณากรอกชื่อลูกค้า');
  if (!draft.date) return toast('กรุณาเลือกวันที่');
  if (!draft.time) return toast('กรุณาเลือกรอบเวลา');
  if (draft.type === 'grooming' && !draft.size) return toast('กรุณาเลือกขนาดน้อง');
  // ด่านสุดท้าย — กันข้อมูลที่เป็นไปไม่ได้หลุดลงฐานข้อมูล เผื่อร่างมาจากหน้าอื่น
  // (เช่นแปลงจากคำขอเว็บ) ซึ่งไม่ได้ผ่านการล้างค่าในฟอร์ม
  if (!slotsFor(draft.type, draft.groomService).includes(draft.time)) {
    return toast(draft.groomService !== 'bath'
      ? `งานตัดขนเริ่มได้ไม่เกิน ${GROOMING_CUT_LAST_SLOT} — กรุณาเลือกรอบใหม่`
      : `รอบ ${draft.time} ไม่มีในโซนนี้ — กรุณาเลือกรอบใหม่`);
  }

  // เกินความจุ = เตือนให้ยืนยัน ไม่ห้าม (ร้านอาจรับได้จริงในบางกรณี)
  const cap = capacityFor(draft.type, settings);
  const n = countInSlot(_appts, { type: draft.type, date: draft.date, time: draft.time, excludeId: existingId });
  if (n + 1 > cap) {
    const ok = await confirmDialog(
      `รอบ ${draft.time} วันที่ ${formatDateTH(draft.date)} มีอยู่แล้ว ${n} ตัว (รับได้ ${cap}) — จองเพิ่มเลยไหม?`,
      { okText: 'จองเพิ่ม' });
    if (!ok) return;
  }

  const rec = {
    ...draft,
    price: computePrice(draft, settings),
    durationMin: durationFor(draft.type, draft.groomService),
    createdBy: draft.createdBy || currentUser()?.email || '',
  };
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

// ────────── helpers (รูปแบบเดียวกับ bookings.js) ──────────
function formGroup(icon, title, color, ...children) {
  return el('div', { class: `form-group form-group--${color}` }, [
    el('div', { class: 'form-group-head' }, [
      el('span', { class: 'fg-ico', html: icon }),
      el('span', { text: title }),
    ]),
    el('div', { class: 'form-group-body' }, children),
  ]);
}
function labeled(label, node) { return el('div', { class: 'field', style: 'margin:0' }, [el('label', { text: label }), node]); }
function selectEl(pairs, value, onChange) {
  const sel = el('select', {}, pairs.map(([v, t]) => el('option', { value: v, text: t })));
  sel.value = value;
  sel.onchange = () => onChange(sel.value);
  return sel;
}
