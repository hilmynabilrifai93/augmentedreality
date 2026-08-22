# Menjalankan kamera WebAR di Chrome Android

Chrome membatasi akses kamera untuk halaman yang berada pada **secure context**. Karena itu alamat seperti `http://192.168.x.x:8000` dari HP biasanya tidak dapat membuka kamera.

## Opsi tercepat tanpa hosting: USB + ADB reverse

1. Aktifkan **Developer options** dan **USB debugging** di Android.
2. Sambungkan HP ke laptop menggunakan kabel USB.
3. Pastikan `adb` tersedia. Jika pernah menginstal Android Build Support/SDK dari Unity Hub, `adb.exe` ada di folder Android SDK `platform-tools`.
4. Jalankan `start-android-usb.bat`.
5. Izinkan dialog USB debugging di HP.
6. Script membuat tunnel `adb reverse` lalu membuka `http://localhost:8000` di HP.
7. Di Chrome Android tekan **Aktifkan Kamera AR** dan beri izin kamera.
8. Tampilkan atau cetak `assets/climate-qr-marker.png`, lalu arahkan kamera ke kartu biru pada area scan.

Karena alamat yang dibuka di HP adalah `localhost`, browser dapat memperlakukannya sebagai konteks lokal untuk pengujian kamera.

## Opsi produksi

Deploy folder ini ke hosting HTTPS seperti GitHub Pages, Netlify, Vercel, Cloudflare Pages, atau hosting sekolah sendiri dengan HTTPS. Setelah deploy, buka URL HTTPS tersebut dari Android.

## Troubleshooting

- **Kamera tidak muncul:** cek Site settings > Camera di Chrome dan pastikan izin aktif.
- **Marker tidak terkunci:** perbesar marker, pastikan pencahayaan cukup, hindari pantulan, dan usahakan marker terlihat penuh di kamera.
- **Model berat/HP lambat:** tambahkan `?quality=lite` pada URL, contoh `http://localhost:8000/?quality=lite`.
- **ADB unauthorized:** cabut/pasang ulang USB lalu izinkan dialog fingerprint debugging di HP.
