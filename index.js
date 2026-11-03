const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config.js');

const app = express();
app.use(cors());
app.use(express.json());

// Inisialisasi Supabase
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);

// Helper: Konversi jam 'HH:MM:SS' ke detik untuk cek overlap
const toSeconds = (time) => {
  if (!time) return 0;
  const [h, m, s] = time.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
};

// Helper: Konversi detik ke format 'HH:MM:SS'
const toTimeString = (totalSeconds) => {
  const h = Math.floor(totalSeconds / 3600) % 24;
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
};

// =====================================================================
// 1. ENDPOINT ADMIN WA
// =====================================================================
app.get('/api/admin-wa', async (req, res) => {
  try {
    const { data, error } = await supabase.from('admin_wa').select('kota, wa_number');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// 2. ENDPOINT PRICELIST & MEDIA
// =====================================================================
app.get('/api/pricelist', async (req, res) => {
  const { kota } = req.query;
  try {
    const [resPricelist, resMedia] = await Promise.all([
      supabase.from('pricelist').select('*').eq('kota', kota),
      supabase.from('pricelist_media').select('*').eq('kota', kota).order('urutan')
    ]);

    if (resPricelist.error) throw resPricelist.error;
    if (resMedia.error) throw resMedia.error;

    res.json({
      paket: resPricelist.data || [],
      media: resMedia.data || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// 3. ENDPOINT ADD-ON
// =====================================================================
app.get('/api/addon', async (req, res) => {
  const { kota } = req.query;
  try {
    const { data, error } = await supabase
      .from('addon')
      .select('*')
      .eq('kota', kota)
      .eq('aktif', true)
      .order('urutan');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// 4. ENDPOINT KALENDER BULANAN (Mengecek Tanggal Tersedia/Full)
// =====================================================================
app.get('/api/kalender', async (req, res) => {
  const { kota, bulan_mulai, jumlah_hari } = req.query;
  try {
    const startDate = `${bulan_mulai}-01`;
    const endDate = `${bulan_mulai}-${String(jumlah_hari).padStart(2, '0')}`;

    // Ambil semua jadwal yang sudah dibooking di bulan tersebut
    const { data: bookings, error } = await supabase
      .from('bookings') // Sesuaikan dengan nama tabel booking Anda
      .select('tanggal, jam_mulai, jam_selesai')
      .eq('kota', kota)
      .gte('tanggal', startDate)
      .lte('tanggal', endDate);

    if (error) throw error;

    // Kembalikan data mentah. Frontend akan menganggap semua tanggal tersedia,
    // dan mengecek jamnya saat tanggal di-klik.
    res.json({ data: bookings || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// 5. ENDPOINT SLOT TERSEDIA (Menggantikan RPC get_slot_tersedia)
// =====================================================================
app.get('/api/slots', async (req, res) => {
  const { kota, tanggal } = req.query;
  try {
    const { data: booked, error } = await supabase
      .from('bookings')
      .select('jam_mulai, jam_selesai')
      .eq('kota', kota)
      .eq('tanggal', tanggal);

    if (error) throw error;

    // 🚨 PENTING: Sesuaikan sesiStandar ini dengan Jam Operasional Studio Lavelle Anda!
    // Saat ini menggunakan contoh per 1 jam dari jam 08:00 sampai 16:00.
    const sesiStandar = [
      { mulai: '08:00:00', selesai: '09:00:00' },
      { mulai: '09:00:00', selesai: '10:00:00' },
      { mulai: '10:00:00', selesai: '11:00:00' },
      { mulai: '11:00:00', selesai: '12:00:00' },
      { mulai: '13:00:00', selesai: '14:00:00' },
      { mulai: '14:00:00', selesai: '15:00:00' },
      { mulai: '15:00:00', selesai: '16:00:00' },
    ];

    // Filter sesi yang bentrok dengan jadwal yang sudah ada
    const tersedia = sesiStandar.filter(sesi => {
      const mulaiBaru = toSeconds(sesi.mulai);
      const selesaiBaru = toSeconds(sesi.selesai);

      const bentrok = booked.some(b => {
        const mulaiLama = toSeconds(b.jam_mulai);
        const selesaiLama = toSeconds(b.jam_selesai);
        // Rumus Overlap
        return (mulaiBaru < selesaiLama) && (selesaiBaru > mulaiLama);
      });

      return !bentrok;
    });

    res.json(tersedia.map(s => ({ jam_mulai: s.mulai, jam_selesai: s.selesai })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// 6. ENDPOINT CEK SLOT ADD-ON (Jika durasi foto ditambah)
// =====================================================================
app.post('/api/cek-slot-addon', async (req, res) => {
  const { p_kota, p_tanggal, p_jam_mulai, p_jam_selesai_slot, p_durasi_tambahan_menit } = req.body;
  try {
    const { data: booked, error } = await supabase
      .from('bookings')
      .select('jam_mulai, jam_selesai')
      .eq('kota', p_kota)
      .eq('tanggal', p_tanggal);

    if (error) throw error;

    const mulaiBaru = toSeconds(p_jam_mulai);
    const selesaiBaru = toSeconds(p_jam_selesai_slot) + (p_durasi_tambahan_menit * 60);

    const bentrok = booked.some(b => {
      const mulaiLama = toSeconds(b.jam_mulai);
      const selesaiLama = toSeconds(b.jam_selesai);
      return (mulaiBaru < selesaiLama) && (selesaiBaru > mulaiLama);
    });

    if (bentrok) {
      return res.json({ tersedia: false, alasan: 'Slot berikutnya sudah terisi' });
    }
    
    res.json({ tersedia: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// 7. ENDPOINT SUBMIT BOOKING
// =====================================================================
app.post('/api/booking', async (req, res) => {
  const {
    p_kota, p_tanggal, p_jam_mulai, p_jam_selesai,
    p_nama_client, p_kampus, p_lokasi, p_paket, p_total_harga,
    p_wa, p_instagram, p_email, p_addon_list, p_total_addon, p_durasi_total_menit
  } = req.body;

  try {
    // 1. Generate Kode Booking (Contoh: LVL-28112026-123)
    const dateStr = p_tanggal.replace(/-/g, '');
    const randomNum = Math.floor(Math.random() * 900) + 100;
    const booking_id = `LVL-${dateStr}-${randomNum}`;

    // 2. Insert ke Tabel bookings
    const { data, error } = await supabase
      .from('bookings') // Sesuaikan dengan nama tabel asli Anda
      .insert([{
        booking_id: booking_id,
        kota: p_kota,
        tanggal: p_tanggal,
        jam_mulai: p_jam_mulai,
        jam_selesai: toTimeString(toSeconds(p_jam_selesai) + (p_durasi_total_menit - 60) * 60), // Sesuaikan jam selesai dengan durasi total
        nama_client: p_nama_client,
        kampus: p_kampus,
        lokasi: p_lokasi,
        paket: p_paket,
        total_harga: p_total_harga,
        wa: p_wa,
        instagram: p_instagram,
        email: p_email,
        addon_list: p_addon_list, // Pastikan kolom di Supabase bertipe JSONB
        total_addon: p_total_addon,
        durasi_total_menit: p_durasi_total_menit,
        status: 'pending',
        created_at: new Date().toISOString()
      }])
      .select();

    if (error) throw error;

    // 3. Kembalikan response sukses ke Frontend
    res.json({
      booking_id: booking_id,
      tanggal: p_tanggal,
      jam_mulai: p_jam_mulai,
      jam_selesai: data[0].jam_selesai,
      total_harga: p_total_harga,
      expired_in: '24 jam'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Jalankan Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend Lavelle berjalan di http://localhost:${PORT}`);
});
