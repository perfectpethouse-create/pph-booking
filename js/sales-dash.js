// ═══════════════════════════════════════════════════════════════
// sales-dash.js — ส่วนบนของหน้า "แดชบอร์ดยอดขาย" (reports.js)
//   เดือนนี้ไปได้ดีไหม · แนวโน้ม 12 เดือน · ยอดจองล่วงหน้า · ลูกค้าใหม่/กลับมาซ้ำ
//
// กติกาการนับยึดตามรายงานรายเดือนเดิม (ตัวเลขต้องตรงกับตารางด้านล่าง):
//  · โรงแรม = grandTotal ของใบจองที่ไม่ยกเลิก อิง "วัน Check-in"
//  · บริการ = ราคาคิว Grooming/ออกกำลังกาย ที่ไม่ยกเลิกและลูกค้าไม่ได้ "ไม่มา" อิง "วันนัด"
//  · ห้อง-คืน/อัตราเข้าพัก = คืนที่นอนจริงรายวัน (eachDate ไม่นับวันเช็คเอาท์)
// ส่วนคำนวณ (buildSalesData) ไม่แตะ DOM — ทดสอบด้วย node ได้
// ═══════════════════════════════════════════════════════════════
import { eachDate, addDaysISO, formatBaht } from './calc.js';
import { capacityOf, apptCounts } from './config-shop.js';

const MS_DAY = 86400000;
export const AHEAD_WEEKS = 8;
const LAPSED_DAYS = 90;

export const shiftMonth = (mk, n) => {
  const d = new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const daysIn = mk => new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)), 0).getDate();
const dayOf = iso => Number(iso.slice(8, 10));
const custKey = (phone, name) => {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : (name ? 'n:' + String(name).trim() : '');
};
const diffDays = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / MS_DAY);

