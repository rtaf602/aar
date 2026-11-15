/**
 * AAR · After Action Review ฝูง.602 — ระบบหลังบ้าน (Google Apps Script)
 * ------------------------------------------------------------------
 * ติดตั้งด้วยบัญชีหลักที่เป็นเจ้าของชีต AAR DATABASE และโฟลเดอร์รูป (ดู SETUP_TH.md)
 *  1. วางไฟล์นี้ใน Apps Script ของชีต AAR DATABASE (ส่วนขยาย → Apps Script)
 *  2. กรอก SETUP ด้านล่าง (ในหน้า Apps Script เท่านั้น อย่า commit ค่าจริงลง GitHub) แล้ว Run setup
 *  3. Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone
 *
 * ใครเข้าได้และทำอะไรได้ ตัดสินโดยระบบ Login กลางของ ฝูง.602 (repo eadmin) ทุกคำขอ:
 *  หน้าเว็บขอ "บัตรผ่าน" (pass) ของเว็บนี้จาก App.enterWeb แล้วส่งมากับทุกคำขอ ที่นี่ถาม web.check ต่อ
 *  ได้ ยศ ชื่อ-สกุล ตำแหน่งงาน (→ ฝ่าย) และ Role ของเว็บนี้ (Admin / Editor / Viewer)
 *  สิทธิ์ทุกข้อตรวจซ้ำที่นี่ การซ่อนปุ่มในหน้าเว็บเป็นแค่ความสะดวก
 *
 * ข้อมูลทุกปีงบอยู่ในไฟล์เดียว แต่ละแท็บมีคอลัมน์อ่านง่าย + คอลัมน์ json (ข้อมูลจริงที่ระบบใช้)
 * แก้ข้อมูลผ่านหน้าเว็บเท่านั้น การแก้ในชีตด้วยมือไม่มีผลกับหน้าเว็บ (ระบบอ่านจากคอลัมน์ json)
 */

/* ====================== กรอกในหน้า Apps Script (ห้าม commit ค่าจริง) ====================== */
const SETUP = {
  dbSheet: '',        // ลิงก์หรือรหัสชีต AAR DATABASE
  photoFolder: '',    // ลิงก์หรือรหัสโฟลเดอร์เก็บรูป
  loginUrl: '',       // ที่อยู่ระบบหลังบ้านของระบบ Login (ค่าเดียวกับ backendUrl ใน eadmin/docs/assets/config.js)
  oldSheet: '',       // (ครั้งแรกเท่านั้น) ลิงก์ชีต AAR SUMMARY ALL MISSION เพื่อนำข้อมูลเดิมเข้า เว้นว่างได้
  mcNames: [],        // (ครั้งแรกเท่านั้น) รายชื่อ MC เช่น ['น.ต. สมชาย', ...] ระบบใส่ในแท็บ LISTS ถ้ายังว่าง
  amcNames: [],       // (ครั้งแรกเท่านั้น) รายชื่อผู้ช่วย MC
};

const CFG = {
  WEB_CODE: 'WEB15',  // รหัสเว็บนี้ในรายชื่อเว็บของหน้า Admin (ต้องตรงกับ webCode ใน config.js)
  CHECK_SEC: 60,      // คำขอที่อ่านอย่างเดียว: ถามระบบ Login ซ้ำทุก 60 วินาที · การแก้ไขถามใหม่ทุกครั้ง
  TZ: 'Asia/Bangkok',
  MAX_PHOTO: 4 * 1024 * 1024,
};

/* ฝ่ายจากคอลัมน์ ตำแหน่งงาน ของ LOGIN DATABASE */
const DEPTS = ['NB', 'CH', 'SO', 'KSO', 'PB', 'TG', 'MD'];
const DEPT_NAME = { NB: 'นักบิน', CH: 'ช่าง', SO: 'สื่อสาร', KSO: 'ขนส่งอากาศยาน', PB: 'พนักงานต้อนรับ', TG: 'TG', MD: 'แพทย์' };
function deptOfPos_(pos) {
  const p = String(pos || '').replace(/\s+/g, '');
  if (!p) return '';
  if (/^(ผบช\.?|นบ\.?|ผอ\.?เดินทาง|นักบิน)/.test(p)) return 'NB';
  if (/^(จนท\.?ชอ\.?|ชอ\.?|ช\.|ช่าง)/.test(p)) return 'CH';
  if (/^(จนท\.?สอ\.?|สอ\.?|ส\.|สื่อสาร)/.test(p)) return 'SO';
  if (/^(ขสอ\.?|ขนส่ง)/.test(p)) return 'KSO';
  if (/^(พบ\.?|พนักงานต้อนรับ)/.test(p)) return 'PB';
  if (/^TG/i.test(p)) return 'TG';
  if (/^(พ\.|แพทย์)/.test(p)) return 'MD';
  return '';
}
const SHARED = ['TG', 'MD'];                       // TG และ พ. ฝ่ายลูกเรือกรอกแทนได้ และทุกฝ่ายเห็นประวัติ/ชื่อ
const PROXY_FROM = ['NB', 'CH', 'SO', 'KSO', 'PB'];

