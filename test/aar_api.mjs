// ทดสอบระบบหลังบ้านของ AAR อย่างเดียว (ไม่มีเบราว์เซอร์): การ Login ผ่านระบบกลาง สิทธิ์ทุกข้อ การนำข้อมูลเดิมเข้า รูปภาพ
// ใช้: EADMIN_DIR=../eadmin APP_DIR=../app node test/aar_api.mjs
import vm from 'node:vm';
import { site, sessions, aarPost, passOf } from './aar_serve.mjs';
const bad = [];
const check = (name, cond, got) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + String(JSON.stringify(got)).slice(0, 400))); if (!cond) bad.push(name); };
const ce = (r) => (r.error || {}).code;
const S = sessions(), P = {}; Object.keys(S).forEach((k) => { P[k] = passOf(S[k].token); });
const sync = (k) => aarPost({ action: 'sync', pass: P[k], ver: 0 });
const write = (k, ops) => aarPost({ action: 'write', pass: P[k], ops });

/* ---------- ติดตั้ง + นำข้อมูลเดิมเข้า ---------- */
check('setup ran: tabs made, keepWarm set, said what it imported', site.logs.some((l) => /นำข้อมูลเดิมเข้าแล้ว: 5 ภารกิจ 7 ข้อ · GSE 1 ข้อ/.test(l)) && !!site.books[site.DBID].MISSIONS && !!site.books[site.DBID].ITEMS_TG && !!site.books[site.DBID].LOG, site.logs);
const d0 = sync('chan').data;
const mBy = (start) => d0.missions.find((m) => m.start === start);
check('import: dates read (เดือนเดียว, ข้ามเดือน 30 ต.ค. - 3 พ.ย.69) and fiscal years', mBy('2026-05-08') && mBy('2026-05-08').end === '2026-05-16' && mBy('2026-10-30') && mBy('2026-10-30').end === '2026-11-03' && mBy('2026-10-30').fy === 2570 && mBy('2026-05-08').fy === 2569, d0.missions.map((m) => [m.start, m.end, m.fy]));
check('import: type guessed (นายก, ผบ.ทอ., เดโชชัย 919+RCVK)', mBy('2026-07-09').type === 'PM' && mBy('2026-08-26').type === 'CAF' && mBy('2026-02-16').type === 'DECHO' && mBy('2026-02-16').sub === '919, RCVK', d0.missions.map((m) => [m.start, m.type, m.sub]));
check('import: the longest title of the same mission kept, route kept as written', mBy('2026-08-26').title === 'รับ-ส่ง ผบ.ทอ.พร้อมคณะ เยือนต่างประเทศ (ทดสอบ)' && mBy('2026-08-26').route.join('|') === 'ดอนเมือง|เมืองก|ดอนเมือง');
const it = (txt) => d0.items.find((i) => i.issue === txt);
check('import: rows with a recommendation only join the issue above', it('ข้อทดสอบ นบ. มีแนวทางต่อ') && it('ข้อทดสอบ นบ. มีแนวทางต่อ').rec === 'แนวทาง 2\nแนวทาง 2 ต่อ\nแนวทาง 2 ต่ออีก', it('ข้อทดสอบ นบ. มีแนวทางต่อ'));
check('import: ภาพรวม with an airport → GSE issue of that mission at that station; the one already in a department skipped', !d0.items.some((i) => /ภาพรวม ก/.test(i.issue)) && d0.gissues.some((g) => /ภาพรวม ก/.test(g.issue) && g.fix === 'แนวทาง ก') && d0.events.some((e) => e.st === 'WBSB' && e.mid === mBy('2026-08-26').id) && d0.items.filter((i) => i.issue === 'ข้อทดสอบ นบ. สอง').length === 1, [d0.gissues, d0.events]);
check('import: a mission row with no issue (สื่อสาร) makes no item; only-recommendation rows make one item', !d0.items.some((i) => i.dept === 'SO' && i.mid === mBy('2026-08-26').id) && d0.items.filter((i) => i.dept === 'PB').length === 1 && /แนวทางอย่างเดียว 2/.test(d0.items.find((i) => i.dept === 'PB').rec));
check('import: departments with nothing to say are confirmed (old missions)', d0.acks.some((a) => a.mid === mBy('2026-05-08').id && a.dept === 'KSO') && !d0.acks.some((a) => a.mid === mBy('2026-05-08').id && a.dept === 'NB'));
check('import: items sit in their department tab', site.books[site.DBID].ITEMS_CH.rows.length === 2 && site.books[site.DBID].ITEMS_NB.rows.length === 4);
check('setup put the MC names (from SETUP, not from GitHub) in LISTS', JSON.stringify(d0.lists.mcNames) === JSON.stringify(['น.ต. ทดสอบหนึ่ง', 'ร.อ. ทดสอบสอง']), d0.lists);
check('setup again does not import twice', (() => { require_setup(); return sync('chan').data.missions.length === 5; })());
function require_setup() { site.ctx.setup(); }

