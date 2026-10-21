// ═══════════════════════════════════════════════════════════════
// public-availability.js — ส่ง "ห้องว่าง" ให้หน้าจองออนไลน์ (perfectbkk.com/booking.html)
//
// ทำงานเบื้องหลังเมื่อพนักงาน/เจ้าของเปิดแอปค้างไว้:
//   ฟังการจอง + ตั้งค่า → นับห้องที่ใช้ต่อวัน (สูตรเดียวกับหน้า "ปฏิทิน")
//   → เขียน publicAvailability/main (ไม่มีข้อมูลลูกค้า) เฉพาะตอนตัวเลขเปลี่ยน
// และเก็บกวาดการกันห้อง (roomHolds) ที่หมดอายุไปนานแล้ว
//
// ⚠️ หน้าเว็บเห็นห้องว่างล่าสุด "ณ ตอนที่มีคนเปิดแอปนี้ครั้งล่าสุด"
//    ถ้าไม่มีใครเปิดแอปเลย ตัวเลขจะค้างที่รอบล่าสุด
// ═══════════════════════════════════════════════════════════════
import { listen, listenSettings, savePublicAvailability, remove, MODE } from './db.js';
import { eachDate, todayISO, addDaysISO } from './calc.js';
import { capacityOf, daycareGroupOf, daycarePrice, DAYCARE_SIZES, DEFAULT_DAYCARE_CAPACITY,
  DEFAULT_LONG_STAY_DISCOUNTS, ONLINE_HOLD_HOURS, FIXED_ADDONS } from './config-shop.js';

const HORIZON_DAYS = 240; // ส่งล่วงหน้า ~8 เดือน
let _started = false;

// นับการใช้งานต่อวัน — แยกออกมาเป็น pure function เพื่อทดสอบได้
export function buildAvailability(bookings, s, today = todayISO()) {
  const end = addDaysISO(today, HORIZON_DAYS);
  const used = {};   // iso -> { 'roomType|pet': rooms }
  const dcUsed = {}; // iso -> { dogSmall|dogLarge|cat: ตัว }
  (bookings || []).filter(b => b.depositStatus !== 'ยกเลิก' && b.checkIn).forEach(b => {
    const lis = b.lineItems || [];
    if (lis.length && b.checkOut && b.checkOut > today) {
      const perKey = {};
      lis.forEach(li => {
        const k = `${li.roomType}|${li.petType || 'dog'}`;
        perKey[k] = (perKey[k] || 0) + (Number(li.rooms) || 0);
      });
      eachDate(b.checkIn < today ? today : b.checkIn, b.checkOut < end ? b.checkOut : end, iso => {
        used[iso] = used[iso] || {};
        for (const [k, n] of Object.entries(perKey)) used[iso][k] = (used[iso][k] || 0) + n;
      });
    }
    // Day Care ล้วน (ใบไม่มีห้อง) — นับในวันที่รับบริการ
    if (!lis.length && b.checkIn >= today && b.checkIn < end) {
      (b.addOns || []).filter(a => a.kind === 'daycare').forEach(a => {
        const g = daycareGroupOf(a.pet, a.size, a.weightKg);
        const d = (dcUsed[b.checkIn] = dcUsed[b.checkIn] || {});
        d[g] = (d[g] || 0) + (Number(a.qty) || 1);
      });
    }
  });

  const cap = {};
  for (const rt of Object.keys(s?.roomPrices || {})) {
    cap[rt] = { dog: capacityOf(s.roomCapacity || {}, rt, 'dog'), cat: capacityOf(s.roomCapacity || {}, rt, 'cat') };
  }
  return {
    v: 1,
    today,
    capacity: cap,
    prices: s?.roomPrices || {},
    online: { vip: { dog: Number(s?.vipPromoPrice) || 0, cat: Number(s?.vipCatPromoPrice) || 0 } },
    longStay: s?.longStayDiscounts || DEFAULT_LONG_STAY_DISCOUNTS,
    depositPct: s?.depositPctDefault ?? 50,
    holdHours: ONLINE_HOLD_HOURS,
    addOns: [
      ...FIXED_ADDONS.map(a => ({ name: a.name, unitPrice: a.unitPrice, unit: a.unit })),
      ...(s?.addOnServices || []).filter(a => !/late check-out/i.test(a.name))
        .map(a => ({ name: a.name, unitPrice: Number(a.price) || 0, unit: 'ครั้ง' })),
    ],
    daycare: {
      capacity: s?.daycareCapacity || DEFAULT_DAYCARE_CAPACITY,
      prices: { dog: Object.fromEntries(DAYCARE_SIZES.dog.map(z => [z.id, daycarePrice('dog', z.id)])),
                cat: Object.fromEntries(DAYCARE_SIZES.cat.map(z => [z.id, daycarePrice('cat', z.id)])) },
    },
    used,
    dcUsed,
  };
}

export function startAvailabilityPublisher() {
  if (_started || MODE !== 'firestore') return;
  _started = true;
  let bookings = null, settings = null, lastBody = '', timer = null;

  const publish = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!bookings || !settings) return;
      const data = buildAvailability(bookings, settings);
      const body = JSON.stringify(data);
      if (body === lastBody) return; // ไม่มีอะไรเปลี่ยน → ไม่เขียนซ้ำ
      try { await savePublicAvailability(body); lastBody = body; }
      catch (e) { console.warn('[availability] เขียนไม่สำเร็จ (ตั้งกฎ Firestore แล้วหรือยัง?)', e); }
    }, 1500);
  };

  listen('bookings', arr => { bookings = arr; publish(); });
  listenSettings(s => { settings = s; publish(); });

  // เก็บกวาดการกันห้องที่หมดอายุเกิน 1 วัน (หน้าเว็บไม่นับอยู่แล้ว แค่ไม่ให้รก)
  listen('roomHolds', holds => {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    holds.forEach(h => {
      const exp = holdExpiryMs(h);
      if (exp && exp < cutoff) remove('roomHolds', h.id).catch(() => {});
    });
  }, { orderBy: null });
}

// expiresAt มาได้ทั้ง Timestamp ของ Firestore และสตริง ISO
export function holdExpiryMs(h) {
  const v = h?.expiresAt;
  if (!v) return 0;
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}
