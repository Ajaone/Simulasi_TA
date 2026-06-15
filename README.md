# identitype — Vanilla Baseline Branch

Ini adalah **branch `vanilla`**: versi aplikasi identitype **tanpa autentikasi
keystroke dynamics**. Hanya login + password biasa.

Branch ini dipakai sebagai **baseline / pembanding** untuk skripsi. Branch
`main` punya fitur lengkap dengan integrasi API identitype.

---

## Perbedaan Singkat antara `main` dan `vanilla`

| Aspek | `main` (lengkap) | `vanilla` (branch ini) |
|---|---|---|
| Login dengan email + password | ✅ | ✅ |
| Verifikasi ritme ketikan (biometric) | ✅ | ❌ |
| Halaman enrollment pola ketikan | ✅ | ❌ |
| Panggilan ke API identitype | ✅ | ❌ |
| Butuh `.env` dengan `IDENTITYPE_API_KEY` | ✅ | ❌ |
| Bisa jalan offline tanpa server identitype | ❌ | ✅ |

---

## Cara Jalankan (2 menit)

### 1. Siapkan environment

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows PowerShell
# atau: source .venv/bin/activate  (Mac/Linux)

pip install -r requirements.txt
```

### 2. Buat file `.env`

```bash
cp .env.example .env
```

Edit `.env`, isi `FLASK_SECRET_KEY` dengan string acak:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Copy outputnya ke `FLASK_SECRET_KEY=` di `.env`.

### 3. Jalankan

```bash
python main.py
```

Buka `http://127.0.0.1:5000` di browser.

---

## Alur Aplikasi

1. **Sign Up** → buat akun (email + password)
2. **Login** → masuk dengan email + password
3. **Dashboard** → "Hello, your@email.com"

Tidak ada langkah enrollment / verifikasi ritme ketikan. Murni password.

---

## Struktur File (Cuma yang Penting)

```
.
├── main.py                          ← entry point
├── requirements.txt                 ← daftar dependency
├── .env.example                     ← template environment
└── website/
    ├── __init__.py                  ← bikin Flask app
    ├── models.py                    ← model User (email + password hash)
    ├── auth.py                      ← /api/sign-up, /api/login, /login, /sign-up
    ├── views.py                     ← /, /dashboard
    ├── static/
    │   ├── index.js                 ← logika frontend (login/signup)
    │   ├── style.css                ← styling utama
    │   ├── toast.js + toast.css     ← notifikasi non-popup
    └── templates/
        ├── base.html                ← layout induk
        ├── home.html                ← landing page
        ├── sign_up.html             ← form daftar
        ├── login.html               ← form masuk
        └── dashboard.html           ← "Hello, {email}"
```

---

## Switching Between Branches

```bash
# Pindah ke branch dengan biometric:
git checkout main

# Pindah balik ke vanilla:
git checkout vanilla
```

⚠️ **Database tidak compatible antar branch.** Schema `vanilla` lebih
sederhana (tidak ada kolom `typing_id`). Setiap kali pindah branch:

```bash
rm -f instance/database.db
```

Lalu jalankan lagi `python main.py` — database baru akan dibuat otomatis
dengan schema sesuai branch yang aktif.