/* ---------- การ Login ---------- */
check('no pass: refused', ce(aarPost({ action: 'sync', ver: 0 })) === 'auth');
check('a made-up pass: refused by the login system', ce(aarPost({ action: 'sync', pass: 'abc.def', ver: 0 })) === 'auth');
check('a session instead of a pass: refused', ce(aarPost({ action: 'sync', pass: S.thana.token, ver: 0 })) === 'auth');
const yT = sync('thana');
check('Editor นบ.: name from the login system (ยศ + ชื่อ-สกุล), department from ตำแหน่งงาน', yT.me.role === 'Editor' && yT.me.dept === 'NB' && yT.me.name === 'น.อ. ธนา ทดลองกิจ', yT.me);
check('จนท.ชอ. → ช. · จนท.สอ. → ส. · Viewer · main admin', sync('somchai').me.dept === 'CH' && sync('kitti').me.dept === 'SO' && sync('phum').me.role === 'Viewer' && sync('chan').me.role === 'Admin' && sync('chan').me.super === true);
check('unchanged version: no data sent again', !aarPost({ action: 'sync', pass: P.thana, ver: yT.ver }).data);

/* ---------- ภารกิจ ---------- */
const NEWM = { id: 'mT1', type: 'TRN', sub: '', title: 'ฝึกบินทดสอบ', start: '2026-11-20', end: '2026-11-20', ac: 'A319', route: ['VTBD', 'VTBU', 'VTBD'], mc: [], amc: [], depts: ['NB', 'CH', 'SO', 'KSO', 'PB'], by: 'ชื่อปลอม' };
check('Viewer cannot open a mission', ce(write('phum', [{ c: 'missions', op: 'put', row: NEWM }])) === 'forbidden');
const w1 = write('kitti', [{ c: 'missions', op: 'put', row: NEWM }]);
const m1 = w1.data && w1.data.missions.find((m) => m.id === 'mT1');
check('Editor opens a mission; "by" is the account, not what the page sent; fiscal year set', m1 && m1.by === 'ร.อ. กิตติ สาธิตกุล' && m1.fy === 2570, m1 || w1);
check('another Editor cannot edit it', ce(write('thana', [{ c: 'missions', op: 'put', row: Object.assign({}, NEWM, { title: 'แก้' }) }])) === 'forbidden');
check('the Editor who opened it can; the Admin can', !write('kitti', [{ c: 'missions', op: 'put', row: Object.assign({}, NEWM, { title: 'แก้โดยคนเปิด' }) }]).error && !write('chan', [{ c: 'missions', op: 'put', row: Object.assign({}, NEWM, { title: 'แก้โดย Admin' }) }]).error && sync('phum').data.missions.find((m) => m.id === 'mT1').by === 'ร.อ. กิตติ สาธิตกุล');

