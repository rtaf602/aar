// ทดสอบ AAR ทั้งระบบบนเครื่อง: ระบบ Login กลางตัวจริง (repo eadmin บนตัวจำลอง gas_sim) + Code.gs ตัวจริงของ AAR
// บนตัวจำลอง Google เล็ก ๆ ในไฟล์นี้ + หน้าเว็บทั้งสองบน origin เดียวกันแบบ GitHub Pages (/eadmin/, /app/, /aar/)
// ใช้: EADMIN_DIR=../eadmin APP_DIR=../app node test/aar_serve.mjs  → พิมพ์ JSON (origin, session ของแต่ละคน) แล้วรอ
// ทุกคนและรหัสผ่านในไฟล์นี้แต่งขึ้น ข้อมูลชีตเดิมเป็นตัวอย่างที่แต่งขึ้นตามรูปแบบของชีตจริง
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), AAR = path.join(HERE, '..');
const EAD = process.env.EADMIN_DIR || path.join(AAR, '..', 'eadmin'), APP = process.env.APP_DIR || path.join(AAR, '..', 'app');
const { startSim, fourFiles, SETUP4, BIRTH, idGov } = await import(path.join(EAD, 'test/gas_sim.mjs'));
const J = JSON.stringify;

/* ---------- ระบบ Login ---------- */
const sim = await startSim({ files: fourFiles() });
const post = (op, o) => sim.post(Object.assign({ v: 1, op }, o || {}));