/* ====================== ตาราง ====================== */
// แต่ละชุดข้อมูล: แท็บ (หรือแท็บตามฝ่าย/ชนิด), คอลัมน์อ่านง่าย · คอลัมน์สุดท้ายคือ json เสมอ
const T = {
  missions: { tab: () => 'MISSIONS', cols: ['id', 'fy', 'type', 'sub', 'title', 'start', 'end', 'ac', 'route', 'mc', 'amc', 'depts', 'by', 'at', 'deleted_at'] },
  items: { tab: (r) => 'ITEMS_' + r.dept, tabs: DEPTS.map((d) => 'ITEMS_' + d), cols: ['id', 'mid', 'fy', 'dept', 'issue', 'rec', 'photos', 'repeatOf', 'proxy', 'cby', 'cdept', 'by', 'at', 'ver', 'deleted_at'] },
  acks: { tab: () => 'ACKS', cols: ['id', 'mid', 'fy', 'dept', 'by', 'at', 'deleted_at'] },
  comments: { tab: () => 'COMMENTS', cols: ['id', 't', 'tid', 'text', 'by', 'dept', 'at', 'deleted_at'] },
  events: { tab: (r) => (r.kind === 'CAT' ? 'CAT_EVENTS' : 'GSE_EVENTS'), tabs: ['GSE_EVENTS', 'CAT_EVENTS'], cols: ['id', 'kind', 'mid', 'fy', 'st', 'date', 'phase', 'leg', 'ft', 'meals', 'ac', 'pid', 'contact', 'rating', 'pay', 'by', 'dept', 'at', 'deleted_at'] },
  gissues: { tab: (r, D) => (kindOfEvent_(D, r.eid) === 'CAT' ? 'CAT_ISSUES' : 'GSE_ISSUES'), tabs: ['GSE_ISSUES', 'CAT_ISSUES'], cols: ['id', 'eid', 'cat', 'issue', 'cause', 'min', 'fix', 'photos', 'by', 'dept', 'at', 'editedBy', 'editedDept', 'editedAt', 'deleted_at'] },
  providers: { tab: () => 'PROVIDERS', cols: ['id', 'kind', 'st', 'name', 'contact', 'services', 'by', 'dept', 'at', 'deleted_at'] },
  notes: { tab: () => 'NOTES', cols: ['id', 'kind', 'st', 'text', 'by', 'dept', 'at', 'deleted_at'] },
  stations: { tab: () => 'STATIONS', cols: ['id', 'name', 'country'] },
  lists: { tab: () => 'LISTS', cols: ['id', 'values'] },
  logs: { tab: () => 'LOG', cols: ['id', 'at', 'user', 'dept', 'scope', 'mid', 'fy', 'action', 'target', 'detail', 'owner'] },
};
const ORDER = Object.keys(T);
const tabsOf_ = (c) => T[c].tabs || [T[c].tab({})];
const LIST_IDS = ['pmNames', 'mcNames', 'amcNames', 'cafNames', 'dechoCodes'];

/* =========================== HTTP =========================== */
function doGet() { return json_({ ok: true, app: 'aar602', time: new Date().toISOString() }); }

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = Object.prototype.hasOwnProperty.call(API, req.action) ? API[req.action] : null;
    if (!fn) throw err_('bad_action', 'ไม่รู้จักคำสั่ง ' + req.action);
    const s = auth_(req.pass, !!FRESH[req.action]);
    return json_(fn(req, s) || { ok: true });
  } catch (x) {
    return json_({ error: { code: (x && x.code) || 'server', message: (x && x.message) || String(x), row: x && x.row } });
  }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function err_(code, message) { const e = new Error(message); e.code = code; return e; }

const FRESH = { write: 1 };