// bookings = ผ่าน computeBooking แล้ว · today = 'YYYY-MM-DD'
export function buildSalesData({ bookings, appts, settings, month, today }) {
  const active = bookings.filter(b => b.depositStatus !== 'ยกเลิก' && b.checkIn);
  const svcAct = appts.filter(apptCounts);
  const todayMk = today.slice(0, 7);

  // ยอดของเดือน mk ตั้งแต่วันที่ 1 ถึงวันที่ upTo (รวม)
  const sumRange = (mk, upTo) => {
    const r = { hotel: 0, svc: 0, bookings: 0, groom: 0, exercise: 0 };
    active.forEach(b => {
      if (b.checkIn.slice(0, 7) === mk && dayOf(b.checkIn) <= upTo) { r.hotel += b.grandTotal || 0; r.bookings++; }
    });
    svcAct.forEach(a => {
      if (a.date.slice(0, 7) !== mk || dayOf(a.date) > upTo) return;
      r.svc += Number(a.price) || 0;
      if ((a.type || 'grooming') === 'exercise') r.exercise++; else r.groom++;
    });
    r.total = r.hotel + r.svc;
    return r;
  };
  // ยอดสะสมรายวันทั้งเดือน (index 0 = วันที่ 1)
  const cumulative = (mk, upTo) => {
    const daily = new Array(daysIn(mk)).fill(0);
    active.forEach(b => { if (b.checkIn.slice(0, 7) === mk) daily[dayOf(b.checkIn) - 1] += b.grandTotal || 0; });
    svcAct.forEach(a => { if (a.date.slice(0, 7) === mk) daily[dayOf(a.date) - 1] += Number(a.price) || 0; });
    let s = 0;
    return daily.slice(0, upTo).map(v => (s += v));
  };

  // เดือนปัจจุบัน = ถึงวันนี้ · เดือนอื่น = ทั้งเดือน (อนาคตคือยอดที่จองไว้แล้ว)
  const isCurrent = month === todayMk;
  const cut = isCurrent ? dayOf(today) : daysIn(month);
  const prevMk = shiftMonth(month, -1), yoyMk = shiftMonth(month, -12);
  const now = sumRange(month, cut);
  const prev = sumRange(prevMk, Math.min(cut, daysIn(prevMk)));
  const yoy = sumRange(yoyMk, Math.min(cut, daysIn(yoyMk)));

  // ห้อง-คืนและอัตราเข้าพักของเดือนที่เลือก (ทั้งเดือน เหมือนตารางเดิม)
  const roomTypes = Object.keys(settings?.roomPrices || {});
  const totalCap = roomTypes.reduce((s, rt) => s + capacityOf(settings?.roomCapacity || {}, rt), 0);
  const nightsBetween = (from, to) => { // [from, to)
    let n = 0;
    active.forEach(b => {
      if (!b.checkOut || b.checkOut <= from || b.checkIn >= to) return;
      const rooms = (b.lineItems || []).reduce((s, li) => s + (Number(li.rooms) || 0), 0);
      eachDate(b.checkIn < from ? from : b.checkIn, b.checkOut > to ? to : b.checkOut, () => { n += rooms; });
    });
    return n;
  };
  const mStart = `${month}-01`, mEnd = `${shiftMonth(month, 1)}-01`;
  const roomNights = nightsBetween(mStart, mEnd);
  const occupancy = totalCap ? roomNights / (totalCap * daysIn(month)) * 100 : 0;

  // แนวโน้ม 12 เดือน: จบที่เดือนนี้ — ถ้าเลือกเดือนนอกช่วง ให้ช่วงเลื่อนตามเดือนที่เลือก
  let endMk = todayMk;
  if (month > todayMk || month <= shiftMonth(todayMk, -12)) endMk = month;
  const trend = [];
  for (let i = 11; i >= 0; i--) {
    const mk = shiftMonth(endMk, -i);
    const r = sumRange(mk, 31);
    trend.push({ mk, hotel: r.hotel, svc: r.svc });
  }

  // ยอดจองล่วงหน้า: เริ่มพรุ่งนี้ ไม่ขึ้นกับเดือนที่เลือก
  const tomorrow = addDaysISO(today, 1);
  const weeks = [];
  for (let w = 0; w < AHEAD_WEEKS; w++) {
    const from = addDaysISO(tomorrow, w * 7), to = addDaysISO(from, 7);
    const n = nightsBetween(from, to);
    weeks.push({ from, to: addDaysISO(to, -1), nights: n, pct: totalCap ? n / (totalCap * 7) * 100 : 0 });
  }
  const end60 = addDaysISO(tomorrow, 60);
  const ahead = {
    weeks, capacity: totalCap,
    nights60: nightsBetween(tomorrow, end60),
    money60: active.filter(b => b.checkIn >= tomorrow && b.checkIn < end60).reduce((s, b) => s + (b.grandTotal || 0), 0),
    appts14: svcAct.filter(a => a.date >= today && a.date < addDaysISO(today, 14)).length,
  };

  // ลูกค้า: จับคู่ด้วยเบอร์โทร (9 หลักท้าย) · ไม่มีเบอร์ใช้ชื่อ
  const people = new Map();
  const visit = (phone, name, date, amount) => {
    const k = custKey(phone, name); if (!k) return;
    const p = people.get(k) || { name: name || '-', dates: [], spend: [] };
    if (name && p.name === '-') p.name = name;
    p.dates.push(date); p.spend.push(amount);
    people.set(k, p);
  };
  active.forEach(b => visit(b.phone, b.customerName, b.checkIn, b.grandTotal || 0));
  svcAct.forEach(a => visit(a.phone, a.customerName, a.date, Number(a.price) || 0));
  let fresh = 0, back = 0;
  const winFrom = `${shiftMonth(month, -11)}-01`;
  const regulars = [], lapsed = [];
  people.forEach(p => {
    const first = p.dates.reduce((m, d) => d < m ? d : m);
    const last = p.dates.reduce((m, d) => d > m ? d : m);
    if (p.dates.some(d => d.slice(0, 7) === month)) { if (first.slice(0, 7) === month) fresh++; else back++; }
    let n = 0, spend = 0;
    p.dates.forEach((d, i) => { if (d >= winFrom && d < mEnd) { n++; spend += p.spend[i]; } });
    if (n >= 2) regulars.push({ name: p.name, visits: n, spend });
    const gap = diffDays(last, today);
    if (p.dates.length >= 2 && gap > LAPSED_DAYS) lapsed.push({ name: p.name, visits: p.dates.length, days: gap });
  });
  regulars.sort((a, b) => b.visits - a.visits || b.spend - a.spend);
  lapsed.sort((a, b) => b.visits - a.visits || a.days - b.days);

  return {
    month, isCurrent, cut, prevMk, yoyMk, now, prev, yoy, roomNights, occupancy,
    paceNow: cumulative(month, cut), pacePrev: cumulative(prevMk, daysIn(prevMk)),
    trend, ahead,
    customers: { fresh, back, regulars: regulars.slice(0, 3), lapsed: lapsed.slice(0, 3) },
  };
}