/* ---------- ตัวจำลอง Google สำหรับ Code.gs ของ AAR ---------- */
const books = {}, drive = { folders: {}, files: {} }, props = {}, cache = new Map(), triggers = [], logs = [];
const clock = () => Date.now() + sim.offset;
function sheetObj(b, name) {
  const sh = b[name];
  const last = () => { let n = sh.rows.length; while (n && !(sh.rows[n - 1] || []).some((v) => v !== '' && v != null)) n--; return n; };
  const range = (r, c, nr, nc) => {
    const api = {
      setFontWeight: () => api, setBackground: () => api, setFontColor: () => api, setNumberFormat: () => api,
      setValues(v) { v.forEach((row, i) => { const t = (sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || []); row.forEach((x, j) => { t[c - 1 + j] = x; }); }); return api; },
      getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = sh.rows[r - 1 + i] || [], a = []; for (let j = 0; j < nc; j++) a.push(row[c - 1 + j] ?? ''); o.push(a); } return o; },
    };
    return api;
  };
  return { getRange: (r, c, nr, nc) => range(r, c, nr || 1, nc || 1), getLastRow: last, setFrozenRows() {}, getName: () => name };
}
const book = (id) => { if (!books[id]) throw new Error('ไม่พบไฟล์ ' + id); const b = books[id]; return { getSheetByName: (n) => (b[n] ? sheetObj(b, n) : null), insertSheet: (n) => { b[n] = { rows: [] }; return sheetObj(b, n); } }; };
const iter = (a) => { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; };
function folderObj(id) {
  const f = drive.folders[id]; if (!f) throw new Error('ไม่พบโฟลเดอร์ ' + id);
  return {
    getName: () => f.name, getId: () => id,
    getFoldersByName: (n) => iter(Object.keys(drive.folders).filter((k) => drive.folders[k].parent === id && drive.folders[k].name === n).map(folderObj)),
    getFolders: () => iter(Object.keys(drive.folders).filter((k) => drive.folders[k].parent === id).map(folderObj)),
    createFolder: (n) => { const k = 'F' + crypto.randomBytes(12).toString('hex'); drive.folders[k] = { name: n, parent: id }; return folderObj(k); },
    createFile: (blob) => { const k = 'D' + crypto.randomBytes(14).toString('hex'); drive.files[k] = { name: blob.name, mime: blob.mime, bytes: blob.bytes, parent: id }; return { getId: () => k }; },
  };
}
const box = {
  console, JSON, Math, Object, String, Number, Array, Error, Boolean, RegExp, Date,
  SpreadsheetApp: { openById: (id) => book(id), flush() {} },
  DriveApp: { getFolderById: (id) => folderObj(id), getFileById: (id) => { const f = drive.files[id]; if (!f) throw new Error('no file'); return { getBlob: () => ({ getContentType: () => f.mime, getBytes: () => f.bytes }) }; } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) },
  CacheService: { getScriptCache: () => ({
    get: (k) => { const e = cache.get(k); return e && e.until > clock() ? e.v : null; },
    put: (k, v, s) => cache.set(k, { v: String(v), until: clock() + s * 1000 }),
    putAll: (m, s) => Object.keys(m).forEach((k) => cache.set(k, { v: String(m[k]), until: clock() + s * 1000 })),
    getAll: (ks) => { const o = {}; ks.forEach((k) => { const e = cache.get(k); if (e && e.until > clock()) o[k] = e.v; }); return o; },
    remove: (k) => cache.delete(k) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }) },
  ScriptApp: { getProjectTriggers: () => triggers.slice(), deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1), newTrigger: (fn) => { const t = { fn, getHandlerFunction: () => fn, timeBased: () => t, everyMinutes: () => t, atHour: () => t, everyDays: () => t, inTimezone: () => t, create: () => { triggers.push(t); return t; } }; return t; } },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (a, t) => Array.from(crypto.createHash('sha256').update(String(t), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    base64Decode: (s) => Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b)),
    base64Encode: (b) => Buffer.from(b.map((x) => (x + 256) % 256)).toString('base64'),
    base64DecodeWebSafe: (s) => Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')).map((b) => (b > 127 ? b - 256 : b)),
    newBlob: (b, mime, name) => ({ bytes: b, mime, name, getDataAsString: () => Buffer.from(b.map((x) => (x + 256) % 256)).toString('utf8') }),
  },
  UrlFetchApp: { fetch: (url, o) => { if (url !== sim.backendUrl) throw new Error('wrong url ' + url); const out = o && o.method === 'post' ? sim.post(JSON.parse(o.payload)) : { ok: true, service: 'eadmin602' }; return { getContentText: () => J(out) }; } },
  Logger: { log: (s) => logs.push(String(s)) },
};
const ctx = vm.createContext(box);
box.__clock = clock;
vm.runInContext('(function () { const R = Date; function D() { const a = arguments; return a.length ? new R(...a) : new R(__clock()); } D.prototype = R.prototype; D.now = function () { return __clock(); }; D.UTC = R.UTC; D.parse = R.parse; globalThis.Date = D; })();', ctx);
vm.runInContext(fs.readFileSync(path.join(AAR, 'apps-script/Code.gs'), 'utf8'), ctx, { filename: 'aar/Code.gs' });

