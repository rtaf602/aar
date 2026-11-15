/**
 * AAR · Backup อัตโนมัติทุกคืน — ติดตั้งด้วย "บัญชีสำรอง" (นอกบัญชีหลัก) ไม่ใช่บัญชีหลัก
 * ------------------------------------------------------------------
 * ทำไมต้องเป็นบัญชีสำรอง: ไฟล์ที่สคริปต์คัดลอกเป็นของบัญชีที่รันสคริปต์ ถ้ารันด้วยบัญชีหลัก
 * แล้ววันหนึ่งบัญชีหลักถูกลบหรือถูกล็อก ไฟล์สำรองจะหายไปด้วย
 *
 * ติดตั้ง (ดู SETUP_TH.md ข้อ 5)
 *  1. บัญชีหลักแชร์ชีต AAR DATABASE ให้บัญชีสำรองเป็น "ผู้มีสิทธิ์อ่าน" (Viewer) ก็พอ
 *  2. บัญชีสำรองเปิด script.google.com → New project → วางไฟล์นี้
 *  3. กรอก SETUP ด้านล่าง (ในหน้า Apps Script เท่านั้น อย่า commit ค่าจริง) แล้ว Run setup หนึ่งครั้ง
 *     ระบบตั้งเวลาให้ทำงานทุกคืนราว 02:00 น. เอง
 *
 * เก็บอะไร: สำเนาชีตทั้งไฟล์ (ไม่รวมรูปภาพ) ชื่อ "AAR DATABASE · backup yyyy-MM-dd"
 *  - รายวัน: เก็บย้อนหลัง 30 วัน
 *  - ไฟล์ของวันที่ 1 ทุกเดือน: เก็บ 12 เดือน
 *  - ไฟล์ที่เก่ากว่านั้นถูกย้ายไปถังขยะเอง (กู้ได้อีก 30 วัน) · ลบเฉพาะไฟล์ที่ระบบนี้สร้าง
 *  - ไม่สำเร็จ: ส่งอีเมลแจ้งบัญชีสำรอง
 */

const SETUP = {
  dbSheet: '',       // ลิงก์ชีต AAR DATABASE (ไฟล์ต้นทาง)
  backupFolder: '',  // ลิงก์โฟลเดอร์ Backup ของบัญชีสำรอง
};
const KEEP_DAYS = 30, KEEP_MONTHS = 12, TZ = 'Asia/Bangkok', PREFIX = 'AAR DATABASE · backup ';

function idOf_(v) { const m = /[-\w]{25,}/.exec(String(v || '')); return m ? m[0] : ''; }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

/** Run ครั้งเดียว: จำค่า ตั้งเวลาทุกคืน และสำรองครั้งแรกทันที */
function setup() {
  const p = PropertiesService.getScriptProperties();
  const db = idOf_(SETUP.dbSheet) || prop_('DB_ID'), fd = idOf_(SETUP.backupFolder) || prop_('FOLDER_ID');
  if (!db) throw new Error('ยังไม่ได้กรอก SETUP.dbSheet');
  if (!fd) throw new Error('ยังไม่ได้กรอก SETUP.backupFolder');
  DriveApp.getFileById(db).getName();     // ขอสิทธิ์ และตรวจว่าเปิดไฟล์ต้นทางได้
  DriveApp.getFolderById(fd).getName();
  p.setProperty('DB_ID', db); p.setProperty('FOLDER_ID', fd);
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('nightlyBackup').timeBased().atHour(2).everyDays(1).inTimezone(TZ).create();
  nightlyBackup();
  Logger.log('ตั้งค่าเสร็จ: สำรองทุกคืนราว 02:00 น. · ทำสำเนาแรกแล้ว');
}

function nightlyBackup() {
  try {
    const src = DriveApp.getFileById(prop_('DB_ID')), folder = DriveApp.getFolderById(prop_('FOLDER_ID'));
    const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), name = PREFIX + today;
    const same = folder.getFilesByName(name);
    while (same.hasNext()) same.next().setTrashed(true);           // รันซ้ำในวันเดียวกัน: เก็บฉบับล่าสุด
    src.makeCopy(name, folder);
    cleanup_(folder, today);
  } catch (x) {
    const me = Session.getEffectiveUser().getEmail();
    if (me) MailApp.sendEmail(me, 'AAR: สำรองข้อมูลไม่สำเร็จ', 'สำรองชีต AAR DATABASE ไม่สำเร็จเมื่อ ' + new Date() + '\nสาเหตุ: ' + (x && x.message) + '\n\nตรวจว่าบัญชีนี้ยังเปิดชีตต้นทางได้ และโฟลเดอร์ Backup ยังอยู่');
    throw x;
  }
}

/** เก็บรายวัน 30 วัน + วันที่ 1 ของเดือน 12 เดือน · ลบเฉพาะไฟล์ชื่อขึ้นต้นด้วย PREFIX ตามด้วยวันที่ */
function cleanup_(folder, today) {
  const t = new Date(today + 'T00:00:00Z').getTime(), DAY = 86400000;
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next(), n = f.getName();
    if (n.indexOf(PREFIX) !== 0) continue;
    const d = n.slice(PREFIX.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const age = Math.round((t - new Date(d + 'T00:00:00Z').getTime()) / DAY);
    if (age < KEEP_DAYS) continue;
    if (d.slice(8) === '01') {
      const months = (Number(today.slice(0, 4)) - Number(d.slice(0, 4))) * 12 + (Number(today.slice(5, 7)) - Number(d.slice(5, 7)));
      if (months < KEEP_MONTHS) continue;
    }
    f.setTrashed(true);
  }
}
