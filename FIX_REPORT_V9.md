# Climate AR FIXED V9 — Repair Report

## Diperbaiki
- File salah `assets/climate-qr.mind.png` dihapus. Itu PNG, bukan file `.mind`.
- Project tidak lagi mencari `assets/climate-qr.mind` yang tidak ada.
- Tracking memakai target resmi MindAR `card.mind`, yang cocok dengan kartu SoftMind pada marker.
- Dibuat `assets/climate-qr-marker.png` baru dengan area tracking besar agar lebih mudah dikenali.
- Modal marker dan halaman cetak memakai marker yang sama.
- Pesan error kamera/AR dibedakan: permission, kamera tidak ada, kamera sibuk, secure context, timeout.
- Script Android dan dokumentasi marker diperbarui.
- Fix 3D, jalan, drag/drop, recovery, dan animasi dari project upload dipertahankan.

## Tes
1. Jalankan `start-local.bat`.
2. Preview 3D harus berjalan.
3. Klik Aktifkan Kamera.
4. Scan `assets/climate-qr-marker.png`, fokus ke kartu biru besar.
5. Android: gunakan `start-android-usb.bat` atau hosting HTTPS/Cloudflare.

Catatan: Three.js dan MindAR masih berasal dari CDN, jadi koneksi internet diperlukan.
