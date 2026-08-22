# SYSTEM TESTS — FIXED V9

## Static checks
- `node --check app.js` ✅
- `node --check ar-cartoon.js` ✅
- Tidak ada duplicate HTML ID ✅
- Semua DOM ID yang direferensikan `app.js` dan `ar-cartoon.js` tersedia di `index.html` ✅
- Semua local asset reference utama tersedia ✅
- CSS opening/closing braces seimbang ✅
- `assets/climate-qr.mind.png` yang salah sudah dihapus ✅
- Project tidak lagi membutuhkan file lokal `assets/climate-qr.mind` ✅
- `assets/climate-qr-marker.png` tersedia ✅

## Sistem yang dipertahankan/diperbaiki
- Kamera menggunakan localhost/HTTPS ✅
- Feed kamera + transparent Three.js canvas ✅
- 5 tahap cerita ✅
- Jalan foreground dan kendaraan bergerak ✅
- Drag/drop 5 jenis solusi ✅
- Object hasil drag tetap hidup saat pemulihan ✅
- Jalan tetap muncul pada dunia pulih ✅
- Marker hilang sementara tidak me-reset progres scene ✅

## Device test
Camera permission, WebGL/GPU, tracking marker, dan performa tetap harus diuji pada HP/laptop target karena bergantung perangkat/browser.
