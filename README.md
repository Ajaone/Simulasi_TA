# identitype — Partner Integration Simulation

Simulasi website mitra yang mengintegrasikan **autentikasi biometrik keystroke dynamics**
menggunakan API [identitype](https://identitype.duckdns.org/). Selain password,
sistem memverifikasi *ritme ketikan* user sebagai faktor kedua.

> Dibangun sebagai bahan skripsi dan referensi implementasi untuk mitra.
> **Bukan production-ready** — lihat bagian Security di docs sebelum dipakai.

---

## Quickstart

```bash
# 1. Clone & masuk
git clone https://github.com/Ajaone/Simulasi_TA.git
cd Simulasi_TA

# 2. Virtual env + dependency
python -m venv .venv
.venv\Scripts\activate          # Windows PowerShell
# atau: source .venv/bin/activate (macOS/Linux)
pip install -r requirements.txt

# 3. Setup environment
cp .env.example .env
# Edit .env, isi IDENTITYPE_API_KEY dengan key dari identitype dashboard

# 4. Jalankan
python main.py
```

Buka `http://127.0.0.1:5000` di browser. Alurnya:

1. **Sign Up** → buat akun (email + password)
2. **Enrollment** → ketik password 5–10x untuk melatih model ritme ketikan
3. **Login** → password + ritme cocok → masuk dashboard

---

## Yang Akan Anda Dapatkan

**Fitur:**
- Sign up + login dengan email + password (hash via werkzeug)
- Enrollment biometrik via API identitype
- Verifikasi ritme ketikan saat login
- Toast notification (no popup alert)
- Minimal UI dengan Fraunces + Inter typography

**Best practices yang sudah ada:**
- Secrets di environment variable (`.env`)
- Server-side proxy (API key tidak bocor ke browser)
- Logging metadata only (no payload — payload berisi password plain-text)
- Error message sanitization
- Password match validation sebelum enroll
- Single-listener pattern (no double-submit bugs)

---

## Branches

| Branch | Deskripsi |
|---|---|
| [`main`](https://github.com/Ajaone/Simulasi_TA/tree/main) | Versi lengkap dengan integrasi keystroke biometric. |
| [`vanilla`](https://github.com/Ajaone/Simulasi_TA/tree/vanilla) | Baseline tanpa biometric (hanya password). Untuk perbandingan / kontrol. |

Switch branch:

```bash
git checkout vanilla
rm -f instance/database.db    # schema beda, regenerate
python main.py
```

---

## Dokumentasi

- [docs/PARTNER_INTEGRATION_GUIDE.md](docs/PARTNER_INTEGRATION_GUIDE.md) —
  panduan integrasi lengkap (Quickstart cURL, arsitektur, implementasi 12 step,
  reference, troubleshooting).
- [docs/UPGRADE_FROM_VANILLA.md](docs/UPGRADE_FROM_VANILLA.md) —
  tutorial khusus untuk mitra yang sudah punya Flask app dengan login
  biasa dan mau menambah identitype. 13 step, ~45 menit.
- [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) — reference API
  identitype (request/response per endpoint, error codes).
- [docs/identitype_Postman_Collection.json](docs/identitype_Postman_Collection.json) —
  Postman collection siap import.

---

## Tech Stack

- **Backend:** Flask + SQLAlchemy (SQLite) + werkzeug security
- **Frontend:** Vanilla JavaScript (no framework) + plain CSS
- **Service:** [identitype Partner API](https://identitype.duckdns.org/)

---

## Disclaimer

Project ini adalah simulasi untuk keperluan akademik. Beberapa hal yang **harus**
disempurnakan sebelum production:

- Server-side session binding di endpoint proxy
- Rate limiting per-user di sisi mitra
- Lockout setelah N gagal verify
- Disclosure GDPR/UU PDP untuk data biometric
- Schema validation yang ketat di proxy

Detail lengkap di [PARTNER_INTEGRATION_GUIDE.md § Production Checklist](docs/PARTNER_INTEGRATION_GUIDE.md#5-production-checklist).
