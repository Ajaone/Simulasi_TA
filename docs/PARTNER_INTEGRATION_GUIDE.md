# identitype — Panduan Integrasi untuk Mitra

> Manual praktis bagi mitra (partner) yang ingin menambahkan autentikasi
> berbasis **keystroke dynamics** (ritme ketikan) ke website mereka,
> menggunakan identitype Partner API.
>
> Dokumen ini ditulis berdasarkan implementasi nyata pada website simulasi
> di repository ini.

---

## Daftar Isi

1. [Apa yang Anda Bangun](#1-apa-yang-anda-bangun)
2. [Arsitektur](#2-arsitektur)
3. [Yang Anda Butuhkan](#3-yang-anda-butuhkan)
4. [Komponen Kode Minimal](#4-komponen-kode-minimal)
5. [Alur User Lengkap](#5-alur-user-lengkap)
6. [Implementasi Langkah demi Langkah](#6-implementasi-langkah-demi-langkah)
7. [Penanganan Error](#7-penanganan-error)
8. [Pelajaran dari Simulasi (Bug Umum)](#8-pelajaran-dari-simulasi-bug-umum)
9. [Keamanan — Wajib Dibaca](#9-keamanan--wajib-dibaca)
10. [Checklist Sebelum Produksi](#10-checklist-sebelum-produksi)

---

## 1. Apa yang Anda Bangun

identitype menambahkan **faktor kedua** ke flow login Anda. Selain password,
sistem memverifikasi *ritme ketikan* user — kecepatan tiap tombol, jeda
antar tombol, durasi penekanan. Pola ini sulit ditiru meskipun password
bocor.

**Dua operasi inti:**

| Operasi | Kapan dipakai | Endpoint identitype |
|---|---|---|
| **Enroll** | Saat user baru daftar — rekam pola ketikan password mereka beberapa kali untuk melatih model | `POST /api/partner/enroll` |
| **Verify** | Saat user login — cocokkan ritme ketikan saat ini dengan model yang sudah terlatih | `POST /api/partner/verify` |

User harus enroll **beberapa sampel** sebelum bisa verify. Jumlah pastinya
dikonfigurasi di sisi identitype dan dikembalikan via field `required_templates`
(observasi lapangan: 5–10). **Jangan hard-code** — selalu baca dari response.

---

## 2. Arsitektur

```
┌─────────────────┐    keystroke events     ┌─────────────────┐    Bearer token     ┌─────────────────┐
│                 │ ──────────────────────► │                 │ ──────────────────► │                 │
│   Browser User  │                          │  Server Mitra   │                     │   identitype API   │
│                 │ ◄──────────────────────  │   (proxy)       │ ◄────────────────── │                 │
└─────────────────┘   match / no-match       └─────────────────┘   verdict + score   └─────────────────┘
```

**Tiga lapisan, tiga tanggung jawab:**

1. **Browser** — merekam tiap `keydown` & `keyup` user di field password,
   menyusunnya jadi array event JSON.
2. **Server Mitra** — menerima event dari browser, menambahkan API key,
   meneruskan ke identitype. Disebut "proxy" karena hanya melewatkan.
3. **identitype API** — melatih atau memverifikasi pola ketikan, mengembalikan
   verdict.

> **Kenapa harus ada proxy?** API key identitype tidak boleh muncul di
> JavaScript browser (siapa pun bisa membacanya via DevTools). Selalu
> simpan di server.

---

## 3. Yang Anda Butuhkan

- **API Key** identitype (format: `sk_live_...`) — didapat saat mendaftar
  sebagai mitra.
- **Backend** apa saja yang bisa kirim HTTP request (Flask, Express,
  Laravel, Django, FastAPI, Spring, dll.). Tutorial ini pakai Flask.
- **Frontend** yang punya akses ke `keydown`/`keyup` event browser
  (semua framework modern bisa).
- **Database** untuk menyimpan akun user dan ID user mereka di identitype.

---

## 4. Komponen Kode Minimal

Sebuah website mitra perlu **enam komponen**:

| # | Komponen | Lokasi | Fungsi |
|---|---|---|---|
| 1 | Tabel user | DB | Simpan `email`, `password_hash`, dan `identitype_id` (UUID) |
| 2 | Endpoint sign-up | Backend | Buat akun, generate `identitype_id` unik per user |
| 3 | Endpoint login | Backend | Validasi password, kembalikan `identitype_id` |
| 4 | Halaman enrollment | Frontend | Form input password, rekam keystroke, kirim ke proxy |
| 5 | Halaman login | Frontend | Form login biasa + perekam keystroke |
| 6 | Endpoint proxy | Backend | Teruskan event ke `/api/partner/enroll` atau `/verify` |

---

## 5. Alur User Lengkap

### Pendaftaran (sekali per user baru)

```
1. User isi form sign-up (email + password)
2. Server: simpan user, generate UUID sebagai identitype_id
3. Redirect ke halaman enrollment
4. User mengetik password mereka — keystroke direkam
5. Browser → Server (proxy) → identitype /enroll
6. Ulangi langkah 4–5 sampai `progress.complete === true` (server menentukan jumlah; observasi: 5–10x)
```

### Login (setiap kali user masuk)

```
1. User isi form login (email + password)
2. Server: validasi password
3. Jika password benar → kembalikan identitype_id ke browser
4. Browser kirim keystroke yang baru saja direkam → Server (proxy) → identitype /verify
5. identitype respon: { verified: true, decision: "genuine", confidence_score: 0.92 }
6. Jika verified=true → masuk ke dashboard. Jika false → blokir / minta ulang
```

---

## 6. Implementasi Langkah demi Langkah

### Step 1 — Tabel User

```python
# models.py
import uuid
from . import db
from flask_login import UserMixin

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(150), unique=True)
    password = db.Column(db.String(150))                                  # hash
    identitype_id = db.Column(db.String(100), default=lambda: str(uuid.uuid4()))
```

> `identitype_id` adalah identifier yang Anda kirim ke identitype API sebagai
> `username`. UUID acak lebih aman daripada email user (jangan kirim email
> langsung ke pihak ketiga).

### Step 2 — Sign-up & Login Endpoint

```python
# auth.py
from flask import Blueprint, request, jsonify, make_response
from werkzeug.security import generate_password_hash, check_password_hash
from . import db
from .models import User

auth = Blueprint('auth', __name__)

@auth.route("/api/sign-up", methods=["POST"])
def api_sign_up():
    data = request.get_json()
    email, password = data.get("email"), data.get("password")

    if User.query.filter_by(email=email).first():
        return jsonify({"message": "Email is already used"}), 409
    if len(password) < 7:
        return jsonify({"message": "Password too short"}), 400

    user = User(email=email, password=generate_password_hash(password))
    db.session.add(user); db.session.commit()
    return jsonify({"message": "Created", "user_id": user.identitype_id}), 201


@auth.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json()
    user = User.query.filter_by(email=data.get("email")).first()
    if not user or not check_password_hash(user.password, data.get("password")):
        return jsonify({"message": "Invalid email or password"}), 401
    return jsonify({"message": "OK", "user_id": user.identitype_id}), 200
```

### Step 3 — Klien identitype (helper di server)

Buat satu modul tipis yang membungkus panggilan ke identitype. Tujuannya:
API key, timeout, dan error-handling hanya ada di satu tempat.

```python
# identitype_client.py
import json
import urllib.request, urllib.error

import os
BASE_URL = os.getenv("IDENTITYPE_BASE_URL")  # e.g. https://api.identitype.example.com/api/partner
API_KEY  = os.getenv("IDENTITYPE_API_KEY")   # sk_live_... — JANGAN expose ke frontend

def _post(endpoint, payload):
    req = urllib.request.Request(
        f"{BASE_URL}/{endpoint}",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type":  "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8")), res.status
    except urllib.error.HTTPError as e:
        body = json.loads(e.read().decode("utf-8") or "{}")
        body.setdefault("success", False)
        body["http_status"] = e.code
        return body, e.code

def enroll(identitype_id, events):
    return _post("enroll", {"username": identitype_id, "events": events})

def verify(identitype_id, events):
    return _post("verify", {"username": identitype_id, "events": events})
```

### Step 4 — Endpoint Proxy

```python
# views.py
from flask import Blueprint, request, jsonify
from .identitype_client import enroll, verify

views = Blueprint("views", __name__)

@views.route("/identitype", methods=["POST"])
def identitype_proxy():
    data = request.get_json() or {}
    user_id = data.get("username")
    events  = data.get("events")
    mode    = data.get("mode", "verify")

    if not user_id or not isinstance(events, list) or not events:
        return jsonify({"error": "Bad request"}), 400

    if mode == "enroll":
        body, status = enroll(user_id, events)
        return jsonify({"enroll": body}), status
    else:
        body, status = verify(user_id, events)
        return jsonify({"verify": body}), status
```

### Step 5 — Perekam Keystroke di Browser

Pakai `recorder.js` dari simulasi ini (lihat
[`website/static/recorder.js`](../website/static/recorder.js)). Tinggal
import dan instantiate:

```javascript
import { Keystroke } from "./recorder.js";

const recorder = new Keystroke();

// Daftarkan input mana yang akan direkam.
// PENTING: target saat enroll dan verify HARUS sama.
recorder.addTarget("password");

// Ambil event saat user submit:
const events = recorder.getEvents();
```

### Step 6 — Frontend: Halaman Enrollment

```javascript
async function submitEnrollment(identitypeId, password) {
  // 1. Pastikan password yang diketik sama dengan yang didaftarkan
  //    (lihat bagian "Pelajaran dari Simulasi" untuk alasannya)
  const v = await fetch("/api/verify-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: identitypeId, password }),
  }).then(r => r.json());

  if (!v.match) {
    showError("Password tidak cocok dengan yang Anda daftarkan.");
    return;
  }

  // 2. Kirim keystroke ke proxy mode enroll
  const events = recorder.getEvents();
  const res = await fetch("/identitype", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: identitypeId,
      events: events,
      mode: "enroll",
    }),
  });

  const body = await res.json();
  const api  = body.enroll || {};

  if (api.success) {
    showInfo(`Tersimpan ${api.templates_count} / ${api.required_templates}`);
    if (api.templates_count >= api.required_templates) {
      window.location.href = "/login";
    } else {
      window.location.reload();  // enroll lagi
    }
  } else {
    showError(api.message || "Enrollment gagal");
  }

  recorder.reset();
}
```

### Step 7 — Frontend: Halaman Login + Verify

```javascript
async function loginAndVerify(email, password) {
  // 1. Validasi password biasa
  const login = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then(r => r.json());

  if (!login.user_id) {
    showError(login.message);
    return;
  }

  // 2. Verifikasi pola ketikan
  const events = recorder.getEvents();
  const res = await fetch("/identitype", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: login.user_id,
      events: events,
      mode: "verify",
    }),
  });

  const body = await res.json();
  const api  = body.verify || {};

  if (api.success && api.verified && api.decision === "genuine") {
    window.location.href = "/dashboard";
  } else {
    showError(`Pola ketikan tidak cocok (confidence: ${api.confidence_score})`);
  }

  recorder.reset();
}
```

### Step 8 — Endpoint Validasi Password (opsional tapi disarankan)

```python
# auth.py — tambahkan endpoint ini
@auth.route("/api/verify-password", methods=["POST"])
def api_verify_password():
    data = request.get_json() or {}
    user = User.query.filter_by(identitype_id=data.get("user_id")).first()
    if not user or not check_password_hash(user.password, data.get("password", "")):
        return jsonify({"match": False, "message": "Password tidak cocok"}), 401
    return jsonify({"match": True}), 200
```

Lihat bagian [Pelajaran dari Simulasi](#8-pelajaran-dari-simulasi-bug-umum)
untuk alasan kenapa langkah ini penting.

---

## 7. Penanganan Error

Field yang penting di setiap respons identitype:

| Field | Arti |
|---|---|
| `success` | `false` artinya request ditolak |
| `error_code` | Kode mesin (lihat tabel di bawah) |
| `message` | Pesan untuk ditampilkan / dilog |
| `verified` | (verify) `true` jika ritme cocok |
| `decision` | (verify) `"genuine"` atau `"impostor"` |
| `confidence_score` | (verify) 0.0–1.0 |
| `templates_count` / `required_templates` | (enroll) progress enrollment |

### Kode Error yang Wajib Ditangani

| `error_code` | Mode | Aksi yang disarankan |
|---|---|---|
| `INSUFFICIENT_SAMPLES` | verify | User belum cukup enroll → arahkan kembali ke halaman enrollment |
| `INSUFFICIENT_ENROLLMENT` | verify | Sama seperti di atas |
| `INVALID_KEYSTROKE_DATA` | both | Data terlalu pendek / inkonsisten → minta user ulang dengan tip ("ketik natural, hindari backspace") |
| `INVALID_USERNAME` | both | `username` tidak terdaftar di identitype — biasanya user belum pernah enroll |
| `RATE_LIMIT_EXCEEDED` | both | Tunggu beberapa saat, jangan retry otomatis tanpa backoff |
| `UNKNOWN` / `null` + status 4xx | verify | Model masih training — tampilkan info, suruh coba lagi |

---

## 8. Pelajaran dari Simulasi (Bug Umum)

Bug-bug ini kami temukan saat membangun simulasi. Hindari sejak awal.

### 8.1 Target perekam HARUS sama antara enroll dan verify

❌ **Salah:** saat enroll merekam hanya `password`, saat login merekam
`email` + `password`.

✅ **Benar:** keduanya hanya merekam `password`.

Kalau berbeda, model dilatih pada pola yang tidak akan pernah user ulangi
saat login. Hasil verify pasti `impostor`.

### 8.2 Validasi password sebelum enroll

User bisa saja mengetik password yang berbeda saat enrollment
(karena form-nya hanya menerima input bebas). Model jadi belajar ritme
password yang salah → saat login, ritme password yang benar dianggap
impostor.

**Solusi:** validasi password ke database sebelum mengirim keystroke ke
`/enroll` (lihat Step 8 di atas).

### 8.3 Submit ganda

Kalau form punya `<button type="submit">` dan Anda pasang listener di
**button click** **dan** **form submit**, keduanya akan jalan saat user
klik tombol. Hasilnya: dua kali fetch, dua kali toast, kemungkinan dua
sampel enrollment terkirim.

**Solusi:** pakai **hanya** listener `submit` di form.

### 8.4 Jangan reset email field saat gagal autentikasi

Setelah login gagal, kosongkan **hanya password**. Memaksa user mengetik
ulang email-nya menyebalkan dan tidak menambah keamanan.

### 8.5 Default `required_templates` jangan di-hardcode

identitype bisa mengubah minimum sampel (saat ini 5). Selalu baca nilai dari
respons API, gunakan fallback hanya jika field tidak ada:

```javascript
const required = api.required_templates || api.min_templates || 5;
```

### 8.6 API key tidak boleh ada di browser

Selalu lewat server proxy. Jika API key bocor, siapa pun bisa enroll/verify
atas nama Anda dan menghabiskan kuota Anda.

### 8.7 Simpan progress enrollment di server, bukan sessionStorage

`sessionStorage` hilang saat user tutup tab atau ganti device.
Idealnya `templates_count` dibaca dari respons identitype setiap kali, bukan
dihitung sendiri di client.

---

## 9. Keamanan — Wajib Dibaca

Kenyataan yang harus Anda pahami sebelum deploy:

### 9.1 Password user **terbaca** dari payload keystroke

Setiap event berisi field `key` (contoh: `"key": "U"`, `"key": "m"`).
Disusun berurutan, mereka **literal mengeja password user**. Artinya
siapa pun yang bisa membaca payload — proxy MITM, log server, Burp
history, database identitype — bisa merekonstruksi password.

Ini sifat inheren dari sistem keystroke dynamics: identitype butuh tahu
karakter mana yang ditekan untuk analisis pola. Jadi tugas mitigasi
**bukan menyembunyikan datanya**, melainkan:

| Aksi | Tujuan |
|---|---|
| **HTTPS wajib di semua lapisan** | Browser↔mitra dan mitra↔identitype. Tanpa TLS, password plain text di kabel. |
| **Jangan log payload** | Log hanya metadata: mode, jumlah event, success/decision. Lihat [identitype.py](../website/identitype.py) — di simulasi `print(payload)` sudah dihapus. |
| **API key di env var** | Tidak boleh hard-coded di source code. |
| **Username = UUID, bukan email** | Jangan kirim PII ke pihak ketiga sebagai identifier. |

### 9.2 Proxy server-to-server: kenapa Burp tidak melihatnya

Saat browser ↔ Flask di-proxy lewat Burp, request itu **terlihat**.
Tapi Flask ↔ identitype lewat `urllib` Python yang tidak ikut proxy
browser — itulah kenapa request kedua tidak muncul di Burp history.

Untuk debugging dengan Burp:

```powershell
$env:HTTP_PROXY  = "http://127.0.0.1:8080"
$env:HTTPS_PROXY = "http://127.0.0.1:8080"
python main.py
```

**Jangan pakai ini di produksi.**

### 9.3 Konfigurasi via Environment Variable

Simulasi ini sekarang membaca semua secret dari env (lihat
[.env.example](../.env.example)):

```bash
IDENTITYPE_BASE_URL=https://api.identitype.example.com/api/partner
IDENTITYPE_API_KEY=<your-identitype-api-key>
IDENTITYPE_TIMEOUT_SECONDS=30
FLASK_SECRET_KEY=<random 32+ chars>
FLASK_DEBUG=0
```

Cara load di Python tanpa dependency tambahan:

```python
# identitype.py
import os
API_KEY  = os.getenv("IDENTITYPE_API_KEY",  "")
BASE_URL = os.getenv("IDENTITYPE_BASE_URL", "")
```

Untuk dev convenience pakai `python-dotenv`:

```bash
pip install python-dotenv
```

```python
# main.py paling atas
from dotenv import load_dotenv; load_dotenv()
```

### 9.4 Pesan Error: Apa yang Boleh Diteruskan ke Client

Aturan: detail teknis di log, pesan generic di response.

| Skenario | Yang ditampilkan ke user | Yang di-log server-side |
|---|---|---|
| Network unreachable | `"Service temporarily unavailable"` | `WinError 10060`, hostname, errno |
| Timeout | `"Service did not respond in time"` | `socket.timeout`, durasi |
| 5xx upstream | `"Service returned an error"` | Status code, response body |
| 4xx upstream dengan `error_code` | Pesan dari identitype (sudah aman) | Sama + http_status |

Implementasinya di [identitype.py](../website/identitype.py) — `urllib.error.URLError`,
`socket.timeout`, dan `HTTPError 5xx` semua disanitasi.

### 9.5 Validasi Input di Proxy

Endpoint `/identitype` mitra **tidak boleh** percaya begitu saja apa yang
dikirim browser. Validasi sebelum forward:

- `username` non-empty dan berasal dari user yang sedang login
  (cocokkan dengan session — di simulasi belum, tapi wajib di produksi)
- `events` adalah array non-empty
- `mode` ∈ {`enroll`, `verify`}
- Batas atas jumlah event (mis. 5000) untuk cegah abuse

Tanpa ini, user A bisa kirim username user B dan menggangu
enrollment/verify orang lain.

### 9.6 Session Binding (Belum ada di Simulasi — Wajib di Prod)

Saat ini frontend simulasi menyimpan `user_id` di `sessionStorage` dan
mengirimnya ke `/identitype`. Server menerimanya apa adanya. **Ini tidak
aman.** Di produksi:

1. Setelah login berhasil → server set Flask session (`session["user_id"] = ...`)
2. Endpoint `/identitype` baca `user_id` dari session, **abaikan body request**
3. Sehingga client tidak bisa mengubah username untuk membajak enrollment
   orang lain

### 9.7 Yang Bergantung pada Sisi identitype (Bukan Mitra)

Beberapa kontrol keamanan tidak bisa Anda lakukan dari mitra — harus
diterapkan oleh tim identitype: TLS endpoint, encryption at rest untuk
template biometrik, rate limiting per-username, rotasi API key, dan
sanitasi error response. Koordinasi dengan tim penyedia API untuk
memastikan kontrol-kontrol ini ada sebelum go-live.

---

## 10. Checklist Sebelum Produksi

### Keamanan
- [ ] **HTTPS** untuk browser ↔ Anda (TLS dari reverse proxy)
- [ ] **HTTPS** untuk Anda ↔ identitype (`IDENTITYPE_BASE_URL=https://…`)
- [ ] API key di environment variable, bukan source code
- [ ] `FLASK_SECRET_KEY` di env, 32+ karakter acak
- [ ] `FLASK_DEBUG=0` di produksi (interactive debugger = RCE bagi attacker)
- [ ] Endpoint `/identitype` proxy hanya bisa dipanggil oleh user yang
      sudah login; `username` diambil dari **session**, bukan body request
- [ ] Validasi `events` di server: array, non-empty, max length wajar
- [ ] Rate limit di endpoint proxy mitra (mis. 5 req/menit per user)
- [ ] Password user di-hash dengan `werkzeug.security` atau setara
      (di simulasi ini sudah, lihat [auth.py](../website/auth.py))
- [ ] CORS dikonfigurasi ketat di domain Anda
- [ ] **Logging hanya metadata** — tidak pernah `print(events)` atau
      `print(payload)`. Lihat [identitype.py](../website/identitype.py) dan
      [views.py](../website/views.py)
- [ ] `.env` ada di `.gitignore`; pastikan tidak masuk git history

### Reliability
- [ ] Timeout pada panggilan ke identitype (kami pakai 30 detik)
- [ ] Tangani `503`/`502` dari identitype dengan graceful fallback
- [ ] Logging request/response (jangan log password!)

### UX
- [ ] Tampilkan progress enrollment (`3 of 5`)
- [ ] Jangan pakai `alert()` — pakai toast/inline message
- [ ] Setelah verify gagal, kosongkan **hanya password**, fokus ke field
      password, biarkan email tetap
- [ ] Sediakan "Forgot rhythm?" / cara re-enroll untuk user yang
      ritmenya berubah (misal cedera tangan)

### Compliance
- [ ] Beri tahu user di privacy notice bahwa data ritme ketikan dikirim
      ke pihak ketiga (identitype)
- [ ] Jangan kirim PII (email, nama) sebagai `username` identitype — pakai
      UUID acak

---

## Referensi File di Simulasi

Daftar semua file yang ada di repository ini beserta peran masing-masing.
Gunakan ini sebagai peta saat membaca code.

### Akar Project

| File | Peran |
|---|---|
| [`main.py`](../main.py) | Entry point. Load `.env`, buat Flask app, jalankan server. |
| [`requirements.txt`](../requirements.txt) | Dependency Python: Flask, Flask-SQLAlchemy, Flask-Login, python-dotenv. |
| [`.env.example`](../.env.example) | Template environment variable. Copy ke `.env` lalu isi nilai asli. |
| `.env` | **Tidak di-commit.** Isi: `IDENTITYPE_BASE_URL`, `IDENTITYPE_API_KEY`, `FLASK_SECRET_KEY`. |
| [`.gitignore`](../.gitignore) | Daftar file yang TIDAK boleh masuk git: `.env`, `instance/`, `.venv`, dll. |
| [`README.md`](../README.md) | Ringkasan project + cara setup singkat. |

### Backend Flask — `website/`

| File | Peran |
|---|---|
| [`__init__.py`](../website/__init__.py) | App factory. Load `FLASK_SECRET_KEY` dari env, register blueprint, init database. |
| [`models.py`](../website/models.py) | Model `User` (SQLAlchemy): kolom `email`, `password` (hash), dan UUID identifier yang dikirim ke identitype sebagai `username`. |
| [`auth.py`](../website/auth.py) | Endpoint JSON: `/api/sign-up`, `/api/login`, `/api/verify-password`. Pakai `werkzeug.security` untuk hash + compare password. |
| [`views.py`](../website/views.py) | Endpoint halaman (home, dashboard, enrollment) + **endpoint proxy `/identitype`** yang menerima keystroke dari browser dan meneruskan ke API identitype. |
| [`identitype.py`](../website/identitype.py) | **Klien HTTP ke API identitype.** Baca `IDENTITYPE_*` env, kirim Bearer token, sanitize error message sebelum dikirim balik ke browser. Tidak pernah log payload. |

### Frontend Static — `website/static/`

| File | Peran |
|---|---|
| [`recorder.js`](../website/static/recorder.js) | **Library perekam keystroke.** Class `Keystroke` yang attach ke input field, rekam keydown/keyup, kembalikan array event. Drop-in module — bisa dipakai standalone. |
| [`index.js`](../website/static/index.js) | Glue frontend: bind form submit, panggil `/api/login` lalu `/identitype`, handle error code, redirect ke dashboard saat verify sukses. |
| [`toast.js`](../website/static/toast.js) | Komponen notifikasi minim (pengganti `alert()`). Expose `window.toast.success/error/warning/info`. |
| [`toast.css`](../website/static/toast.css) | Styling untuk toast — slide-in dari top-right, auto-dismiss. |
| [`style.css`](../website/static/style.css) | Stylesheet utama. Font Fraunces + Inter, palette minimalis. |

### Frontend Templates — `website/templates/`

| File | Peran |
|---|---|
| [`base.html`](../website/templates/base.html) | Layout induk: nav, toast container, link CSS/JS. Semua page extends ini. |
| [`home.html`](../website/templates/home.html) | Landing page dengan dua CTA (sign-up / login). |
| [`sign_up.html`](../website/templates/sign_up.html) | Form pendaftaran. Submit → `/api/sign-up` → redirect ke enrollment. |
| [`typing_patterns.html`](../website/templates/typing_patterns.html) | Form enrollment. User mengetik password berulang-kali; tiap submit kirim keystroke ke `/identitype` mode `enroll`. |
| [`login.html`](../website/templates/login.html) | Form login. Submit → `/api/login` → `/identitype` mode `verify` → dashboard. |
| [`dashboard.html`](../website/templates/dashboard.html) | Halaman setelah login sukses: `Hello, <email>` + tombol sign out. |

### Database

| Path | Peran |
|---|---|
| `instance/database.db` | **Tidak di-commit.** SQLite database lokal yang dibuat otomatis saat `python main.py` pertama kali. Berisi akun user (email + hash password + UUID identifier identitype). |

### Dokumentasi — `docs/`

| File | Peran |
|---|---|
| [`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md) | Reference lengkap REST API identitype: request/response per endpoint, error codes, contoh cURL. |
| [`PARTNER_INTEGRATION_GUIDE.md`](./PARTNER_INTEGRATION_GUIDE.md) | **Dokumen ini.** Panduan implementasi step-by-step + best practice. |
| [`identitype_Postman_Collection.json`](./identitype_Postman_Collection.json) | Postman collection siap import untuk testing endpoint `enroll` & `verify`. |

### Yang Wajib Mitra Punya (Minimum)

Kalau Anda implementasi ulang di stack lain, **minimal** enam komponen ini:

1. **Sebuah klien HTTP** ke identitype (analog [`identitype.py`](../website/identitype.py)) — baca API key dari env, kirim Bearer token, sanitize error.
2. **Endpoint proxy** di backend Anda (analog [`views.py /identitype`](../website/views.py)) — validasi input, panggil klien #1, return response ke browser.
3. **Perekam keystroke** di frontend (analog [`recorder.js`](../website/static/recorder.js)) — bisa pakai file ini langsung sebagai drop-in.
4. **Form enrollment** yang merekam password user beberapa kali (analog [`typing_patterns.html`](../website/templates/typing_patterns.html)).
5. **Form login** yang merekam keystroke + kirim ke proxy mode `verify` (analog [`login.html`](../website/templates/login.html) + bagian relevan di [`index.js`](../website/static/index.js)).
6. **Tabel user** dengan kolom UUID untuk identifier yang dikirim ke identitype sebagai `username` (analog [`models.py`](../website/models.py)).

Setiap komponen ini bisa Anda copy-adapt dari simulasi.