const API = {
  // ข้อมูลทั้งหมดที่ผู้ใช้คนนี้เห็นได้ ส่งเฉพาะเมื่อมีการเปลี่ยนหลังเวอร์ชันที่หน้าเว็บถืออยู่
  sync: function (r, s) {
    const v = ver_();
    const out = { ok: true, ver: v, me: meOut_(s) };
    if (Number(r.ver) !== v) out.data = view_(load_(), s);
    return out;
  },
  // ชุดการแก้ไขจากหน้าเว็บ: ตรวจสิทธิ์ทีละรายการ ทั้งชุดผ่านหรือไม่ผ่านทั้งหมด
  write: function (r, s) {
    const ops = Array.isArray(r.ops) ? r.ops : [];
    if (ops.length > 400) throw err_('bad_request', 'แก้ไขพร้อมกันมากเกินไป');
    return withLock_(function () {
      const D = load_(true), changed = {};
      ops.forEach(function (op) { applyOp_(D, op, s, changed); });
      const n = Object.keys(changed).length;
      if (n) { save_(D, changed); bump_(); cacheData_(D); }
      return { ok: true, ver: ver_(), data: view_(D, s), me: meOut_(s) };
    });
  },
  // รูปที่เก็บใน Drive: ส่งเฉพาะรูปที่อยู่ในข้อมูลของระบบนี้ (ไม่เปิดไฟล์อื่นใน Drive)
  photo: function (r, s) {
    const id = String(r.id || '').replace(/^drive:/, '');
    if (!/^[A-Za-z0-9_-]{10,100}$/.test(id)) throw err_('bad_request', 'รหัสรูปไม่ถูกต้อง');
    const D = load_(), ref = 'drive:' + id;
    const used = D.items.concat(D.gissues).some(function (x) { return !x.deleted_at && (x.photos || []).indexOf(ref) >= 0; });
    if (!used) throw err_('not_found', 'ไม่พบรูปนี้');
    const blob = DriveApp.getFileById(id).getBlob();
    return { ok: true, id: ref, src: 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
  },
};

/* =========================== ผู้ใช้และสิทธิ์ =========================== */
function meOut_(s) { return { name: s.name, role: s.role, dept: s.dept, super: s.super, pos: s.pos }; }
const isAdmin_ = (s) => s.role === 'Admin';
const canWrite_ = (s) => s.role === 'Admin' || s.role === 'Editor';
const isProxyFor_ = (s, dk) => SHARED.indexOf(dk) >= 0 && PROXY_FROM.indexOf(s.dept) >= 0;
const canEditDept_ = (s, dk) => canWrite_(s) && !!dk && (s.dept === dk || isProxyFor_(s, dk));
const canSeeNames_ = (s, dk) => isAdmin_(s) || s.dept === dk || SHARED.indexOf(dk) >= 0;
function logScopes_(s) {
  const sc = s.dept ? [s.dept] : [];
  if (isAdmin_(s)) DEPTS.forEach(function (d) { if (sc.indexOf(d) < 0) sc.push(d); });
  SHARED.forEach(function (d) { if (sc.indexOf(d) < 0) sc.push(d); });
  if (canWrite_(s)) sc.push('MISSION');
  sc.push('GSE', 'CAT');
  return sc;
}
const isDelLog_ = (l) => l.action === 'DELETE' || /_DEL$/.test(String(l.action || ''));
const canSeeDelText_ = (s, l) => l.scope === 'GSE' || l.scope === 'CAT' || isAdmin_(s) || s.dept === l.owner || s.dept === l.scope;

/* สิ่งที่ผู้ใช้คนนี้เห็น: ไม่ส่งแถวที่ลบแล้ว ซ่อนชื่อคนกรอกของฝ่ายอื่น กรองประวัติตามสิทธิ์ */
function view_(D, s) {
  const live = (a) => a.filter(function (x) { return !x.deleted_at; });
  const sc = logScopes_(s);
  return {
    missions: live(D.missions),
    items: live(D.items).map(function (i) {
      if (canSeeNames_(s, i.dept)) return i;
      const o = Object.assign({}, i); o.by = ''; o.cby = ''; return o;
    }),
    acks: live(D.acks).map(function (a) { if (canSeeNames_(s, a.dept)) return a; const o = Object.assign({}, a); o.by = ''; return o; }),
    comments: live(D.comments), events: live(D.events), gissues: live(D.gissues), providers: live(D.providers), notes: live(D.notes),
    stations: D.stations, lists: D.lists,
    logs: D.logs.filter(function (l) { return sc.indexOf(l.scope) >= 0; }).slice(0, 2000).map(function (l) {
      if (!isDelLog_(l) || canSeeDelText_(s, l)) return l;
      const o = Object.assign({}, l); o.detail = ''; o.masked = true; return o;
    }),
  };
}

/* หนึ่งรายการแก้ไข: { c: ชุดข้อมูล, op: 'put' | 'del', row | id } */
function applyOp_(D, op, s, changed) {
  const c = String(op && op.c || '');
  if (!T[c]) throw err_('bad_request', 'ไม่รู้จักชุดข้อมูล ' + c);
  // stations / lists เก็บเป็น object ในข้อมูล: แปลงเป็นรายการชั่วคราว แล้วเขียนกลับท้ายฟังก์ชัน
  const isMap = c === 'stations' || c === 'lists';
  const list = isMap ? Object.keys(D[c]).map(function (k) { return c === 'stations' ? { id: k, name: D[c][k].name, country: D[c][k].country } : { id: k, values: D[c][k] }; }) : D[c];
  const now = new Date().toISOString();
  if (c === 'acks' && op.op === 'put' && op.row) op.row.id = String(op.row.mid || '') + '|' + String(op.row.dept || '');
  const id = String(op.op === 'del' ? op.id : (op.row && op.row.id) || '');
  if (!id || id.length > 120) throw err_('bad_request', 'ไม่มีรหัสรายการ');
  const at = list.findIndex(function (x) { return x.id === id; });
  const old = at >= 0 ? list[at] : null;
  const deny = (m) => { throw err_('forbidden', m || 'บัญชีนี้ไม่มีสิทธิ์แก้ไขรายการนี้'); };

  if (op.op === 'del') {
    if (!old || old.deleted_at) return;
    if (c === 'logs' || c === 'stations' || c === 'lists') deny();
    if (c === 'missions' && !isAdmin_(s)) deny('ลบภารกิจได้เฉพาะ Admin');
    if (c === 'items' && !canEditDept_(s, old.dept)) deny('แก้ไขได้เฉพาะข้อของฝ่ายตัวเอง');
    if (c === 'acks' && !(canWrite_(s) && old.dept === s.dept)) deny();
    if (c === 'comments' && !(old.by === s.name && (old.t === 'g' || canWrite_(s)))) deny('ลบได้เฉพาะความเห็นของตัวเอง');
    list[at] = Object.assign({}, old, { deleted_at: now, deleted_by: s.name });
    changed[c + ':' + id] = list[at];
    return;
  }
  if (op.op !== 'put' || !op.row || typeof op.row !== 'object') throw err_('bad_request', 'คำสั่งไม่ถูกต้อง');
  let row = JSON.parse(JSON.stringify(op.row));
  if (JSON.stringify(row).length > 60000 && c !== 'items' && c !== 'gissues') throw err_('bad_request', 'ข้อมูลยาวเกินไป');
  delete row.deleted_at; delete row.deleted_by;
  if (old && old.deleted_at) deny('รายการนี้ถูกลบไปแล้ว');

  if (c === 'missions') {
    if (!old) { if (!canWrite_(s)) deny('เปิดภารกิจได้เฉพาะ Editor และ Admin'); row.by = s.name; row.at = now; }
    else {
      if (!(isAdmin_(s) || (canWrite_(s) && old.by === s.name))) deny('แก้ข้อมูลภารกิจได้เฉพาะ Admin หรือคนที่เปิดภารกิจ');
      row.by = old.by; row.at = old.at;
    }
    row.fy = fyOf_(row.start);
  } else if (c === 'items') {
    if (DEPTS.indexOf(row.dept) < 0) throw err_('bad_request', 'ไม่รู้จักฝ่าย');
    if (old && old.dept !== row.dept) deny('ย้ายฝ่ายของข้อไม่ได้');
    if (!canEditDept_(s, row.dept)) deny('แก้ไขได้เฉพาะข้อของฝ่ายตัวเอง');
    if (!missionOf_(D, row.mid)) throw err_('bad_request', 'ไม่พบภารกิจของข้อนี้');
    if (old) {
      const ov = Number(old.ver || 1), nv = Number(row.ver || 1);
      if (nv !== ov && nv !== ov + 1) { const e = err_('conflict', 'มีคนแก้ข้อนี้ไปก่อนแล้ว โหลดข้อมูลล่าสุดให้แล้ว'); e.row = old; throw e; }
      row.cby = old.cby || old.by; row.cdept = old.cdept || old.dept; row.proxy = old.proxy;
    } else {
      row.cby = s.name; row.cdept = s.dept; row.proxy = row.dept !== s.dept ? s.dept : undefined; row.ver = 1;
    }
    row.by = s.name; row.at = now;
    row.fy = fyOf_((missionOf_(D, row.mid) || {}).start);
    row.photos = savePhotos_(row.photos, old && old.photos, missionOf_(D, row.mid), row.dept + '_' + row.id);
  } else if (c === 'acks') {
    if (!(canWrite_(s) && row.dept === s.dept)) deny('ยืนยันได้เฉพาะฝ่ายตัวเอง');
    row.id = row.mid + '|' + row.dept; row.by = s.name; row.at = now; row.fy = fyOf_((missionOf_(D, row.mid) || {}).start);
  } else if (c === 'comments') {
    if (old) deny('แก้ความเห็นไม่ได้ ลบแล้วเขียนใหม่');
    if (row.t !== 'g' && !canWrite_(s)) deny('Viewer แสดงความเห็นในข้อของฝ่ายไม่ได้');
    row.by = s.name; row.dept = s.dept; row.at = now; row.text = String(row.text || '').slice(0, 3000);
  } else if (c === 'events' || c === 'providers' || c === 'notes') {
    // GSE / Catering: ทุกคนที่เข้าเว็บได้ กรอกและแก้ได้ (ผู้ใช้กำหนด) ชื่อคนกรอกครั้งแรกคงไว้
    if (old) { row.by = old.by; row.dept = old.dept; row.at = old.at; } else { row.by = s.name; row.dept = s.dept; row.at = now; }
    if (c === 'events') row.fy = fyOf_(row.date);
  } else if (c === 'gissues') {
    if (old) { row.by = old.by; row.dept = old.dept; row.at = old.at; row.editedBy = s.name; row.editedDept = s.dept; row.editedAt = now; }
    else { row.by = s.name; row.dept = s.dept; row.at = now; delete row.editedBy; delete row.editedDept; delete row.editedAt; }
    const ev = D.events.find(function (x) { return x.id === row.eid; });
    row.photos = savePhotos_(row.photos, old && old.photos, ev && missionOf_(D, ev.mid), (ev && ev.kind === 'CAT' ? 'CAT_' : 'GSE_') + (ev ? ev.st : '') + '_' + row.id, ev);
  } else if (c === 'stations') {
    row.name = String(row.name || row.id).slice(0, 120); row.country = String(row.country || '').slice(0, 60);
  } else if (c === 'lists') {
    if (LIST_IDS.indexOf(id) < 0) throw err_('bad_request', 'ไม่รู้จักรายชื่อ');
    if (!canWrite_(s)) deny();
    row.values = (Array.isArray(row.values) ? row.values : []).map(String).slice(0, 300);
  } else if (c === 'logs') {
    if (old) return;                                            // ประวัติเพิ่มอย่างเดียว
    const scopes = DEPTS.concat(['GSE', 'CAT', 'MISSION']);
    if (scopes.indexOf(row.scope) < 0) throw err_('bad_request', 'ไม่รู้จักส่วนของประวัติ');
    if (/^EXPORT/.test(String(row.action)) && !canWrite_(s)) deny('Viewer ส่งออกไฟล์ไม่ได้');
    row = { id: id, at: now, user: s.name, dept: s.dept, scope: row.scope, mid: row.mid || null, action: String(row.action || '').slice(0, 40),
      target: String(row.target || '').slice(0, 200), detail: String(row.detail || '').slice(0, 800), owner: row.owner || undefined };
    row.fy = fyOf_((missionOf_(D, row.mid) || {}).start);
    list.unshift(row); changed[c + ':' + id] = row;
    return;
  }
  if (isMap) { D[c][id] = c === 'stations' ? { name: row.name, country: row.country } : row.values; changed[c + ':' + id] = row; return; }
  if (at >= 0) list[at] = row; else list.push(row);
  changed[c + ':' + id] = row;
}
const missionOf_ = (D, mid) => D.missions.find(function (m) { return m.id === mid && !m.deleted_at; });
function kindOfEvent_(D, eid) { const e = (D.events || []).find(function (x) { return x.id === eid; }); return e && e.kind === 'CAT' ? 'CAT' : 'GSE'; }
function fyOf_(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  return Number(m[1]) + 543 + (Number(m[2]) >= 10 ? 1 : 0);
}

/* =========================== รูปภาพ (Google Drive) =========================== */
// รูปใหม่จากหน้าเว็บมาเป็น data:image/... เก็บลงโฟลเดอร์ ปีงบ / รหัสภารกิจ ชื่อภารกิจ แล้วเก็บในข้อมูลเป็น drive:<รหัสไฟล์>
// รูปที่ถูกเอาออกจากข้อ: ไฟล์ยังอยู่ใน Drive (ลบแบบซ่อน)
function savePhotos_(photos, oldPhotos, m, base, ev) {
  const keep = {}; (oldPhotos || []).forEach(function (p) { keep[p] = 1; });
  return (Array.isArray(photos) ? photos : []).slice(0, 12).map(function (p, k) {
    p = String(p || '');
    if (/^drive:[A-Za-z0-9_-]+$/.test(p)) { if (!keep[p]) throw err_('forbidden', 'รูปนี้ไม่ใช่ของรายการนี้'); return p; }
    const mm = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(p);
    if (!mm) return null;
    const bytes = Utilities.base64Decode(mm[2]);
    if (bytes.length > CFG.MAX_PHOTO) throw err_('bad_request', 'รูปใหญ่เกินไป');
    const folder = photoFolderFor_(m, ev);
    const ext = mm[1] === 'image/png' ? 'png' : mm[1] === 'image/webp' ? 'webp' : 'jpg';
    const f = folder.createFile(Utilities.newBlob(bytes, mm[1], base + '_' + Date.now().toString(36) + '_' + (k + 1) + '.' + ext));
    return 'drive:' + f.getId();
  }).filter(Boolean);
}
function photoFolderFor_(m, ev) {
  const root = DriveApp.getFolderById(prop_('PHOTO_ID'));
  const fy = String(fyOf_(m ? m.start : ev ? ev.date : new Date().toISOString().slice(0, 10)) || 'ไม่ระบุปีงบ');
  const year = child_(root, fy);
  if (!m) return child_(year, 'ไม่ผูกภารกิจ');
  // หาโฟลเดอร์ของภารกิจจากรหัส (ชื่อภารกิจเปลี่ยนภายหลังได้ รูปไม่หลุด)
  const it = year.getFolders();
  while (it.hasNext()) { const f = it.next(); if (f.getName().split(' ')[0] === m.id) return f; }
  return year.createFolder(m.id + ' ' + String(m.title || '').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 80));
}
function child_(parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }

