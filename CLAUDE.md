# AAR · After Action Review ฝูง.602 — คู่มือสำหรับผู้แก้โค้ด

**ตอบผู้ใช้เป็นภาษาไทยเสมอ** ผู้ใช้เป็นเจ้าหน้าที่ของ ฝูง.602 ไม่ใช่โปรแกรมเมอร์

> repo นี้เป็นสาธารณะ (GitHub Pages) **ห้ามใส่**: ลิงก์/รหัสชีตหรือโฟลเดอร์จริง ที่อยู่ระบบ Login ชื่อคนจริง ข้อมูลภารกิจจริง
> ค่าเหล่านี้อยู่ใน `SETUP` ที่ผู้ใช้กรอกในหน้า Apps Script และใน Script Properties เท่านั้น
> `config.js` บน GitHub มีที่อยู่ Apps Script ของผู้ใช้ **อย่าเขียนทับ**
> push ขึ้น branch แล้วเปิด pull request ให้ผู้ใช้กด Merge ห้าม push ขึ้น `main` เอง

## โครงสร้าง

| ไฟล์ | ทำอะไร |
|---|---|
| `index.html` | หน้าเว็บทั้งหมด (มาจากต้นแบบ Version4) ข้อมูลอยู่ใน `S` แก้แล้วเรียก `save()` |
| `api.js` | `window.AAR`: บัตรผ่านจาก `App.enterWeb(webCode)`, `sync` ทุก 15 วินาที, `push()` ส่งเฉพาะรายการที่เปลี่ยน (เทียบกับสำเนาล่าสุดของเซิร์ฟเวอร์), รูปจาก Drive (`photoSrc`), กันปิดหน้าระหว่างบันทึก |
| `config.js` | `webCode: 'WEB15'`, `apiUrl` (ผู้ใช้วางเอง) |
| `apps-script/Code.gs` | ระบบหลังบ้าน (บัญชีหลัก) |
| `apps-script-backup/Backup.gs` | สำรองชีตทุกคืน (บัญชีสำรอง) 30 วัน + วันที่ 1 ของเดือน 12 เดือน |
| `test/aar_serve.mjs` | ระบบทั้งชุดบนเครื่อง: eadmin ตัวจริงบน gas_sim + Code.gs บนตัวจำลอง + หน้าเว็บ |
| `test/aar_api.mjs` | ทดสอบสิทธิ์ทุกข้อของระบบหลังบ้าน |

## ส่วนที่เป็นของระบบ Login (ห้ามถอด)

- `index.html` โหลด `/eadmin/assets/config.js`, `/eadmin/assets/app.js` ก่อน `config.js`, `api.js` และ `/app/back.js` ท้ายไฟล์ (แถบ OPS 602 ห้ามทำปุ่มกลับหน้ารวมซ้ำ)
- ท้าย `index.html`: ไม่มีการ Login → `App.toLogin()` · มีแล้ว → `App.watch()` → `startApp()` · `app-denied`, `app-auth-lost`
- หน้าเว็บไม่ส่ง session ไป Apps Script ส่งแค่ pass · Code.gs ถาม `web.check` ทุกคำขอ (`write` ถามใหม่ทุกครั้ง อ่านอย่างเดียว cache 60 วินาที)

## กติกาสิทธิ์ (ตรวจที่ `applyOp_` / `view_` ใน Code.gs · หน้าเว็บมีสำเนาไว้แสดงปุ่ม)

- ฝ่าย = คอลัมน์ ตำแหน่งงาน (`deptOfPos_`) · Role = สิทธิ์เว็บ WEB15
- ภารกิจ: เปิดได้ Editor/Admin · แก้: Admin ทุกภารกิจ, Editor เฉพาะที่ตัวเองเปิด · ลบ: Admin
- ข้อของฝ่าย: Editor/Admin ของฝ่ายนั้น · นบ. ช. ส. ขสอ. พบ. กรอกแทน TG และ พ. ได้ · Admin แก้ข้อของฝ่ายอื่นไม่ได้ · version กันแก้ทับ (`conflict`)
- ยืนยัน "ไม่มีข้อขัดข้อง": เฉพาะฝ่ายตัวเอง
- GSE / Catering / ผู้ให้บริการ / ข้อแนะนำ Station: ทุกคนรวม Viewer · คนกรอกครั้งแรกคงไว้ + `editedBy`
- ความเห็น: ข้อของฝ่าย Editor/Admin · ข้อ GSE ทุกคน · ลบได้เฉพาะของตัวเอง
- ชื่อคนกรอก/แก้/ยืนยัน: Admin เห็นทุกฝ่าย · Editor/Viewer เห็นฝ่ายตัวเอง + TG + พ. · GSE/ความเห็นทุกคนเห็น
- ประวัติ: ฝ่ายตัวเอง + TG + พ. + GSE + Catering · Editor/Admin + การเปิด/แก้ภารกิจ · Admin ทุกฝ่าย · ข้อความของรายการที่ลบ เห็นเฉพาะฝ่ายเจ้าของ/Admin (GSE/Catering ทุกคน)
- ลบ = ลบแบบซ่อน (`deleted_at`) แถวยังอยู่ในชีต รูปยังอยู่ใน Drive
- Export: Editor/Admin (หน้าเว็บ) บันทึกลงประวัติ · Viewer ส่งออกไม่ได้ (ปุ่มไม่มี และ log ถูกปฏิเสธ)

## ข้อมูลในชีต

ไฟล์เดียวทุกปีงบ แต่ละแท็บ: คอลัมน์อ่านง่าย + `json` (ระบบอ่านจาก json เท่านั้น) · คอลัมน์ `fy` = ปีงบ พ.ศ. (ต.ค. ขึ้นปีใหม่)
แท็บ: MISSIONS, ITEMS_NB/CH/SO/KSO/PB/TG/MD, ACKS, COMMENTS, GSE_EVENTS, CAT_EVENTS, GSE_ISSUES, CAT_ISSUES, PROVIDERS, NOTES, STATIONS, LISTS, LOG
รูป: โฟลเดอร์รูป / ปีงบ / `<รหัสภารกิจ> <ชื่อ>` (ระบบสร้างเอง) ข้อมูลเก็บ `drive:<id>` และส่งรูปผ่าน action `photo` เฉพาะรูปที่อยู่ในข้อมูล

## ทดสอบ

    EADMIN_DIR=../eadmin APP_DIR=../app node test/aar_api.mjs          # ระบบหลังบ้าน (ไม่ต้องติดตั้งอะไรเพิ่ม)
    EADMIN_DIR=../eadmin APP_DIR=../app PORT=8765 node test/aar_serve.mjs   # เปิดระบบทั้งชุด ใช้กับชุดทดสอบเบราว์เซอร์

ตัวจำลองไม่รู้เรื่องโควตาและความเร็วจริงของ Google · ยังไม่เคยรันบน Google จริง (15 พ.ย. 2026)