/* ---------- ข้อขัดข้องของฝ่าย ---------- */
const item = (id, dept, x) => Object.assign({ id, mid: 'mT1', dept, issue: 'ข้อ ' + id, rec: '', photos: [], ver: 1, by: 'ชื่อปลอม' }, x || {});
const w2 = write('thana', [{ c: 'items', op: 'put', row: item('iA', 'NB') }]);
const iA = w2.data && w2.data.items.find((i) => i.id === 'iA');
check('Editor writes an item of its own department; by/cby = the account', iA && iA.by === 'น.อ. ธนา ทดลองกิจ' && iA.cby === 'น.อ. ธนา ทดลองกิจ' && iA.cdept === 'NB', iA || w2);
check('…of another crew department: refused', ce(write('somchai', [{ c: 'items', op: 'put', row: item('iB', 'NB') }])) === 'forbidden' && ce(write('somchai', [{ c: 'items', op: 'put', row: Object.assign({}, iA, { issue: 'แก้ข้ามฝ่าย', ver: 2 }) }])) === 'forbidden');
check('Viewer writes no item', ce(write('phum', [{ c: 'items', op: 'put', row: item('iC', 'NB') }])) === 'forbidden');
const w3 = write('somchai', [{ c: 'items', op: 'put', row: item('iTG', 'TG') }]);
const iTG = w3.data && w3.data.items.find((i) => i.id === 'iTG');
check('a crew department writes for TG / พ. (proxy marked)', iTG && iTG.proxy === 'CH' && iTG.cdept === 'CH', iTG || w3);
check('Admin cannot edit another department\'s item', ce(write('chan', [{ c: 'items', op: 'put', row: item('iCH', 'CH') }])) === 'forbidden');
const w4 = write('thana', [{ c: 'items', op: 'put', row: Object.assign({}, iA, { issue: 'แก้ครั้งที่ 2', ver: 2 }) }]);
check('edit with the next version: ok, creator kept', !w4.error && w4.data.items.find((i) => i.id === 'iA').cby === 'น.อ. ธนา ทดลองกิจ');
const w5 = write('thana', [{ c: 'items', op: 'put', row: Object.assign({}, iA, { issue: 'แก้จากหน้าเก่า', ver: 5 }) }]);
check('edit from a stale page (version jump): conflict, with the current row', ce(w5) === 'conflict' && w5.error.row && w5.error.row.issue === 'แก้ครั้งที่ 2', w5);

/* ---------- ชื่อที่แต่ละคนเห็น ---------- */
const kv = sync('kitti').data;
check('Editor ส.: names on นบ. items hidden; on TG items shown', kv.items.find((i) => i.id === 'iA').by === '' && kv.items.find((i) => i.id === 'iA').cby === '' && kv.items.find((i) => i.id === 'iTG').by !== '');
check('Admin: sees every name', sync('chan').data.items.find((i) => i.id === 'iA').by === 'น.อ. ธนา ทดลองกิจ');
check('Viewer of the same department sees its names', sync('phum').data.items.find((i) => i.id === 'iA').by === 'น.อ. ธนา ทดลองกิจ');

/* ---------- การยืนยัน ---------- */
check('ack: own department only', !write('kitti', [{ c: 'acks', op: 'put', row: { mid: 'mT1', dept: 'SO' } }]).error && ce(write('kitti', [{ c: 'acks', op: 'put', row: { mid: 'mT1', dept: 'CH' } }])) === 'forbidden');
check('ack name hidden from other departments', sync('thana').data.acks.find((a) => a.mid === 'mT1' && a.dept === 'SO').by === '' && sync('chan').data.acks.find((a) => a.mid === 'mT1' && a.dept === 'SO').by !== '');