// % เปลี่ยนแปลง · null = ฐานเป็น 0 เทียบไม่ได้
export const pctChange = (cur, base) => (base > 0 ? (cur - base) / base * 100 : null);

// ═════════════ ส่วนแสดงผล ═════════════
const NS = 'http://www.w3.org/2000/svg';
// แดชบอร์ดแสดงเป็นบาทเต็ม (ยอดรวมจากส่วนลด % อาจมีเศษสตางค์) · ตารางรายละเอียดด้านล่างยังแสดงละเอียดเหมือนเดิม
const baht = n => formatBaht(Math.round(n));
const C_HOTEL = '#D9600F', C_SVC = '#2F6DB5', C_PREV = '#BDB2A6'; // ผ่าน validate_palette (CVD ΔE 22.9)
const svgEl = (tag, attrs, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};
const svgText = (parent, attrs, text) => { const t = svgEl('text', attrs, parent); t.textContent = text; return t; };
const kTick = v => (v >= 1000 ? `${Math.round(v / 1000)}K` : String(v));
const kBaht = v => (v >= 1000 ? `฿${(v / 1000).toFixed(1)}K` : baht(v));
// ปลายแท่งมน 4px ฐานเหลี่ยม
const barPath = (x, y, w, h, r = 4) => {
  r = Math.max(0, Math.min(r, h, w / 2));
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};
// สเกลแกน y ให้ได้ตัวเลขกลมๆ 4 ช่อง
const niceMax = v => {
  if (v <= 0) return 4000;
  const step = Math.pow(10, Math.floor(Math.log10(v / 4)));
  const s = [1, 2, 2.5, 5, 10].map(m => m * step).find(m => m * 4 >= v);
  return s * 4;
};

let _tip = null;
function tip() {
  if (!_tip) { _tip = document.createElement('div'); _tip.className = 'sd-tip'; document.body.appendChild(_tip); }
  return _tip;
}
function showTip(e, html) {
  const t = tip(); t.innerHTML = html; t.style.opacity = '1';
  t.style.left = Math.max(8, Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8)) + 'px';
  t.style.top = Math.max(8, e.clientY - t.offsetHeight - 12) + 'px';
}
export function hideTip() { if (_tip) _tip.style.opacity = '0'; }
const tk = c => `<i class="sd-tk" style="background:${c}"></i>`;

export function thMonthLong(mk) {
  return new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}
