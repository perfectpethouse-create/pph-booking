// ═══════════════════════════════════════════════════════════════
// backup.js — สำรอง/นำเข้าข้อมูลเป็นไฟล์ JSON + เตือนสำรองเป็นระยะ
// ═══════════════════════════════════════════════════════════════
import { exportAll, importAll, MODE } from './db.js';
import { el, toast, confirmDialog } from './ui.js';
import { icons } from './icons.js';
import { formatDateTH, todayISO } from './calc.js';

const LAST_BACKUP_KEY = 'pph_last_backup';

export function renderBackup(container) {
  container.appendChild(el('div', { class: 'page-title' }, [el('h1', { text: 'สำรองข้อมูล' })]));

  const last = localStorage.getItem(LAST_BACKUP_KEY);
  const daysSince = last ? Math.floor((Date.now() - Number(last)) / 86400000) : null;

  // แจ้งเตือนถ้าไม่ได้สำรองนาน
  const warn = el('div', { class: 'card', style: 'border-color:var(--orange);background:rgba(255,149,0,0.05)' }, [
    el('h2', { text: 'การสำรองข้อมูล' }),
    el('p', {}, [
      last
        ? `สำรองครั้งล่าสุด: ${formatDateTH(new Date(Number(last)).toISOString().slice(0, 10))} (${daysSince} วันก่อน)` + (daysSince >= 7 ? ' — ควรสำรองใหม่' : '')
        : 'ยังไม่เคยสำรองข้อมูลจากเครื่องนี้ — แนะนำให้สำรองอย่างน้อยสัปดาห์ละครั้ง',
    ]),
  ]);
  container.appendChild(warn);

  // Export
  const expBtn = el('button', { class: 'btn primary', html: icons.download + ' ดาวน์โหลดไฟล์สำรอง (JSON)' });
  expBtn.onclick = async () => {
    try {
      const data = await exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: `PPH-backup-${todayISO()}.json` });
      a.click(); URL.revokeObjectURL(a.href);
      localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
      toast('สำรองข้อมูลแล้ว — เก็บไฟล์ไว้ใน Google Drive หรือที่ปลอดภัย');
      setTimeout(() => renderBackup(clear(container)), 400);
    } catch (e) { toast('สำรองไม่สำเร็จ: ' + e.message); }
  };

  // Import
  const fileInp = el('input', { type: 'file', accept: 'application/json', style: 'display:none' });
  const impBtn = el('button', { class: 'btn', html: icons.upload + ' นำเข้าจากไฟล์สำรอง' });
  impBtn.onclick = () => fileInp.click();
  fileInp.onchange = async () => {
    const file = fileInp.files[0];
    if (!file) return;
    if (!await confirmDialog('นำเข้าข้อมูลจากไฟล์นี้? ข้อมูลที่มี id ตรงกันจะถูกเขียนทับ', { okText: 'นำเข้า' })) return;
    try {
      const data = JSON.parse(await file.text());
      await importAll(data);
      toast('นำเข้าข้อมูลสำเร็จ');
    } catch (e) { toast('นำเข้าไม่สำเร็จ: ' + e.message); }
    fileInp.value = '';
  };

  container.appendChild(el('div', { class: 'card' }, [
    el('h2', { text: 'จัดการไฟล์สำรอง' }),
    el('p', { class: 'muted', text: 'สำรองข้อมูลการจอง ลูกค้า และการตั้งค่าทั้งหมดเป็นไฟล์เดียว เก็บไว้กู้คืนได้' }),
    el('div', { class: 'row', style: 'gap:10px' }, [expBtn, impBtn, fileInp]),
  ]));

  if (MODE === 'mock') {
    container.appendChild(el('div', { class: 'card', style: 'background:var(--accent-tint);border-color:transparent' }, [
      el('p', { class: 'muted', html: '<strong>โหมดทดลอง:</strong> ข้อมูลตอนนี้เก็บในเบราว์เซอร์เครื่องนี้เท่านั้น — เมื่อตั้งค่า Firebase เสร็จ ข้อมูลจะซิงค์หลายเครื่องอัตโนมัติ (ดู README-setup-th.md)' }),
    ]));
  }
}

function clear(container) { container.innerHTML = ''; return container; }
