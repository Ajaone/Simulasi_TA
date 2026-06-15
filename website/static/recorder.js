/**
 * Keystroke Dynamics Recorder
 *
 * Merekam event keydown/keyup untuk keperluan autentikasi biometrik.
 * Digunakan bersama endpoint identitype Partner API:
 *   POST /api/partner/enroll
 *   POST /api/partner/verify
 */

'use strict';

// ── Konstanta ──────────────────────────────────────────────────────────────────

const KS_VERSION    = '1.0.0';
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);
const SPECIAL_KEYS  = new Set(['Backspace', 'Tab', ' ']);

// ── Helper Functions ───────────────────────────────────────────────────────────

function nowMs() {
    return (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
}

function isEditableTarget(el) {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable) return true;

    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return true;

    if (tag === 'input') {
        const type = String(el.type || 'text').toLowerCase();
        return type !== 'button' && type !== 'submit' && type !== 'reset';
    }

    return false;
}

function resolveElement(inputOrSelector) {
    if (!inputOrSelector) {
        throw new Error('Target element or selector is required');
    }
    if (typeof inputOrSelector !== 'string') {
        return inputOrSelector;
    }

    let el = document.querySelector(inputOrSelector);
    if (!el && !inputOrSelector.startsWith('#') && !inputOrSelector.startsWith('.')) {
        el = document.getElementById(inputOrSelector);
    }
    if (!el) {
        throw new Error('Target tidak ditemukan: ' + inputOrSelector);
    }
    return el;
}

function simpleHash(input) {
    const str = String(input || '').toLowerCase();
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return h >>> 0;
}

// ── Keystroke Class ────────────────────────────────────────────────────────────

export class Keystroke {
    constructor(options = {}) {
        this.version = KS_VERSION;

        // Konfigurasi
        this._maxHistoryLength     = Number(options.maxHistoryLength)     > 0 ? Math.floor(options.maxHistoryLength)     : 2000;
        this._defaultHistoryLength = Number(options.defaultHistoryLength) > 0 ? Math.floor(options.defaultHistoryLength) : 160;
        this._minEvents            = Number(options.minEvents)            > 0 ? Math.max(1, options.minEvents)           : 4;
        this._maxSeekTime          = Number(options.maxSeekTime)          > 0 ? options.maxSeekTime                      : 2000;
        this._maxPressTime         = Number(options.maxPressTime)         > 0 ? options.maxPressTime                     : 800;
        this._includeModifiers     = !!options.includeModifiers;
        this._captureSpecialKeys   = options.captureSpecialKeys !== false;
        this._captureRepeat        = options.captureRepeat !== false;
        this._normalizeTime        = !!options.normalizeTime;

        // State
        this._recording   = false;
        this._events      = [];
        this._activeKeys  = {};
        this._targets     = {};   // { elementId: true }
        this._targetCount = 0;
        this._startedAt   = null;

        // Bound handlers — disimpan agar bisa dilepas lewat removeEventListeners()
        this._onKeyDown = (e) => this._handleKeyDown(e);
        this._onKeyUp   = (e) => this._handleKeyUp(e);
        this._listenersAttached = false;

        this._attachListeners();

        // Daftarkan target awal jika ada di options
        if (Array.isArray(options.targets)) {
            for (const t of options.targets) this.addTarget(t);
        }

        // Mulai rekam secara otomatis (bisa dinonaktifkan via autoStart: false)
        if (options.autoStart !== false) this.start();
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    /** Mulai merekam event ketikan. */
    start() {
        this._recording = true;
        return this._recording;
    }

    /** Hentikan perekaman. */
    stop() {
        this._recording = false;
        return this._recording;
    }

    /**
     * Hapus semua data yang sudah terekam.
     * @param {boolean} all  Jika true, hapus juga daftar target terdaftar.
     */
    reset(all = false) {
        this._events     = [];
        this._activeKeys = {};
        this._startedAt  = null;
        if (all) {
            this._targets     = {};
            this._targetCount = 0;
        }
    }

    /** Lepas event listener dari document. */
    removeEventListeners() {
        if (!this._listenersAttached || typeof document === 'undefined') return;
        document.removeEventListener('keydown', this._onKeyDown, true);
        document.removeEventListener('keyup',   this._onKeyUp,   true);
        this._listenersAttached = false;
    }

    // ── Manajemen Target ───────────────────────────────────────────────────────

    /**
     * Daftarkan input/textarea tertentu sebagai target rekaman.
     * Ketukan di luar target yang terdaftar akan diabaikan.
     * @param {string|HTMLElement} inputOrSelector  ID, CSS selector, atau elemen langsung.
     * @returns {string} ID elemen yang terdaftar.
     */
    addTarget(inputOrSelector) {
        const el = resolveElement(inputOrSelector);
        if (!el.id) {
            el.id = 'ks-' + simpleHash(String(nowMs()) + Math.random());
        }
        if (!this._targets[el.id]) {
            this._targets[el.id] = true;
            this._targetCount++;
        }
        return el.id;
    }

    /**
     * Hapus target dari daftar rekaman.
     * @param {string|HTMLElement} inputOrSelector
     */
    removeTarget(inputOrSelector) {
        let id = null;
        if (typeof inputOrSelector === 'string') {
            id = inputOrSelector.startsWith('#') ? inputOrSelector.slice(1) : inputOrSelector;
        } else if (inputOrSelector && inputOrSelector.id) {
            id = inputOrSelector.id;
        }
        if (id && this._targets[id]) {
            delete this._targets[id];
            this._targetCount--;
        }
    }

    // ── Akses Data ─────────────────────────────────────────────────────────────

    /**
     * Ambil array event yang terekam.
     * @param {Object} options
     * @param {number}  options.length         Batasi jumlah event (ambil N event terakhir).
     * @param {boolean} options.normalizeTime  Normalisasi waktu mulai dari 0.
     * @returns {Array<{evt: string, key: string, code: string, t: number}>}
     */
    getEvents(options = {}) {
        const maxLen    = typeof options.length        === 'number'  ? options.length        : null;
        const normalize = typeof options.normalizeTime === 'boolean' ? options.normalizeTime : this._normalizeTime;
        return this._cloneEvents(this._events, normalize, maxLen);
    }

    /** Jumlah event yang tersimpan saat ini. */
    getLength() {
        return this._events.length;
    }

    /**
     * Cek apakah data yang terekam sudah cukup untuk dikirim.
     * @param {number} minEvents  Override minimum event (opsional).
     */
    hasEnoughData(minEvents) {
        const threshold = typeof minEvents === 'number' ? minEvents : this._minEvents;
        return this._events.length >= threshold;
    }

    /** Durasi rekaman dalam detik sejak event pertama. */
    getElapsedSeconds() {
        return this._startedAt === null ? 0 : (nowMs() - this._startedAt) / 1000;
    }

    /**
     * Hitung hash 32-bit dari teks (berguna sebagai textId).
     * @param {string} text
     * @returns {number}
     */
    getTextId(text) {
        return simpleHash(String(text || ''));
    }

    // ── Informasi Lingkungan ───────────────────────────────────────────────────

    /** Menghasilkan informasi browser saat ini. */
    checkEnvironment() {
        const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '').toLowerCase() : '';
        let browserType = 'unknown';

        if      (ua.includes('edg/'))                          browserType = 'edge';
        else if (ua.includes('firefox'))                       browserType = 'firefox';
        else if (ua.includes('opr/') || ua.includes('opera')) browserType = 'opera';
        else if (ua.includes('chrome'))                        browserType = 'chrome';
        else if (ua.includes('safari'))                        browserType = 'safari';

        return { browserType };
    }

