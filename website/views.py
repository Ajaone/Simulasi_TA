from flask import Blueprint, render_template, request, jsonify, make_response
import logging

from .identitype import send_typing_data

views = Blueprint('views', __name__)
log = logging.getLogger(__name__)


@views.route('/')
def home():
    return render_template("home.html")


@views.route('/typing-patterns')
def typing_patterns():
    return render_template("typing_patterns.html")


@views.route('/dashboard')
def dashboard():
    return render_template("dashboard.html")


@views.route('/identitype', methods=['POST'])
def identitype():
    data = request.get_json(silent=True) or {}

    username = str(data.get('username', '')).strip()
    events = data.get('events')
    mode = str(data.get('mode', 'verify')).lower()

    # NOTE: keystroke events contain the literal characters typed by the user
    # (e.g. password). NEVER log `data` or `events` in plaintext.
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
        mode,
        status,
        upstream.get("success"),
        upstream.get("decision"),
    )

    return make_response(jsonify(response), status)
