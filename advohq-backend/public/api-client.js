/**
 * AdvoHQ — Frontend API Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop this script into every HTML page (before any page script).
 * It replaces all localStorage / direct Anthropic calls with
 * authenticated backend requests.
 *
 * Usage in any page:
 *   <script src="/api-client.js"></script>
 *
 * The global `API` object exposes every method the pages need.
 * Token refresh is handled transparently — pages never touch tokens directly.
 */

'use strict';

(function () {

  // ── Storage keys ────────────────────────────────────────────────────────────
  const KEY_ACCESS  = 'advohq_access';
  const KEY_REFRESH = 'advohq_refresh';
  const KEY_USER    = 'advohq_user';

  // ── Low-level fetch wrapper ──────────────────────────────────────────────────
  async function _fetch(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const access  = sessionStorage.getItem(KEY_ACCESS);
    if (access) headers['Authorization'] = `Bearer ${access}`;

    let res = await fetch(url, { ...options, headers });

    // Attempt a single token refresh on 401
    if (res.status === 401 && !options._retry) {
      const refreshed = await _refreshToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${sessionStorage.getItem(KEY_ACCESS)}`;
        res = await fetch(url, { ...options, headers, _retry: true });
      } else {
        _clearAuth();
        window.location.href = '/login.html';
        return;
      }
    }

    // Parse JSON for all responses
    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await res.json()
      : await res.text();

    if (!res.ok) {
      const msg = (typeof body === 'object' ? body.error : body) || `HTTP ${res.status}`;
      throw Object.assign(new Error(msg), { status: res.status, body });
    }

    return body;
  }

  async function _refreshToken() {
    const rt = localStorage.getItem(KEY_REFRESH);
    if (!rt) return false;
    try {
      const res = await fetch('/api/auth/refresh', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      sessionStorage.setItem(KEY_ACCESS, data.access_token);
      return true;
    } catch {
      return false;
    }
  }

  function _clearAuth() {
    sessionStorage.removeItem(KEY_ACCESS);
    localStorage.removeItem(KEY_REFRESH);
    localStorage.removeItem(KEY_USER);
  }

  function _saveAuth(data) {
    sessionStorage.setItem(KEY_ACCESS, data.access_token);
    if (data.refresh_token) localStorage.setItem(KEY_REFRESH, data.refresh_token);
    if (data.user)          localStorage.setItem(KEY_USER, JSON.stringify(data.user));
  }

  function get(url, q)      { return _fetch(url + (q ? '?' + new URLSearchParams(q) : '')); }
  function post(url, body)  { return _fetch(url, { method: 'POST',   body: JSON.stringify(body) }); }
  function put(url, body)   { return _fetch(url, { method: 'PUT',    body: JSON.stringify(body) }); }
  function patch(url, body) { return _fetch(url, { method: 'PATCH',  body: JSON.stringify(body) }); }
  function del(url, body)   { return _fetch(url, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }); }

  // ── Auth helpers ─────────────────────────────────────────────────────────────
  function isLoggedIn() {
    return !!(sessionStorage.getItem(KEY_ACCESS) || localStorage.getItem(KEY_REFRESH));
  }

  function currentUser() {
    try { return JSON.parse(localStorage.getItem(KEY_USER) || 'null'); } catch { return null; }
  }

  /** Call on every protected page load. Redirects to login if not authenticated. */
  async function requireLogin() {
    if (sessionStorage.getItem(KEY_ACCESS)) return; // already have live access token
    if (localStorage.getItem(KEY_REFRESH)) {
      const ok = await _refreshToken();
      if (ok) return;
    }
    _clearAuth();
    window.location.href = '/login.html';
  }

  /** Call on login.html — redirect to app if already logged in. */
  async function redirectIfLoggedIn(dest) {
    if (sessionStorage.getItem(KEY_ACCESS)) {
      window.location.href = dest || '/advohq-home.html';
      return;
    }
    if (localStorage.getItem(KEY_REFRESH)) {
      const ok = await _refreshToken();
      if (ok) { window.location.href = dest || '/advohq-home.html'; }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  AUTH
  // ══════════════════════════════════════════════════════════════════════════════

  const Auth = {
    /**
     * @param {string} username
     * @param {string} password
     * @param {string} [totpCode]  — supply if server responds with require_totp:true
     * @returns {{ require_totp?: boolean, user?: object }}
     */
    async login(username, password, totpCode) {
      const data = await post('/api/auth/login', {
        username,
        password,
        totp_code: totpCode || undefined,
      });
      if (data.require_totp) return data;   // caller must show TOTP input
      _saveAuth(data);
      return data;
    },

    async register(username, password, displayName, email) {
      return post('/api/auth/register', { username, password, display_name: displayName, email });
    },

    async logout() {
      const rt = localStorage.getItem(KEY_REFRESH);
      try { await post('/api/auth/logout', { refresh_token: rt }); } catch { /* ignore */ }
      _clearAuth();
      window.location.href = '/login.html';
    },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  //  PROFILE / SETTINGS  (/api/me/*)
  // ══════════════════════════════════════════════════════════════════════════════

  const Me = {
    get()                       { return get('/api/me'); },
    update(fields)              { return put('/api/me', fields); },
    changePassword(curr, next)  { return put('/api/me/password', { current_password: curr, new_password: next }); },

    // 2FA
    setup2fa()                  { return post('/api/me/2fa/setup', {}); },
    verify2fa(code)             { return post('/api/me/2fa/verify', { totp_code: code }); },
    disable2fa()                { return del('/api/me/2fa'); },

    // Sessions
    getSessions()               { return get('/api/me/sessions'); },
    revokeSession(id)           { return del(`/api/me/sessions/${id}`); },
    revokeAllOtherSessions(currentTokenHash) {
      return del('/api/me/sessions', { current_token_hash: currentTokenHash });
    },

    // Memories
    getMemories()               { return get('/api/me/memories'); },
    addMemory(content)          { return post('/api/me/memories', { content }); },
    deleteMemory(id)            { return del(`/api/me/memories/${id}`); },
    clearMemories()             { return del('/api/me/memories'); },

    // Export
    exportData() { window.location.href = '/api/me/export'; },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  //  CASES  (/api/cases/*)
  // ══════════════════════════════════════════════════════════════════════════════

  const Cases = {
    list(q)               { return get('/api/cases', q ? { q } : undefined); },
    get(id)               { return get(`/api/cases/${id}`); },
    create(title)         { return post('/api/cases', { title }); },
    update(id, fields)    { return put(`/api/cases/${id}`, fields); },
    delete(id)            { return del(`/api/cases/${id}`); },

    // Points shorthand
    savePoints(id, points) { return put(`/api/cases/${id}`, { points }); },

    // File references (text tags)
    addFile(caseId, name)        { return post(`/api/cases/${caseId}/files`, { name }); },
    deleteFile(caseId, fileId)   { return del(`/api/cases/${caseId}/files/${fileId}`); },

    // Important dates
    addDate(caseId, date_iso, label)    { return post(`/api/cases/${caseId}/dates`, { date_iso, label }); },
    markDateNotified(caseId, dateId)    { return patch(`/api/cases/${caseId}/dates/${dateId}`, {}); },
    deleteDate(caseId, dateId)          { return del(`/api/cases/${caseId}/dates/${dateId}`); },

    upcomingDates()  { return get('/api/cases/upcoming-dates'); },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  //  LIBRARY  (/api/library/*)
  // ══════════════════════════════════════════════════════════════════════════════

  const Library = {
    list(params)           { return get('/api/library', params); },
    getStorage()           { return get('/api/library/storage'); },

    createFolder(name, parentId) {
      return post('/api/library/folder', { name, parent_id: parentId });
    },

    /**
     * Upload one or more File objects from an <input type=file> or drag-drop.
     * @param {File[]} files
     * @param {number|null} parentId
     * @param {function} onProgress  — optional (value 0-100)
     */
    upload(files, parentId, onProgress) {
      return new Promise((resolve, reject) => {
        const access = sessionStorage.getItem(KEY_ACCESS);
        const fd = new FormData();
        files.forEach(f => fd.append('files', f));
        if (parentId) fd.append('parent_id', parentId);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/library/upload');
        if (access) xhr.setRequestHeader('Authorization', `Bearer ${access}`);

        if (onProgress) {
          xhr.upload.addEventListener('progress', e => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
          });
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch { resolve(xhr.responseText); }
          } else {
            let msg = `Upload failed (${xhr.status})`;
            try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* */ }
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(fd);
      });
    },

    update(id, fields)         { return put(`/api/library/${id}`, fields); },
    trash(id)                  { return del(`/api/library/${id}`); },
    deletePermanent(id)        { return del(`/api/library/${id}?permanent=true`); },
    restore(id)                { return post(`/api/library/${id}/restore`, {}); },
    downloadUrl(id)            { return `/api/library/${id}/download`; },

    // Notes
    getNotes(fileId)           { return get('/api/library/notes/list', fileId ? { file_id: fileId } : {}); },
    addNote(text, fileId)      { return post('/api/library/notes/list', { text, file_id: fileId }); },
    deleteNote(id)             { return del(`/api/library/notes/${id}`); },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  //  AI  (/api/ai/*)
  // ══════════════════════════════════════════════════════════════════════════════

  const AI = {
    /**
     * Summarise / rewrite case points.
     * @param {string} points — existing text in the points editor
     * @param {string} [prompt] — optional user instruction
     */
    summarise(points, prompt) {
      return post('/api/ai/summarise', { points, prompt });
    },

    /**
     * Ask a question in the file viewer chat.
     * @param {string}   question
     * @param {string}   [context]   — document content / metadata
     * @param {object[]} [history]   — [{role, content}, ...]
     */
    ask(question, context, history) {
      return post('/api/ai/ask', { question, context, history });
    },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════════════════

  window.API = {
    // Lifecycle
    isLoggedIn,
    currentUser,
    requireLogin,
    redirectIfLoggedIn,

    // Domain modules
    Auth,
    Me,
    Cases,
    Library,
    AI,
  };

})();