/* =========================== อ่าน / เขียนชีต =========================== */
function db_() { return SpreadsheetApp.openById(prop_('DB_ID')); }
function emptyData_() { const D = {}; ORDER.forEach(function (c) { D[c] = []; }); D.stations = {}; D.lists = {}; return D; }
function load_(fresh) {
  if (!fresh) { const hit = cacheGet_('data:' + ver_()); if (hit) return hit; }
  const ss = db_(), D = emptyData_();
  ORDER.forEach(function (c) {
    const arr = [];
    tabsOf_(c).forEach(function (name) {
      const sh = ss.getSheetByName(name); if (!sh) return;
      const n = sh.getLastRow(), w = T[c].cols.length + 1;
      if (n < 2) return;
      sh.getRange(2, 1, n - 1, w).getValues().forEach(function (r) {
        const j = String(r[w - 1] || ''); if (!j) return;
        try { arr.push(JSON.parse(j)); } catch (x) { /* แถวที่ถูกแก้ด้วยมือจนอ่านไม่ได้: ข้าม */ }
      });
    });
    if (c === 'stations') arr.forEach(function (x) { D.stations[x.id] = { name: x.name, country: x.country }; });
    else if (c === 'lists') arr.forEach(function (x) { D.lists[x.id] = x.values || []; });
    else D[c] = arr;
  });
  D.logs.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  if (!fresh) cacheData_(D);
  return D;
}
// เขียนเฉพาะแถวที่เปลี่ยน (หาแถวจากรหัสในคอลัมน์ A) แถวใหม่ต่อท้าย
function save_(D, changed) {
  const ss = db_(), byTab = {};
  Object.keys(changed).forEach(function (k) {
    const c = k.split(':')[0], row = changed[k];
    let rec = row;
    if (c === 'stations') rec = { id: row.id, name: row.name, country: row.country };
    const name = T[c].tab(rec, D);
    (byTab[name] = byTab[name] || { c: c, rows: [] }).rows.push(rec);
  });
  Object.keys(byTab).forEach(function (name) {
    const c = byTab[name].c, cols = T[c].cols, sh = sheet_(ss, name, cols);
    const n = sh.getLastRow(), ids = n > 1 ? sh.getRange(2, 1, n - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
    const add = [];
    byTab[name].rows.forEach(function (r) {
      const vals = rowVals_(c, r), i = ids.indexOf(String(r.id));
      if (i >= 0) sh.getRange(i + 2, 1, 1, vals.length).setValues([vals]); else add.push(vals);
    });
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, add[0].length).setValues(add);
  });
  SpreadsheetApp.flush();
}
function rowVals_(c, r) {
  const cols = T[c].cols;
  return cols.map(function (k) {
    let v = r[k];
    if (v == null) return '';
    if (Array.isArray(v)) v = v.map(function (x) { return typeof x === 'string' && x.length > 60 ? x.slice(0, 60) + '…' : x; }).join(', ');
    else if (typeof v === 'object') v = JSON.stringify(v);
    v = String(v);
    if (/^[=+\-@]/.test(v)) v = "'" + v;                 // ไม่ให้ชีตอ่านเป็นสูตร
    return v.length > 4000 ? v.slice(0, 4000) + '…' : v;
  }).concat([JSON.stringify(r)]);
}
function sheet_(ss, name, cols) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length + 1).setValues([cols.concat(['json'])]).setFontWeight('bold').setBackground('#1f3a68').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* =========================== cache / เวอร์ชัน / lock =========================== */
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function ver_() { return Number(prop_('VER') || '1'); }
function bump_() { PropertiesService.getScriptProperties().setProperty('VER', String(ver_() + 1)); }
function withLock_(fn) {
  const l = LockService.getScriptLock();
  if (!l.tryLock(25000)) throw err_('busy', 'ระบบกำลังบันทึกของคนอื่นอยู่ ลองใหม่อีกครั้ง');
  try { return fn(); } finally { l.releaseLock(); }
}
// ข้อมูลทั้งหมดเก็บใน cache แบ่งเป็นชิ้น (ชิ้นละไม่เกิน 90KB) อายุ 6 ชั่วโมง
function cacheData_(D) { try { cachePut_('data:' + ver_(), D); } catch (x) { /* cache เต็ม: อ่านจากชีตแทน */ } }
function cachePut_(key, obj) {
  const c = CacheService.getScriptCache(), s = JSON.stringify(obj), size = 90000, parts = Math.ceil(s.length / size);
  if (parts > 90) return;
  const m = {}; for (let i = 0; i < parts; i++) m[key + ':' + i] = s.slice(i * size, (i + 1) * size);
  m[key] = String(parts); c.putAll(m, 21600);
}
function cacheGet_(key) {
  const c = CacheService.getScriptCache(), n = Number(c.get(key) || 0);
  if (!n) return null;
  const keys = []; for (let i = 0; i < n; i++) keys.push(key + ':' + i);
  const got = c.getAll(keys); let s = '';
  for (let i = 0; i < n; i++) { const p = got[key + ':' + i]; if (p == null) return null; s += p; }
  try { return JSON.parse(s); } catch (x) { return null; }
}