/* ---------- GSE / Catering: ทุกคน ---------- */
const EV = { id: 'eT1', kind: 'GSE', mid: 'mT1', st: 'VTBU', date: '2026-11-20', phase: 'ARR', items: { GPU: { s: 'late', min: 10 } } };
const w6 = write('phum', [{ c: 'stations', op: 'put', row: { id: 'VTBU', name: 'อู่ตะเภา', country: 'ไทย' } }, { c: 'events', op: 'put', row: EV }, { c: 'gissues', op: 'put', row: { id: 'gT1', eid: 'eT1', cat: 'GPU', issue: 'GPU มาช้า', min: 10 } }]);
check('Viewer opens a GSE record and adds an issue (everyone may)', !w6.error && w6.data.gissues.find((g) => g.id === 'gT1').by === 'น.ต. ภูมิ สาธิตพงศ์', w6);
const w7 = write('kitti', [{ c: 'gissues', op: 'put', row: { id: 'gT1', eid: 'eT1', cat: 'GPU', issue: 'GPU มาช้า (แก้)', min: 12 } }]);
const g7 = w7.data && w7.data.gissues.find((g) => g.id === 'gT1');
check('another department edits it: first author kept, last editor recorded', g7 && g7.by === 'น.ต. ภูมิ สาธิตพงศ์' && g7.editedBy === 'ร.อ. กิตติ สาธิตกุล' && g7.editedDept === 'SO', g7);
check('GSE issues sit in GSE_ISSUES', site.books[site.DBID].GSE_ISSUES.rows.length === 3);

/* ---------- ความเห็น ---------- */
check('Viewer: no comment on a department item, a comment on a GSE issue', ce(write('phum', [{ c: 'comments', op: 'put', row: { id: 'c1', t: 'i', tid: 'iA', text: 'x' } }])) === 'forbidden' && !write('phum', [{ c: 'comments', op: 'put', row: { id: 'c2', t: 'g', tid: 'gT1', text: 'ความเห็น GSE' } }]).error);
check('a comment of somebody else cannot be deleted; own can', ce(write('kitti', [{ c: 'comments', op: 'del', id: 'c2' }])) === 'forbidden' && !write('phum', [{ c: 'comments', op: 'del', id: 'c2' }]).error && !sync('phum').data.comments.some((c) => c.id === 'c2'));

/* ---------- ประวัติ ---------- */
write('thana', [{ c: 'items', op: 'put', row: item('iDel', 'NB', { issue: 'ข้อความที่เขียนแรงไป' }) }]);
const wd = write('thana', [{ c: 'items', op: 'del', id: 'iDel' }, { c: 'logs', op: 'put', row: { id: 'lD1', scope: 'NB', action: 'DELETE', target: 'ฝึกบินทดสอบ', detail: 'ลบข้อ: ข้อความที่เขียนแรงไป', owner: 'NB', user: 'ปลอม' } }]);
if (wd.error) console.log('DEL ERR', JSON.stringify(wd.error));
const lg = (k) => sync(k).data.logs;
check('log: user and time set by the server', lg('thana').find((l) => l.id === 'lD1').user === 'น.อ. ธนา ทดลองกิจ');
check('log: another crew department does not get the history of นบ.', !lg('kitti').some((l) => l.scope === 'NB'));
check('log: Admin gets every department; text of a deletion shown to Admin', lg('chan').find((l) => l.id === 'lD1').detail === 'ลบข้อ: ข้อความที่เขียนแรงไป');
check('deleted item: gone from the page, row kept in the sheet (soft delete)', !sync('thana').data.items.some((i) => i.id === 'iDel') && JSON.stringify(site.books[site.DBID].ITEMS_NB.rows).includes('deleted_at'));
write('somchai', [{ c: 'items', op: 'put', row: item('iTG2', 'TG', { issue: 'ข้อ TG ที่จะลบ' }) }]);
write('somchai', [{ c: 'items', op: 'del', id: 'iTG2' }, { c: 'logs', op: 'put', row: { id: 'lD2', scope: 'TG', action: 'DELETE', detail: 'ลบข้อ: ข้อ TG ที่จะลบ', owner: 'CH' } }]);
check('deleted text in TG history: hidden from ส., shown to ช. (author) and Admin', lg('kitti').find((l) => l.id === 'lD2').detail === '' && lg('somchai').find((l) => l.id === 'lD2').detail !== '' && lg('chan').find((l) => l.id === 'lD2').detail !== '');
check('Viewer cannot log an export', ce(write('phum', [{ c: 'logs', op: 'put', row: { id: 'lX', scope: 'NB', action: 'EXPORT_PDF', detail: 'x' } }])) === 'forbidden');

