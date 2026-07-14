// ═══════════════════════════════════════════════════════════════
// customers.js — ฐานข้อมูลลูกค้า + สัตว์เลี้ยง (โน้ตสุขภาพ/วัคซีน)
// ═══════════════════════════════════════════════════════════════
import { listen, save, remove } from './db.js';
import { el, toast, openModal, confirmDialog } from './ui.js';
import { PET_TYPES } from './config-shop.js';
import { icons } from './icons.js';

let _unsub = [];
let _customers = [];

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
      const tr = el('tr', { style: 'cursor:pointer' }, [
        el('td', {}, [el('strong', { text: c.name || '-' })]),
        el('td', { text: c.phone || '-' }),
        el('td', { style: 'white-space:normal', text: pets }),
        el('td', { text: `${(c.pets || []).length} ตัว` }),
      ]);
      tr.onclick = () => openCustomerForm(c);
      return tr;
    });
    const head = el('tr', {}, ['ชื่อ', 'เบอร์', 'สัตว์เลี้ยง', 'จำนวน'].map(h => el('th', { text: h })));
    listWrap.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [el('thead', {}, [head]), el('tbody', {}, body)])]));
  };
  searchInput.oninput = draw;
  _unsub.push(listen('customers', arr => { _customers = arr; draw(); }));
}

function petLabel(id) { return (PET_TYPES.find(p => p.id === id) || {}).label || id || ''; }

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
      el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px;gap:8px' }, [delBtn, saveBtn].filter(Boolean)),
    );
  }

  function petRow(p, idx) {
    const name = inp(p.name, 'ชื่อสัตว์', v => p.name = v);
    const species = el('select', {}, PET_TYPES.map(t => el('option', { value: t.id, text: t.label })));
    species.value = p.species || 'dog'; species.onchange = () => p.species = species.value;
    const breed = inp(p.breed, 'พันธุ์', v => p.breed = v);
    const weight = inp(p.weight, 'น้ำหนัก (กก.)', v => p.weight = v);
    const health = inp(p.healthNotes, 'โน้ตสุขภาพ', v => p.healthNotes = v);
    const vaccine = inp(p.vaccineNotes, 'วัคซีน', v => p.vaccineNotes = v);
    const rm = el('button', { class: 'btn sm danger', html: icons.x, 'aria-label': 'ลบ' });
    rm.onclick = () => { draft.pets.splice(idx, 1); build(); };
    return el('div', { class: 'lineitem' }, [
      el('div', { class: 'li-head' }, [el('strong', { text: `สัตว์เลี้ยงที่ ${idx + 1}` }), rm]),
      el('div', { class: 'row' }, [labeled('ชื่อ', name), labeled('ชนิด', species), labeled('พันธุ์', breed), labeled('น้ำหนัก', weight)]),
      el('div', { class: 'row' }, [labeled('โน้ตสุขภาพ', health), labeled('วัคซีน', vaccine)]),
    ]);
  }
}

function inp(value, placeholder, onInput) {
  const i = el('input', { value: value ?? '', placeholder });
  i.oninput = () => onInput(i.value);
  return i;
}
function labeled(label, node) { return el('div', { class: 'field', style: 'margin:0' }, [el('label', { text: label }), node]); }