/* =========================== การ Login (ระบบ Login กลาง) =========================== */
function loginUrl_() { return String(prop_('LOGIN_URL') || '').trim(); }
function loginUrlOk_(url) { return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url); }
function auth_(pass, fresh) {
  pass = String(pass || '');
  if (!pass || pass.length > 800) throw err_('auth', 'ให้เข้าสู่ระบบ');
  let w = '';
  try { w = String(JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pass.split('.')[0])).getDataAsString()).w || ''); } catch (x) { w = ''; }
  if (w && w !== CFG.WEB_CODE) throw err_('wrong_web', 'รหัสเว็บในไฟล์ config.js (' + w + ') ไม่ตรงกับ CFG.WEB_CODE ใน Apps Script (' + CFG.WEB_CODE + ') ให้แก้ให้ตรงกัน');
  const key = sha256_('aar|' + pass).slice(0, 32), cache = CacheService.getScriptCache();
  if (!fresh) { const hit = cache.get('who:' + key); if (hit) return JSON.parse(hit); }
  const url = loginUrl_();
  if (!loginUrlOk_(url)) throw err_('config', 'ยังไม่ได้ตั้งที่อยู่ระบบ Login (SETUP.loginUrl แล้ว Run setup)');
  let j = null;
  try {
    const res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify({ v: 1, op: 'web.check', pass: pass, web: CFG.WEB_CODE }), muteHttpExceptions: true, followRedirects: true });
    j = JSON.parse(res.getContentText());
  } catch (x) { j = null; }
  if (!j || (!j.ok && !j.error)) throw err_('busy', 'ตรวจสิทธิ์กับระบบ Login ไม่ได้ ลองอีกครั้ง');
  if (!j.ok) {
    cache.remove('who:' + key);
    const c = String(j.error.code || '');
    if (c === 'auth' || c === 'expired' || c === 'taken') throw err_('auth', String(j.error.message || 'ให้เข้าสู่ระบบใหม่'));
    if (c === 'no_web' || c === 'web_closed') throw err_(c, String(j.error.message || 'บัญชีนี้ไม่มีสิทธิ์ใช้งานเว็บนี้ ให้ติดต่อ Admin'));
    throw err_('busy', String(j.error.message || 'ระบบ Login ขัดข้อง ลองอีกครั้ง'));
  }
  const u = j.user || {}, role = String(j.role || '');
  const name = ((String(u.rank || '').trim() + ' ' + String(u.name || '').trim()).trim() || String(u.username || '')).slice(0, 80);
  const who = { name: name, role: role, dept: deptOfPos_(u.pos), pos: String(u.pos || '').slice(0, 40), super: j.super === true };
  const left = Math.floor((Number(j.expiresAt) - Date.now()) / 1000);
  if (left > 1) cache.put('who:' + key, JSON.stringify(who), Math.min(CFG.CHECK_SEC, left));
  return who;
}
function sha256_(t) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, t, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

