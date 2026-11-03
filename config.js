// config.js — aman ditaruh publik. Isinya cuma URL + publishable key.
window.LAVELLE_CONFIG = {
  SUPABASE_URL: "https://xgdlzlyjmnuzdytycree.supabase.co",
  SUPABASE_KEY: "sb_publishable_2CSjGRSMIKSl_KTUX2hr0A_crngTzEf",
  APP_URL: window.location.origin
};

// Ekspor untuk Node.js (Backend)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LAVELLE_CONFIG;
} 

// Pasang ke window untuk Browser (Frontend)
if (typeof window !== 'undefined') {
  window.LAVELLE_CONFIG = LAVELLE_CONFIG;
}