/* ---------- รูปภาพ ---------- */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const w8 = write('thana', [{ c: 'items', op: 'put', row: item('iP', 'NB', { photos: [PNG] }) }]);
const ph = w8.data && w8.data.items.find((i) => i.id === 'iP').photos[0];
check('a photo goes to Drive (folder ปีงบ / ภารกิจ), the item keeps drive:<id>', /^drive:D/.test(ph || '') && Object.values(site.drive.folders).some((f) => f.name === '2570') && Object.values(site.drive.folders).some((f) => /^mT1 /.test(f.name)), w8.error || ph);
const pr = aarPost({ action: 'photo', pass: P.kitti, id: ph });
check('the photo is served to a signed-in person', pr.src && pr.src.startsWith('data:image/png;base64,'), pr.error);
check('a Drive file not used by this system is not served', ce(aarPost({ action: 'photo', pass: P.kitti, id: 'drive:' + 'A'.repeat(30) })) === 'not_found');
check('a photo of another item cannot be borrowed', ce(write('thana', [{ c: 'items', op: 'put', row: item('iQ', 'NB', { photos: [ph] }) }])) === 'forbidden');

/* ---------- ยศแยกจากชื่อ ---------- */
const mr = site.books[site.DBID].MISSIONS.rows, head = mr[0];
const col = (k) => head.indexOf(k);
const rowT1 = mr.find((r) => r[0] === 'mT1');
check('sheet: rank and name of the recorder in separate columns', rowT1[col('ยศ ผู้บันทึก')] === 'ร.อ.' && rowT1[col('ชื่อ-สกุล ผู้บันทึก')] === 'กิตติ สาธิตกุล', [head, rowT1]);
write('chan', [{ c: 'missions', op: 'put', row: Object.assign({}, NEWM, { mc: ['น.ต.วีรวิท'], amc: ['ร.อ.ศุภกร', 'ร.ท. พิชญะ'] }) }]);
const rowT1b = site.books[site.DBID].MISSIONS.rows.find((r) => r[0] === 'mT1');
check('sheet: MC / ผู้ช่วย MC rank and name in separate columns (typed without a space too)', rowT1b[col('ยศ MC')] === 'น.ต.' && rowT1b[col('ชื่อ MC')] === 'วีรวิท' && rowT1b[col('ยศ ผู้ช่วย MC')] === 'ร.อ., ร.ท.' && rowT1b[col('ชื่อ ผู้ช่วย MC')] === 'ศุภกร, พิชญะ', rowT1b);
check('page data: MC tidied to "ยศ ชื่อ"', sync('phum').data.missions.find((m) => m.id === 'mT1').mc[0] === 'น.ต. วีรวิท');
check('usernames of other people are not sent to the page; own is', sync('phum').data.missions.find((m) => m.id === 'mT1').byUser === '' && sync('kitti').data.missions.find((m) => m.id === 'mT1').byUser === 'kitti_s');
const li = site.books[site.DBID].ITEMS_NB.rows; const ih = li[0];
check('items: rank / name of the author in separate columns', li.some((r) => r[ih.indexOf('ยศ ผู้กรอก')] === 'น.อ.' && r[ih.indexOf('ชื่อ-สกุล ผู้กรอก')] === 'ธนา ทดลองกิจ'));
const lgr = site.books[site.DBID].LOG.rows; const lh = lgr[0];
check('history: rank / name separate', lgr.some((r) => r[lh.indexOf('ยศ')] === 'น.อ.' && r[lh.indexOf('ชื่อ-สกุล')] === 'ธนา ทดลองกิจ'));
check('ownership by username: a mission still belongs to the one who opened it after a promotion', vm.runInContext(`(() => { const m = load_(true).missions.find((x) => x.id === 'mT1');
  return isMine_(Object.assign({}, m, { by: 'น.ท. กิตติ สาธิตกุล' }), 'by', { user: 'kitti_s', name: 'น.ท. กิตติ สาธิตกุล' }) && !isMine_(m, 'by', { user: 'thana_t', name: m.by }); })()`, site.ctx));

console.log('errors: ' + JSON.stringify(bad));
process.exit(bad.length ? 1 : 0);
