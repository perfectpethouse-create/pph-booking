// ═══════════════════════════════════════════════════════════════
// dashboard.js — แดชบอร์ดวันนี้: เช็คอิน/เอาท์วันนี้ + ยอดค้าง/ยังไม่ลงระบบ
// ═══════════════════════════════════════════════════════════════
import { listen, save } from './db.js';
import { el, getSettings, toast, confirmDialog, openModal } from './ui.js';
import { computeBooking, formatBaht, formatDateTH, todayISO, addDaysISO } from './calc.js';
import { PAYMENT_METHODS } from './config-shop.js';
import { icons } from './icons.js';

// เลือกช่องทางรับเงิน — ใช้ร่วมกันทุกจุดที่ปิดยอด (เช็คอิน/เช็คเอาท์/รับเงินตามหลัง)
function methodSelect(value = PAYMENT_METHODS[0]) {
  const sel = el('select', {}, PAYMENT_METHODS.map(m => el('option', { value: m, text: m })));
  sel.value = value;
  return sel;
}

let _unsub = [];
let _appts = [];

export function renderDashboard(container) {
  _unsub.forEach(u => u()); _unsub = [];

  container.appendChild(el('div', { class: 'page-title' }, [
    el('h1', { text: 'แดชบอร์ดวันนี้' }),
    el('span', { class: 'muted', text: formatDateTH(todayISO()) }),
  ]));
  // แจ้งเตือนใบลงทะเบียนใหม่จากเว็บ (perfectbkk.com/checkin.html)
  const regBanner = el('div', { class: 'promo-banner hidden', style: 'margin-bottom:14px;cursor:pointer' });
  regBanner.onclick = () => window.__go && window.__go('registrations');

  // แจ้งเตือนคำขอจองใหม่จากฟอร์มจองบนเว็บ
  const reqBanner = el('div', { class: 'promo-banner hidden', style: 'margin-bottom:14px;cursor:pointer' });
  reqBanner.onclick = () => window.__go && window.__go('requests');
  _unsub.push(listen('bookingRequests', reqs => {
    const n = reqs.filter(r => (r.status || 'new') === 'new').length;
    reqBanner.innerHTML = '';
    if (!n) { reqBanner.classList.add('hidden'); return; }
    reqBanner.classList.remove('hidden');
    reqBanner.appendChild(el('span', { class: 'promo-text', html:
      `${icons.bookings} มีคำขอจองใหม่จากเว็บ <strong>${n} รายการ</strong> — รอตรวจและสร้างการจอง` }));
    reqBanner.appendChild(el('span', { class: 'btn sm primary', text: 'เปิดดู' }));
  }, { orderBy: null }));

  const statGrid = el('div', { class: 'stat-grid', style: 'margin-bottom:16px' });
  const body = el('div', {});
  container.append(regBanner, reqBanner, statGrid, body);

  _unsub.push(listen('checkinForms', forms => {
    const n = forms.filter(f => (f.status || 'new') === 'new').length;
    regBanner.innerHTML = '';
    if (!n) { regBanner.classList.add('hidden'); return; }
    regBanner.classList.remove('hidden');
    regBanner.appendChild(el('span', { class: 'promo-text', html:
      `${icons.inbox} มีใบลงทะเบียนเข้าพักใหม่จากเว็บ <strong>${n} ใบ</strong> — กดเพื่อเปิดดู` }));
    regBanner.appendChild(el('span', { class: 'btn sm primary', text: 'เปิดดู' }));
  }, { orderBy: null }));

  // เก็บ bookings ล่าสุดไว้ เพื่อให้ listener ของ appointments วาดใหม่ได้โดยไม่ต้องรอ bookings มาอีกรอบ
  let _bookings = [];
  _unsub.push(listen('bookings', raw => { _bookings = raw.map(computeBooking); draw(_bookings); }));
  _unsub.push(listen('appointments', arr => { _appts = arr; draw(_bookings); }));

  function draw(bookings) {
    const today = todayISO();
    const tomorrow = addDaysISO(today, 1);
    const active = bookings.filter(b => b.depositStatus !== 'ยกเลิก');
    const checkinToday = active.filter(b => b.checkIn === today);
    const checkoutToday = active.filter(b => b.checkOut === today);
    const checkinTomorrow = active.filter(b => b.checkIn === tomorrow);
    const checkoutTomorrow = active.filter(b => b.checkOut === tomorrow);
    const staying = active.filter(b => b.checkIn <= today && today < b.checkOut);
    const unpaid = active.filter(b => b.depositStatus !== 'จ่ายครบแล้ว' && b.grandTotal > 0);
    const notRecorded = active.filter(b => b.recordStatus === 'ยังไม่ลงระบบ');
    // ค้างเท่าไหร่จริง: ยังไม่มัดจำ = ค้างทั้งก้อน · มัดจำแล้ว = ค้างครึ่งหลัง
    const owedOf = b => b.depositStatus === 'มัดจำแล้ว' ? b.balanceDue : b.grandTotal;
    const balanceSum = unpaid.reduce((s, b) => s + owedOf(b), 0);

    // สีสื่อความหมาย: เขียว=เข้าพัก · ส้ม=ออกวันนี้ · ฟ้า=กำลังพัก · แดง=ยอดค้าง
    statGrid.innerHTML = '';
    [
      ['เข้าพักวันนี้', checkinToday.length, icons.login, 'green'],
      ['ออกวันนี้', checkoutToday.length, icons.logout, 'orange'],
      ['กำลังพักอยู่', staying.length, icons.home, 'blue'],
      ['ยอดค้างรับรวม', formatBaht(balanceSum), icons.banknote, 'red'],
    ].forEach(([l, n, ico, color]) => statGrid.appendChild(
      el('div', { class: `stat stat--${color}` }, [
        el('div', { class: 'stat-ico', html: ico }),
        el('div', {}, [el('div', { class: 'n', text: String(n) }), el('div', { class: 'l', text: l })]),
      ])
    ));

    // จัดเป็นโซนเหมือนหน้า "งานวันนี้" — สีเดียวกันทั้งแอป
    // (เดิมการ์ดทุกใบหน้าตาเหมือนกัน แยกไม่ออกว่าอันไหนงานโรงแรม อันไหนงานอาบน้ำ)
    const groomList = apptsOfDay(today, 'grooming');
    const exList = apptsOfDay(today, 'exercise');

    body.innerHTML = '';
    body.append(
      zoneGroup('hotel', icons.home, 'โซนโรงแรม (ห้องพัก)',
        `${checkinToday.length + checkoutToday.length + staying.length} รายการ`, [
        section('เช็คอินวันนี้ · เก็บยอดที่เหลือ', checkinToday, 'ไม่มีลูกค้าเข้าพักวันนี้', true, icons.login, 'checkin'),
        section('เช็คเอาท์วันนี้', checkoutToday, 'ไม่มีลูกค้าออกวันนี้', true, icons.logout, 'checkout'),
        section('ค้างชำระ / ยังไม่จ่ายครบ', unpaid, 'ไม่มียอดค้าง', true, icons.banknote, 'pay'),
        // ── ดูล่วงหน้า: เตรียมงานพรุ่งนี้ ──
        section(`พรุ่งนี้เข้าพัก · ${formatDateTH(tomorrow)} — เตรียมห้อง`, checkinTomorrow, 'พรุ่งนี้ไม่มีลูกค้าเข้าพัก', true, icons.calendar),
        section(`พรุ่งนี้เช็คเอาท์ · ${formatDateTH(tomorrow)} — เตรียมเก็บยอด`, checkoutTomorrow, 'พรุ่งนี้ไม่มีลูกค้าออก', true, icons.calendar),
        section('ยังไม่ลงระบบ', notRecorded, 'ลงระบบครบแล้ว', false, icons.alert),
      ]),
      zoneGroup('grooming', icons.star, 'โซน Grooming (อาบน้ำ-ตัดขน)', `${groomList.length} คิว`, [
        apptCard(groomList, 'วันนี้ยังไม่มีคิวอาบน้ำ-ตัดขน'),
      ]),
      zoneGroup('exercise', icons.paw, 'โซนออกกำลังกาย', `${exList.length} คิว`, [
        apptCard(exList, 'วันนี้ยังไม่มีคิวออกกำลังกาย'),
      ]),
    );
  }

  // กล่องครอบ 1 โซน — หัวแถบสี + ไอคอน + จำนวนงาน
  function zoneGroup(id, ico, title, countText, children) {
    return el('div', { class: `zone-group zone--${id}` }, [
      el('div', { class: 'zone-head' }, [
        el('span', { class: 'zone-ico', html: ico }),
        el('div', { class: 'zone-title', text: title }),
        el('span', { class: 'zone-count', text: countText }),
      ]),
      el('div', { class: 'zone-body' }, children),
    ]);
  }

  function apptsOfDay(today, type) {
    return _appts
      .filter(a => a.date === today && a.type === type && a.status !== 'ยกเลิก')
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }

  // คิวของโซนหนึ่ง เรียงตามรอบเวลา — เจ้าของร้านเห็นยอดด้วย
  function apptCard(list, emptyText) {
    const card = el('div', { class: 'card section-card' });
    if (!list.length) {
      card.appendChild(el('p', { class: 'muted', style: 'margin:0', text: emptyText }));
      return card;
    }
    list.forEach(a => {
      const detail = a.type === 'exercise'
        ? `ระดับ ${a.level || '-'}`
        : (a.includeCut ? 'อาบน้ำ + ตัดขน' : 'อาบน้ำ');
      card.appendChild(el('div', { class: 'lineitem' }, [
        el('div', { class: 'li-head' }, [
          el('div', {}, [
            el('strong', { text: `${a.time || '—'} · ${a.petName || a.customerName || '-'}` }),
            el('span', { class: 'muted', style: 'font-size:12px;margin-left:8px', text: a.customerName || '' }),
          ]),
          el('span', { class: 'pill ' + (a.status === 'เสร็จแล้ว' ? 'green' : 'grey'), text: a.status || 'จองแล้ว' }),
        ]),
        el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-top:4px;align-items:center' }, [
          el('span', { class: 'pet-chip pet-' + (a.petType || 'dog'), text: detail }),
          el('span', { class: 'muted', style: 'font-size:12px', text: `ประมาณ ${Math.round((a.durationMin || 60) / 60)} ชม.` }),
          el('strong', { style: 'margin-left:auto', text: formatBaht(a.price) }),
        ]),
      ]));
    });
    return card;
  }

  // ปุ่มลัดเปลี่ยนสถานะเข้าพักจริง — บันทึกเวลาไว้ด้วย (มุมมองแดชบอร์ดอัปเดตเอง)
  function actionCell(b, mode) {
    const td = el('td', { class: 'num' });
    const time = (ts) => ts ? new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
    if (mode === 'checkin') {
      if (b.stayStatus === 'checked-in' || b.stayStatus === 'checked-out') {
        td.appendChild(el('span', { class: 'pill green', text: `เช็คอินแล้ว ${time(b.checkedInAt)}` }));
        // เตือนถ้าเช็คอินไปแล้วแต่ยังไม่ได้อัปเดตยอด
        if (b.depositStatus !== 'จ่ายครบแล้ว' && b.balanceDue > 0) {
          td.appendChild(el('div', { style: 'margin-top:4px' }, [payNowBtn(b)]));
        }
      } else {
        const btn = el('button', { class: 'btn sm primary', text: 'เช็คอิน' });
        btn.onclick = () => openCheckinDialog(b);
        td.appendChild(btn);
      }
    } else if (mode === 'checkout') {
      if (b.stayStatus === 'checked-out') {
        td.appendChild(el('span', { class: 'pill grey', text: `เช็คเอาท์แล้ว ${time(b.checkedOutAt)}` }));
      } else {
        const btn = el('button', { class: 'btn sm primary', text: 'เช็คเอาท์' });
        btn.onclick = async () => {
          const needPay = b.depositStatus !== 'จ่ายครบแล้ว' && b.balanceDue > 0;
          if (needPay) {
            // ยังค้างยอด → ต้องเก็บเงิน + ระบุช่องทาง ก่อนเช็คเอาท์
            const method = await askPayMethod(b, 'เช็คเอาท์');
            if (!method) return;
            await save('bookings', {
              ...b, stayStatus: 'checked-out', checkedOutAt: Date.now(),
              depositStatus: 'จ่ายครบแล้ว', balancePaidAt: Date.now(), balanceMethod: method,
            });
            toast(`เช็คเอาท์ ${b.customerName} + รับ ${formatBaht(b.balanceDue)} (${method})`);
            return;
          }
          if (!await confirmDialog(`เช็คเอาท์ ${b.customerName}?`, { okText: 'เช็คเอาท์' })) return;
          await save('bookings', { ...b, stayStatus: 'checked-out', checkedOutAt: Date.now() });
          toast(`เช็คเอาท์ ${b.customerName} เรียบร้อย`);
        };
        td.appendChild(btn);
      }
    } else if (mode === 'pay') {
      td.appendChild(payNowBtn(b));
    }
    return td;
  }

  // กล่องเช็คอิน: นโยบายร้านคือลูกค้าจ่ายส่วนที่เหลือ "วันเช็คอิน"
  // → ถามตอนกดเช็คอินเลย จะได้ไม่ลืมอัปเดตยอด
  function openCheckinDialog(b) {
    const unpaid = b.depositStatus !== 'จ่ายครบแล้ว' && b.balanceDue > 0;
    if (!unpaid) {
      // จ่ายครบแล้ว → เช็คอินได้เลย
      save('bookings', { ...b, stayStatus: 'checked-in', checkedInAt: Date.now() })
        .then(() => toast(`เช็คอิน ${b.customerName} แล้ว`));
      return;
    }
    const methodSel = methodSelect();
    const paidBtn = el('button', { class: 'btn primary block', text: `รับเงิน ${formatBaht(b.balanceDue)} แล้ว — เช็คอิน` });
    const laterBtn = el('button', { class: 'btn block', text: 'ยังไม่รับเงิน — เช็คอินก่อน' });
    const cancelBtn = el('button', { class: 'btn ghost block', text: 'ยกเลิก' });
    const m = openModal(el('div', {}, [
      el('h2', { text: `เช็คอิน ${b.customerName}` }),
      el('div', { class: 'summary-box', style: 'margin:12px 0' }, [
        el('div', { class: 'line' }, [el('span', { text: 'ยอดทั้งหมด' }), el('span', { text: formatBaht(b.grandTotal) })]),
        el('div', { class: 'line' }, [el('span', { text: `มัดจำแล้ว ${b.depositPct}%` }), el('span', { text: formatBaht(b.depositAmount) })]),
        el('div', { class: 'line grand' }, [el('span', { text: 'ต้องเก็บวันนี้' }), el('span', { text: formatBaht(b.balanceDue) })]),
      ]),
      el('div', { class: 'field' }, [el('label', { text: 'รับเงินทางช่องทางไหน' }), methodSel]),
      el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [paidBtn, laterBtn, cancelBtn]),
    ]));
    paidBtn.onclick = async () => {
      const method = methodSel.value;
      await save('bookings', {
        ...b, stayStatus: 'checked-in', checkedInAt: Date.now(),
        depositStatus: 'จ่ายครบแล้ว', balancePaidAt: Date.now(), balanceMethod: method,
      });
      m.close(); toast(`เช็คอิน ${b.customerName} + รับ ${formatBaht(b.balanceDue)} (${method})`);
    };
    laterBtn.onclick = async () => {
      await save('bookings', { ...b, stayStatus: 'checked-in', checkedInAt: Date.now() });
      m.close(); toast(`เช็คอินแล้ว — ยอด ${formatBaht(b.balanceDue)} ยังค้างอยู่ (จะเตือนในหน้านี้)`);
    };
    cancelBtn.onclick = () => m.close();
  }

  // ถามช่องทางรับเงิน → คืนชื่อช่องทาง หรือ null ถ้ายกเลิก (ใช้ร่วมหลายจุด)
  function askPayMethod(b, okText = 'รับแล้ว') {
    return new Promise(resolve => {
      // เก็บค่าไว้ก่อนปิด แล้วให้ onClose เป็นคนตอบทางเดียว
      // (ปิดด้วยการคลิกฉากหลังก็จะได้ null = ยกเลิก โดยไม่ต้องมี resolve ซ้อน)
      let picked = null;
      const methodSel = methodSelect();
      const okBtn = el('button', { class: 'btn primary', text: okText });
      const cancelBtn = el('button', { class: 'btn ghost', text: 'ยกเลิก' });
      const m = openModal(el('div', {}, [
        el('h2', { text: `รับยอดคงเหลือ ${formatBaht(b.balanceDue)}` }),
        el('p', { class: 'muted', style: 'margin-top:-6px', text: `จาก ${b.customerName} — ระบบจะบันทึกเป็น "จ่ายครบแล้ว"` }),
        el('div', { class: 'field' }, [el('label', { text: 'รับเงินทางช่องทางไหน' }), methodSel]),
        el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px' }, [cancelBtn, okBtn]),
      ]), { onClose: () => resolve(picked) });
      okBtn.onclick = () => { picked = methodSel.value; m.close(); };
      cancelBtn.onclick = () => m.close();
    });
  }

  // ปุ่ม "รับเงิน" สำหรับคนที่เช็คอินไปแล้วแต่ยังไม่จ่ายครบ
  function payNowBtn(b) {
    const btn = el('button', { class: 'btn sm danger', text: `รับเงิน ${formatBaht(b.balanceDue)}` });
    btn.onclick = async () => {
      const method = await askPayMethod(b);
      if (!method) return;
      await save('bookings', { ...b, depositStatus: 'จ่ายครบแล้ว', balancePaidAt: Date.now(), balanceMethod: method });
      toast(`รับยอด ${b.customerName} แล้ว (${method})`);
    };
    return btn;
  }

  // สีมาจากโซนที่ครอบอยู่ · ไอคอนบอกประเภทงาน (เดิมใช้สีบอกประเภท ทำให้ชนกับสีโซน)
  function section(title, list, emptyText, showBalance, ico = null, mode = null) {
    const card = el('div', { class: 'card section-card' }, [
      el('h2', { class: 'sec-title' }, [
        el('span', { class: 'sec-ico', html: ico || '' }),
        el('span', { text: `${title} (${list.length})` }),
      ]),
    ]);
    if (!list.length) { card.appendChild(el('p', { class: 'muted', text: emptyText })); return card; }
    const rows = list.map(b => el('tr', {}, [
      el('td', {}, [el('strong', { text: b.customerName || '-' }), el('div', { class: 'muted', style: 'font-size:12px', text: b.phone || '' })]),
      el('td', { text: `${formatDateTH(b.checkIn)} → ${formatDateTH(b.checkOut)}` }),
      el('td', { text: roomsDesc(b) }),
      el('td', { class: 'num', text: showBalance ? formatBaht(b.balanceDue) : formatBaht(b.grandTotal) }),
      ...(mode ? [actionCell(b, mode)] : []),
    ]));
    card.appendChild(el('div', { class: 'table-wrap' }, [el('table', {}, [el('tbody', {}, rows)])]));
    return card;
  }
}

function roomsDesc(b) {
  const s = getSettings();
  return b.lineItems.map(li => `${li.rooms || 1}×${(s?.roomPrices?.[li.roomType]?.label || li.roomType)}`).join(', ');
}
