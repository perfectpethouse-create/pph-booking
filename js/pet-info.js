// ═══════════════════════════════════════════════════════════════
// pet-info.js — แหล่งความจริงเดียวสำหรับ "ข้อมูลน้องของใบจอง"
// ใช้ร่วมกันทั้งการ์ดรับลูกค้า (cockpit, ฝั่งเจ้าของ) และหน้างานวันนี้ (ฝั่งพนักงาน)
// เพื่อให้ทั้งสองหน้าเห็นข้อมูลน้องชุดเดียวกันเสมอ — ไม่แตกต่างกันอีก
// ═══════════════════════════════════════════════════════════════
import { matchCustomer, vaccineStatus } from './customers.js';
import { parseRaw, mapFormToPets } from './registrations.js';

const norm = (t) => String(t ?? '').replace(/\D/g, '');

// หาใบเช็คอินจากเว็บของลูกค้ารายนี้ที่ "มีข้อมูลน้อง" — จับด้วยเบอร์ (digits) หรือชื่อ
// ใช้เบอร์/ชื่อจาก raw.owner เป็นหลัก เพราะฟิลด์ระดับบนสุด (f.phone) บางใบไม่มี/ไม่ตรง
function findForm(b, checkinForms) {
  const bp = norm(b.phone);
  const bn = String(b.customerName || '').trim();
  for (const f of checkinForms) {
    const d = parseRaw(f);
    const owner = d.owner || {};
    const fp = norm(owner.phone || f.phone);
    const fn = String(owner.fullname || f.name || '').trim();
    const hit = (bp && fp && bp === fp)
      || (bn && fn && (fn === bn || fn.includes(bn) || bn.includes(fn)));
    if (!hit) continue;
    const pets = mapFormToPets(d);
    if (pets.length) return { form: f, d, pets, imported: f.status === 'imported' };
  }
  return null;
}

// เลือกชุดข้อมูลน้องที่ "ครบสุด" ตามลำดับ:
//   profile (โปรไฟล์มีน้องที่กรอกสุขภาพ/วัคซีนแล้ว)
//   → form (ดึงจากใบเช็คอินที่ข้อมูลครบกว่า)
//   → profile-sparse (โปรไฟล์มีน้องแต่ยังบางๆ)
//   → profile-empty (มีโปรไฟล์แต่ยังไม่มีน้อง)
//   → none (ไม่มีทั้งโปรไฟล์และใบเช็คอิน)
// คืน { customer, pets, source, form?, formData?, imported? }
export function resolvePetInfo(b, customers = [], checkinForms = []) {
  const customer = customers.find(x => matchCustomer(b, x)) || null;
  const custPets = (customer && (customer.pets || []).length) ? customer.pets : null;
  const profileRich = custPets && custPets.some(p => p.healthNotes || p.vaccineNotes);
  if (profileRich) return { customer, pets: custPets, source: 'profile' };

  const fm = findForm(b, checkinForms);
  if (fm) return { customer, pets: fm.pets, source: 'form', form: fm.form, formData: fm.d, imported: fm.imported };

  if (custPets) return { customer, pets: custPets, source: 'profile-sparse' };
  return { customer, pets: [], source: customer ? 'profile-empty' : 'none' };
}

// ธงวัคซีนรวมของน้องชุดหนึ่ง: 'expired' (หมดอายุ) | 'soon' (ใกล้หมด) | null
export function worstVaccine(pets = []) {
  const st = pets.map(p => vaccineStatus(p));
  return st.includes('expired') ? 'expired' : st.includes('soon') ? 'soon' : null;
}
