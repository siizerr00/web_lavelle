/* ============================================================
   MAPS.JS - Studio Lavelle
   Sistem peta, autocomplete, dan hitung jarak transport
   Menggunakan OpenStreetMap (Leaflet + Nominatim + OSRM) - 100% GRATIS
   
   Konfigurasi radius & biaya:
   - Jogja    : > 7 KM  → Rp 30.000
   - Solo     : > 7 KM  → Rp 30.000
   - Surabaya : > 10 KM → Rp 30.000
   ============================================================ */
(function () {
  'use strict';

  // ============================================================
  // KONFIGURASI TITIK 0 & RADIUS PER KOTA
  // ============================================================
  var KONFIG_KOTA = {
  Jogja: {
    lat: -7.771278,
    lng: 110.377722,
    nama: 'Universitas Gadjah Mada',
    batas_gratis_meter: 7000,
    biaya_transport: 30000,
    region: 'Yogyakarta'
  },
  Solo: {
    lat: -7.568475,
    lng: 110.823998,
    nama: 'Bundaran Gladag Solo',
    batas_gratis_meter: 7000,
    biaya_transport: 30000,
    region: 'Jawa Tengah'
  },
  Surabaya: {
    lat: -7.245930,
    lng: 112.737853,
    nama: 'Tugu Pahlawan Surabaya',
    batas_gratis_meter: 10000,
    biaya_transport: 30000,
    region: 'Jawa Timur'
  }
};

  // ============================================================
  // STATE INTERNAL
  // ============================================================
  var map = null;
  var markerTitik0 = null;
  var markerLokasi = null;
  var garisRute = null;
  var kotaAktif = null;
  var debounceTimer = null;
  var selectedLocation = null;
  var mapInitialized = false;

  function getKonfig() {
    return kotaAktif ? KONFIG_KOTA[kotaAktif] : null;
  }

  // ============================================================
  // ICON CUSTOM MARKER
  // ============================================================
  function buatIcon(emoji, warna) {
    return L.divIcon({
      html: '<div style="' +
        'background:' + warna + ';' +
        'width:38px;height:38px;' +
        'border-radius:50%;' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-size:18px;' +
        'border:3px solid white;' +
        'box-shadow:0 2px 10px rgba(0,0,0,0.3);' +
        '">' + emoji + '</div>',
      className: '',
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });
  }

  // ============================================================
  // INIT PETA
  // ============================================================
  function initMap(kota) {
    if (!kota || !KONFIG_KOTA[kota]) {
      console.warn('⚠️ Kota tidak valid untuk peta:', kota);
      return;
    }

    kotaAktif = kota;
    var konfig = KONFIG_KOTA[kota];

    if (mapInitialized && map) {
      map.setView([konfig.lat, konfig.lng], 13);
      if (markerTitik0) {
        markerTitik0.setLatLng([konfig.lat, konfig.lng]);
        markerTitik0.setPopupContent('<b>' + konfig.nama + '</b><br>Titik Pusat ' + kota);
      }
      resetLokasi();
      return;
    }

    map = L.map('mapLokasi', {
      zoomControl: true,
      scrollWheelZoom: true
    }).setView([konfig.lat, konfig.lng], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19
    }).addTo(map);

    markerTitik0 = L.marker([konfig.lat, konfig.lng], {
      icon: buatIcon('🏠', '#764ba2')
    }).addTo(map).bindPopup('<b>' + konfig.nama + '</b><br>Titik Pusat ' + kota);

    mapInitialized = true;

    setTimeout(function () {
      if (map) map.invalidateSize();
    }, 300);
  }

  // ============================================================
  // RESET LOKASI
  // ============================================================
  function resetLokasi() {
    selectedLocation = null;
    if (markerLokasi && map) { map.removeLayer(markerLokasi); markerLokasi = null; }
    if (garisRute && map) { map.removeLayer(garisRute); garisRute = null; }

    var infoBox = document.getElementById('distanceInfo');
    if (infoBox) infoBox.style.display = 'none';

    var input = document.getElementById('locationInput');
    if (input) input.value = '';

    var suggest = document.getElementById('suggestions');
    if (suggest) { suggest.innerHTML = ''; suggest.style.display = 'none'; }

    ['hiddenLat', 'hiddenLng', 'hiddenAlamat', 'hiddenJarak', 'hiddenBiaya'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });

    var konfig = getKonfig();
    if (map && konfig) {
      map.setView([konfig.lat, konfig.lng], 13);
    }

    // Reset data global
    window.__mapsData = null;

    // Trigger update preview harga
    if (typeof window.updateHargaPreview === 'function') {
      window.updateHargaPreview();
    }
  }

  // ============================================================
  // AUTOCOMPLETE - NOMINATIM
  // ============================================================
  function initAutocomplete() {
    var input = document.getElementById('locationInput');
    var suggestBox = document.getElementById('suggestions');
    if (!input || !suggestBox) return;

    input.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      var q = this.value.trim();

      if (q.length < 3) {
        suggestBox.innerHTML = '';
        suggestBox.style.display = 'none';
        return;
      }

      suggestBox.innerHTML = '<div class="suggestion-loading"><span class="loading-spinner"></span> Mencari lokasi...</div>';
      suggestBox.style.display = 'block';

      debounceTimer = setTimeout(function () {
        cariAlamat(q);
      }, 500);
    });

    // Enter untuk cari langsung
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(debounceTimer);
        var q = this.value.trim();
        if (q.length >= 3) cariAlamat(q);
      }
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.location-input-wrapper')) {
        suggestBox.style.display = 'none';
      }
    });
  }

  // ============================================================
  // CARI ALAMAT - VERSI DIPERBAIKI
  // ============================================================
  function cariAlamat(query) {
    var suggestBox = document.getElementById('suggestions');
    if (!suggestBox) return;

    var konfig = getKonfig();
    var region = konfig ? konfig.region : 'Indonesia';

    // Strategi: coba dengan state filter dulu, kalau kosong fallback tanpa filter
    var urlDenganState = 'https://nominatim.openstreetmap.org/search?' +
      'format=json&q=' + encodeURIComponent(query) +
      '&state=' + encodeURIComponent(region) +
      '&countrycodes=id&limit=8&addressdetails=1&accept-language=id';

    fetch(urlDenganState, {
      headers: { 'User-Agent': 'StudioLavelle/1.0 (booking system)' }
    })
      .then(function (r) { return r.json(); })
      .then(function (results) {
        if (Array.isArray(results) && results.length > 0) {
          tampilkanSuggestions(results);
        } else {
          // Fallback: cari tanpa filter state
          return cariAlamatFallback(query);
        }
      })
      .catch(function (err) {
        console.error('Nominatim error:', err);
        // Coba fallback juga kalau error
        cariAlamatFallback(query);
      });
  }

  function cariAlamatFallback(query) {
    var suggestBox = document.getElementById('suggestions');
    if (!suggestBox) return;

    var konfig = getKonfig();
    var kotaNama = kotaAktif || '';
    var q = query + ' ' + kotaNama;

    var url = 'https://nominatim.openstreetmap.org/search?' +
      'format=json&q=' + encodeURIComponent(q) +
      '&countrycodes=id&limit=8&addressdetails=1&accept-language=id';

    fetch(url, {
      headers: { 'User-Agent': 'StudioLavelle/1.0 (booking system)' }
    })
      .then(function (r) { return r.json(); })
      .then(function (results) {
        if (!Array.isArray(results)) results = [];
        tampilkanSuggestions(results);
      })
      .catch(function (err) {
        console.error('Nominatim fallback error:', err);
        suggestBox.innerHTML = '<div class="no-result">❌ Gagal cari lokasi. Coba lagi.</div>';
      });
  }

  // ============================================================
  // TAMPILKAN SUGGESTIONS - VERSI DIPERBAIKI
  // ============================================================
  function tampilkanSuggestions(results) {
    var suggestBox = document.getElementById('suggestions');
    if (!suggestBox) return;

    // Pastikan array
    if (!Array.isArray(results) || results.length === 0) {
      suggestBox.innerHTML = '<div class="no-result">😔 Lokasi tidak ditemukan. Coba kata kunci lain.</div>';
      suggestBox.style.display = 'block';
      return;
    }

    // Filter hasil yang valid
    var filtered = results.filter(function (r) {
      return r && r.display_name && r.lat && r.lon;
    });

    // Ambil maksimal 6 hasil teratas
    filtered = filtered.slice(0, 6);

    if (filtered.length === 0) {
      suggestBox.innerHTML = '<div class="no-result">😔 Lokasi tidak ditemukan. Coba kata kunci lain.</div>';
      suggestBox.style.display = 'block';
      return;
    }

    suggestBox.innerHTML = filtered.map(function (r) {
      // Ambil nama utama (bagian sebelum koma pertama)
      var parts = r.display_name.split(',');
      var nama = parts[0].trim();

      // Ambil 2-3 bagian berikutnya sebagai alamat
      var alamatLengkap = parts.slice(1, 4).map(function (s) {
        return s.trim();
      }).join(', ');
      if (!alamatLengkap) alamatLengkap = r.display_name;

      var lat = r.lat;
      var lon = r.lon;
      var safeAlamat = (nama + ', ' + alamatLengkap)
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      var safeNama = nama
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      return '<div class="suggestion-item" onclick="pilihLokasiMap(' + lat + ',' + lon + ',\'' + safeNama + '\',\'' + safeAlamat + '\')">' +
        '<span class="icon">📍</span>' +
        '<div class="suggestion-text">' +
        '<div class="suggestion-name">' + nama + '</div>' +
        '<div class="suggestion-address">' + alamatLengkap + '</div>' +
        '</div>' +
        '</div>';
    }).join('');

    suggestBox.style.display = 'block';
  }

  // ============================================================
  // PILIH LOKASI
  // ============================================================
  function pilihLokasiMap(lat, lng, namaSingkat, alamatLengkap) {
    if (!map || !kotaAktif) return;
    var konfig = getKonfig();
    if (!konfig) return;

    var suggestBox = document.getElementById('suggestions');
    if (suggestBox) suggestBox.style.display = 'none';

    var input = document.getElementById('locationInput');
    if (input) input.value = namaSingkat;

    selectedLocation = {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      nama: namaSingkat,
      alamat: alamatLengkap
    };

    if (markerLokasi) { map.removeLayer(markerLokasi); markerLokasi = null; }
    if (garisRute) { map.removeLayer(garisRute); garisRute = null; }

    markerLokasi = L.marker([lat, lng], {
      icon: buatIcon('📸', '#B76E79')
    }).addTo(map).bindPopup('<b>' + namaSingkat + '</b><br>' + alamatLengkap).openPopup();

    map.fitBounds([
      [konfig.lat, konfig.lng],
      [lat, lng]
    ], { padding: [50, 50], maxZoom: 15 });

    hitungJarakRute(lat, lng);
  }

  // ============================================================
  // HITUNG JARAK OSRM
  // ============================================================
  function hitungJarakRute(latTujuan, lngTujuan) {
    var konfig = getKonfig();
    if (!konfig) return;

    var infoBox = document.getElementById('distanceInfo');
    var jarakText = document.getElementById('jarakText');
    var biayaText = document.getElementById('biayaText');

    if (infoBox) {
      infoBox.style.display = 'block';
      if (jarakText) jarakText.innerHTML = '<span class="loading-spinner"></span>';
      if (biayaText) biayaText.innerHTML = '<span class="loading-spinner"></span>';
    }

    var url = 'https://router.project-osrm.org/route/v1/driving/' +
      konfig.lng + ',' + konfig.lat + ';' +
      lngTujuan + ',' + latTujuan +
      '?overview=full&geometries=geojson';

    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
          throw new Error('Routing gagal');
        }

        var route = data.routes[0];
        var jarakMeter = route.distance;
        var jarakKm = (jarakMeter / 1000).toFixed(2);

        var koordinat = route.geometry.coordinates.map(function (c) {
          return [c[1], c[0]];
        });
        if (garisRute) map.removeLayer(garisRute);
        garisRute = L.polyline(koordinat, {
          color: '#B76E79',
          weight: 5,
          opacity: 0.75,
          dashArray: '10, 8'
        }).addTo(map);

        var biaya = jarakMeter > konfig.batas_gratis_meter ? konfig.biaya_transport : 0;
        var batasKm = (konfig.batas_gratis_meter / 1000).toFixed(0);

        if (jarakText) {
          jarakText.innerText = jarakKm + ' KM dari ' + konfig.nama;
        }
        if (biayaText) {
          biayaText.innerText = biaya > 0
            ? 'Rp ' + biaya.toLocaleString('id-ID')
            : 'GRATIS (dalam radius ' + batasKm + ' KM)';
          biayaText.style.color = biaya > 0 ? '#B76E79' : '#6B8F71';
        }

        setHiddenValue('hiddenLat', latTujuan);
        setHiddenValue('hiddenLng', lngTujuan);
        setHiddenValue('hiddenAlamat', selectedLocation ? selectedLocation.alamat : '');
        setHiddenValue('hiddenJarak', jarakKm);
        setHiddenValue('hiddenBiaya', biaya);

        window.__mapsData = {
          lat: latTujuan,
          lng: lngTujuan,
          alamat: selectedLocation ? selectedLocation.alamat : '',
          jarak_km: parseFloat(jarakKm),
          biaya_transport: biaya,
          batas_gratis_km: parseFloat(batasKm),
          titik_nol: konfig.nama,
          kota: kotaAktif
        };

        // Trigger update preview harga
        if (typeof window.updateHargaPreview === 'function') {
          window.updateHargaPreview();
        }
      })
      .catch(function (err) {
        console.error('OSRM error:', err);
        if (jarakText) jarakText.innerText = '❌ Gagal hitung jarak';
        if (biayaText) biayaText.innerText = '-';
      });
  }

  function setHiddenValue(id, val) {
    var el = document.getElementById(id);
    if (el) el.value = val;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  window.MapsSystem = {
    buka: function (kota) {
      if (!KONFIG_KOTA[kota]) {
        console.warn('⚠️ Kota tidak punya konfigurasi:', kota);
        return;
      }
      if (!mapInitialized) {
        initMap(kota);
        initAutocomplete();
      } else if (kotaAktif !== kota) {
        initMap(kota);
      } else {
        resetLokasi();
      }

      setTimeout(function () {
        if (map) map.invalidateSize();
      }, 350);
    },

    getData: function () {
      return window.__mapsData || null;
    },

    reset: function () {
      resetLokasi();
      window.__mapsData = null;
    },

    isLokasiValid: function () {
      return window.__mapsData && window.__mapsData.alamat && window.__mapsData.jarak_km > 0;
    },

    getKonfig: function (kota) {
      return KONFIG_KOTA[kota] || null;
    }
  };

  window.pilihLokasiMap = pilihLokasiMap;

  console.log('✅ MapsSystem siap (Jogja/Solo: 7KM, Surabaya: 10KM)');
})();