// ไฟล์ของผู้ใช้ (แต่งขึ้น): ชีต AAR DATABASE ว่าง, โฟลเดอร์รูป, และชีตเดิมรูปแบบเดียวกับ AAR SUMMARY ALL MISSION
const DBID = 'AARDB' + 'x'.repeat(30), OLDID = 'AAROLD' + 'y'.repeat(30), PHID = 'PHOTOS' + 'z'.repeat(30);
books[DBID] = { Sheet1: { rows: [] } };
drive.folders[PHID] = { name: 'AAR PHOTOS', parent: null };
const H = ['ช่วงเวลาที่ปฏิบัติภารกิจ', 'ภารกิจ', 'เส้นทางบิน', 'ข้อขัดข้อง', 'ข้อเสนอแนะ และแนวทางการแก้ไข', 'จำนวนภารกิจที่เกิดข้อขัดข้อง(หลังเกิดเหตุครั้งแรก)'];
const T0 = ['ข้อขัดข้องหลังปฏิบัติภารกิจ '];
books[OLDID] = {
  'ภาพรวม': { rows: [T0, H, ['26-28 ส.ค.69', 'รับ-ส่ง ผบ.ทอ.พร้อมคณะ เยือนต่างประเทศ (ทดสอบ)', 'ดอนเมือง - เมืองก - ดอนเมือง', 'ข้อจากภาพรวม ก', 'แนวทาง ก', '0'], ['', '', '', 'ข้อทดสอบ นบ. สอง', 'ซ้ำกับแท็บนักบิน']] },
  'นักบิน': { rows: [T0, H,
    ['8-16 พ.ค.69', 'ส่ง RCVK', 'ดอนเมือง-เมืองข-ดอนเมือง', 'ข้อทดสอบ นบ. หนึ่ง', 'แนวทาง 1', '0'],
    ['', '', '', 'ข้อทดสอบ นบ. มีแนวทางต่อ', 'แนวทาง 2', '0'], ['', '', '', '', 'แนวทาง 2 ต่อ', '0'], ['', '', '', '', 'แนวทาง 2 ต่ออีก', '0'],
    [], ['26-28 ส.ค.69', 'รับ-ส่ง ผบ.ทอ.พร้อมคณะ เยือนต่างประเทศ (ทดสอบ)', 'ดอนเมือง - เมืองก - ดอนเมือง', 'ข้อทดสอบ นบ. สอง', 'แนวทาง 3', '0']] },
  'ช่าง': { rows: [T0, H, ['26-28 ส.ค.69', 'รับ-ส่ง ผบ.ทอ.พร้อมคณะ เยือนต่างประเทศ (ทดสอบ)', 'ดอนเมือง - เมืองก - ดอนเมือง', 'ข้อทดสอบ ช.', 'แนวทาง ช.', '0']] },
  'สื่อสาร': { rows: [T0, H, ['16-23 ก.พ.69', 'ส่ง 919 และ RCVK ', 'ดอนเมือง-เมืองข-ดอนเมือง', 'ข้อทดสอบ ส.', 'แนวทาง ส.'], [], ['26-28 ส.ค.69', 'รับ-ส่ง ผบ.ทอ.และคณะ', 'ดอนเมือง - เมืองก - ดอนเมือง']] },
  'ขนส่งอากาศยาน': { rows: [T0, H, ['9-10 ก.ค.69', 'รับ-ส่ง นายกรัฐมนตรี และคณะ', 'ดอนเมือง-เมืองค-หาดใหญ่-ดอนเมือง', 'ข้อทดสอบ ขสอ. ไม่มีแนวทาง']] },
  'พนักงานต้อนรับ': { rows: [T0, H, ['30 ต.ค. - 3 พ.ย.69', 'รับ 919 และ RCVK', 'ดอนเมือง - เมืองข - ดอนเมือง', '', '- แนวทางอย่างเดียว 1'], ['', '', '', '', '- แนวทางอย่างเดียว 2']] },
};

