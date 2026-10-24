// ═══════════════════════════════════════════════════════════════
// customers.js — ฐานข้อมูลลูกค้า + สัตว์เลี้ยง (โน้ตสุขภาพ/วัคซีน)
// ═══════════════════════════════════════════════════════════════
import { listen, save, remove } from './db.js';
import { el, toast, openModal, confirmDialog } from './ui.js';
import { PET_TYPES, LOYAL_CUSTOMER_MIN_STAYS } from './config-shop.js';
import { computeBooking, formatBaht, formatDateTH, todayISO, nightsBetween } from './calc.js';
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

  const searchInput = el('input', { type: 'search', placeholder: 'ค้นหาชื่อ / เบอร์', 'aria-label': 'ค้นหาลูกค้า' });
  // ตัวกรองชุดเดียวกับชิปบนมือถือ
  const groupFilter = el('select', { 'aria-label': 'กรองกลุ่มลูกค้า' }, [
    el('option', { value: '', text: 'ลูกค้าทั้งหมด' }),
    el('option', { value: 'loyal', text: 'ลูกค้าประจำ' }),
    el('option', { value: 'vacc', text: 'วัคซีนต้องตาม' }),
  ]);
  const addBtn = el('button', { class: 'btn primary', html: icons.plus + ' เพิ่มลูกค้า' });
  addBtn.onclick = () => openCustomerForm(null);
  const listWrap = el('div', {});
  const subtitle = el('div', { class: 'd-date' });

  // มือถือ = การ์ดลูกค้าแบบแอป (.mcust) · คอม = ตาราง (.cust-full) ตาม customers-mockup
  const mobile = buildMobileCustomers();
  container.appendChild(mobile.node);
  container.appendChild(el('div', { class: 'cust-full' }, [
    el('div', { class: 'd-top' }, [el('h1', { text: 'ลูกค้า & สัตว์เลี้ยง' }), subtitle]),
    el('div', { class: 'd-card' }, [
      el('div', { class: 'd-filters' }, [
        el('label', { class: 'd-search' }, [el('span', { html: icons.search }), searchInput]),
        groupFilter, el('span', { class: 'd-sp' }), addBtn,
      ]),
      listWrap,
    ]),
  ]));

  const vaccOf = (c) => {
    const st = (c.pets || []).map(p => vaccineStatus(p));
    return st.includes('expired') ? 'expired' : st.includes('soon') ? 'soon' : null;
  };

  const draw = () => {
    mobile.draw();
    const q = searchInput.value.trim().toLowerCase();
    const g = groupFilter.value;
    const rows = _customers.filter(c => `${c.name || ''} ${c.phone || ''}`.toLowerCase().includes(q)
      && (!g || (g === 'loyal' ? isLoyal(c, _bookings) : !!vaccOf(c))));
    subtitle.textContent = q || g ? `พบ ${rows.length} จาก ${_customers.length} คน` : `ทั้งหมด ${_customers.length} คน`;
    listWrap.innerHTML = '';
    if (!rows.length) {
      listWrap.appendChild(el('p', { class: 'd-empty', style: 'padding:24px 18px;text-align:center', text: _customers.length ? 'ไม่พบลูกค้าที่ค้นหา' : 'ยังไม่มีลูกค้า' }));
      return;
    }
    const body = rows.map(c => {
      const stays = _bookings.filter(b => matchCustomer(b, c) && b.depositStatus !== 'ยกเลิก').length;
      // ชิปสัตว์ทีละตัว + ป้ายเตือนวัคซีน: แดง = หมดอายุ · ส้ม = หมดภายใน 30 วัน
      const v = vaccOf(c);
      const petCell = el('td', { style: 'white-space:normal' }, [el('div', { class: 'd-pets' }, [
        ...(c.pets || []).map(p => el('span', { class: 'd-petc' + (p.species === 'cat' ? ' cat' : ''),
          html: `${p.species === 'cat' ? icons.cat : icons.dog}${escapeText(p.name || petLabel(p.species))}` })),
        (c.pets || []).length ? null : el('span', { class: 'muted', text: '—' }),
        v === 'expired' ? el('span', { class: 'pill red', text: 'วัคซีนหมดอายุ' })
          : v === 'soon' ? el('span', { class: 'pill yellow', text: 'วัคซีนใกล้หมด' }) : null,
      ].filter(Boolean))]);
      const nameCell = el('td', {}, [el('div', { class: 'd-cname' }, [
        el('span', { class: 'd-cava', text: (c.name || '?').trim().charAt(0) }),
        el('strong', { text: c.name || '-' }),
        stays >= LOYAL_CUSTOMER_MIN_STAYS ? el('span', { class: 'pill gold', text: 'ลูกค้าประจำ' }) : null,
      ].filter(Boolean))]);
      const tr = el('tr', { style: 'cursor:pointer' }, [
        nameCell,
        el('td', { text: c.phone || '-' }),
        petCell,
        el('td', { class: 'num', text: `${stays} ครั้ง` }),
      ]);
      tr.onclick = () => openCustomerForm(c);
      return tr;
    });
    const head = el('tr', {}, ['ชื่อ', 'เบอร์', 'สัตว์เลี้ยง', 'เคยพัก'].map((h, i) => el('th', { class: i === 3 ? 'num' : '', text: h })));
    listWrap.appendChild(el('div', { class: 'table-wrap' }, [el('table', { class: 'd-bktable' }, [el('thead', {}, [head]), el('tbody', {}, body)])]));
  };
  groupFilter.onchange = draw;
  searchInput.oninput = draw;
  _unsub.push(listen('customers', arr => { _customers = arr; draw(); }));
  _unsub.push(listen('bookings', arr => { _bookings = arr.map(computeBooking); draw(); }));
}

