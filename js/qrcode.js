// ═══════════════════════════════════════════════════════════════
// qrcode.js — ตัวสร้าง QR Code แบบฝังในตัว (ไม่พึ่งเน็ต/CDN) สำหรับพิมพ์บนเอกสาร
//
// รองรับ: byte mode (UTF-8), ระดับแก้ความผิดพลาด M, เวอร์ชัน 1–4 (เลือกอัตโนมัติ)
//   — พอสำหรับรหัสจองสั้นๆ (เช่น PPH-260718-1047) และ URL สั้น
//   — ทำไมจำกัด v1–4: ตารางบล็อก/ตำแหน่ง alignment ของเวอร์ชันเหล่านี้ตายตัวและตรวจสอบง่าย
//     (v≥7 ต้องมี version-info เพิ่ม, v5–6 ตารางบล็อกจำง่ายพลาด — เลี่ยงไว้เพื่อความถูกต้อง)
//
// export: qrSVG(text, opts) → string(SVG) ; qrMatrix(text) → boolean[][]
// อ้างอิงอัลกอริทึม QR มาตรฐาน (ISO/IEC 18004) — finder/timing/format/mask/Reed–Solomon
// ═══════════════════════════════════════════════════════════════

// ── Galois Field GF(256) (primitive 0x11d) ──
const EXP = new Array(256);
const LOG = new Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  EXP[255] = EXP[0];
})();
function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[(LOG[a] + LOG[b]) % 255]; }

// สร้างพหุนาม generator ดีกรี n สำหรับ Reed–Solomon
function rsGenerator(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gmul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

// คำนวณ EC codewords จาก data codewords 1 บล็อก
function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Array(data.length + ecLen).fill(0);
  for (let i = 0; i < data.length; i++) res[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const factor = res[i];
    if (factor !== 0) {
      for (let j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], factor);
    }
  }
  return res.slice(data.length); // ท้ายสุดคือ EC
}

// ── สเปกเวอร์ชัน (ระดับ M) ──
// modules = ขนาดกริด, ecPerBlock = EC ต่อบล็อก, blocks = [[dataLen ×จำนวน], ...]
// align = ตำแหน่งกึ่งกลาง alignment pattern (นอกเหนือมุม finder)
const VERSIONS = {
  1: { modules: 21, ecPerBlock: 10, blocks: [[16, 1]], align: [] },
  2: { modules: 25, ecPerBlock: 16, blocks: [[28, 1]], align: [6, 18] },
  3: { modules: 29, ecPerBlock: 26, blocks: [[44, 1]], align: [6, 22] },
  4: { modules: 33, ecPerBlock: 18, blocks: [[32, 2]], align: [6, 26] },
};

// จำนวน data codewords รวมของเวอร์ชัน
function dataCapacity(v) {
  return VERSIONS[v].blocks.reduce((s, [len, cnt]) => s + len * cnt, 0);
}

// ── สร้าง bitstream (byte mode) ──
function buildBitStream(bytes, v) {
  const cap = dataCapacity(v);
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);            // mode: byte
  push(bytes.length, 8);      // char count (v1–9 = 8 บิต)
  bytes.forEach(b => push(b, 8));
  // terminator สูงสุด 4 บิต
  const capBits = cap * 8;
  for (let i = 0; i < 4 && bits.length < capBits; i++) bits.push(0);
  // เติมให้ครบ byte
  while (bits.length % 8 !== 0) bits.push(0);
  // เติม pad bytes สลับ 0xEC / 0x11
  const pads = [0xEC, 0x11];
  let pi = 0;
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  while (codewords.length < cap) { codewords.push(pads[pi]); pi ^= 1; }
  return codewords;
}

// แบ่งบล็อก + คำนวณ EC + สาน (interleave) ตามสเปก
function buildCodewords(dataCodewords, v) {
  const spec = VERSIONS[v];
  const blocks = [];
  let idx = 0;
  spec.blocks.forEach(([len, cnt]) => {
    for (let c = 0; c < cnt; c++) {
      const data = dataCodewords.slice(idx, idx + len); idx += len;
      blocks.push({ data, ec: rsEncode(data, spec.ecPerBlock) });
    }
  });
  const result = [];
  const maxData = Math.max(...blocks.map(b => b.data.length));
  for (let i = 0; i < maxData; i++) blocks.forEach(b => { if (i < b.data.length) result.push(b.data[i]); });
  for (let i = 0; i < spec.ecPerBlock; i++) blocks.forEach(b => result.push(b.ec[i]));
  return result;
}

// ── วางลวดลายลงกริด ──
function makeMatrix(v) {
  const n = VERSIONS[v].modules;
  const m = Array.from({ length: n }, () => new Array(n).fill(null)); // null=ว่าง
  const reserved = Array.from({ length: n }, () => new Array(n).fill(false));

  const setF = (r, c, val) => { m[r][c] = val ? 1 : 0; reserved[r][c] = true; };

  // finder pattern 7×7 + separator
  const placeFinder = (r, c) => {
    for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
      const rr = r + i, cc = c + j;
      if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
      const onBorder = (i === 0 || i === 6) && j >= 0 && j <= 6;
      const onSide = (j === 0 || j === 6) && i >= 0 && i <= 6;
      const inCenter = i >= 2 && i <= 4 && j >= 2 && j <= 4;
      setF(rr, cc, onBorder || onSide || inCenter);
    }
  };
  placeFinder(0, 0); placeFinder(0, n - 7); placeFinder(n - 7, 0);

  // timing patterns
  for (let i = 8; i < n - 8; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }

  // alignment pattern (v2–4: จุดเดียวกึ่งกลาง)
  const al = VERSIONS[v].align;
  if (al.length) {
    const cr = al[1], cc = al[1];
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const ring = Math.max(Math.abs(i), Math.abs(j));
      setF(cr + i, cc + j, ring !== 1);
    }
  }

  // dark module
  setF(n - 8, 8, 1);

  // จองพื้นที่ format info (ยังไม่ใส่ค่า)
  for (let i = 0; i < 9; i++) { if (!reserved[8][i]) reserved[8][i] = true; if (!reserved[i][8]) reserved[i][8] = true; }
  for (let i = 0; i < 8; i++) { reserved[8][n - 1 - i] = true; reserved[n - 1 - i][8] = true; }

  return { m, reserved, n };
}