const thMonthShort = mk => new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 1, 1).toLocaleDateString('th-TH', { month: 'short' });
const thMonthShortY = mk => new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 1, 1).toLocaleDateString('th-TH', { month: 'short', year: 'numeric' });
const thDM = iso => new Date(iso + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
const weekLabel = (a, b) => (a.slice(5, 7) === b.slice(5, 7)
  ? `${dayOf(a)}–${thDM(b)}` : `${thDM(a)}–${thDM(b)}`);

function deltaSpan(p) {
  const s = document.createElement('span');
  if (p == null) { s.className = 'sd-delta'; s.textContent = '—'; return s; }
  const up = p >= 0;
  s.className = 'sd-delta ' + (up ? 'up' : 'down');
  s.textContent = `${up ? '▲' : '▼'} ${pctText(p)}`;
  return s;
}
// ฐานเล็กมาก % จะพุ่งเป็นพัน อ่านไม่รู้เรื่อง → เกิน 200% แสดงเป็น "กี่เท่า"
const pctText = p => (p >= 200 ? `${(1 + p / 100).toFixed(1)} เท่า` : `${Math.abs(p).toFixed(0)}%`);
const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// d = buildSalesData(...) · onSelect(mk) = กดแท่งเดือนในกราฟ 12 เดือน
export function renderSalesDash(host, d, { onSelect } = {}) {
  host.innerHTML = '';
  host.append(paceSection(d), trendSection(d, onSelect), h('div', 'sd-row3'));
  host.lastChild.append(aheadSection(d), customerSection(d));
  return () => { drawPace(d); drawTrend(d, onSelect); };
}

function paceSection(d) {
  const sec = h('section', 'panel sd-pace');
  const left = h('div', 'sd-pace-total');
  left.append(
    h('div', 'sd-lbl', d.isCurrent ? `ยอดขาย 1–${d.cut} ${thMonthShort(d.month)} (ถึงวันนี้)` : `ยอดขายทั้งเดือน ${thMonthLong(d.month)}`),
    h('div', 'sd-num', baht(d.now.total)),
  );
  const v = h('p', 'sd-verdict');
  const pPrev = pctChange(d.now.total, d.prev.total), pYoy = pctChange(d.now.total, d.yoy.total);
  // ไม่มีข้อมูลฐานให้เทียบ (เดือนก่อน/ปีก่อนเป็น 0) → ไม่พูดถึงช่วงนั้น
  if (pPrev != null) v.append(deltaSpan(pPrev), ` จาก${d.isCurrent ? 'ช่วงเดียวกันของ' : ''}เดือนก่อน (${baht(d.prev.total)})`);
  if (pYoy != null) v.append(pPrev != null ? ' และ ' : '', deltaSpan(pYoy), ` จาก ${thMonthShortY(d.yoyMk)}`);
  if (pPrev == null && pYoy == null) v.append('ยังไม่มีข้อมูลเดือนก่อนหรือปีก่อนให้เทียบ');
  const line = verdictLine(d);
  if (line) { v.append(' · '); const b = h('b', '', line); v.append(b); }
  left.append(v);

  const split = h('div', 'sd-split');
  const queues = d.now.groom + d.now.exercise;
  split.append(
    splitCell(C_HOTEL, 'โรงแรม', d.now.hotel, pctChange(d.now.hotel, d.prev.hotel),
      [`${d.now.bookings} การจอง`, `เข้าพัก ${d.occupancy.toFixed(1)}% · ${d.roomNights} ห้อง-คืน`]),
    splitCell(C_SVC, 'บริการ', d.now.svc, pctChange(d.now.svc, d.prev.svc),
      [`อาบน้ำตัดขน ${d.now.groom} · โซนเล่น ${d.now.exercise} คิว`, queues ? `เฉลี่ย ${baht(Math.round(d.now.svc / queues))} / คิว` : 'ยังไม่มีคิว']),
  );
  left.append(split);

  const right = h('div', 'sd-pace-r');
  const ph = h('div', 'sd-ph');
  const t = h('div'); t.append(h('h2', '', 'ยอดสะสมรายวัน'), h('div', 'sd-sub', d.isCurrent ? 'เดือนนี้เทียบเดือนก่อน ณ วันเดียวกัน' : 'เทียบกับเดือนก่อนหน้า'));
  const lg = h('div', 'sd-legend');
  lg.innerHTML = `<span><i class="sd-ln" style="background:${C_HOTEL}"></i>${thMonthShortY(d.month)}</span><span><i class="sd-ln" style="background:${C_PREV}"></i>${thMonthShortY(d.prevMk)}</span>`;
  ph.append(t, lg);
  right.append(ph, h('div', 'sd-chart sd-pace-chart'));
  sec.append(left, right);
  return sec;
}

// ประโยคสรุปสั้นๆ จากข้อมูลจริงเท่านั้น
function verdictLine(d) {
  const part = (name, cur, base) => {
    if (base <= 0) return null;
    const p = (cur - base) / base * 100;
    if (Math.abs(p) < 3) return `${name}ใกล้เคียงเดือนก่อน`;
    return `${name}${p > 0 ? 'นำ' : 'ตามหลัง'}เดือนก่อน ${pctText(p)}`;
  };
  return [part('โรงแรม', d.now.hotel, d.prev.hotel), part('บริการ', d.now.svc, d.prev.svc)].filter(Boolean).join(' · ');
}

function splitCell(color, label, amount, p, metas) {
  const c = h('div');
  const k = h('div', 'sd-k'); k.innerHTML = `<i class="sd-key" style="background:${color}"></i>`; k.append(label);
  const m = h('div', 'sd-m'); m.append(deltaSpan(p), ' · ' + metas[0]); m.append(document.createElement('br'), metas[1]);
  c.append(k, h('div', 'sd-v', baht(amount)), m);
  return c;
}

function drawPace(d) {
  const host = document.querySelector('.sd-pace-chart'); if (!host) return;
  host.innerHTML = '';
  const W = host.clientWidth, H = host.clientHeight || 240, L = 44, R = 62, T = 22, B = 26;
  if (W < 50) return;
  const nDays = Math.max(d.pacePrev.length, daysIn(d.month));
  const top = niceMax(Math.max(d.paceNow.at(-1) || 0, d.pacePrev.at(-1) || 0));
  const x = i => L + i / (nDays - 1) * (W - L - R), y = v => T + (1 - v / top) * (H - T - B);
  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'กราฟยอดสะสมรายวัน' }, host);
  for (let v = 0; v <= top; v += top / 4) {
    svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'sd-grid' }, svg);
    svgText(svg, { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'sd-axis' }, kTick(v));
  }
  [1, 8, 15, 22, nDays].forEach(dd => svgText(svg, { x: x(dd - 1), y: H - 6, 'text-anchor': 'middle', class: 'sd-axis' }, dd));
  const path = arr => arr.map((v, i) => (i ? 'L' : 'M') + x(i) + ',' + y(v)).join('');
  if (d.paceNow.length) {
    svgEl('path', { d: path(d.paceNow) + `L${x(d.paceNow.length - 1)},${y(0)}L${x(0)},${y(0)}Z`, fill: C_HOTEL, opacity: 0.1 }, svg);
  }
  if (d.pacePrev.length) {
    svgEl('path', { d: path(d.pacePrev), fill: 'none', stroke: C_PREV, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    const pi = d.pacePrev.length - 1;
    svgText(svg, { x: x(pi) + 6, y: y(d.pacePrev[pi]) + 4, class: 'sd-axis' }, kBaht(d.pacePrev[pi]));
  }
  if (d.paceNow.length) {
    svgEl('path', { d: path(d.paceNow), fill: 'none', stroke: C_HOTEL, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    const ni = d.paceNow.length - 1;
    svgEl('circle', { cx: x(ni), cy: y(d.paceNow[ni]), r: 5, fill: C_HOTEL, stroke: '#fff', 'stroke-width': 2 }, svg);
    svgText(svg, { x: x(ni), y: y(d.paceNow[ni]) - 12, 'text-anchor': 'middle', class: 'sd-val' }, kBaht(d.paceNow[ni]));
  }
  const cross = svgEl('line', { y1: T, y2: H - B, class: 'sd-cross' }, svg);
  const hit = svgEl('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' }, svg);
  const onMove = e => {
    const r = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(nDays - 1, Math.round((e.clientX - r.left - L) / (W - L - R) * (nDays - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.opacity = '1';
    showTip(e, `<div>วันที่ ${i + 1}</div>`
      + (d.paceNow[i] != null ? `<div>${tk(C_HOTEL)}${thMonthShort(d.month)} <b>${baht(d.paceNow[i])}</b></div>` : '')
      + (d.pacePrev[i] != null ? `<div>${tk(C_PREV)}${thMonthShort(d.prevMk)} <b>${baht(d.pacePrev[i])}</b></div>` : ''));
  };
  hit.addEventListener('pointermove', onMove);
  hit.addEventListener('pointerleave', () => { cross.style.opacity = '0'; hideTip(); });
}

function trendSection() {
  const sec = h('section', 'panel sd-trend');
  const ph = h('div', 'sd-ph');
  const t = h('div'); t.append(h('h2', '', 'แนวโน้ม 12 เดือน'), h('div', 'sd-sub', 'ยอดขายรายเดือน แยกโรงแรม / บริการ · แตะแท่งเพื่อดูเดือนนั้น'));
  const lg = h('div', 'sd-legend');
  lg.innerHTML = `<span><i class="sd-key" style="background:${C_HOTEL}"></i>โรงแรม</span><span><i class="sd-key" style="background:${C_SVC}"></i>บริการ (อาบน้ำ/โซนเล่น)</span>`;
  ph.append(t, lg);
  sec.append(ph, h('div', 'sd-chart sd-trend-chart'));
  return sec;
}

function drawTrend(d, onSelect) {
  const host = document.querySelector('.sd-trend-chart'); if (!host) return;
  host.innerHTML = '';
  const W = host.clientWidth; if (W < 50) return;
  const H = W < 600 ? 220 : 260, L = 44, R = 8, T = 22, B = 28;
  const top = niceMax(Math.max(...d.trend.map(m => m.hotel + m.svc)));
  const y = v => T + (1 - v / top) * (H - T - B), band = (W - L - R) / 12, bw = Math.min(28, band * 0.56);
  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'กราฟยอดขาย 12 เดือน' }, host);
  for (let v = 0; v <= top; v += top / 4) {
    svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'sd-grid' }, svg);
    svgText(svg, { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'sd-axis' }, kTick(v));
  }
  const selI = d.trend.findIndex(m => m.mk === d.month);
  const peak = Math.max(...d.trend.map(m => m.hotel + m.svc));
  d.trend.forEach((m, i) => {
    const cx = L + band * i + band / 2, x0 = cx - bw / 2, tot = m.hotel + m.svc;
    const g = svgEl('g', { class: 'sd-col', tabindex: 0, role: 'button', 'aria-label': `${thMonthLong(m.mk)} ${baht(tot)}` }, svg);
    if (i === selI) svgEl('rect', { x: L + band * i + 2, y: T - 18, width: band - 4, height: H - T - B + 18, rx: 10, class: 'sd-sel' }, g);
    const yH = y(m.hotel), yT = y(tot);
    if (m.hotel > 0) svgEl('path', { d: m.svc > 0 ? `M${x0},${y(0)}V${yH}H${x0 + bw}V${y(0)}Z` : barPath(x0, yH, bw, y(0) - yH), fill: C_HOTEL }, g);
    if (m.svc > 0) svgEl('path', { d: barPath(x0, yT, bw, Math.max(0, (m.hotel > 0 ? yH - 2 : y(0)) - yT)), fill: C_SVC }, g);
    if (band >= 34 || i === selI || i % 2 === selI % 2) {
      svgText(g, { x: cx, y: H - 8, 'text-anchor': 'middle', class: i === selI ? 'sd-axis on' : 'sd-axis' }, thMonthShort(m.mk));
    }
    if (tot > 0 && (i === selI || (band >= 34 && tot === peak))) {
      const last = i === 11 && band < 60;
      svgText(g, { x: last ? cx + bw / 2 + 2 : cx, y: yT - 6, 'text-anchor': last ? 'end' : 'middle', class: 'sd-val' }, kBaht(tot));
    }
    svgEl('rect', { x: L + band * i, y: T - 18, width: band, height: H - T - B + 18, fill: 'transparent' }, g);
    const tipHtml = `<div><b>${thMonthLong(m.mk)}</b> · ${baht(tot)}</div><div>${tk(C_HOTEL)}โรงแรม <b>${baht(m.hotel)}</b></div><div>${tk(C_SVC)}บริการ <b>${baht(m.svc)}</b></div>`;
    g.addEventListener('pointermove', e => showTip(e, tipHtml));
    g.addEventListener('pointerleave', hideTip);
    const pick = () => { hideTip(); if (onSelect && m.mk !== d.month) onSelect(m.mk); };
    g.addEventListener('click', pick);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });
}

function aheadSection(d) {
  const a = d.ahead;
  const sec = h('section', 'panel');
  const ph = h('div', 'sd-ph');
  const t = h('div'); t.append(h('h2', '', 'ยอดจองล่วงหน้า'), h('div', 'sd-sub', `ห้องที่จองแล้ว ${AHEAD_WEEKS} สัปดาห์ข้างหน้า · % ของห้องทั้งหมด ${a.capacity} ห้อง`));
  ph.append(t);
  const list = h('div', 'sd-ahead');
  a.weeks.forEach(w => {
    const row = h('div', 'sd-wk');
    const lb = h('span', 'sd-wk-d', weekLabel(w.from, w.to));
    if (a.capacity && w.pct < 10) lb.append(h('small', '', 'ว่างเยอะ'));
    const track = h('span', 'sd-track'); const fill = h('span', 'sd-fill'); fill.style.width = Math.min(100, w.pct) + '%'; track.append(fill);
    row.title = `${w.nights} ห้อง-คืน`;
    row.append(lb, track, h('span', 'sd-wk-p', `${w.pct.toFixed(0)}%`));
    list.append(row);
  });
  const mini = h('div', 'sd-mini');
  [[String(a.nights60), 'ห้อง-คืนที่จองแล้ว (60 วัน)'], [baht(a.money60), 'ยอดจองที่เข้าพักใน 60 วัน'], [String(a.appts14), 'คิวบริการที่นัดไว้ (14 วัน)']]
    .forEach(([n, l]) => { const c = h('div'); c.append(h('b', '', n), l); mini.append(c); });
  sec.append(ph, list, mini);
  return sec;
}

function customerSection(d) {
  const c = d.customers, total = c.fresh + c.back;
  const sec = h('section', 'panel');
  const ph = h('div', 'sd-ph');
  const t = h('div'); t.append(h('h2', '', `ลูกค้า ${thMonthLong(d.month)}`), h('div', 'sd-sub', 'นับจากเบอร์โทร · โรงแรม + บริการรวมกัน'));
  ph.append(t);
  sec.append(ph);
  if (!total) { sec.append(h('p', 'sd-empty', 'ยังไม่มีลูกค้าในเดือนนี้')); }
  else {
    const bar = h('div', 'sd-nr'); bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = `${c.fresh ? `<i style="flex:${c.fresh};background:${C_SVC}"></i>` : ''}${c.back ? `<i style="flex:${c.back};background:${C_HOTEL}"></i>` : ''}`;
    const leg = h('div', 'sd-nr-leg');
    const pct = n => `${Math.round(n / total * 100)}%`;
    leg.innerHTML = `<span><i class="sd-key" style="background:${C_SVC}"></i>ลูกค้าใหม่ <b>${c.fresh} ราย</b> (${pct(c.fresh)})</span><span><i class="sd-key" style="background:${C_HOTEL}"></i>กลับมาซ้ำ <b>${c.back} ราย</b> (${pct(c.back)})</span>`;
    sec.append(bar, leg);
  }
  const list = (title, rows, right) => {
    if (!rows.length) return;
    sec.append(h('div', 'sd-cust-h', title));
    const ul = h('ul', 'sd-cust');
    rows.forEach(r => {
      const li = h('li'); const l = h('span', '', r.name); l.append(h('small', '', right.sub(r)));
      li.append(l, h('span', right.cls, right.val(r))); ul.append(li);
    });
    sec.append(ul);
  };
  list('ลูกค้าประจำ (12 เดือน)', c.regulars, { sub: r => ` · ${r.visits} ครั้ง`, cls: 'amt', val: r => baht(r.spend) });
  list(`หายไปนานเกิน ${LAPSED_DAYS} วัน · ทักกลับได้`, c.lapsed, { sub: r => ` · เคยมา ${r.visits} ครั้ง`, cls: 'ago', val: r => `${r.days} วัน` });
  return sec;
}