    // ── Payload Builder ────────────────────────────────────────────────────────

    /**
     * Buat objek payload siap kirim ke endpoint identitype.
     * @param {Object} params
     * @param {string} params.username  Username / UUID pengguna (wajib).
     * @returns {{ username: string, events: Array }}
     */
    buildPayload(params = {}) {
        if (!params.username || !String(params.username).trim()) {
            throw new Error('username is required');
        }
        return {
            username: String(params.username).trim(),
            events:   this.getEvents({ normalizeTime: this._normalizeTime }),
        };
    }

    // ── Private Methods ────────────────────────────────────────────────────────

    _attachListeners() {
        if (this._listenersAttached || typeof document === 'undefined' || !document.addEventListener) return;
        document.addEventListener('keydown', this._onKeyDown, true);
        document.addEventListener('keyup',   this._onKeyUp,   true);
        this._listenersAttached = true;
    }

    _isTargetAllowed(target) {
        if (!isEditableTarget(target)) return false;
        if (this._targetCount === 0) return true;
        return !!(target && target.id && this._targets[target.id]);
    }

    _isEventAllowed(event) {
        if (!this._recording)                         return false;
        if (!this._isTargetAllowed(event.target))     return false;
        if (event.key === 'Enter')                    return false;

        const isModifier = MODIFIER_KEYS.has(event.key);
        if (!this._includeModifiers && isModifier)    return false;

        if (event.key && event.key.length > 1 && !isModifier) {
            if (!this._captureSpecialKeys || !SPECIAL_KEYS.has(event.key)) return false;
        }

        return true;
    }

    _handleKeyDown(event) {
        if (!this._isEventAllowed(event)) return;

        const now      = nowMs();
        const identity = event.code || event.key || 'unknown';

        // Abaikan key-repeat jika dikonfigurasi demikian
        if (!this._captureRepeat && this._activeKeys[identity]) return;

        if (this._startedAt === null) this._startedAt = now;

        this._activeKeys[identity] = now;
        this._pushEvent({ evt: 'd', key: event.key || '', code: event.code || '', t: now });
    }

    _handleKeyUp(event) {
        if (!this._isEventAllowed(event)) return;

        const identity = event.code || event.key || 'unknown';
        if (!this._activeKeys[identity]) return;

        delete this._activeKeys[identity];
        const now = nowMs();
        this._pushEvent({ evt: 'u', key: event.key || '', code: event.code || '', t: now });
    }

    _pushEvent(evt) {
        this._events.push(evt);
        if (this._events.length > this._maxHistoryLength) {
            this._events.shift();
        }
    }

    _cloneEvents(events, normalizeTime, maxLength) {
        let source = events;
        if (typeof maxLength === 'number' && maxLength > 0 && source.length > maxLength) {
            source = source.slice(source.length - maxLength);
        }

        if (!normalizeTime || source.length === 0) {
            return source.map(e => ({ evt: e.evt, key: e.key, code: e.code, t: e.t }));
        }

        const t0 = source[0].t;
        return source.map(e => ({
            evt:  e.evt,
            key:  e.key,
            code: e.code,
            t:    Number((e.t - t0).toFixed(4)),
        }));
    }
}
