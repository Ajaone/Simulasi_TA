"""
SecAuth Partner API client.

PRODUCTION REQUIREMENTS:
- BASE_URL MUST be HTTPS in production. HTTP exposes the API key and the
  keystroke events (which contain the literal characters typed) to anyone on
  the network path.
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

# Config — read from env, fall back to local-dev defaults.
BASE_URL = os.getenv("SECAUTH_BASE_URL", "http://localhost:5000/api/partner")
API_KEY  = os.getenv("SECAUTH_API_KEY", "")
TIMEOUT  = int(os.getenv("SECAUTH_TIMEOUT_SECONDS", "30"))

if BASE_URL.startswith("http://") and not BASE_URL.startswith("http://127.") \
        and not BASE_URL.startswith("http://localhost"):
    log.warning(
        "SECAUTH_BASE_URL uses plain HTTP. Use HTTPS in production — keystroke "
        "events and the API key are sent over the wire."
    )

if not API_KEY:
    log.warning("SECAUTH_API_KEY is not set. Requests to SecAuth will fail.")

# Generic messages — never leak infrastructure detail to the client.
_MSG_UNAVAILABLE = "Authentication service is temporarily unavailable. Please try again in a moment."
_MSG_TIMEOUT     = "Authentication service did not respond in time. Please try again."
_MSG_UPSTREAM    = "Authentication service returned an error. Please try again later."


def _redact_key(k: str) -> str:
    """Show only the first 12 chars of the API key in logs."""
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

    # Log only metadata — never log `payload` (contains keystroke characters).
    log.info(
        "→ SecAuth %s endpoint=%s events_count=%s key=%s",
        "POST",
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
                log.error("SecAuth returned non-JSON response (status=%s)", res.status)
                return {
                    "success":    False,
                    "error_code": "UPSTREAM_ERROR",
                    "message":    _MSG_UPSTREAM,
                }
            log.info(
                "← SecAuth ok status=%s success=%s decision=%s verified=%s",
                res.status,
                parsed.get("success"),
                parsed.get("decision"),
                parsed.get("verified"),
            )
            return parsed

    except urllib.error.HTTPError as e:
        try:
            error_body = e.read().decode("utf-8")
        except Exception:
            error_body = ""

        log.warning("SecAuth HTTP error status=%s", e.code)

        try:
            error_json = json.loads(error_body)
            error_json["http_status"] = e.code
            if "success" not in error_json:
                error_json["success"] = False
            if e.code >= 500:
                # Don't trust upstream messages on 5xx — they may leak internals.
                error_json["message"] = _MSG_UPSTREAM
            return error_json
        except Exception:
            return {
                "success":     False,
                "http_status": e.code,
                "error_code":  "SERVER_ERROR" if e.code >= 500 else "API_ERROR",
                "message":     _MSG_UPSTREAM,
            }

    except (socket.timeout, TimeoutError):
        log.warning("SecAuth timeout after %ss", TIMEOUT)
        return {
            "success":    False,
            "error_code": "SERVICE_TIMEOUT",
            "message":    _MSG_TIMEOUT,
        }

    except urllib.error.URLError as e:
        # str(e) leaks hostname / WinError / errno — log it server-side only.
        log.warning("SecAuth network error: %s", type(e).__name__)
        return {
            "success":    False,
            "error_code": "SERVICE_UNAVAILABLE",
            "message":    _MSG_UNAVAILABLE,
        }

    except Exception as e:
        log.exception("Unexpected error calling SecAuth: %s", type(e).__name__)
        return {
            "success":    False,
            "error_code": "SERVER_ERROR",
            "message":    _MSG_UPSTREAM,
        }


def send_typing_data(username: str, events: list[dict], mode: str = "verify", origin: str | None = None):
    payload = {"username": str(username), "events": events}

    if mode == "enroll":
        return {"enroll": post_partner("enroll", payload, origin=origin)}

    return {"verify": post_partner("verify", payload, origin=origin)}
