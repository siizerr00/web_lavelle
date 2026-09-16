// ============================================================
// EDGE FUNCTION: copy-foto
// Copy file dari folder Gdrive client ke folder edit admin
// ============================================================

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ---------- ENV ----------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_SA_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")!;
const TARGET_FOLDER_ID = "1Is77T9Kmi5o6WsP0_egU_hpWgE8ZXykd"; // folder root admin

// ---------- SUPABASE CLIENT ----------
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ---------- GOOGLE AUTH ----------
let cachedToken: { token: string; expires: number } | null = null;

async function getGoogleAccessToken(): Promise<string> {
  // Cek cache dulu
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const sa = JSON.parse(GOOGLE_SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  // Encode base64url
  const enc = (obj: any) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const unsigned = `${enc(header)}.${enc(payload)}`;

  // Sign JWT pakai private key
  const pemContents = sa.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${unsigned}.${sigB64}`;

  // Tukar JWT jadi access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error("Google auth gagal: " + err);
  }

  const tokenData = await tokenRes.json();
  cachedToken = {
    token: tokenData.access_token,
    expires: Date.now() + tokenData.expires_in * 1000,
  };
  return tokenData.access_token;
}

// ---------- HELPER: extract folder ID dari link ----------
function extractFolderId(link: string): string | null {
  if (!link) return null;
  let m = link.match(/\/folders\/([^\/\?]+)/);
  if (m) return m[1];
  m = link.match(/\/d\/([^\/\?]+)/);
  if (m) return m[1];
  m = link.match(/[?&]id=([^&]+)/);
  if (m) return m[1];
  return null;
}

// ---------- HELPER: cari atau buat folder ----------
async function getOrCreateFolder(
  token: string,
  parentId: string,
  name: string
): Promise<string> {
  // Cari folder dengan nama sama
  const query = encodeURIComponent(
    `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Kalau belum ada, buat baru
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  const createData = await createRes.json();
  if (!createData.id) {
    throw new Error("Gagal buat folder: " + JSON.stringify(createData));
  }
  return createData.id;
}

// ---------- HELPER: cari file di folder ----------
async function findFile(
  token: string,
  folderId: string,
  baseName: string
): Promise<{ id: string; name: string } | null> {
  // Cari nama tanpa ekstensi dulu, biar fleksibel
  const nameEscaped = baseName.replace(/'/g, "\\'");
  const query = encodeURIComponent(
    `'${folderId}' in parents and trashed = false and (name = '${nameEscaped}' or name = '${nameEscaped}.jpg' or name = '${nameEscaped}.jpeg' or name = '${nameEscaped}.png' or name = '${nameEscaped}.JPG' or name = '${nameEscaped}.JPEG' or name = '${nameEscaped}.PNG')`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (data.files && data.files.length > 0) {
    return data.files[0];
  }

  // Fallback: cari nama yang mengandung baseName
  const query2 = encodeURIComponent(
    `'${folderId}' in parents and trashed = false and name contains '${nameEscaped}'`
  );
  const res2 = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query2}&fields=files(id,name)&pageSize=5`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data2 = await res2.json();
  if (data2.files && data2.files.length > 0) {
    // Cek yang namanya mirip (tanpa ekstensi)
    for (const f of data2.files) {
      const noExt = f.name.replace(/\.[^/.]+$/, "");
      if (noExt.toLowerCase() === baseName.toLowerCase()) {
        return f;
      }
    }
  }

  return null;
}

// ---------- HELPER: copy file ----------
async function copyFile(
  token: string,
  fileId: string,
  targetFolderId: string,
  newName: string
): Promise<{ id: string; name: string }> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/copy?fields=id,name`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: newName,
        parents: [targetFolderId],
      }),
    }
  );
  const data = await res.json();
  if (!data.id) {
    throw new Error("Gagal copy file: " + JSON.stringify(data));
  }
  return data;
}

