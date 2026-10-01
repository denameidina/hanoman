# Plan QA ramah pemula dan Excel

- [x] Implementasikan codec workbook dengan panduan dan validasi semua sheet.
- [x] Hubungkan template XLSX, impor XLSX + berkas pendamping, dan ZIP Excel + lampiran ke pipeline transfer yang ada.
- [x] Rapikan editor, label test case/temuan, input lingkungan, serta dialog impor dengan petunjuk lampiran.
- [x] Perbarui kontrak/panduan dan index; verifikasi round-trip, UI, typecheck, dan smoke endpoint.

Verifikasi: 60 test pada 6 berkas lulus dengan DB terisolasi dan file serial, typecheck server/app/shared, smoke HTTP localhost untuk template dan impor Excel + screenshot. Browser visual belum terverifikasi: runtime browser gagal memulai app-server lokal.
