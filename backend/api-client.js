// api-client.js
// Drop this file alongside your HTML files and include it with:
//   <script src="api-client.js"></script>
//
// Change BASE_URL to your Railway deployment URL after deploying.

const API = (() => {
  const BASE_URL = 'https://YOUR-APP.up.railway.app'; // ← update after deploy

  function getToken() {
    return localStorage.getItem('advohq_token');
  }

  function saveToken(token) {
    localStorage.setItem('advohq_token', token);
  }

  function clearToken() {
    localStorage.removeItem('advohq_token');
    localStorage.removeItem('advohq_user');
  }

  async function request(method, path, body, isFormData = false) {
    const headers = { Authorization: `Bearer ${getToken()}` };
    if (!isFormData) headers['Content-Type'] = 'application/json';

    const res = await fetch(BASE_URL + path, {
      method,
      headers,
      body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
    });

    // Auth expired — redirect to login
    if (res.status === 401) {
      clearToken();
      window.location.href = 'login2.html';
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  return {
    // ── AUTH ────────────────────────────────────────────────────────────────
    async register(name, email, username, password) {
      const data = await request('POST', '/api/auth/register', { name, email, username, password });
      saveToken(data.token);
      localStorage.setItem('advohq_user', JSON.stringify(data.user));
      return data.user;
    },

    async login(login, password) {
      const data = await request('POST', '/api/auth/login', { login, password });
      saveToken(data.token);
      localStorage.setItem('advohq_user', JSON.stringify(data.user));
      return data.user;
    },

    logout() {
      clearToken();
      window.location.href = 'login2.html';
    },

    getUser() {
      const u = localStorage.getItem('advohq_user');
      return u ? JSON.parse(u) : null;
    },

    isLoggedIn() {
      return !!getToken();
    },

    // ── CASES ────────────────────────────────────────────────────────────────
    getCases:       ()       => request('GET',    '/api/cases'),
    getCase:        (id)     => request('GET',    `/api/cases/${id}`),
    createCase:     (data)   => request('POST',   '/api/cases', data),
    updateCase:     (id, d)  => request('PATCH',  `/api/cases/${id}`, d),
    deleteCase:     (id)     => request('DELETE',  `/api/cases/${id}`),

    // ── FILES ────────────────────────────────────────────────────────────────
    getFiles:       (caseId) => request('GET', `/api/files${caseId ? '?case_id='+caseId : ''}`),
    deleteFile:     (id)     => request('DELETE', `/api/files/${id}`),
    getDownloadURL: (id)     => request('GET', `/api/files/${id}/download`),

    async uploadFile(file, caseId) {
      const form = new FormData();
      form.append('file', file);
      if (caseId) form.append('case_id', caseId);
      return request('POST', '/api/files/upload', form, true);
    },

    // ── NOTES ────────────────────────────────────────────────────────────────
    getNotes:   (fileId)          => request('GET',    `/api/files/${fileId}/notes`),
    addNote:    (fileId, content) => request('POST',   `/api/files/${fileId}/notes`, { content }),
    deleteNote: (fileId, noteId)  => request('DELETE', `/api/files/${fileId}/notes/${noteId}`),

    // ── SCHEDULE ─────────────────────────────────────────────────────────────
    getEvents:    (month)    => request('GET',    `/api/schedule${month ? '?month='+month : ''}`),
    createEvent:  (data)     => request('POST',   '/api/schedule', data),
    updateEvent:  (id, data) => request('PATCH',  `/api/schedule/${id}`, data),
    deleteEvent:  (id)       => request('DELETE',  `/api/schedule/${id}`),

    // ── AI ───────────────────────────────────────────────────────────────────
    askAI: (prompt, system) => request('POST', '/api/ai/ask', { prompt, system }),
  };
})();

// Auto-redirect to login if not authenticated (skip on login pages)
if (!API.isLoggedIn() && !['login.html','login2.html','index.html'].some(p => location.pathname.endsWith(p))) {
  window.location.href = 'login2.html';
}