// ---------- MAIN HANDLER ----------
serve(async (req) => {
  // CORS
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  };
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const bookingId = body.booking_id;

    if (!bookingId) {
      return new Response(JSON.stringify({ error: "booking_id wajib diisi" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Ambil data booking
    const { data: booking, error: bErr } = await supabase
      .from("booking")
      .select("*")
      .eq("booking_id", bookingId)
      .single();

    if (bErr || !booking) {
      return new Response(
        JSON.stringify({ error: "Booking tidak ditemukan" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!booking.link_gdrive) {
      return new Response(
        JSON.stringify({ error: "Link Gdrive belum diupload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Parse foto_list (bisa array atau string JSON)
    let fotoList: string[] = [];
    try {
      if (Array.isArray(booking.foto_list)) {
        fotoList = booking.foto_list;
      } else if (typeof booking.foto_list === "string") {
        fotoList = JSON.parse(booking.foto_list);
      }
    } catch (e) {
      fotoList = [];
    }
    fotoList = fotoList.filter((f: any) => f && String(f).trim() !== "");

    if (fotoList.length === 0) {
      return new Response(
        JSON.stringify({ error: "Daftar foto kosong" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Auth ke Google
    const gToken = await getGoogleAccessToken();

    // 4. Setup folder tujuan
    // Nama folder: <bulan>-<kampus>-<nama> (bulan tanpa leading zero)
    const tglFoto = new Date(booking.tanggal + "T00:00:00");
    const bulan = tglFoto.getMonth() + 1; // tanpa leading zero
    const kampusSlug = String(booking.kampus || "kampus")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ""); // hapus spasi & karakter aneh
    const namaSlug = String(booking.nama_client || "client")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    const folderName = `${bulan}-${kampusSlug}-${namaSlug}`;

    const targetFolderId = await getOrCreateFolder(
      gToken,
      TARGET_FOLDER_ID,
      folderName
    );

    // 5. Cari folder sumber (dari link client)
    const sourceFolderId = extractFolderId(booking.link_gdrive);
    if (!sourceFolderId) {
      return new Response(
        JSON.stringify({ error: "Link Gdrive sumber tidak valid" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Simpan status awal ke copy_queue
    await supabase
      .from("copy_queue")
      .upsert(
        {
          booking_id: bookingId,
          foto_list: fotoList,
          status: "processing",
          progress: 0,
          total: fotoList.length,
          result: "",
          detail_result: [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "booking_id" }
      );

    // 7. Proses copy satu per satu
    const detail: any[] = [];
    let sukses = 0;
    let gagal = 0;

    for (let i = 0; i < fotoList.length; i++) {
      const nama = String(fotoList[i]).trim();
      let hasil: any = { foto: nama, status: "pending" };

      try {
        const fileDitemukan = await findFile(gToken, sourceFolderId, nama);
        if (!fileDitemukan) {
          hasil.status = "failed";
          hasil.error = "File tidak ditemukan di folder client";
          gagal++;
        } else {
          // Copy dengan nama yang sama (tanpa suffix)
          await copyFile(
            gToken,
            fileDitemukan.id,
            targetFolderId,
            fileDitemukan.name
          );
          hasil.status = "success";
          hasil.original = fileDitemukan.name;
          sukses++;
        }
      } catch (e: any) {
        hasil.status = "failed";
        hasil.error = e.message || "Error";
        gagal++;
      }

      detail.push(hasil);

      // Update progress ke Supabase
      await supabase
        .from("copy_queue")
        .update({
          progress: i + 1,
          detail_result: detail,
          updated_at: new Date().toISOString(),
        })
        .eq("booking_id", bookingId);
    }

    // 8. Final update
    const resultText =
      `✅ ${sukses} berhasil, ${gagal} gagal. ` +
      `📁 https://drive.google.com/drive/folders/${targetFolderId}`;

    await supabase
      .from("copy_queue")
      .update({
        status: gagal === 0 ? "done" : "failed",
        progress: fotoList.length,
        result: resultText,
        detail_result: detail,
        updated_at: new Date().toISOString(),
      })
      .eq("booking_id", bookingId);

    // 9. Kalau semua sukses, update status booking
    if (gagal === 0) {
      await supabase
        .from("booking")
        .update({ status: "edit_foto" })
        .eq("booking_id", bookingId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        folder_name: folderName,
        folder_id: targetFolderId,
        folder_link: `https://drive.google.com/drive/folders/${targetFolderId}`,
        sukses,
        gagal,
        detail,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("❌ Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
