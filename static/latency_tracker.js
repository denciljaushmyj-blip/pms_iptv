/**
 * latency_tracker.js
 * ───────────────────
 * Place at: static/js/latency_tracker.js
 *
 * Add ONE script tag to your base template (dashboard.html / default.html):
 *   <script src="/static/js/latency_tracker.js"></script>
 *
 * Captures automatically (zero changes to existing JS needed):
 *   - All fetch() calls (API duration)
 *   - All form submits
 *   - All button clicks
 *   - Page load time
 *   - DOM content loaded time
 *   - Modal open/close (via MutationObserver)
 */

(function () {
    'use strict';

    // ── Config ──────────────────────────────────────────────────────────
    const SLOW_THRESHOLD_MS = 500;   // highlight anything slower than this
    const DEBUG_PANEL = true;        // set false in production to hide panel
    const LOG_PREFIX = '[PMS-Latency]';

    // ── Internal log store ───────────────────────────────────────────────
    const _log = [];

    function record(type, label, ms) {
        const entry = {
            type,
            label,
            ms: parseFloat(ms.toFixed(2)),
            slow: ms >= SLOW_THRESHOLD_MS,
            ts: new Date().toLocaleTimeString()
        };
        _log.push(entry);

        const tag = entry.slow ? '⚠️ SLOW' : '✅';
        console.warn(`${LOG_PREFIX} ${tag} ${type}: ${label} = ${ms.toFixed(2)}ms`);

        if (DEBUG_PANEL) _updatePanel(entry);
    }

    // ── 1. Page load time ────────────────────────────────────────────────
    window.addEventListener('load', function () {
        const nav = performance.getEntriesByType('navigation')[0];
        if (nav) {
            record('PAGE_LOAD', document.title || window.location.pathname, nav.loadEventEnd - nav.startTime);
            record('DOM_READY', 'DOMContentLoaded', nav.domContentLoadedEventEnd - nav.startTime);
        }
    });

    // ── 2. Fetch interceptor (all API calls) ─────────────────────────────
    const _origFetch = window.fetch;
    window.fetch = function (input, init) {
        const url = (typeof input === 'string') ? input : input.url;
        const label = _shortUrl(url);
        const t0 = performance.now();

        return _origFetch.apply(this, arguments).then(function (response) {
            const ms = performance.now() - t0;
            // Also read X-Response-Time-Ms header if backend set it
            const serverMs = response.headers.get('X-Response-Time-Ms');
            record('API_CALL', label, ms);
            if (serverMs) {
                record('SERVER_TIME', label, parseFloat(serverMs));
            }
            return response;
        }).catch(function (err) {
            const ms = performance.now() - t0;
            record('API_ERROR', label, ms);
            throw err;
        });
    };

    // ── 3. Form submit timing ────────────────────────────────────────────
    document.addEventListener('submit', function (e) {
        const form = e.target;
        const label = form.getAttribute('action') || form.id || 'form-submit';
        const t0 = performance.now();

        // Record immediately (timing the submit action itself)
        record('FORM_SUBMIT', label, performance.now() - t0);

        // Store t0 on form so we can measure navigation latency on next load
        try {
            sessionStorage.setItem('pms_form_submit_t0', String(Date.now()));
            sessionStorage.setItem('pms_form_submit_label', label);
        } catch (_) {}
    }, true);

    // If we just came back from a form submit, measure total round-trip
    window.addEventListener('DOMContentLoaded', function () {
        try {
            const t0 = sessionStorage.getItem('pms_form_submit_t0');
            const label = sessionStorage.getItem('pms_form_submit_label');
            if (t0 && label) {
                sessionStorage.removeItem('pms_form_submit_t0');
                sessionStorage.removeItem('pms_form_submit_label');
                const ms = Date.now() - parseInt(t0);
                record('FORM_ROUNDTRIP', label, ms);
            }
        } catch (_) {}
    });

    // ── 4. Button click timing ────────────────────────────────────────────
    document.addEventListener('click', function (e) {
        const btn = e.target.closest('button, [role="button"], .btn, input[type="submit"]');
        if (!btn) return;

        const label = btn.textContent.trim().slice(0, 40)
            || btn.getAttribute('aria-label')
            || btn.id
            || 'button';

        const t0 = performance.now();
        // Use requestAnimationFrame to measure until next render
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                record('BUTTON_CLICK', label, performance.now() - t0);
            });
        });
    }, true);

    // ── 5. Modal / popup open-close (MutationObserver) ───────────────────
    const _modalOpenTime = {};

    const observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            if (m.type !== 'attributes' || m.attributeName !== 'class') return;
            const el = m.target;
            const isModal = el.classList.contains('modal')
                || el.classList.contains('popup')
                || el.classList.contains('dialog')
                || el.getAttribute('role') === 'dialog';
            if (!isModal) return;

            const id = el.id || el.className;
            const visible = el.classList.contains('show')
                || el.classList.contains('active')
                || el.style.display === 'block';

            if (visible) {
                _modalOpenTime[id] = performance.now();
            } else if (_modalOpenTime[id]) {
                record('MODAL_CLOSE', id, performance.now() - _modalOpenTime[id]);
                delete _modalOpenTime[id];
            }
        });
    });

    document.addEventListener('DOMContentLoaded', function () {
        observer.observe(document.body, {
            attributes: true,
            subtree: true,
            attributeFilter: ['class', 'style']
        });
    });

    // ── 6. Search / filter input debounce timing ──────────────────────────
    let _searchTimer = null;
    document.addEventListener('input', function (e) {
        const el = e.target;
        const isSearch = el.type === 'search'
            || el.getAttribute('role') === 'searchbox'
            || (el.id || '').toLowerCase().includes('search')
            || (el.className || '').toLowerCase().includes('search')
            || (el.placeholder || '').toLowerCase().includes('search');
        if (!isSearch) return;

        clearTimeout(_searchTimer);
        const t0 = performance.now();
        _searchTimer = setTimeout(function () {
            record('SEARCH_FILTER', el.id || el.placeholder || 'search', performance.now() - t0);
        }, 300);
    }, true);

    // ── 7. Keyboard shortcut timing ───────────────────────────────────────
    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey || e.altKey) && e.key.length === 1) {
            const combo = `${e.ctrlKey ? 'Ctrl+' : ''}${e.metaKey ? 'Meta+' : ''}${e.altKey ? 'Alt+' : ''}${e.key.toUpperCase()}`;
            const t0 = performance.now();
            requestAnimationFrame(function () {
                record('KEYBOARD_SHORTCUT', combo, performance.now() - t0);
            });
        }
    });

    // ── Helpers ───────────────────────────────────────────────────────────
    function _shortUrl(url) {
        try {
            const u = new URL(url, window.location.origin);
            return u.pathname + (u.search ? u.search.slice(0, 30) : '');
        } catch (_) {
            return String(url).slice(0, 60);
        }
    }

    // ── Debug panel ───────────────────────────────────────────────────────
    let _panel = null;
    let _panelBody = null;

    function _buildPanel() {
        _panel = document.createElement('div');
        _panel.id = 'pms-latency-panel';
        _panel.style.cssText = [
            'position:fixed', 'bottom:10px', 'right:10px', 'z-index:99999',
            'width:340px', 'max-height:320px',
            'background:rgba(10,10,20,0.92)', 'color:#e0e0e0',
            'font:12px/1.5 monospace', 'border-radius:8px',
            'border:1px solid #333', 'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
            'overflow:hidden', 'display:flex', 'flex-direction:column'
        ].join(';');

        // ── Header (drag handle + toggle) ──
        const header = document.createElement('div');
        header.style.cssText = 'padding:6px 10px;background:#1a1a2e;display:flex;justify-content:space-between;align-items:center;cursor:grab;user-select:none;';
        header.innerHTML = '<span style="color:#7eb8f7;font-weight:bold">⏱ PMS Latency <span style="font-size:9px;color:#555;margin-left:4px;">drag me</span></span>'
            + '<span id="pms-lat-toggle" style="color:#aaa;font-size:11px;cursor:pointer;">hide ▾</span>';

        // Toggle only fires on the toggle span, not the whole header
        header.querySelector('#pms-lat-toggle').addEventListener('click', function (e) {
            e.stopPropagation();
            _togglePanel();
        });

        _panelBody = document.createElement('div');
        _panelBody.style.cssText = 'overflow-y:auto;max-height:260px;padding:4px 0;user-select:text;cursor:text;';

        // Prevent clicks/mousedown inside the log area from starting a drag
        _panelBody.addEventListener('mousedown', function (e) {
            e.stopPropagation();
        });

        const footer = document.createElement('div');
        footer.style.cssText = 'padding:4px 10px;background:#111;font-size:10px;color:#555;display:flex;gap:8px;user-select:none;';
        footer.innerHTML = '<span style="cursor:pointer;color:#7eb8f7" onclick="window.__pmsLatencyExport()">⬇ export</span>'
            + '<span style="cursor:pointer;color:#f77" onclick="window.__pmsClear()">✕ clear</span>';

        _panel.appendChild(header);
        _panel.appendChild(_panelBody);
        _panel.appendChild(footer);
        document.body.appendChild(_panel);

        // ── Drag logic ──────────────────────────────────────────────────
        let _dragging = false;
        let _dragOffX = 0;
        let _dragOffY = 0;

        header.addEventListener('mousedown', function (e) {
            // Don't drag if clicking the toggle button
            if (e.target.id === 'pms-lat-toggle') return;

            _dragging = true;
            const rect = _panel.getBoundingClientRect();
            _dragOffX = e.clientX - rect.left;
            _dragOffY = e.clientY - rect.top;

            // Switch from bottom/right anchoring to top/left so drag coords work
            _panel.style.right  = 'auto';
            _panel.style.bottom = 'auto';
            _panel.style.left   = rect.left + 'px';
            _panel.style.top    = rect.top  + 'px';

            header.style.cursor = 'grabbing';
            e.preventDefault();  // only prevent default on header, not on body rows
        });

        document.addEventListener('mousemove', function (e) {
            if (!_dragging) return;
            // If pointer is inside the panel body (text area), don't drag
            if (_panelBody.contains(e.target)) return;

            let newLeft = e.clientX - _dragOffX;
            let newTop  = e.clientY - _dragOffY;

            // Keep panel inside viewport
            const panelW = _panel.offsetWidth;
            const panelH = _panel.offsetHeight;
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth  - panelW));
            newTop  = Math.max(0, Math.min(newTop,  window.innerHeight - panelH));

            _panel.style.left = newLeft + 'px';
            _panel.style.top  = newTop  + 'px';
        });

        document.addEventListener('mouseup', function () {
            if (_dragging) {
                _dragging = false;
                header.style.cursor = 'grab';
            }
        });

        // ── Touch support (mobile) ───────────────────────────────────────
        header.addEventListener('touchstart', function (e) {
            if (e.target.id === 'pms-lat-toggle') return;
            const touch = e.touches[0];
            const rect  = _panel.getBoundingClientRect();
            _dragging = true;
            _dragOffX = touch.clientX - rect.left;
            _dragOffY = touch.clientY - rect.top;
            _panel.style.right  = 'auto';
            _panel.style.bottom = 'auto';
            _panel.style.left   = rect.left + 'px';
            _panel.style.top    = rect.top  + 'px';
            e.preventDefault();
        }, { passive: false });

        document.addEventListener('touchmove', function (e) {
            if (!_dragging) return;
            const touch  = e.touches[0];
            let newLeft  = touch.clientX - _dragOffX;
            let newTop   = touch.clientY - _dragOffY;
            const panelW = _panel.offsetWidth;
            const panelH = _panel.offsetHeight;
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth  - panelW));
            newTop  = Math.max(0, Math.min(newTop,  window.innerHeight - panelH));
            _panel.style.left = newLeft + 'px';
            _panel.style.top  = newTop  + 'px';
            e.preventDefault();
        }, { passive: false });

        document.addEventListener('touchend', function () {
            _dragging = false;
        });
    }

    let _collapsed = false;
    function _togglePanel() {
        _collapsed = !_collapsed;
        _panelBody.style.display = _collapsed ? 'none' : 'block';
        document.getElementById('pms-lat-toggle').textContent = _collapsed ? 'show ▸' : 'hide ▾';
    }

    function _updatePanel(entry) {
        if (!DEBUG_PANEL) return;
        if (!_panel) {
            if (document.body) _buildPanel();
            else { document.addEventListener('DOMContentLoaded', function() { _buildPanel(); _updatePanel(entry); }); return; }
        }

        const row = document.createElement('div');
        const color = entry.slow ? '#ff6b6b' : (entry.ms > 200 ? '#ffd166' : '#06d6a0');
        row.style.cssText = `padding:2px 10px;border-bottom:1px solid #222;color:${color};user-select:text;cursor:text;`;
        row.textContent = `${entry.ts}  ${entry.type.padEnd(14)}  ${String(entry.ms).padStart(7)}ms  ${entry.label}`;

        _panelBody.appendChild(row);
        _panelBody.scrollTop = _panelBody.scrollHeight;
    }

    // ── Public API ────────────────────────────────────────────────────────

    /** Export all captured logs as CSV download */
    window.__pmsLatencyExport = function () {
        const headers = ['Timestamp', 'Type', 'Label', 'Ms', 'Slow'];
        const rows = _log.map(function (e) {
            // Wrap label in quotes to handle commas inside label text
            return [
                e.ts,
                e.type,
                '"' + e.label.replace(/"/g, '""') + '"',
                e.ms,
                e.slow ? 'YES' : 'NO'
            ].join(',');
        });
        const csv = [headers.join(',')].concat(rows).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'pms_latency_' + Date.now() + '.csv';
        a.click();
    };

    /** Clear the panel */
    window.__pmsClear = function () {
        _log.length = 0;
        if (_panelBody) _panelBody.innerHTML = '';
    };

    /** Manually time any async operation */
    window.pmsTrack = async function (label, fn) {
        const t0 = performance.now();
        const result = await fn();
        record('CUSTOM', label, performance.now() - t0);
        return result;
    };

    console.log(`${LOG_PREFIX} Latency tracker loaded. SLOW threshold: ${SLOW_THRESHOLD_MS}ms`);

})();