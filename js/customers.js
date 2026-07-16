// ═══════════════════════════════════════════════════════════════
// customers.js — ฐานข้อมูลลูกค้า + สัตว์เลี้ยง (โน้ตสุขภาพ/วัคซีน)
// ═══════════════════════════════════════════════════════════════
import { listen, save, remove } from './db.js';
import { el, toast, openModal, confirmDialog } from './ui.js';
import { PET_TYPES } from './config-shop.js';
import { computeBooking, formatBaht, formatDateTH, todayISO } from './calc.js';
import { icons } from './icons.js';

let _unsub = [];
let _customers = [];
let _bookings = [];

// วัคซีนของสัตว์ตัวนี้หมดอายุแล้วหรือใกล้หมด (ภายใน 30 วัน)?
export function vaccineStatus(pet, refDateISO = todayISO()) {
  if (!pet?.vaccineExpiry) return null;
  if (pet.vaccineExpiry < refDateISO) return 'expired';
  const soon = new Date(refDateISO + 'T00:00:00');
  soon.setDate(soon.getDate() + 30);
  // ฟอร์แมตแบบเวลาท้องถิ่น (toISOString เป็น UTC จะเพี้ยน 1 วันในไทย)
  const soonISO = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  return pet.vaccineExpiry <= soonISO ? 'soon' : 'ok';
}

export function renderCustomers(container) {
  _unsub.forEach(u => u()); _unsub = [];

  const searchInput = el('input', { placeholder: 'ค้นหาชื่อ / เบอร์', style: 'max-width:240px' });
  const addBtn = el('button', { class: 'btn primary', html: icons.plus + ' เพิ่มลูกค้า' });
  addBtn.onclick = () => openCustomerForm(null);
  const listWrap = el('div', {});

  container.appendChild(el('div', { class: 'page-title' }, [
    el('h1', { text: 'ลูกค้า & สัตว์เลี้ยง' }),
    el('div', { class: 'row', style: 'gap:8px' }, [searchInput, addBtn]),
  ]));
  container.appendChild(el('div', { class: 'card' }, [listWrap]));

  const draw = () => {
    const q = searchInput.value.trim().toLowerCase();
    const rows = _customers.filter(c => `${c.name || ''} ${c.phone || ''}`.toLowerCase().includes(q));
    listWrap.innerHTML = '';
    if (!rows.length) { listWrap.appendChild(el('p', { class: 'muted', style: 'padding:20px;text-align:center', text: 'ยังไม่มีลูกค้า' })); return; }
    const body = rows.map(c => {
      const pets = (c.pets || []).map(p => `${petLabel(p.species)} ${p.name || ''}`.trim()).join(', ') || '—';
      const stays = _bookings.filter(b => matchCustomer(b, c) && b.depositStatus !== 'ยกเลิก').length;
      const petCell = el('td', { style: 'white-space:normal' }, [el('span', { text: pets })]);
      // ป้ายเตือนวัคซีน: แดง = หมดอายุ · ส้ม = หมดภายใน 30 วัน
      if ((c.pets || []).some(p => vaccineStatus(p) === 'expired')) {
        petCell.appendChild(el('span', { class: 'pill red', style: 'margin-left:6px', text: 'วัคซีนหมดอายุ' }));
      } else if ((c.pets || []).some(p => vaccineStatus(p) === 'soon')) {
        petCell.appendChild(el('span', { class: 'pill yellow', style: 'margin-left:6px', text: 'วัคซีนใกล้หมด' }));
      }
      const tr = el('tr', { style: 'cursor:pointer' }, [
        el('td', {}, [el('strong', { text: c.name || '-' })]),
        el('td', { text: c.phone || '-' }),
        petCell,
        el('td', { class: 'num', text: `${stays} ครั้ง` }),
      ]);
      tr.onclick = () => openCustomerForm(c);
      return tr;
    });
    const head = el('tr', {}, ['ชื่อ', 'เบอร์', 'สัตว์เลี้ยง', 'เคยพัก'].map((h, i) => el('th', { class: i === 3 ? 'num' : '', text: h })));
    listWrap.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [el('thead', {}, [head]), el('tbody', {}, body)])]));
  };
  searchInput.oninput = draw;
  _unsub.push(listen('customers', arr => { _customers = arr; draw(); }));
  _unsub.push(listen('bookings', arr => { _bookings = arr.map(computeBooking); draw(); }));
}