/* =========================== ติดตั้งครั้งแรก =========================== */
function idOf_(v) { const m = /[-\w]{25,}/.exec(String(v || '')); return m ? m[0] : ''; }

/** Run ครั้งแรก (และทุกครั้งที่แก้ SETUP): จำค่าไว้ สร้างแท็บ ตรวจระบบ Login และนำข้อมูลเดิมเข้า (ถ้ายังว่าง) */
function setup() {
  const p = PropertiesService.getScriptProperties();
  const db = idOf_(SETUP.dbSheet) || prop_('DB_ID'), ph = idOf_(SETUP.photoFolder) || prop_('PHOTO_ID');
  const url = String(SETUP.loginUrl || '').trim() || loginUrl_();
  if (!db) throw new Error('ยังไม่ได้กรอก SETUP.dbSheet (ลิงก์ชีต AAR DATABASE)');
  if (!ph) throw new Error('ยังไม่ได้กรอก SETUP.photoFolder (ลิงก์โฟลเดอร์เก็บรูป)');
  if (!loginUrlOk_(url)) throw new Error('SETUP.loginUrl ต้องเป็นที่อยู่ Web app ของระบบ Login (ขึ้นต้น https://script.google.com/macros/s/ ลงท้าย /exec)');
  p.setProperty('DB_ID', db); p.setProperty('PHOTO_ID', ph); p.setProperty('LOGIN_URL', url);
  let ok = false;
  try { ok = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true }).getContentText()).service === 'eadmin602'; } catch (x) { ok = false; }
  if (!ok) throw new Error('ติดต่อระบบ Login ที่ ' + url + ' ไม่ได้ ตรวจ SETUP.loginUrl แล้ว Run setup อีกครั้ง');
  Logger.log('ระบบ Login ตอบแล้ว · รหัสเว็บนี้ ' + CFG.WEB_CODE + ' (ต้องมีในรายชื่อเว็บของหน้า Admin)');
  const ss = SpreadsheetApp.openById(db);
  ORDER.forEach(function (c) { tabsOf_(c).forEach(function (n) { sheet_(ss, n, T[c].cols); }); });
  try { DriveApp.getFolderById(ph).getName(); } catch (x) { throw new Error('เปิดโฟลเดอร์รูปไม่ได้: ตรวจ SETUP.photoFolder และให้บัญชีนี้เป็นผู้แก้ไขโฟลเดอร์'); }
  if (!p.getProperty('VER')) p.setProperty('VER', '1');
  const D = load_(true);
  if (!D.missions.length && idOf_(SETUP.oldSheet)) {
    const n = importOld_(SpreadsheetApp.openById(idOf_(SETUP.oldSheet)), D);
    Logger.log('นำข้อมูลเดิมเข้าแล้ว: ' + n.missions + ' ภารกิจ ' + n.items + ' ข้อ');
  } else if (D.missions.length) Logger.log('ชีตมีข้อมูลแล้ว ' + D.missions.length + ' ภารกิจ (ไม่นำข้อมูลเดิมเข้าซ้ำ)');
  const lists = {};
  [['mcNames', SETUP.mcNames], ['amcNames', SETUP.amcNames]].forEach(function (x) {
    const D2 = load_(true);
    if ((!D2.lists[x[0]] || !D2.lists[x[0]].length) && Array.isArray(x[1]) && x[1].length) lists['lists:' + x[0]] = { id: x[0], values: x[1].map(String) };
  });
  if (Object.keys(lists).length) { save_(load_(true), lists); Logger.log('ใส่รายชื่อ MC / ผู้ช่วย MC ในแท็บ LISTS แล้ว'); }
  bump_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'keepWarm') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(5).create();
  Logger.log('ตั้งค่าเสร็จแล้ว ขั้นต่อไป: Deploy → New deployment → Web app (Execute as: Me · Anyone)');
}
/** ปลุกระบบทุก 5 นาที ให้หน้าเว็บเปิดเร็ว (ไม่อ่านชีต) */
function keepWarm() { return ver_(); }

