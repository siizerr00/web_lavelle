# Studio Lavelle — Booking Site

Website statis (HTML/CSS/JS murni, tanpa framework/build step) untuk booking foto Studio Lavelle.
Backend/database ada di **Google Apps Script + Google Sheets** (bukan di repo ini — dipanggil lewat `CONFIG.API_URL` di dalam file HTML).

## Struktur folder

```
lavelle-booking/
├── index.html          → halaman utama (client booking) — jadi domain.com/
├── fotografer/
│   └── index.html      → halaman login fotografer — jadi domain.com/fotografer
├── vercel.json          → konfigurasi biar URL bersih (tanpa .html)
└── README.md
```

## Cara deploy ke Vercel

1. Buat repo baru di GitHub, upload semua file & folder ini dengan struktur yang sama persis (jangan diubah nama foldernya).
2. Di Vercel: **Add New Project** → pilih repo ini.
3. Framework Preset: pilih **Other** (jangan Next.js). Build Command & Output Directory dikosongkan saja — Vercel otomatis serve file statis ini apa adanya.
4. Klik **Deploy**.

Tidak perlu environment variable apapun karena `API_URL` (link Apps Script) sudah tertanam langsung di dalam file HTML.

## Kalau nanti update link Apps Script

Cari baris `const CONFIG = {` di kedua file (`index.html` dan `fotografer/index.html`), lalu ganti nilai `API_URL`.