/* ---------- ผู้ใช้ทดสอบ ---------- */
const PW = { chan: 'Main-Admin-Pass-01', thana: 'Editor-Password-05', phum: 'Viewer-Password-03', somchai: 'Tech-Password-09', kitti: 'Comm-Password-11' };
export const site = { sim, ctx, props, books, drive, logs, DBID, PHID, OLDID };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname);
  if (p === '/aar-api/exec' && req.method === 'POST') {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      let out; try { out = ctx.doPost({ postData: { contents: b } }).getContent(); } catch (e) { out = J({ error: { code: 'server', message: String(e && e.stack || e) } }); }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(out);
    }); return;
  }
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/eadmin/assets/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.EADMIN_CONFIG = ' + J({ backendUrl: sim.backendUrl }) + ';'); return; }
  if (p.startsWith('/aar/config.js')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.AAR_CONFIG = ' + J({ webCode: 'WEB15', apiUrl: ORIGIN + '/aar-api/exec' }) + ';'); return; }
  let file = null;
  if (p.startsWith('/eadmin/')) file = path.join(EAD, 'docs', path.normalize(p.slice(8)));
  else if (p.startsWith('/app/')) file = path.join(APP, path.normalize(p.slice(5)));
  else if (p.startsWith('/aar/')) file = path.join(AAR, path.normalize(p.slice(5)));
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
  const t = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': t }); res.end(fs.readFileSync(file));
});
await new Promise((r) => srv.listen(Number(process.env.PORT || 0), '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + srv.address().port;
sim.setup(Object.assign({}, SETUP4, { superAdmin: 'chan_t', firstAdmins: ['chan_t'], siteUrl: ORIGIN + '/eadmin/' }));
const first = sim.firstLinks(), tok = (l) => /#token=([A-Za-z0-9_-]+)/.exec(l)[1];
post('link.use', { token: tok(first.find((l) => l.startsWith('chan_t'))), password: PW.chan, birth: BIRTH });
let A = post('login', { username: 'chan_t', password: PW.chan, idGov: String(idGov(8)), birth: BIRTH }).session;
const ref = (u) => post('admin.list', { session: A }).people.find((p) => p.username === u).ref;
for (const [u, pw] of [['thana_t', PW.thana], ['phum_s', PW.phum], ['somchai_t', PW.somchai], ['kitti_s', PW.kitti]]) {
  const g = post('admin.link', { session: A, ref: ref(u), role: 'User', end: '' });
  post('link.use', { token: g.token, password: pw, birth: BIRTH });
}
const wl = post('admin.webList', { session: A, act: 'add', code: 'WEB15', name: 'AAR', link: 'https://example.github.io/aar/' }); if (!wl.ok) throw new Error('web list: ' + JSON.stringify(wl));
post('admin.web', { session: A, ref: ref('thana_t'), web: { WEB15: 'Editor' } });     // นบ.
post('admin.web', { session: A, ref: ref('phum_s'), web: { WEB15: 'Viewer' } });      // นบ.
post('admin.web', { session: A, ref: ref('somchai_t'), web: { WEB15: 'Editor' } });   // จนท.ชอ. → ช.
post('admin.web', { session: A, ref: ref('kitti_s'), web: { WEB15: 'Editor' } });     // จนท.สอ. → ส.
post('logout', { session: A });

/* ---------- ติดตั้ง Code.gs ของ AAR ---------- */
vm.runInContext(`SETUP.dbSheet = 'https://docs.google.com/spreadsheets/d/${DBID}/edit'; SETUP.photoFolder = 'https://drive.google.com/drive/folders/${PHID}'; SETUP.oldSheet = '${OLDID}'; SETUP.mcNames = ['น.ต. ทดสอบหนึ่ง', 'ร.อ. ทดสอบสอง']; SETUP.loginUrl = 'https://script.google.com/macros/s/TEST/exec';`, ctx);
vm.runInContext(`var __ok = loginUrlOk_; loginUrlOk_ = function (u) { return u === ${J(sim.backendUrl)} || __ok(u); };`, ctx);
vm.runInContext(`SETUP.loginUrl = ${J(sim.backendUrl)};`, ctx);
vm.runInContext('setup()', ctx);

const login = (u, pw, n) => { const r = post('login', { username: u, password: pw, idGov: String(idGov(n)), birth: BIRTH }); return { token: r.session, exp: r.expiresAt, user: r.user }; };
export function sessions() {
  return { chan: login('chan_t', PW.chan, 8), thana: login('thana_t', PW.thana, 3), phum: login('phum_s', PW.phum, 5), somchai: login('somchai_t', PW.somchai, 9), kitti: login('kitti_s', PW.kitti, 11) };
}
export const origin = ORIGIN;
export const aarPost = (o) => JSON.parse(ctx.doPost({ postData: { contents: J(o) } }).getContent());
export const passOf = (s) => post('web.enter', { session: s, web: 'WEB15' }).pass;
export { post };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // ใช้เป็นเซิร์ฟเวอร์ให้ชุดทดสอบเบราว์เซอร์ (Python Playwright): พิมพ์ข้อมูลแล้วรอ · บรรทัด "SESS" ขอ session ใหม่
  console.log(J({ origin: ORIGIN, logs, sessions: sessions(), pw: PW, birth: BIRTH }));
  process.stdin.on('data', (d) => { if (String(d).trim() === 'SESS') console.log(J({ sessions: sessions() })); if (String(d).trim() === 'DUMP') console.log(J({ books: books[DBID], drive: Object.keys(drive.files).length })); });
}
