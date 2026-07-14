// ═══════════════════════════════════════════════════════════════
// dashboard.js — แดชบอร์ดวันนี้: เช็คอิน/เอาท์วันนี้ + ยอดค้าง/ยังไม่ลงระบบ
// ═══════════════════════════════════════════════════════════════
import { listen, save } from './db.js';
import { el, getSettings, toast, confirmDialog } from './ui.js';
import { computeBooking, formatBaht, formatDateTH, todayISO } from './calc.js';
import { icons } from './icons.js';

let _unsub = [];

export function renderDashboard(container) {
  _unsub.forEach(u => u()); _unsub = [];

  container.appendChild(el('div', { class: 'page-title' }, [
    el('h1', { text: 'แดชบอร์ดวันนี้' }),
    el('span', { class: 'muted', text: formatDateTH(todayISO()) }),
  ]));
  const statGrid = el('div', { class: 'stat-grid', style: 'margin-bottom:16px' });
  const body = el('div', {});
  container.append(statGrid, body);

  _unsub.push(listen('bookings', raw => draw(raw.map(computeBooking))));

  function draw(bookings) {
    const today = todayISO();
    const active = bookings.filter(b => b.depositStatus !== 'ยกเลิก');
    const checkinToday = active.filter(b => b.checkIn === today);
    const checkoutToday = active.filter(b => b.checkOut === today);
    const staying = active.filter(b => b.checkIn <= today && today < b.checkOut);
    const unpaid = active.filter(b => b.depositStatus !== 'จ่ายครบแล้ว' && b.balanceDue > 0);
    const notRecorded = active.filter(b => b.recordStatus === 'ยังไม่ลงระบบ');
    const balanceSum = unpaid.reduce((s, b) => s + b.balanceDue, 0);

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

    body.innerHTML = '';
    body.append(
      section('เช็คอินวันนี้', checkinToday, 'ไม่มีลูกค้าเข้าพักวันนี้', false, 'green', 'checkin'),
      section('เช็คเอาท์วันนี้ · เก็บยอดคงเหลือ', checkoutToday, 'ไม่มีลูกค้าออกวันนี้', true, 'orange', 'checkout'),
      section('ค้างชำระ / ยังไม่จ่ายครบ', unpaid, 'ไม่มียอดค้าง', true, 'red'),
      section('ยังไม่ลงระบบ', notRecorded, 'ลงระบบครบแล้ว', false, 'grey'),
    );
  }

  // ปุ่มลัดเปลี่ยนสถานะเข้าพักจริง — บันทึกเวลาไว้ด้วย (มุมมองแดชบอร์ดอัปเดตเอง)
  function actionCell(b, mode) {
    const td = el('td', { class: 'num' });
    const time = (ts) => ts ? new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
    if (mode === 'checkin') {
      if (b.stayStatus === 'checked-in' || b.stayStatus === 'checked-out') {
        td.appendChild(el('span', { class: 'pill green', text: `เช็คอินแล้ว ${time(b.checkedInAt)}` }));
      } else {
        const btn = el('button', { class: 'btn sm primary', text: 'เช็คอิน' });
        btn.onclick = async () => {
          await save('bookings', { ...b, stayStatus: 'checked-in', checkedInAt: Date.now() });
          toast(`เช็คอิน ${b.customerName} แล้ว`);
        };
        td.appendChild(btn);
      }
    } else if (mode === 'checkout') {
      if (b.stayStatus === 'checked-out') {
        td.appendChild(el('span', { class: 'pill grey', text: `เช็คเอาท์แล้ว ${time(b.checkedOutAt)}` }));
      } else {
        const btn = el('button', { class: 'btn sm primary', text: 'เช็คเอาท์' });
        btn.onclick = async () => {
          const needPay = b.depositStatus !== 'จ่ายครบแล้ว' && b.balanceDue > 0;
          const msg = needPay
            ? `รับยอดคงเหลือ ${formatBaht(b.balanceDue)} จาก ${b.customerName} แล้วใช่ไหม? (ระบบจะบันทึกเป็น "จ่ายครบแล้ว")`
            : `เช็คเอาท์ ${b.customerName}?`;
          if (!await confirmDialog(msg, { okText: 'เช็คเอาท์' })) return;
          await save('bookings', {
            ...b, stayStatus: 'checked-out', checkedOutAt: Date.now(),
            ...(needPay ? { depositStatus: 'จ่ายครบแล้ว' } : {}),
          });
          toast(`เช็คเอาท์ ${b.customerName} เรียบร้อย`);
        };
        td.appendChild(btn);
      }
    }
    return td;
  }

  function section(title, list, emptyText, showBalance, color = 'grey', mode = null) {
    const card = el('div', { class: `card section-card section--${color}` }, [el('h2', { text: `${title} (${list.length})` })]);
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
