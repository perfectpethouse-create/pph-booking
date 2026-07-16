// ═══════════════════════════════════════════════════════════════
// db.js — ชั้นข้อมูล (data layer) สลับได้ 2 โหมด:
//   • firestore : ใช้ Firebase จริง ซิงค์หลายเครื่องเรียลไทม์ (ตอนตั้งค่าเสร็จ)
//   • mock      : เก็บใน localStorage เครื่องนี้ (สำหรับทดลอง/ทดสอบก่อนตั้ง Firebase)
// UI เรียกใช้ API ชุดเดียวกันทั้งสองโหมด → เปลี่ยน backend ไม่ต้องแก้หน้าจอ
// ═══════════════════════════════════════════════════════════════

import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';
import { defaultSettings } from './config-shop.js';

const FORCE_MOCK = new URLSearchParams(location.search).has('mock');
export const MODE = (!FORCE_MOCK && isFirebaseConfigured()) ? 'firestore' : 'mock';

// ─────────────────────────────────────────────────────────────
// ส่วน Firestore (โหลด SDK เมื่อจำเป็นเท่านั้น)
// ─────────────────────────────────────────────────────────────
let fb = null; // เก็บ handle ของ firebase (app, auth, db, ฟังก์ชัน)

async function initFirestore() {
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const store = fsMod.getFirestore(app);
  fb = { app, auth, store, authMod, fsMod };
}

// ─────────────────────────────────────────────────────────────
// ส่วน MOCK (localStorage + pub/sub ในหน้าเดียว และข้ามแท็บ)
// ─────────────────────────────────────────────────────────────
const LS = {
  bookings: 'pph_bookings',
  customers: 'pph_customers',
  checkinForms: 'pph_checkin_forms', // ใบลงทะเบียนจากเว็บ perfectbkk.com/checkin.html
  settings: 'pph_settings',
  user: 'pph_mock_user',
};
const listeners = {}; // collectionName -> Set(cb)

function mockRead(col) {
  try { return JSON.parse(localStorage.getItem(LS[col]) || '[]'); }
  catch { return []; }
}
function mockWrite(col, arr) {
  localStorage.setItem(LS[col], JSON.stringify(arr));
  emit(col, arr);
}
function emit(col, arr) {
  (listeners[col] || new Set()).forEach(cb => cb(structuredClone(arr)));
}
// ซิงค์ข้ามแท็บในเครื่องเดียวกัน
window.addEventListener('storage', (e) => {
  for (const col of ['bookings', 'customers', 'checkinForms', 'settings']) {
    if (e.key === LS[col]) emit(col, mockRead(col));
  }
});