/* =========================== นำข้อมูลจากชีตเดิม (AAR SUMMARY ALL MISSION) =========================== */
const OLD_TABS = [['นักบิน', 'NB'], ['ช่าง', 'CH'], ['สื่อสาร', 'SO'], ['ขนส่งอากาศยาน', 'KSO'], ['พนักงานต้อนรับ', 'PB'], ['ภาพรวม', 'NB']];
const TH_MON = { 'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6, 'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12 };
function parseThaiRange_(t) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  const m = /^(\d{1,2})\s*([ก-๙.]+?)?\s*[-–]\s*(\d{1,2})\s*([ก-๙.]+?)\s*(\d{2,4})$/.exec(t) || /^(\d{1,2})()\s*()\s*([ก-๙.]+?)\s*(\d{2,4})$/.exec(t);
  if (!m) return null;
  let y = Number(m[5]); if (y < 100) y += 2500; if (y > 2400) y -= 543;
  const m2 = TH_MON[m[4]], m1 = m[2] ? TH_MON[m[2]] : m2;
  if (!m1 || !m2) return null;
  const y1 = m1 > m2 ? y - 1 : y, pad = (n) => ('0' + n).slice(-2);
  return { start: y1 + '-' + pad(m1) + '-' + pad(m[1]), end: y + '-' + pad(m2) + '-' + pad(m[3] || m[1]) };
}
function guessType_(title) {
  if (/นายกรัฐมนตรี|นายกฯ/.test(title)) return { type: 'PM', sub: '' };
  if (/ผบ\.\s*ทอ\./.test(title)) return { type: 'CAF', sub: '' };
  const codes = (title.match(/RCVK|919/g) || []);
  if (codes.length) return { type: 'DECHO', sub: codes.filter(function (c, i, a) { return a.indexOf(c) === i; }).join(', ') };
  return { type: 'OUT', sub: '' };
}
/** อ่านแท็บฝ่ายของชีตเดิม: หนึ่งช่วงวันที่ = หนึ่งภารกิจ · แถวที่มีแต่ข้อเสนอแนะ ต่อท้ายข้อก่อนหน้า
    แท็บ ภาพรวม นำเข้าเป็นของฝ่ายนักบิน เฉพาะข้อที่ไม่ซ้ำกับแท็บนักบิน · ภารกิจเดิมถือว่าทุกฝ่ายตรวจแล้ว */
