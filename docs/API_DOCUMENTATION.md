# SecAuth Keystroke Dynamics — API Documentation

> **Base URL (SecAuth Server):** `<SECAUTH_BASE_URL>` — set per-environment (e.g. via `SECAUTH_BASE_URL` env var). HTTPS in production.
> **API Key:** `<YOUR_API_KEY>` — set via `SECAUTH_API_KEY` env var; never commit to source.
> **Simulation Website Base URL:** `http://localhost:5000` *(adjust to your local port)*

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Event Object Format](#event-object-format)
4. [Endpoints](#endpoints)
   - [POST /api/partner/enroll](#1-post-apipartnerenroll)
   - [POST /api/partner/verify](#2-post-apipartnerverify)
5. [Error Codes Reference](#error-codes-reference)
6. [Postman Collection](#postman-collection)
7. [Integration Guide — Simulasi Website](#integration-guide--simulasi-website)
   - [Architecture Overview](#architecture-overview)
   - [Step 1: Record Keystroke Events](#step-1-record-keystroke-events-front-end)
   - [Step 2: Send to Simulation Proxy](#step-2-send-to-simulation-proxy-endpoint)
   - [Step 3: Proxy Calls SecAuth Partner API](#step-3-proxy-calls-secauth-partner-api)
   - [Complete Flow Diagram](#complete-flow-diagram)
8. [JavaScript SDK — recorder.js](#javascript-sdk--recorderjs)

---

## Overview

SecAuth provides a **biometric keystroke-dynamics authentication** service.  
Partners integrate the service through two REST endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /api/partner/enroll` | Register/learn a user's typing pattern |
| `POST /api/partner/verify` | Authenticate a user against their stored pattern |

A user must enroll **at least once (typically 3 times)** before they can verify.

---

## Authentication

Every request to the SecAuth partner API requires a **Bearer Token** in the `Authorization` header.

```
Authorization: Bearer <YOUR_API_KEY>
```

| Header | Value |
|---|---|
| `Authorization` | `Bearer <API_KEY>` |
| `Content-Type` | `application/json` |

> **Security note:** Never expose your API key in front-end JavaScript. Always route through your server-side proxy (as done in this simulation website via `/secauth`).

---

## Event Object Format

Both endpoints receive an array of raw keystroke events. Each event is captured client-side using the `recorder.js` library.

### Single Event Object

```json
{
  "evt":  "d",
  "key":  "a",
  "code": "KeyA",
  "t":    1234.5678
}
```

| Field | Type | Description |
|---|---|---|
| `evt` | `string` | `"d"` = keydown, `"u"` = keyup |
| `key` | `string` | The logical key value (e.g. `"a"`, `"Shift"`, `" "`) |
| `code` | `string` | Physical key code (e.g. `"KeyA"`, `"Space"`) |
| `t` | `number` | Timestamp in milliseconds (`performance.now()` or `Date.now()`) |

### Example Events Array

```json
[
  { "evt": "d", "key": "p", "code": "KeyP", "t": 0.0 },
  { "evt": "u", "key": "p", "code": "KeyP", "t": 82.5 },
  { "evt": "d", "key": "a", "code": "KeyA", "t": 210.3 },
  { "evt": "u", "key": "a", "code": "KeyA", "t": 295.1 },
  { "evt": "d", "key": "s", "code": "KeyS", "t": 380.0 },
  { "evt": "u", "key": "s", "code": "KeyS", "t": 461.2 }
]
```

---

## Endpoints

### 1. `POST /api/partner/enroll`

Enrolls (saves) a user's typing pattern. Multiple enrollment samples are recommended to build a stable biometric template.

#### Request

```
POST <SECAUTH_BASE_URL>/enroll
Content-Type: application/json
Authorization: Bearer <YOUR_API_KEY>
```

**Body:**

```json
{
  "username": "550e8400-e29b-41d4-a716-446655440000",
  "events": [
    { "evt": "d", "key": "p", "code": "KeyP", "t": 0.0 },
    { "evt": "u", "key": "p", "code": "KeyP", "t": 82.5 },
    { "evt": "d", "key": "a", "code": "KeyA", "t": 210.3 },
    { "evt": "u", "key": "a", "code": "KeyA", "t": 295.1 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `username` | `string` | Yes | Unique user identifier (UUID or any string) |
| `events` | `array` | Yes | Non-empty array of keystroke event objects |

#### Response — Success `200 / 201`

```json
{
  "success": true,
  "message": "Sample 2/10 saved",
  "templates_count": 2,
  "required_templates": 10,
  "min_templates": 10,
  "progress": { "complete": false, "current": 2, "target": 10 },
  "enrollment_count": 2,
  "remaining_quota": 98
}
```

| Field | Type | Description |
|---|---|---|
| `success` | `boolean` | `true` when enrollment was accepted |
| `message` | `string` | Human-readable status |
| `templates_count` | `number` | Number of templates stored so far for this user |
| `required_templates` | `number` | Minimum templates required before verify is available. **Read this from each response — do not hard-code** (server may change the minimum; observed values: 5–10). |
| `min_templates` | `number` | Alias of `required_templates`. |
| `progress` | `object` | `{ complete, current, target }` — convenient progress object. |
| `remaining_quota` | `number` | API quota remaining for the current API key. |

#### Response — Error `400`

```json
{
  "success": false,
  "error_code": "INVALID_KEYSTROKE_DATA",
  "message": "Keystroke data is too short or malformed"
}
```

---

### 2. `POST /api/partner/verify`

Verifies whether the current typing pattern matches the enrolled templates.  
The user must have completed enrollment before calling this endpoint.

#### Request

```
POST <SECAUTH_BASE_URL>/verify
Content-Type: application/json
Authorization: Bearer <YOUR_API_KEY>
```

**Body:**

```json
{
  "username": "550e8400-e29b-41d4-a716-446655440000",
  "events": [
    { "evt": "d", "key": "p", "code": "KeyP", "t": 0.0 },
    { "evt": "u", "key": "p", "code": "KeyP", "t": 79.2 },
    { "evt": "d", "key": "a", "code": "KeyA", "t": 198.4 },
    { "evt": "u", "key": "a", "code": "KeyA", "t": 280.6 }
  ]
}
```

#### Response — Verified `200`

```json
{
  "success": true,
  "verified": true,
  "decision": "genuine",
  "confidence_score": 0.87,
  "confidence_label": "High"
}
```

| Field | Type | Description |
|---|---|---|
| `success` | `boolean` | `true` when the request was processed |
| `verified` | `boolean` | `true` if the user is authenticated |
| `decision` | `string` | `"genuine"` or `"impostor"` |
| `confidence_score` | `number` | Score between `0.0` – `1.0` |
| `confidence_label` | `string` | Human-readable label: `"Low"`, `"Medium"`, `"High"` |

#### Response — Not Verified `200`

```json
{
  "success": true,
  "verified": false,
  "decision": "impostor",
  "confidence_score": 0.21,
  "confidence_label": "Low"
}
```

#### Response — Not Enrolled `404`

```json
{
  "success": false,
  "error_code": "USER_NOT_FOUND",
  "message": "User has not been enrolled yet"
}
```

#### Response — Insufficient Enrollment `400`

```json
{
  "success": false,
  "error_code": "INSUFFICIENT_SAMPLES",
  "templates_count": 3,
  "usable_count": 3,
  "required_templates": 5,
  "message": "Need at least 5 complete enrollment samples to train (have 3 usable out of 3). Submit more enrollment samples and try again."
}
```

> Server can return either `INSUFFICIENT_ENROLLMENT` or `INSUFFICIENT_SAMPLES`. Clients should handle both equivalently.

---

## Error Codes Reference

| `error_code` | HTTP Status | Description |
|---|---|---|
| `INVALID_INPUT` | 400 | Missing or malformed request field |
| `INVALID_KEYSTROKE_DATA` | 400 | Events array is empty, too short, or malformed |
| `INSUFFICIENT_ENROLLMENT` | 400 | User has not completed the minimum enrollment count |
| `INVALID_USERNAME` | 400 | Username format is invalid |
| `USER_NOT_FOUND` | 404 | No enrollment record found for the username |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests from this API key |
| `SERVER_ERROR` | 500 | Internal SecAuth server error |
| `API_ERROR` | 4xx | Generic partner API error |

---

## Postman Collection

Import the file `docs/SecAuth_Postman_Collection.json` into Postman.

### Quick Setup in Postman

1. Open Postman → **Import** → select `SecAuth_Postman_Collection.json`
2. Go to **Collections → SecAuth Partner API → Variables**
3. Set `base_url` to `<SECAUTH_BASE_URL>`
4. Set `api_key` to your Bearer token
5. Set `username` to any UUID you want to test with

### Manual cURL Examples

**Enroll:**
```bash
curl -X POST <SECAUTH_BASE_URL>/enroll \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test-user-001",
    "events": [
      {"evt":"d","key":"p","code":"KeyP","t":0},
      {"evt":"u","key":"p","code":"KeyP","t":85},
      {"evt":"d","key":"a","code":"KeyA","t":210},
      {"evt":"u","key":"a","code":"KeyA","t":295},
      {"evt":"d","key":"s","code":"KeyS","t":380},
      {"evt":"u","key":"s","code":"KeyS","t":461},
      {"evt":"d","key":"s","code":"KeyS","t":520},
      {"evt":"u","key":"s","code":"KeyS","t":601}
    ]
  }'
```

**Verify:**
```bash
curl -X POST <SECAUTH_BASE_URL>/verify \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test-user-001",
    "events": [
      {"evt":"d","key":"p","code":"KeyP","t":0},
      {"evt":"u","key":"p","code":"KeyP","t":80},
      {"evt":"d","key":"a","code":"KeyA","t":205},
      {"evt":"u","key":"a","code":"KeyA","t":290},
      {"evt":"d","key":"s","code":"KeyS","t":375},
      {"evt":"u","key":"s","code":"KeyS","t":455},
      {"evt":"d","key":"s","code":"KeyS","t":510},
      {"evt":"u","key":"s","code":"KeyS","t":595}
    ]
  }'
```

---

## Integration Guide — Simulasi Website

### Architecture Overview

The simulation website acts as a **proxy** between the browser and the SecAuth server. The API key is **never exposed to the browser**.

```
Browser (recorder.js)
       │
       │  POST /secauth  (internal, no API key)
       ▼
Simulation Website (Flask)
  website/views.py → /secauth route
  website/secauth.py → post_partner()
       │
       │  POST /api/partner/enroll  or  /api/partner/verify
       │  Authorization: Bearer <API_KEY>
       ▼
SecAuth Server (<SECAUTH_BASE_URL>)
```

---

### Step 1: Record Keystroke Events (Front-end)

Include `recorder.js` and initialize the `Keystroke` recorder on your page.

```html
<!-- In your HTML -->
<input type="password" id="password" placeholder="Type your password">

<script type="module">
import { Keystroke } from "/static/recorder.js";

// Initialize the recorder
const ks = new Keystroke();

// Attach to the password field
ks.addTarget("password");
ks.start();

document.getElementById("submit-btn").addEventListener("click", () => {
  // Collect recorded events
  const events = ks.getEvents();
  console.log("Captured events:", events.length);
  
  // Reset for next use
  ks.reset();
  
  // Send to your server proxy
  submitWithKeystroke(events);
});
</script>
```

**Important notes:**
- Call `ks.start()` before the user types.
- Call `ks.reset()` after collecting events to clear the buffer.
- A minimum of **4–8 key events** (keydown + keyup pairs) is required.

---

### Step 2: Send to Simulation Proxy Endpoint

From the browser, send the events to your own server's `/secauth` route, **not** directly to SecAuth.

```javascript
async function submitWithKeystroke(events) {
  const payload = {
    username: "USER_UUID_FROM_YOUR_DB",  // e.g. UUID stored after sign-up
    events: events,
    mode: "enroll"  // or "verify"
  };

  const response = await fetch("/secauth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  
  // data.enroll  → if mode was "enroll"
  // data.verify  → if mode was "verify"
  const result = data.enroll || data.verify;

  if (result.success && result.verified) {
    console.log("Authenticated! Confidence:", result.confidence_score);
  } else {
    console.error("Failed:", result.error_code);
  }
}
```

**Proxy request payload (`/secauth`):**

```json
{
  "username": "550e8400-e29b-41d4-a716-446655440000",
  "mode": "enroll",
  "events": [ ... ]
}
```

**Proxy response format:**

```json
{
  "enroll": {
    "success": true,
    "templates_count": 2,
    "required_templates": 10,
    "progress": { "complete": false, "current": 2, "target": 10 }
  }
}
```
or
```json
{
  "verify": {
    "success": true,
    "verified": true,
    "decision": "genuine",
    "confidence_score": 0.87,
    "confidence_label": "High"
  }
}
```

---

### Step 3: Proxy Calls SecAuth Partner API

The Flask proxy in `website/secauth.py` handles forwarding:

```python
# website/secauth.py — read secrets from environment, never hard-code.
import os

BASE_URL = os.getenv("SECAUTH_BASE_URL")  # e.g. https://api.secauth.example.com/api/partner
API_KEY  = os.getenv("SECAUTH_API_KEY")   # sk_live_...

def send_typing_data(username, events, mode="verify"):
    payload = {"username": username, "events": events}
    endpoint = "enroll" if mode == "enroll" else "verify"
    result = post_partner(endpoint, payload)
    return {mode: result}
```

The `/secauth` route in `website/views.py` validates input and calls `send_typing_data`:

```python
@views.route('/secauth', methods=['POST'])
def secauth():
    data = request.get_json()
    username = data.get('username')
    events   = data.get('events')
    mode     = data.get('mode', 'verify')  # "enroll" or "verify"
    
    # Input validation (username, events, mode)...
    
    response = send_typing_data(username, events, mode=mode)
    upstream = response.get(mode, {})
    status   = 200 if upstream.get("success") else 400
    return make_response(jsonify(response), status)
```

---

### Complete Flow Diagram

#### Enrollment Flow

```
User (typing-patterns page)
  1. Types password → recorder.js captures events
  2. Clicks "Enroll" button
  3. Front-end calls POST /secauth  {username, events, mode:"enroll"}
  4. Flask /secauth validates input
  5. Flask calls POST /api/partner/enroll  {username, events}
  6. SecAuth returns {success, templates_count, required_templates}
  7. If templates_count < required_templates → show progress, repeat from step 1
  8. If templates_count >= required_templates → redirect to /login
```

#### Verification Flow (Login)

```
User (login page)
  1. Types email + password → recorder.js captures events
  2. Clicks "Login" button
  3. Front-end calls POST /api/login  {email, password}
  4. Flask returns {user_id} on credential match
  5. Front-end calls POST /secauth  {username: user_id, events, mode:"verify"}
  6. Flask /secauth validates input
  7. Flask calls POST /api/partner/verify  {username, events}
  8. SecAuth returns {success, verified, decision, confidence_score}
  9. If verified && decision=="genuine" → redirect to home
 10. If not verified → show failure message
```

---

## JavaScript SDK — recorder.js

The `recorder.js` file is a self-contained keystroke recorder. Key API:

### Constructor

```javascript
const ks = new Keystroke(options);
```

| Option | Type | Default | Description |
|---|---|---|---|
| `maxHistoryLength` | `number` | `2000` | Max total events stored |
| `defaultHistoryLength` | `number` | `160` | Default events returned by `getEvents()` |
| `maxSeekTime` | `number` | `2000` | Max time between keys (ms) |
| `maxPressTime` | `number` | `800` | Max key hold time (ms) |
| `minEvents` | `number` | `4` | Min events for `hasEnoughData()` |
| `normalizeTime` | `boolean` | `false` | Normalize `t` to start from `0` |
| `autoStart` | `boolean` | `true` | Start recording immediately |

### Methods

| Method | Returns | Description |
|---|---|---|
| `start()` | `boolean` | Begin capturing events |
| `stop()` | `boolean` | Pause capturing |
| `reset(all)` | `void` | Clear event buffer (`all=true` juga reset targets) |
| `addTarget(elementOrSelector)` | `string` | Restrict capture to a specific input |
| `removeTarget(elementOrSelector)` | `void` | Remove an input from tracking |
| `getEvents(options)` | `array` | Get captured event array |
| `hasEnoughData(minEvents)` | `boolean` | Check if minimum events are captured |
| `getLength()` | `number` | Number of events stored |
| `getElapsedSeconds()` | `number` | Seconds elapsed since recording started |
| `getTextId(text)` | `number` | Hash dari teks untuk identifikasi pola |
| `checkEnvironment()` | `object` | Returns `{ browserType }` |
| `buildPayload(params)` | `object` | Build payload siap kirim ke SecAuth API |
| `removeEventListeners()` | `void` | Remove all keyboard event listeners |

### `getEvents()` Options

```javascript
const events = ks.getEvents({
  length: 100,          // Max events to return (latest N)
  normalizeTime: true   // Set first event t=0
});
```

### Minimal Integration Example

```html
<!DOCTYPE html>
<html>
<body>
  <input id="pwd" type="password" placeholder="Your password">
  <button id="btn">Login</button>

  <script type="module">
    import { Keystroke } from "./recorder.js";

    const ks = new Keystroke();
    ks.addTarget("pwd");

    document.getElementById("btn").onclick = async () => {
      if (!ks.hasEnoughData(8)) {
        alert("Please type more characters.");
        return;
      }

      const events = ks.getEvents();
      ks.reset();

      const res = await fetch("/secauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: sessionStorage.getItem("user_id"),
          events: events,
          mode: "verify"
        })
      });

      const { verify } = await res.json();
      if (verify.success && verify.verified) {
        window.location.href = "/";
      } else {
        alert("Authentication failed: " + verify.error_code);
      }
    };
  </script>
</body>
</html>
```