// ═══════════ มือถือ: ค้นหา + ชิป + การ์ดลูกค้า ═══════════
// ชิป "วัคซีน" ช่วยตามลูกค้าก่อนวันเข้าพัก · "ลูกค้าประจำ" ใช้เกณฑ์เดียวกับป้ายบนคอม
const MOBILE_PAGE = 40;
function buildMobileCustomers() {
  let filter = 'all', query = '', limit = MOBILE_PAGE;
  const node = el('div', { class: 'mcust' });
  const search = el('input', { type: 'search', placeholder: 'ค้นหาชื่อ หรือเบอร์โทร', 'aria-label': 'ค้นหาลูกค้า' });
  search.oninput = () => { query = search.value.trim().toLowerCase(); limit = MOBILE_PAGE; draw(); };
  const chips = el('div', { class: 'm-chips' });
  const listEl = el('div', {});
  const addBtn = el('button', { class: 'm-addbtn', html: icons.plus + '<span>เพิ่ม</span>' });
  addBtn.onclick = () => openCustomerForm(null);
  node.append(
    el('div', { class: 'm-ptitle' }, [el('h1', { text: 'ลูกค้า & สัตว์เลี้ยง' }), addBtn]),
    el('label', { class: 'm-search' }, [el('span', { html: icons.search }), search]),
    chips, listEl,
  );

  const vacc = (c) => {
    const st = (c.pets || []).map(p => vaccineStatus(p));
    return st.includes('expired') ? 'expired' : st.includes('soon') ? 'soon' : null;
  };
  const FILTERS = [
    ['all', 'ทั้งหมด', () => true],
    ['loyal', 'ลูกค้าประจำ', (c) => isLoyal(c, _bookings)],
    ['vacc', 'วัคซีนต้องตาม', (c) => !!vacc(c)],
  ];

  function draw() {
    const base = _customers.filter(c => !query || `${c.name || ''} ${c.phone || ''}`.toLowerCase().includes(query));
    chips.innerHTML = '';
    FILTERS.forEach(([id, label, test]) => {
      const b = el('button', { class: 'm-chipf' + (id === filter ? ' on' : '') }, [label, el('span', { text: String(base.filter(test).length) })]);
      b.onclick = () => { filter = id; limit = MOBILE_PAGE; draw(); };
      chips.appendChild(b);
    });
    const rows = base.filter(FILTERS.find(f => f[0] === filter)[2])
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th'));
    listEl.innerHTML = '';
    if (!rows.length) { listEl.appendChild(el('div', { class: 'm-empty', text: query ? 'ไม่พบลูกค้าที่ค้นหา' : 'ยังไม่มีลูกค้าในกลุ่มนี้' })); return; }
    rows.slice(0, limit).forEach(c => {
      const stays = stayCountOf(c, _bookings);
      const v = vacc(c);
      const card = el('div', { class: 'm-bk m-cust', role: 'button', tabindex: '0' }, [
        el('div', { class: 'm-bk-top' }, [
          el('span', { class: 'm-ava', text: (c.name || '?').trim().charAt(0) }),
          el('div', { class: 'm-tx' }, [el('b', { text: c.name || '-' }), el('small', { text: c.phone || 'ไม่มีเบอร์' })]),
          stays >= LOYAL_CUSTOMER_MIN_STAYS ? el('span', { class: 'pill gold', text: 'ลูกค้าประจำ' }) : null,
        ]),
        (c.pets || []).length ? el('div', { class: 'm-req-tags' }, c.pets.map(p => el('span', {
          class: 'm-tag m-pettag' + (p.species === 'cat' ? ' cat' : ''),
          html: (p.species === 'cat' ? icons.cat : icons.dog) + `<span>${escapeText(p.name || petLabel(p.species))}</span>`,
        }))) : null,
        el('div', { class: 'm-req-foot' }, [
          el('span', { text: `เคยพัก ${stays} ครั้ง` }),
          v ? el('span', { class: 'm-hold' + (v === 'expired' ? ' over' : ''), text: v === 'expired' ? 'วัคซีนหมดอายุ' : 'วัคซีนใกล้หมด' }) : null,
        ]),
      ]);
      card.onclick = () => openCustomerForm(c);
      card.onkeydown = (e) => { if (e.key === 'Enter') openCustomerForm(c); };
      listEl.appendChild(card);
    });
    if (rows.length > limit) {
      const more = el('button', { class: 'm-more', text: `แสดงเพิ่ม (เหลืออีก ${rows.length - limit} ราย)` });
      more.onclick = () => { limit += MOBILE_PAGE; draw(); };
      listEl.appendChild(more);
    }
  }
  return { node, draw };
}
const escapeText = (t) => String(t).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