function uid() {
  return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ═════════════════ API สาธารณะ ═════════════════

export async function initDb() {
  if (MODE === 'firestore') await initFirestore();
  return { mode: MODE };
}

// ─── Auth ───
export function onAuthChanged(cb) {
  if (MODE === 'firestore') {
    return fb.authMod.onAuthStateChanged(fb.auth, (u) =>
      cb(u ? { uid: u.uid, email: u.email } : null));
  }
  // mock: อ่านจาก localStorage แล้วแจ้งครั้งแรก
  const raw = localStorage.getItem(LS.user);
  cb(raw ? JSON.parse(raw) : null);
  return () => {};
}

export async function signIn(email, password) {
  if (MODE === 'firestore') {
    const { signInWithEmailAndPassword } = fb.authMod;
    const cred = await signInWithEmailAndPassword(fb.auth, email, password);
    return { uid: cred.user.uid, email: cred.user.email };
  }
  // mock: ยอมรับอีเมล+รหัสใดก็ได้ (โหมดทดลอง) แต่ต้องกรอกครบ
  if (!email || !password) throw new Error('กรุณากรอกอีเมลและรหัสผ่าน');
  const user = { uid: 'mock_' + email, email };
  localStorage.setItem(LS.user, JSON.stringify(user));
  return user;
}

export async function signOutUser() {
  if (MODE === 'firestore') return fb.authMod.signOut(fb.auth);
  localStorage.removeItem(LS.user);
  location.reload();
}

// ─── Realtime listener ต่อ collection ───
// คืนค่า unsubscribe()
export function listen(col, cb) {
  if (MODE === 'firestore') {
    const { collection, onSnapshot, query, orderBy } = fb.fsMod;
    const q = query(collection(fb.store, col), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
  listeners[col] = listeners[col] || new Set();
  listeners[col].add(cb);
  cb(mockRead(col)); // แจ้งค่าปัจจุบันทันที
  return () => listeners[col].delete(cb);
}

export async function getAll(col) {
  if (MODE === 'firestore') {
    const { collection, getDocs } = fb.fsMod;
    const snap = await getDocs(collection(fb.store, col));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  return mockRead(col);
}

// สร้าง/แก้ไข เอกสาร (ถ้ามี obj.id = แก้ไข ไม่มี = สร้างใหม่)
export async function save(col, obj) {
  const now = new Date().toISOString();
  if (MODE === 'firestore') {
    const { collection, doc, setDoc, addDoc } = fb.fsMod;
    if (obj.id) {
      const { id, ...rest } = obj;
      await setDoc(doc(fb.store, col, id), { ...rest, updatedAt: now }, { merge: true });
      return id;
    }
    const ref = await addDoc(collection(fb.store, col), { ...obj, createdAt: now, updatedAt: now });
    return ref.id;
  }
  // mock
  const arr = mockRead(col);
  if (obj.id) {
    const i = arr.findIndex(x => x.id === obj.id);
    if (i >= 0) arr[i] = { ...arr[i], ...obj, updatedAt: now };
    else arr.unshift({ ...obj, updatedAt: now });
    mockWrite(col, arr);
    return obj.id;
  }
  const rec = { ...obj, id: uid(), createdAt: now, updatedAt: now };
  arr.unshift(rec);
  mockWrite(col, arr);
  return rec.id;
}

export async function remove(col, id) {
  if (MODE === 'firestore') {
    const { doc, deleteDoc } = fb.fsMod;
    return deleteDoc(doc(fb.store, col, id));
  }
  mockWrite(col, mockRead(col).filter(x => x.id !== id));
}

// ─── Settings (เอกสารเดียว) ───
export async function getSettings() {
  const def = defaultSettings();
  if (MODE === 'firestore') {
    const { doc, getDoc } = fb.fsMod;
    const snap = await getDoc(doc(fb.store, 'settings', 'app'));
    return snap.exists() ? { ...def, ...snap.data() } : def;
  }
  const raw = localStorage.getItem(LS.settings);
  return raw ? { ...def, ...JSON.parse(raw) } : def;
}

export async function saveSettings(obj) {
  if (MODE === 'firestore') {
    const { doc, setDoc } = fb.fsMod;
    await setDoc(doc(fb.store, 'settings', 'app'), obj, { merge: true });
  } else {
    localStorage.setItem(LS.settings, JSON.stringify(obj));
    emit('settings', obj);
  }
}

export function listenSettings(cb) {
  if (MODE === 'firestore') {
    const { doc, onSnapshot } = fb.fsMod;
    return onSnapshot(doc(fb.store, 'settings', 'app'), async () => cb(await getSettings()));
  }
  listeners.settings = listeners.settings || new Set();
  const wrapped = async () => cb(await getSettings());
  listeners.settings.add(wrapped);
  wrapped();
  return () => listeners.settings.delete(wrapped);
}

// ─── สำรอง/นำเข้าข้อมูล ───
export async function exportAll() {
  const [bookings, customers, settings] = await Promise.all([
    getAll('bookings'), getAll('customers'), getSettings(),
  ]);
  return { exportedAt: new Date().toISOString(), bookings, customers, settings };
}

export async function importAll(data) {
  if (!data || (!data.bookings && !data.customers)) throw new Error('ไฟล์ไม่ถูกต้อง');
  for (const b of (data.bookings || [])) await save('bookings', b);
  for (const c of (data.customers || [])) await save('customers', c);
  if (data.settings) await saveSettings(data.settings);
}
