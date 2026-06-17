# Tutorial: Tambahkan identitype ke Aplikasi Existing

Tutorial step-by-step untuk mitra yang **sudah punya Flask app dengan
login/sign-up biasa** (seperti branch `vanilla` di repo ini) dan ingin
menambahkan autentikasi biometrik keystroke dynamics via identitype.

> Target waktu: ~45 menit kalau ikuti tahap demi tahap.
> Hasil akhir: aplikasi Anda akan persis seperti branch `main`.

---

## 0. Sebelum Mulai

### Pastikan Anda punya:

1. **Aplikasi Flask yang sudah jalan** dengan login + sign-up biasa (seperti
   branch `vanilla`). Test dulu: pastikan bisa sign up + login + lihat
   dashboard sebelum mulai modifikasi.

2. **API key identitype** — daftar di [identitype.duckdns.org](https://identitype.duckdns.org/),
   buat partner account, generate API key (format: `sk_live_...`).

3. **Backup branch atau folder.** Sebelum mulai, buat backup:
   ```bash
   git checkout vanilla
   git checkout -b vanilla-with-identitype
   ```
   Atau (kalau bukan pakai git):
   ```powershell
   Copy-Item -Recurse "Simulasi TA" "Simulasi TA backup"
   ```

### Struktur file vanilla saat ini

```
project/
├── main.py
├── requirements.txt
├── .env.example                       ← akan dimodifikasi
└── website/
    ├── __init__.py
    ├── auth.py                        ← akan dimodifikasi
    ├── models.py                      ← akan dimodifikasi
    ├── views.py                       ← akan dimodifikasi
    ├── static/
    │   ├── index.js                   ← akan dimodifikasi
    │   ├── style.css
    │   ├── toast.js + toast.css
    └── templates/
        ├── base.html
        ├── home.html
        ├── login.html
        ├── sign_up.html
        └── dashboard.html
```

### Setelah selesai

```
project/
├── ...
└── website/
    ├── identitype.py                  ← BARU
    ├── ... (file existing diubah)
    ├── static/
    │   ├── recorder.js                ← BARU
    │   └── ... (index.js diubah)
    └── templates/
        ├── typing_patterns.html       ← BARU
        └── ... (template lain diubah text-nya)
```

**Ringkas:** 3 file baru + 6 file diubah + 1 env config + 1 reset database.

---

## Step 1 — Update `.env.example` dan `.env`

Tambah 3 baris di `.env.example`:

```bash
# .env.example — tambahkan di paling atas atau bawah, terserah
IDENTITYPE_BASE_URL=https://identitype.duckdns.org/api/partner
IDENTITYPE_API_KEY=<your-identitype-api-key>
IDENTITYPE_TIMEOUT_SECONDS=30
```

Lalu update `.env` Anda dengan nilai asli:

```bash
# .env
IDENTITYPE_BASE_URL=https://identitype.duckdns.org/api/partner
IDENTITYPE_API_KEY=<your-identitype-api-key>
IDENTITYPE_TIMEOUT_SECONDS=30
```

> **Catatan:** `.env` jangan di-commit. Pastikan ada di `.gitignore`.

---

## Step 2 — Buat `website/identitype.py` (file baru)

Ini klien HTTP yang akan memanggil API identitype. Browser **tidak boleh**
langsung memanggil identitype (kalau bisa, API key bocor di JavaScript).
Jadi browser kirim ke server Anda, server Anda yang panggil identitype
pakai file ini.

**Buat file `website/identitype.py`** dengan isi:

```python
"""
identitype Partner API client.

PRODUCTION REQUIREMENTS:
- BASE_URL MUST be HTTPS in production.
- API_KEY MUST be set via environment variable, never committed to source.
- This module deliberately avoids logging the request payload because the
  `events` array contains password keystrokes. Only metadata is logged.
"""

import json
import logging
import os
import socket
import urllib.error
import urllib.request

log = logging.getLogger(__name__)

# Config dari env, dengan fallback localhost untuk dev
BASE_URL = os.getenv("IDENTITYPE_BASE_URL", "http://localhost:5000/api/partner")
API_KEY  = os.getenv("IDENTITYPE_API_KEY", "")
TIMEOUT  = int(os.getenv("IDENTITYPE_TIMEOUT_SECONDS", "30"))

if BASE_URL.startswith("http://") and not BASE_URL.startswith("http://127.") \
        and not BASE_URL.startswith("http://localhost"):
    log.warning(
        "IDENTITYPE_BASE_URL uses plain HTTP. Use HTTPS in production — keystroke "
        "events and the API key are sent over the wire."
    )

if not API_KEY:
    log.warning("IDENTITYPE_API_KEY is not set. Requests to identitype will fail.")

# Pesan generic — jangan bocor detail infrastruktur ke browser
_MSG_UNAVAILABLE = "Authentication service is temporarily unavailable. Please try again in a moment."
_MSG_TIMEOUT     = "Authentication service did not respond in time. Please try again."
_MSG_UPSTREAM    = "Authentication service returned an error. Please try again later."


def _redact_key(k: str) -> str:
    if not k or len(k) < 16:
        return "<redacted>"
    return k[:12] + "…"


def post_partner(endpoint: str, payload: dict, origin: str | None = None):
    url = f"{BASE_URL}/{endpoint}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
    )
    req.add_header("Authorization", f"Bearer {API_KEY}")
    req.add_header("Content-Type", "application/json")
    if origin:
        req.add_header("Origin", origin)

    # PENTING: log metadata saja, jangan pernah log `payload` (berisi password chars)
    log.info(
        "→ identitype POST endpoint=%s events_count=%s key=%s",
        endpoint,
        len(payload.get("events", [])) if isinstance(payload.get("events"), list) else "N/A",
        _redact_key(API_KEY),
    )

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            body = res.read().decode("utf-8")
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                log.error("identitype returned non-JSON response (status=%s)", res.status)
                return {"success": False, "error_code": "UPSTREAM_ERROR", "message": _MSG_UPSTREAM}
            log.info(
                "← identitype ok status=%s success=%s decision=%s verified=%s",
                res.status, parsed.get("success"), parsed.get("decision"), parsed.get("verified"),
            )
            return parsed

    except urllib.error.HTTPError as e:
        try:
            error_body = e.read().decode("utf-8")
        except Exception:
            error_body = ""
        log.warning("identitype HTTP error status=%s", e.code)
        try:
            error_json = json.loads(error_body)
            error_json["http_status"] = e.code
            if "success" not in error_json:
                error_json["success"] = False
            if e.code >= 500:
                error_json["message"] = _MSG_UPSTREAM  # jangan bocor pesan 5xx
            return error_json
        except Exception:
            return {
                "success": False,
                "http_status": e.code,
                "error_code": "SERVER_ERROR" if e.code >= 500 else "API_ERROR",
                "message": _MSG_UPSTREAM,
            }

    except (socket.timeout, TimeoutError):
        log.warning("identitype timeout after %ss", TIMEOUT)
        return {"success": False, "error_code": "SERVICE_TIMEOUT", "message": _MSG_TIMEOUT}

    except urllib.error.URLError as e:
        log.warning("identitype network error: %s", type(e).__name__)
        return {"success": False, "error_code": "SERVICE_UNAVAILABLE", "message": _MSG_UNAVAILABLE}

    except Exception as e:
        log.exception("Unexpected error calling identitype: %s", type(e).__name__)
        return {"success": False, "error_code": "SERVER_ERROR", "message": _MSG_UPSTREAM}


def send_typing_data(username: str, events: list[dict], mode: str = "verify",
                     origin: str | None = None):
    payload = {"username": str(username), "events": events}
    if mode == "enroll":
        return {"enroll": post_partner("enroll", payload, origin=origin)}
    return {"verify": post_partner("verify", payload, origin=origin)}
```

**Quick test:** masih belum bisa test sampai Step 6. Lanjutkan.

---

## Step 3 — Buat `website/static/recorder.js` (file baru)

Ini library JavaScript yang merekam keystroke di browser. Drop-in, tidak
butuh framework. Anda **tidak perlu modifikasi** isinya.

**Buat file `website/static/recorder.js`** dengan isi yang sama dari branch
`main`. Cara paling cepat (kalau pakai git):

```bash
git checkout main -- website/static/recorder.js
```

Atau download manual dari:
https://raw.githubusercontent.com/Ajaone/Simulasi_TA/main/website/static/recorder.js

> File ini ~340 baris vanilla JS. Tidak ada konfigurasi yang perlu diubah.

---

## Step 4 — Modifikasi `website/models.py`

Tambah kolom `typing_id` di model User. Ini UUID acak yang akan dikirim ke
identitype sebagai `username` (lebih aman daripada kirim email — jangan
expose PII ke pihak ketiga).

**Ganti `website/models.py` menjadi:**

```python
from . import db
from flask_login import UserMixin
import uuid


class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(150), unique=True)
    password = db.Column(db.String(150))
    # Baru: UUID yang dikirim ke identitype sebagai username
    typing_id = db.Column(db.String(100), default=lambda: str(uuid.uuid4()))
```

> **Catatan:** kolom baru ini mengubah schema database. Step 12 nanti akan
> reset DB-nya.

---

## Step 5 — Modifikasi `website/auth.py`

Tiga perubahan:
1. Login & sign-up return `user.typing_id` sebagai `user_id`, bukan `user.id`
2. Tambah endpoint `/api/verify-password` untuk validasi password sebelum enroll

**Ganti `website/auth.py` menjadi:**

```python
from flask import Blueprint, render_template, make_response, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

from . import db
from .models import User

auth = Blueprint('auth', __name__)


@auth.route("/api/login", methods=['POST'])
def api_login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    user = User.query.filter_by(email=email).first()
    if user and check_password_hash(user.password, password):
        # CHANGE: return typing_id, bukan user.id
        return make_response(jsonify({"message": "Login successful", "user_id": user.typing_id}), 200)
    return make_response(jsonify({"message": "Invalid email or password"}), 401)


@auth.route("/api/sign-up", methods=['POST'])
def api_sign_up():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if User.query.filter_by(email=email).first():
        return make_response(jsonify({"message": "Email is already used"}), 409)
    if not email or len(email) < 4:
        return make_response(jsonify({"message": "Email is invalid"}), 401)
    if len(password) < 7:
        return make_response(jsonify({"message": "Password too short"}), 401)

    new_user = User(email=email, password=generate_password_hash(password))
    db.session.add(new_user)
    db.session.commit()
    # CHANGE: return typing_id
    return make_response(jsonify({"message": "User created!", "user_id": new_user.typing_id}), 201)


# BARU: validasi password = password akun sebelum enroll
# Tanpa ini, user bisa ketik password berbeda saat enroll → model belajar
# ritme password salah → saat login asli, dianggap impostor
@auth.route("/api/verify-password", methods=['POST'])
def api_verify_password():
    data = request.get_json() or {}
    user_id = data.get('user_id')
    password = data.get('password') or ''

    if not user_id or not password:
        return make_response(jsonify({"match": False, "message": "Missing fields"}), 400)

    user = User.query.filter_by(typing_id=user_id).first()
    if not user:
        return make_response(jsonify({"match": False, "message": "User not found"}), 404)

    if not check_password_hash(user.password, password):
        return make_response(jsonify({"match": False, "message": "Password does not match the one used at sign-up"}), 401)

    return make_response(jsonify({"match": True}), 200)


@auth.route('/login')
def login():
    return render_template("login.html")


@auth.route('/sign-up')
def sign_up():
    return render_template("sign_up.html")
```

---

## Step 6 — Modifikasi `website/views.py`

Tambah dua route baru:
1. `/typing-patterns` — halaman enrollment (akan dibuat di Step 7)
2. `/identitype` — endpoint proxy yang menerima keystroke dari browser dan
   meneruskan ke identitype API

**Ganti `website/views.py` menjadi:**

```python
from flask import Blueprint, render_template, request, jsonify, make_response
import logging

from .identitype import send_typing_data

views = Blueprint('views', __name__)
log = logging.getLogger(__name__)


@views.route('/')
def home():
    return render_template("home.html")


# BARU: halaman form enrollment
@views.route('/typing-patterns')
def typing_patterns():
    return render_template("typing_patterns.html")


@views.route('/dashboard')
def dashboard():
    return render_template("dashboard.html")


# BARU: proxy endpoint yang dipanggil browser
@views.route('/identitype', methods=['POST'])
def identitype():
    data = request.get_json(silent=True) or {}

    username = str(data.get('username', '')).strip()
    events = data.get('events')
    mode = str(data.get('mode', 'verify')).lower()

    # PENTING: jangan log isi events (berisi karakter password)
    log.info(
        "identitype request: mode=%s username=%s events_count=%s",
        mode,
        username[:8] + "…" if username else "<empty>",
        len(events) if isinstance(events, list) else "N/A",
    )

    if not username:
        return make_response(jsonify({
            "error": {"success": False, "error_code": "INVALID_INPUT", "message": "username is required"}
        }), 400)
    if not isinstance(events, list) or len(events) == 0:
        return make_response(jsonify({
            "error": {"success": False, "error_code": "INVALID_KEYSTROKE_DATA", "message": "events must be a non-empty array"}
        }), 400)
    if mode not in ("enroll", "verify"):
        return make_response(jsonify({
            "error": {"success": False, "error_code": "INVALID_INPUT", "message": "mode must be enroll or verify"}
        }), 400)

    response = send_typing_data(username, events, mode=mode)
    upstream = response.get(mode, {})

    if "http_status" in upstream and upstream.get("http_status") >= 400:
        status = upstream["http_status"]
    else:
        status = 200 if upstream.get("success") else 400

    log.info(
        "identitype response: mode=%s status=%s success=%s decision=%s",
        mode, status, upstream.get("success"), upstream.get("decision"),
    )

    return make_response(jsonify(response), status)
```

---

## Step 7 — Buat `website/templates/typing_patterns.html` (file baru)

Halaman enrollment. User akan datang ke sini setelah sign-up untuk
melatih model dengan password mereka.

**Buat file `website/templates/typing_patterns.html`:**

```html
{% extends "base.html" %}
{% block title %}Enroll typing pattern{% endblock %}
{% block content %}
<p class="eyebrow">Two-factor</p>
<h2>Enroll your typing pattern.</h2>
<p class="muted">Type your password naturally. We'll record the rhythm, not the text.</p>

<form id="typing-patterns-form">
  <div class="field">
    <label for="password">Password</label>
    <input type="password" id="password" name="password" placeholder="Type your password" autofocus autocomplete="off" />
  </div>
  <button type="submit" id="typing-patterns-button">Submit pattern</button>
</form>
{% endblock %}
```

> **Yang penting:**
> - Form ID = `typing-patterns-form` → index.js akan cari ini
> - Input ID = `password` → recorder akan attach ke field ini
> - `autofocus` membantu user langsung ngetik tanpa klik

---

## Step 8 — Update text di template existing

Ini hanya perubahan copy/teks supaya konsisten dengan fitur baru. Optional
tapi disarankan.

**`website/templates/sign_up.html`** — ganti baris ke-6:

```html
<!-- Sebelum: -->
<p class="muted">After signing up you'll be redirected to log in.</p>

<!-- Sesudah: -->
<p class="muted">After signing up, you'll enroll your typing pattern.</p>
```

**`website/templates/login.html`** — ganti baris ke-6:

```html
<!-- Sebelum: -->
<p class="muted">Enter your email and password to continue.</p>

<!-- Sesudah: -->
<p class="muted">Enter your credentials. We'll verify your typing rhythm too.</p>
```

**`website/templates/dashboard.html`** — ganti baris ke-6:

```html
<!-- Sebelum: -->
<p class="lead">You're signed in.</p>

<!-- Sesudah: -->
<p class="lead">You're signed in. Your typing pattern matched.</p>
```

**`website/templates/home.html`** — ganti hero copy (baris ~5-8):

```html
<!-- Sebelum: -->
<h1>Sign in to your account.</h1>
<p class="lead">
  A simple authentication demo with email and password.
</p>

<!-- Sesudah: -->
<h1>Authenticate by the way you type.</h1>
<p class="lead">
  A small demo of keystroke-dynamics two-factor authentication. Create an
  account, enroll your typing pattern, and log in.
</p>
```

---

## Step 9 — Update `website/templates/base.html`

Pastikan script `index.js` di-load dengan `type="module"` (supaya bisa
import recorder.js). Cek baris di akhir `<body>`:

```html
<!-- Pastikan ada type="module" -->
<script type="module" src="{{ url_for('static', filename='index.js') }}"></script>
```

Kalau di vanilla belum ada `type="module"`, tambahkan.

---

## Step 10 — Ganti `website/static/index.js` total

Ini perubahan paling besar. Vanilla punya ~70 baris logic login/signup biasa.
Setelah modifikasi: ~340 baris dengan keystroke recording + verify flow.

Cara paling cepat (kalau pakai git):

```bash
git checkout main -- website/static/index.js
```

Atau download manual dari:
https://raw.githubusercontent.com/Ajaone/Simulasi_TA/main/website/static/index.js

**Logika baru yang dilakukan `index.js`:**

1. Import `Keystroke` dari `./recorder.js`
2. Buat instance `Keystroke` global
3. Deteksi form di page → attach listener:
   - `login-form` → record `password` keystroke, submit ke `/api/login` lalu kirim keystroke ke `/identitype` mode `verify`
   - `typing-patterns-form` → record `password` keystroke, validasi password via `/api/verify-password`, lalu kirim ke `/identitype` mode `enroll`
   - `sign-up-form` → submit ke `/api/sign-up`, redirect ke `/typing-patterns`
4. Handle response: success → redirect, error → toast

> ⚠️ **Detail penting:** di `login-form` dan `typing-patterns-form`, panggil
> `recorder.addTarget("password")` — **hanya** password yang direkam. Kalau
> beda target antara enroll dan verify, model akan reject sebagai impostor.

---

## Step 11 — Reset database

Schema berubah (ada kolom `typing_id` baru). Database lama tidak compatible.

**Windows PowerShell:**
```powershell
Remove-Item instance\database.db
```

**Mac/Linux:**
```bash
rm -f instance/database.db
```

Flask akan auto-create database baru saat startup berikutnya.

> Konsekuensi: akun yang sudah pernah dibuat di vanilla **hilang**. Untuk
> simulasi/demo, ini OK. Untuk production, gunakan migrasi Alembic untuk
> ALTER TABLE menambah kolom tanpa kehilangan data.

---

## Step 12 — Restart Flask

```powershell
python main.py
```

**Cek log startup — harus seperti ini:**

```
INFO website — Created database file
```

**Yang TIDAK boleh muncul:**

- ❌ `IDENTITYPE_API_KEY is not set` → `.env` belum di-load. Cek `python-dotenv` ter-install.
- ❌ `IDENTITYPE_BASE_URL uses plain HTTP` → BASE_URL pakai `http://`, ganti ke `https://`.

---

## Step 13 — Test End-to-End

Buka `http://127.0.0.1:5000` di browser.

### Test 1: Sign Up

1. Klik "Get started" atau buka `/sign-up`
2. Isi: email `test@example.com`, password `Password123`
3. Submit → toast: "Account created! Please enroll your typing pattern."
4. Otomatis redirect ke `/typing-patterns`

### Test 2: Enrollment

1. Di page `/typing-patterns`, ketik password `Password123`
2. Submit → toast: "Sample 1/10 saved" (atau angka apa pun yang dikembalikan server)
3. Page reload otomatis
4. Ulangi ketik password yang **sama** → toast: "Sample 2/10 saved"
5. Lanjutkan sampai progress complete (biasanya 5-10x)
6. Setelah complete → toast "Enrollment successful" → redirect ke `/login`

### Test 3: Login (verify)

1. Di page `/login`, isi email + password
2. Submit → server cek password (OK) → server kirim keystroke ke identitype untuk verify
3. Kalau ritme cocok → toast "Authentication successful" → redirect ke `/dashboard`
4. Dashboard menampilkan: "Hello, test@example.com."

### Test 4: Login dengan ritme palsu

Coba ketik password dengan kecepatan jauh lebih lambat / cepat dari biasanya
→ server harusnya reject → toast "Pola ketikan tidak cocok."

---

## Troubleshooting

| Gejala | Penyebab + Solusi |
|---|---|
| Log: `key=<redacted>` | `python-dotenv` belum di-install. Jalankan: `pip install python-dotenv` |
| `POST /api/partner/enroll → 404` di localhost | BASE_URL fallback ke localhost. Sama dengan di atas, cek dotenv. |
| HTTP 401 `Invalid API key` | API key salah / belum di-set di `.env`. Buat key baru di dashboard identitype. |
| `decision: impostor` padahal password benar | Target perekam beda antara enroll dan verify. Pastikan kedua form pakai `recorder.addTarget("password")` saja, tidak ada target lain. |
| Selalu `INSUFFICIENT_SAMPLES` | Sample ditolak karena ketikan terlalu kacau. Ketik lebih natural & konsisten. |
| Sign-up sukses tapi tidak redirect ke `/typing-patterns` | Cek `index.js` — pastikan setelah sign-up sukses, `window.location.href = "/typing-patterns"` |
| Toast muncul double | Form punya listener di `click` button DAN `submit` form. Hapus salah satu, pakai `submit` saja. |
| Modul `recorder.js` tidak ke-load | `base.html` tidak pakai `<script type="module">`. Tambahkan attribute itu. |

---

## Verifikasi Final

Setelah semua step selesai, struktur folder Anda harus:

```
project/
├── .env                              ← berisi IDENTITYPE_API_KEY, dll
├── .env.example                      ← updated dengan 3 env baru
└── website/
    ├── identitype.py                 ← BARU
    ├── auth.py                       ← +verify-password endpoint
    ├── models.py                     ← +typing_id field
    ├── views.py                      ← +/typing-patterns, /identitype routes
    ├── static/
    │   ├── recorder.js               ← BARU
    │   └── index.js                  ← rewritten dengan keystroke logic
    └── templates/
        ├── typing_patterns.html      ← BARU
        ├── base.html                 ← +type="module" di script tag
        ├── home.html                 ← updated copy
        ├── login.html                ← updated copy
        ├── sign_up.html              ← updated copy
        └── dashboard.html            ← updated copy
```

**Jalankan diff dengan branch `main` untuk konfirmasi:**

```bash
git diff main -- website/ .env.example
```

Output harus minimal/kosong (kecuali nilai actual di `.env`).

---

## Apa Selanjutnya?

Setelah aplikasi Anda jalan dengan identitype, baca:

- **[PARTNER_INTEGRATION_GUIDE.md § Production Hardening](./PARTNER_INTEGRATION_GUIDE.md#6-production-hardening-checklist)** — checklist sebelum go-live: HTTPS, rate limit, session binding, dll.
- **[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)** — reference lengkap response field, error code per endpoint.

Untuk laporan skripsi, branch `vanilla` (password-only) bisa Anda pakai
sebagai **control group** dan branch hasil tutorial ini sebagai **treatment
group** — untuk ukur dampak identitype terhadap UX, security, performance,
dst.
