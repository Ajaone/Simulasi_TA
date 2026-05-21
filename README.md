# Keystroke Biometric Authentication Demo

A simple Flask web application that demonstrates two-factor authentication using
keystroke dynamics. The app records typing patterns from the user and verifies
them against a backend SecAuth Partner API.

## Stack
- Flask + SQLAlchemy (SQLite)
- Vanilla JavaScript keystroke recorder
- SecAuth Partner API for enroll/verify

## Run

```bash
pip install -r requirements.txt
python main.py
```

The app starts on `http://127.0.0.1:5000`.
