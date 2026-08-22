# Climate AR — FUN CARTOON WEBAR V6

Versi ini merombak V5 agar pengalaman AR lebih mirip "dunia kecil keluar dari kertas" dan lebih menyenangkan untuk siswa SD, SMP, sampai SMA.

## Perubahan utama
- Mode **Live AR** memenuhi layar ponsel agar kamera tetap menjadi latar utama seperti demo AR dunia nyata.
- Reticle tracking memandu pengguna sampai image marker terkunci, lalu menghilang otomatis.
- Kontrol cerita ringkas tampil langsung di atas kamera: Alam → Industri → Emisi → Pemulihan.
- Perpindahan tahap memakai transisi sinematik tanpa me-reset sudut pandang, zoom, atau progres pengguna.
- Rak aset pemulihan tetap dapat digunakan sebagai panel terapung dalam mode layar penuh.
- Pose marker distabilkan: pitch dan roll dikunci, sedangkan gerakan/yaw kiri-kanan tetap mengikuti kamera secara halus.
- Diorama memakai framing lebih lebar, background pop-up per kondisi, dan zona aman agar aset tidak saling menembus.
- Setelah kombinasi solusi pemulihan tercapai, adegan kelima **Lingkungan Pulih** muncul dengan efek pop-up baru.
- Diorama 3D dibuat ulang dengan gaya **stylized cartoon 3D** yang konsisten.
- Marker hybrid `assets/climate-qr-marker.png` memakai kartu SoftMind berukuran besar di tengah supaya tracking lebih mudah, ditambah elemen QR sebagai penanda visual.
- Saat marker ditemukan, dunia 3D memakai **pop-up / reveal animation**: model berawal datar lalu tumbuh ke atas dari permukaan kertas.
- Area kamera/3D dibuat bersih. Informasi tahap, emisi, dan tombol cerita ditempatkan **di luar viewport 3D**.
- Navigasi utama berupa **bottom dock** pada desktop, Android, dan iOS. Tombol **Scan Marker** berada di tengah.
- 1 jari: rotate 360 derajat.
- 2 jari: pinch zoom.
- Tahap 4 menggunakan **drag & drop model 3D sungguhan**, bukan drag teks:
  - Panel Surya;
  - Ruang Hijau;
  - Mobil Listrik;
  - Hemat Air;
  - Kelola Sampah;
  - preview/ghost berasal dari render model 3D dan objek final tetap dapat dipindahkan lagi.
- Sungai, pohon, semak, rumah, jalan, mobil, pabrik, cerobong, asap, tanah rusak, panel surya, dan turbin dibuat sebagai geometri 3D aktual.
- Preview 3D mensimulasikan meja dan kertas marker agar konsep pop-up terlihat tanpa kamera.

## Menjalankan di laptop
Jalankan:
- `start-local.bat`
- buka alamat localhost
- pilih **Preview 3D** untuk pengujian tanpa kamera.

## Kamera Android lokal
1. Aktifkan Developer Options + USB Debugging.
2. Hubungkan Android ke laptop.
3. Jalankan `start-android-usb.bat`.
4. Izinkan debugging USB jika muncul.
5. Browser Android membuka localhost melalui `adb reverse`.
6. Tekan tombol tengah **Scan Marker**.
7. Arahkan kamera ke kartu biru SoftMind pada marker.

## iPhone / iPad
Safari membutuhkan halaman HTTPS untuk kamera. Deploy folder ini ke hosting HTTPS (misalnya GitHub Pages, Netlify, Vercel, atau hosting sekolah), lalu buka URL tersebut di Safari dan berikan izin kamera.

## Marker
- Marker utama untuk pengalaman live: `assets/climate-qr-marker.png`
- Target mentah kompatibel MindAR: `assets/mindar-marker.png`
- Halaman cetak: `print-marker.html`

## Catatan tracking
Versi ini sengaja mempertahankan target MindAR SoftMind yang sudah terkompilasi. Marker dekoratif menempatkan target tersebut cukup besar di tengah. Saat scan, arahkan kamera terutama ke area biru tersebut.

## File utama
- `index.html`
- `styles.css`
- `app.js`
- `ar-cartoon.js`
- `print-marker.html`


## FIX V9 — Marker
Tracking tidak lagi mencari `assets/climate-qr.mind`. Target memakai file resmi MindAR SoftMind dari CDN. Marker hybrid `assets/climate-qr-marker.png` menampilkan kartu target berukuran besar di tengah.