function petLabel(id) { return (PET_TYPES.find(p => p.id === id) || {}).label || id || ''; }

// จับคู่การจองกับลูกค้า: เบอร์ตรงกันก่อน (แม่นสุด) ไม่มีเบอร์ค่อยเทียบชื่อ
function matchCustomer(b, c) {
  if (c.phone && b.phone) return c.phone.replace(/\D/g, '') === b.phone.replace(/\D/g, '');
  return (b.customerName || '').trim() === (c.name || '').trim();
}

function openCustomerForm(existing) {
  const isNew = !existing;
  const draft = existing ? structuredClone(existing) : { name: '', phone: '', pets: [], notes: '' };
  if (!draft.pets) draft.pets = [];

  const form = el('div', {});
  const m = openModal(form);
  build();

  function build() {
    form.innerHTML = '';
    const nameInp = el('input', { value: draft.name || '', placeholder: 'ชื่อลูกค้า' });
    nameInp.oninput = () => draft.name = nameInp.value;
    const phoneInp = el('input', { value: draft.phone || '', placeholder: 'เบอร์โทร' });
    phoneInp.oninput = () => draft.phone = phoneInp.value;

    const petsWrap = el('div', {});
    draft.pets.forEach((p, idx) => petsWrap.appendChild(petRow(p, idx)));
    const addPet = el('button', { class: 'btn sm ghost', html: icons.plus + ' เพิ่มสัตว์เลี้ยง' });
    addPet.onclick = () => { draft.pets.push({ name: '', species: 'dog', breed: '', weight: '', healthNotes: '', vaccineNotes: '' }); build(); };

    const notesInp = el('textarea', { placeholder: 'หมายเหตุลูกค้า' });
    notesInp.value = draft.notes || '';
    notesInp.oninput = () => draft.notes = notesInp.value;

    const saveBtn = el('button', { class: 'btn primary', html: icons.save + ' บันทึก' });
    saveBtn.onclick = async () => {
      if (!draft.name.trim()) return toast('กรุณากรอกชื่อลูกค้า');
      await save('customers', draft); m.close(); toast('บันทึกแล้ว');
    };
    const delBtn = existing ? el('button', { class: 'btn danger', html: icons.trash + ' ลบ' }) : null;
    if (delBtn) delBtn.onclick = async () => {
      if (await confirmDialog('ลบลูกค้ารายนี้?', { danger: true, okText: 'ลบ' })) { await remove('customers', existing.id); m.close(); toast('ลบแล้ว'); }
    };

    form.append(
      el('h2', { text: isNew ? 'เพิ่มลูกค้า' : 'แก้ไขลูกค้า' }),
      el('div', { class: 'row' }, [
        el('div', { class: 'field', style: 'flex:2' }, [el('label', { text: 'ชื่อ' }), nameInp]),
        el('div', { class: 'field' }, [el('label', { text: 'เบอร์โทร' }), phoneInp]),
      ]),
      el('label', { class: 'form-section', text: 'สัตว์เลี้ยง' }), petsWrap, addPet,
      el('div', { class: 'field', style: 'margin-top:12px' }, [el('label', { text: 'หมายเหตุ' }), notesInp]),
      ...(existing ? [historySection(draft)] : []),
      el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px;gap:8px' }, [delBtn, saveBtn].filter(Boolean)),
    );
  }

  // ประวัติการจองของลูกค้ารายนี้ (ไม่นับที่ยกเลิก)
  function historySection(c) {
    const wrap = el('div', {});
    const list = _bookings
      .filter(b => matchCustomer(b, c))
      .sort((a, b) => (b.checkIn || '').localeCompare(a.checkIn || ''));
    const active = list.filter(b => b.depositStatus !== 'ยกเลิก');
    const totalSpent = active.reduce((s, b) => s + (b.grandTotal || 0), 0);

    wrap.appendChild(el('label', {
      class: 'form-section',
      text: `ประวัติการจอง — ${active.length} ครั้ง · รวม ${formatBaht(totalSpent)}`,
    }));
    if (!list.length) {
      wrap.appendChild(el('p', { class: 'muted', text: 'ยังไม่มีประวัติการจอง' }));
      return wrap;
    }
    const rows = list.slice(0, 10).map(b => el('tr', {}, [
      el('td', { text: `${formatDateTH(b.checkIn)} → ${formatDateTH(b.checkOut)}` }),
      el('td', { class: 'num', text: formatBaht(b.grandTotal) }),
      el('td', {}, [el('span', {
        class: 'pill ' + ({ 'จ่ายครบแล้ว': 'green', 'มัดจำแล้ว': 'yellow', 'ยกเลิก': 'red' }[b.depositStatus] || 'grey'),
        text: b.depositStatus || '-',
      })]),
    ]));
    wrap.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [el('tbody', {}, rows)])]));
    if (list.length > 10) wrap.appendChild(el('p', { class: 'muted', style: 'font-size:12px', text: `แสดง 10 รายการล่าสุดจาก ${list.length}` }));
    return wrap;
  }

  function petRow(p, idx) {
    const name = inp(p.name, 'ชื่อสัตว์', v => p.name = v);
    const species = el('select', {}, PET_TYPES.map(t => el('option', { value: t.id, text: t.label })));
    species.value = p.species || 'dog'; species.onchange = () => p.species = species.value;
    const breed = inp(p.breed, 'พันธุ์', v => p.breed = v);
    const weight = inp(p.weight, 'น้ำหนัก (กก.)', v => p.weight = v);
    const health = inp(p.healthNotes, 'โน้ตสุขภาพ', v => p.healthNotes = v);
    const vaccine = inp(p.vaccineNotes, 'เช่น พิษสุนัขบ้า ครบ', v => p.vaccineNotes = v);
    const vacExp = el('input', { type: 'date', value: p.vaccineExpiry || '' });
    vacExp.oninput = () => p.vaccineExpiry = vacExp.value;
    const rm = el('button', { class: 'btn sm danger', html: icons.x, 'aria-label': 'ลบ' });
    rm.onclick = () => { draft.pets.splice(idx, 1); build(); };
    const head = el('div', { class: 'li-head' }, [el('strong', { text: `สัตว์เลี้ยงที่ ${idx + 1}` }), rm]);
    const vs = vaccineStatus(p);
    if (vs === 'expired') head.insertBefore(el('span', { class: 'pill red', text: 'วัคซีนหมดอายุ' }), rm);
    else if (vs === 'soon') head.insertBefore(el('span', { class: 'pill yellow', text: 'วัคซีนใกล้หมด' }), rm);
    return el('div', { class: 'lineitem' }, [
      head,
      el('div', { class: 'row' }, [labeled('ชื่อ', name), labeled('ชนิด', species), labeled('พันธุ์', breed), labeled('น้ำหนัก', weight)]),
      el('div', { class: 'row' }, [labeled('โน้ตสุขภาพ', health), labeled('วัคซีน', vaccine), labeled('วัคซีนหมดอายุ', vacExp)]),
    ]);
  }
}

function inp(value, placeholder, onInput) {
  const i = el('input', { value: value ?? '', placeholder });
  i.oninput = () => onInput(i.value);
  return i;
}
function labeled(label, node) { return el('div', { class: 'field', style: 'margin:0' }, [el('label', { text: label }), node]); }
