// ต่อหน้าเว็บ AAR กับระบบหลังบ้าน (Google Apps Script ที่อยู่ใน config.js) และระบบ Login กลาง ฝูง.602 (repo eadmin)
// - หน้าเว็บขอ "บัตรผ่าน" ของเว็บนี้จาก App.enterWeb(webCode) แล้วส่งไปกับทุกคำขอ (ไม่ส่ง session ของ Login)
// - หน้าเว็บแก้ข้อมูลใน S แล้วเรียก AAR.push(): ระบบเทียบกับสำเนาล่าสุดของเซิร์ฟเวอร์ ส่งเฉพาะรายการที่เปลี่ยน
// - ถามเซิร์ฟเวอร์ทุก 15 วินาทีว่ามีคนอื่นแก้หรือไม่ (เฉพาะตอนหน้าเว็บเปิดอยู่)
// - สิทธิ์ทุกข้อตรวจที่ Apps Script การซ่อนปุ่มในหน้าเว็บเป็นแค่ความสะดวก
(function () {
  'use strict';
  const CONF = window.AAR_CONFIG || {};
  const AUTH = window.App || null;
  const POLL_MS = 15000;
  const say = (name, detail) => setTimeout(() => window.dispatchEvent(new CustomEvent(name, { detail })), 0);

  /* ---------- บัตรผ่านของเว็บนี้ ---------- */
  function SESS() { const s = AUTH && AUTH.session(); return s ? s.token : ''; }
  let PASS = '', PASS_OF = '';
  const PASSV = () => (PASS_OF && PASS_OF === SESS() ? PASS : '');
  async function getPass() {
    const s = SESS(); if (!s) return '';
    if (PASS_OF === s && PASS) return PASS;
    const r = await AUTH.enterWeb(CONF.webCode || '');
    PASS = r.pass || ''; PASS_OF = s; return PASS;
  }

  async function api(action, payload) {
    if (!CONF.apiUrl) throw { code: 'no_api', message: 'ยังไม่ได้ตั้งค่า apiUrl ในไฟล์ config.js' };
    let res, j;
    try {
      res = await fetch(CONF.apiUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action, pass: PASSV() }, payload || {})) });
    } catch (e) { throw { code: 'network', message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต' }; }
    try { j = await res.json(); } catch (e) { throw { code: 'network', message: 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง' }; }
    if (j && j.error) {
      const c = j.error.code;
      if (c === 'auth') say('app-auth-lost');
      else if (c === 'no_web' || c === 'web_closed' || c === 'wrong_web') say('app-denied', j.error.message);
      throw j.error;
    }
    return j;
  }

  /* ---------- แปลง S ของหน้าเว็บ ↔ ตารางของเซิร์ฟเวอร์ ---------- */
  const ARR = ['missions', 'items', 'comments', 'events', 'gissues', 'providers', 'notes', 'logs'];
  const LISTS = ['pmNames', 'mcNames', 'amcNames', 'cafNames', 'dechoCodes'];
  const NO_DEL = { logs: 1, stations: 1, lists: 1 };
  function toRows(S) {
    const t = {};
    ARR.forEach((c) => { t[c] = (S[c] || []).filter((x) => x && x.id); });
    t.acks = (S.acks || []).map((a) => Object.assign({}, a, { id: a.mid + '|' + a.dept }));
    t.stations = Object.keys(S.stations || {}).map((k) => ({ id: k, name: (S.stations[k] || {}).name || k, country: (S.stations[k] || {}).country || '' }));
    t.lists = LISTS.filter((k) => Array.isArray(S[k])).map((k) => ({ id: k, values: S[k].slice() }));
    return t;
  }
  function toState(d) {
    const S = { v: 2 };
    ARR.forEach((c) => { S[c] = (d[c] || []).map((x) => Object.assign({}, x)); });
    S.acks = (d.acks || []).map((a) => { const o = Object.assign({}, a); delete o.id; return o; });
    S.stations = {}; Object.keys(d.stations || {}).forEach((k) => { S.stations[k] = Object.assign({}, d.stations[k]); });
    LISTS.forEach((k) => { if (d.lists && Array.isArray(d.lists[k])) S[k] = d.lists[k].slice(); });
    return S;
  }
  // สำเนาล่าสุดที่ได้จากเซิร์ฟเวอร์: ชุดข้อมูล → รหัส → JSON
  let SNAP = {}, VER = 0, DATA = null;
  function snapOf(d) {
    const rows = toRows(toState(d)), o = {};
    Object.keys(rows).forEach((c) => { o[c] = {}; rows[c].forEach((r) => { o[c][r.id] = JSON.stringify(r); }); });
    return o;
  }
  function diff(S) {
    const rows = toRows(S), ops = [];
    Object.keys(rows).forEach((c) => {
      const was = SNAP[c] || {}, seen = {};
      rows[c].forEach((r) => {
        seen[r.id] = 1;
        const j = JSON.stringify(r);
        if (was[r.id] !== j) { if (c === 'logs' && was[r.id]) return; ops.push({ c, op: 'put', row: r }); }
      });
      if (!NO_DEL[c]) Object.keys(was).forEach((id) => { if (!seen[id]) ops.push({ c, op: 'del', id }); });
    });
    // ข้อมูลหลักก่อน (ภารกิจ → ข้อ → ...) ประวัติท้ายสุด
    const rank = { stations: 0, lists: 0, missions: 1, events: 2, providers: 2, notes: 2, items: 3, gissues: 3, acks: 4, comments: 5, logs: 9 };
    return ops.sort((a, b) => rank[a.c] - rank[b.c]);
  }

  /* ---------- รับข้อมูลจากเซิร์ฟเวอร์ ---------- */
  let ME = null;
  function take(r) {
    if (r.me) ME = r.me;
    if (r.data) { DATA = r.data; SNAP = snapOf(r.data); }
    if (r.ver) VER = r.ver;
  }
  function deliver(why) { if (DATA && window.AAR.onData) window.AAR.onData(toState(DATA), ME, why); }

  /* ---------- ส่งการแก้ไข ---------- */
  let sending = false, again = false, timerPush = null, lastPush = Promise.resolve();
  function push() { clearTimeout(timerPush); timerPush = setTimeout(flush, 40); return lastPush; }
  async function flush() {
    if (sending) { again = true; return; }
    const S = window.AAR.state && window.AAR.state();
    if (!S) return;
    const ops = diff(S);
    if (!ops.length) return;
    sending = true; say('aar-saving', true);
    lastPush = (async () => {
      try {
        const r = await api('write', { ops });
        take(r);
        // การแก้ไขที่เกิดระหว่างรอ: ส่งต่อรอบหน้า (ข้อมูลในหน้าไม่ถูกแทนที่ระหว่างนี้)
        if (!again) deliver('saved');
      } catch (e) {
        if (e && (e.code === 'conflict' || e.code === 'forbidden' || e.code === 'bad_request' || e.code === 'not_found')) {
          say('app-toast', e.message || 'บันทึกไม่สำเร็จ');
          try { take(await api('sync', { ver: 0 })); deliver('reload'); } catch (_) {}
        } else if (e && e.code !== 'auth') {
          say('app-toast', (e && e.message ? e.message : 'บันทึกไม่สำเร็จ') + ' · ข้อมูลที่แก้ยังอยู่ในหน้านี้ ระบบจะลองส่งใหม่');
          setTimeout(push, 8000);
        }
      } finally {
        sending = false; say('aar-saving', false);
        if (again) { again = false; push(); }
      }
    })();
    return lastPush;
  }

  /* ---------- ถามการเปลี่ยนแปลงของคนอื่น ---------- */
  let pollT = null;
  async function poll() {
    clearTimeout(pollT);
    try {
      if (PASSV() && !document.hidden && !sending && !timerPushPending()) {
        const r = await api('sync', { ver: VER });
        if (r.data && !sending && !timerPushPending() && !diff(window.AAR.state ? window.AAR.state() : {}).length) {
          take(r);
          if (!window.AAR.busy || !window.AAR.busy()) deliver('remote'); else waiting = true;
        } else take({ me: r.me });
      }
    } catch (_) { /* ลองใหม่รอบหน้า */ }
    pollT = setTimeout(poll, POLL_MS);
  }
  let waiting = false;
  const timerPushPending = () => false;
  // ยังมีการแก้ไขที่ยังไม่ถึงเซิร์ฟเวอร์
  function unsaved() { try { return sending || (window.AAR.state && diff(window.AAR.state()).length > 0); } catch (_) { return false; } }
  // ปิด / โหลดหน้าใหม่ระหว่างบันทึก: เบราว์เซอร์ถามก่อน และส่งรายการที่ค้างไปให้เป็นครั้งสุดท้าย
  window.addEventListener('beforeunload', (e) => { if (unsaved()) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('pagehide', () => {
    try {
      if (sending || !PASSV() || !CONF.apiUrl || !navigator.sendBeacon) return;
      const ops = diff(window.AAR.state()); if (!ops.length) return;
      navigator.sendBeacon(CONF.apiUrl, new Blob([JSON.stringify({ action: 'write', pass: PASSV(), ops })], { type: 'text/plain;charset=utf-8' }));
    } catch (_) {}
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && PASSV()) poll(); });

  /* ---------- รูปใน Drive ---------- */
  const PH = {}, PHP = {};
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  function photoSrc(p) {
    p = String(p || '');
    if (!/^drive:/.test(p)) return p;
    if (PH[p]) return PH[p];
    if (!PHP[p]) PHP[p] = api('photo', { id: p }).then((r) => {
      PH[p] = r.src;
      document.querySelectorAll('img[data-ph="' + p + '"]').forEach((im) => { im.src = r.src; });
    }).catch(() => { delete PHP[p]; });
    return BLANK;
  }

  window.AAR = {
    state: null,      // หน้าเว็บกำหนด: () => S
    onData: null,     // หน้าเว็บกำหนด: (S, me, why) => …
    busy: null,       // หน้าเว็บกำหนด: () => true ถ้ากำลังพิมพ์หรือเปิดหน้าต่างอยู่ (ยังไม่แทนที่ข้อมูล)
    push, api, photoSrc,
    me: () => ME,
    unsaved,
    // หลังปิดหน้าต่าง / เลิกพิมพ์: ข้อมูลของคนอื่นที่รออยู่ แสดงได้แล้ว
    idle() { if (waiting && !sending) { waiting = false; deliver('remote'); } },
    async start() {
      PASS_OF = ''; await getPass();
      const r = await api('sync', { ver: 0 });
      take(r); clearTimeout(pollT); pollT = setTimeout(poll, POLL_MS);
      return { S: toState(DATA || {}), me: ME };
    },
    async renew() { PASS_OF = ''; await getPass(); poll(); },
    async reload() { take(await api('sync', { ver: 0 })); deliver('reload'); },
  };
})();