// ฟังก์ชัน mask 8 แบบ
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

// วาง data bits แบบ zig-zag แล้ว apply mask
function placeData(base, codewords, maskFn) {
  const { m, reserved, n } = base;
  const grid = m.map(row => row.slice());
  const bits = [];
  codewords.forEach(cw => { for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1); });

  let bitIdx = 0, dirUp = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--; // ข้ามคอลัมน์ timing
    for (let i = 0; i < n; i++) {
      const row = dirUp ? n - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (reserved[row][cc]) continue;
        let bit = bitIdx < bits.length ? bits[bitIdx++] : 0;
        if (maskFn(row, cc)) bit ^= 1;
        grid[row][cc] = bit;
      }
    }
    dirUp = !dirUp;
  }
  return grid;
}

// format info (ระดับ M) + mask → 15 บิต BCH
function formatBits(maskIdx) {
  const ecBits = 0b00; // M
  let data = (ecBits << 3) | maskIdx; // 5 บิต
  let bch = data << 10;
  const g = 0b10100110111; // 0x537
  for (let i = 14; i >= 10; i--) if ((bch >> i) & 1) bch ^= g << (i - 10);
  let bits = ((data << 10) | bch) ^ 0b101010000010010; // mask 0x5412
  return bits & 0x7fff;
}

function placeFormat(grid, n, maskIdx) {
  const bits = formatBits(maskIdx);
  const get = (i) => (bits >> i) & 1;
  // แนวตั้ง (คอลัมน์ 8) — ตาม reference implementation (Kazuhiko Arase)
  for (let i = 0; i < 15; i++) {
    const b = get(i);
    if (i < 6) grid[i][8] = b;
    else if (i < 8) grid[i + 1][8] = b;
    else grid[n - 15 + i][8] = b;
  }
  // แนวนอน (แถว 8)
  for (let i = 0; i < 15; i++) {
    const b = get(i);
    if (i < 8) grid[8][n - i - 1] = b;
    else if (i < 9) grid[8][15 - i] = b; // i=8 → grid[8][7]
    else grid[8][14 - i] = b;            // i=9..14 → grid[8][5..0]
  }
  grid[n - 8][8] = 1; // dark module
}

// ── ประเมินโทษของแต่ละ mask (เลือกที่ดีสุด) ──
function penalty(grid, n) {
  let score = 0;
  // rule 1: run เดียวกัน ≥5
  for (let r = 0; r < n; r++) for (let dir = 0; dir < 2; dir++) {
    let run = 1;
    for (let c = 1; c < n; c++) {
      const a = dir ? grid[c][r] : grid[r][c];
      const b = dir ? grid[c - 1][r] : grid[r][c - 1];
      if (a === b) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
      else run = 1;
    }
  }
  // rule 2: บล็อก 2×2
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const v = grid[r][c];
    if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
  }
  // rule 3: pattern 1:1:3:1:1
  const pat = [1, 0, 1, 1, 1, 0, 1];
  const check = (arr) => {
    for (let i = 0; i + 7 <= arr.length; i++) {
      let ok = true;
      for (let k = 0; k < 7; k++) if (arr[i + k] !== pat[k]) { ok = false; break; }
      if (ok) {
        const before = arr.slice(Math.max(0, i - 4), i);
        const after = arr.slice(i + 7, i + 11);
        if (before.length === 4 && before.every(x => x === 0)) score += 40;
        if (after.length === 4 && after.every(x => x === 0)) score += 40;
      }
    }
  };
  for (let r = 0; r < n; r++) { check(grid[r]); check(grid.map(row => row[r])); }
  // rule 4: สัดส่วนสีเข้ม
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark += grid[r][c];
  const ratio = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

// ── สร้าง matrix สมบูรณ์ ──
export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  // เลือกเวอร์ชันเล็กสุดที่พอ (overhead = mode4 + count8 = 12 บิต ≈ 2 byte)
  let v = null;
  for (const ver of [1, 2, 3, 4]) {
    if (bytes.length + 2 <= dataCapacity(ver)) { v = ver; break; }
  }
  if (v == null) throw new Error('ข้อมูลยาวเกินไปสำหรับ QR (v1–4)');

  const dataCw = buildBitStream(bytes, v);
  const allCw = buildCodewords(dataCw, v);
  const base = makeMatrix(v);

  let best = null, bestScore = Infinity;
  for (let maskIdx = 0; maskIdx < 8; maskIdx++) {
    const grid = placeData(base, allCw, MASKS[maskIdx]);
    placeFormat(grid, base.n, maskIdx);
    const score = penalty(grid, base.n);
    if (score < bestScore) { bestScore = score; best = grid; }
  }
  return best.map(row => row.map(v => v === 1));
}

// ── render เป็น SVG (คมชัดตอนพิมพ์) ──
export function qrSVG(text, { size = 120, margin = 2 } = {}) {
  const mat = qrMatrix(text);
  const n = mat.length;
  const total = n + margin * 2;
  const cell = size / total;
  let rects = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (mat[r][c]) {
      const x = ((c + margin) * cell).toFixed(2);
      const y = ((r + margin) * cell).toFixed(2);
      rects += `<rect x="${x}" y="${y}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}
