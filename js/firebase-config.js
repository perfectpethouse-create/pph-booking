// ═══════════════════════════════════════════════════════════════
// firebase-config.js — วาง config ของโปรเจกต์ Firebase ที่นี่
//
// วิธีเอา config: Firebase Console → Project settings (เฟือง) →
//   หัวข้อ "Your apps" → เลือก Web app → คัดลอกค่าในบล็อก firebaseConfig
//   มาวางแทนค่า YOUR_... ด้านล่าง
//
// ตราบใดที่ยังเป็นค่า YOUR_... แอปจะรันใน "โหมดทดลอง (mock)" เก็บข้อมูล
// ในเครื่องนี้เท่านั้น เพื่อให้ลองใช้ก่อนตั้ง Firebase จริงได้
// (ดูขั้นตอนละเอียดใน README-setup-th.md)
// ═══════════════════════════════════════════════════════════════

export const firebaseConfig = {
  apiKey: 'AIzaSyCi7sSXV0Sz85XqWI0hVTGw-BbNd8Cxox0',
  authDomain: 'pph-booking.firebaseapp.com',
  projectId: 'pph-booking',
  storageBucket: 'pph-booking.firebasestorage.app',
  messagingSenderId: '500925629853',
  appId: '1:500925629853:web:c3c30413ffcb2e0c90db74',
};

// ตรวจว่ากรอก config จริงหรือยัง (ยังไม่กรอก = ใช้โหมด mock)
export function isFirebaseConfigured() {
  return firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith('YOUR_') &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.startsWith('YOUR_');
}