function petLabel(id) { return (PET_TYPES.find(p => p.id === id) || {}).label || id || ''; }

// นับจำนวนครั้งที่เคยพักจริง (ไม่นับที่ยกเลิก) — ใช้ตัดสินว่าเป็น "ลูกค้าประจำ"
export function stayCountOf(c, bookings) {
  return bookings.filter(b => matchCustomer(b, c) && b.depositStatus !== 'ยกเลิก').length;
}
export function isLoyal(c, bookings) {
  return stayCountOf(c, bookings) >= LOYAL_CUSTOMER_MIN_STAYS;
}

// จับคู่การจองกับลูกค้า: เบอร์ตรงกันก่อน (แม่นสุด) ไม่มีเบอร์ค่อยเทียบชื่อ
export function matchCustomer(b, c) {
  if (c.phone && b.phone) return c.phone.replace(/\D/g, '') === b.phone.replace(/\D/g, '');
  return (b.customerName || '').trim() === (c.name || '').trim();
}

// existing = ลูกค้าเดิม (แก้ไข) · seed = ค่าเริ่มต้นตอนสร้างใหม่ (เช่น prefill ชื่อ+เบอร์จากใบจอง)
export function openCustomerForm(existing, seed = null) {
  const isNew = !existing;
  const draft = existing ? structuredClone(existing)
    : { name: seed?.name || '', phone: seed?.phone || '', pets: [], notes: '' };
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
    const totalNights = active.reduce((s, b) =>
      s + b.lineItems.reduce((n, li) => n + (Number(li.rooms) || 0) * (Number(li.nights) || 0), 0), 0);
    const lastStay = active[0]?.checkIn; // list เรียง checkIn ใหม่→เก่า อยู่แล้ว
    const loyal = active.length >= LOYAL_CUSTOMER_MIN_STAYS;

    const histHead = el('label', { class: 'form-section', text: 'ประวัติการจอง' });
    if (loyal) histHead.appendChild(el('span', { class: 'pill gold', style: 'margin-left:8px', text: 'ลูกค้าประจำ' }));
    wrap.appendChild(histHead);

    // สรุปสถิติ — ไว้ดูแลลูกค้าประจำ (ไม่ใช่ส่วนลด ตามกฎแบรนด์)
    if (active.length) {
      const stat = (n, l) => el('div', { class: 'mini-stat' }, [
        el('div', { class: 'n', text: n }), el('div', { class: 'l', text: l }),
      ]);
      wrap.appendChild(el('div', { class: 'mini-stat-grid' }, [
        stat(`${active.length}`, 'ครั้งที่พัก'),
        stat(formatBaht(totalSpent), 'ยอดสะสม'),
        stat(`${totalNights}`, 'ห้อง-คืนสะสม'),
        stat(lastStay ? formatDateTH(lastStay) : '-', 'ครั้งล่าสุด'),
      ]));
      if (!loyal) {
        wrap.appendChild(el('p', { class: 'muted', style: 'font-size:12px;margin:6px 0 0', text:
          `อีก ${LOYAL_CUSTOMER_MIN_STAYS - active.length} ครั้ง จะเป็นลูกค้าประจำ` }));
      }
    }
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