function importOld_(old, D) {
  const now = new Date().toISOString(), BY = 'นำเข้าจากชีตเดิม';
  const byKey = {}, missions = [], items = [], acks = [];
  let seq = 0;
  OLD_TABS.forEach(function (td) {
    const sh = old.getSheetByName(td[0]); if (!sh) return;
    const n = sh.getLastRow(); if (n < 3) return;
    const rows = sh.getRange(3, 1, n - 2, 5).getValues();
    let m = null, last = null;
    rows.forEach(function (r) {
      const date = String(r[0] || '').trim(), title = String(r[1] || '').trim(), route = String(r[2] || '').trim();
      const issue = String(r[3] || '').trim(), rec = String(r[4] || '').trim();
      if (date) {
        const d = parseThaiRange_(date); if (!d) { m = null; return; }
        const key = d.start;
        m = byKey[key];
        if (!m) {
          const g = guessType_(title);
          m = byKey[key] = { id: 'M' + d.start.replace(/-/g, ''), type: g.type, sub: g.sub, title: title, start: d.start, end: d.end, ac: '',
            route: route.split(/\s*[-–]\s*/).map(function (x) { return x.trim(); }).filter(Boolean), mc: [], amc: [], depts: ['NB', 'CH', 'SO', 'KSO', 'PB'], by: BY, at: now, imported: true };
          missions.push(m);
        } else if (title.length > m.title.length) m.title = title;
        last = null;
      }
      if (!m || (!issue && !rec)) { if (!date && !issue && !rec) last = null; return; }
      if (!issue && last) { last.rec = last.rec ? last.rec + '\n' + rec : rec; return; }
      if (td[0] === 'ภาพรวม' && items.some(function (x) { return x.mid === m.id && x.dept === 'NB' && x.issue === issue; })) { last = null; return; }
      seq++;
      last = { id: 'i' + ('000' + seq).slice(-4) + '_' + td[1], mid: m.id, dept: td[1], issue: issue, rec: rec, photos: [], repeatOf: null, cby: BY, cdept: td[1], by: BY, at: now, ver: 1 };
      items.push(last);
    });
  });
  missions.forEach(function (m) {
    m.fy = fyOf_(m.start);
    m.depts.forEach(function (dk) {
      if (!items.some(function (i) { return i.mid === m.id && i.dept === dk; })) acks.push({ id: m.id + '|' + dk, mid: m.id, dept: dk, fy: m.fy, by: 'นำเข้าข้อมูลเดิม', at: now });
    });
  });
  items.forEach(function (i) { i.fy = fyOf_(byKey[Object.keys(byKey).find(function (k) { return byKey[k].id === i.mid; })].start); });
  const changed = {};
  missions.forEach(function (m) { D.missions.push(m); changed['missions:' + m.id] = m; });
  items.forEach(function (i) { D.items.push(i); changed['items:' + i.id] = i; });
  acks.forEach(function (a) { D.acks.push(a); changed['acks:' + a.id] = a; });
  const lg = { id: 'l_import', at: now, user: 'ระบบ', dept: '', scope: 'MISSION', mid: null, action: 'IMPORT', target: 'AAR SUMMARY ALL MISSION', detail: 'นำเข้าข้อมูลเดิม ' + missions.length + ' ภารกิจ ' + items.length + ' ข้อ' };
  D.logs.unshift(lg); changed['logs:' + lg.id] = lg;
  save_(D, changed);
  return { missions: missions.length, items: items.length };
}
