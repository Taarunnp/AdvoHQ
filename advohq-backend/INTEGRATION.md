# AdvoHQ — Frontend Integration Guide

## 1. Project layout

```
advohq-backend/
├── server.js
├── db.js
├── .env                   ← created by setup script
├── package.json
├── middleware/
│   ├── auth.js
│   └── rateLimit.js
├── routes/
│   ├── auth.js
│   ├── me.js
│   ├── cases.js
│   ├── library.js
│   └── ai.js
├── scripts/
│   └── setup.js
├── data/                  ← SQLite DB (auto-created)
├── uploads/               ← disk uploads (auto-created)
└── public/                ← place ALL HTML files here
    ├── api-client.js      ← global API wrapper
    ├── index.html
    ├── login.html
    ├── advohq-home.html
    ├── advohq-file.html
    └── AdvoHQ-settings.html
```

---

## 2. First-time setup

```bash
cd advohq-backend
npm install
node scripts/setup.js        # generates .env, creates your account
npm start                    # or: npm run dev  (with nodemon)
```

Then open http://localhost:3000

---

## 3. Add api-client.js to every HTML page

Add this **before your page `<script>` block** in each HTML file:

```html
<script src="/api-client.js"></script>
```

---

## 4. index.html  (marketing / landing page)

No backend calls needed. Just make sure the "Sign in" links point to `/login.html`.

---

## 5. login.html

Replace the entire `<script>` block at the bottom with:

```html
<script src="/api-client.js"></script>
<script>
// ── Redirect if already logged in ──────────────────────────────────────────
API.redirectIfLoggedIn('/advohq-home.html');

// ── State ───────────────────────────────────────────────────────────────────
let awaitingTotp = false;

// ── Login form handler ───────────────────────────────────────────────────────
document.getElementById('login-btn').onclick = async () => {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl  = document.getElementById('login-error');
  errorEl.textContent = '';

  try {
    if (awaitingTotp) {
      const code = document.getElementById('totp-input').value.trim();
      await API.Auth.login(username, password, code);
    } else {
      const result = await API.Auth.login(username, password);
      if (result.require_totp) {
        awaitingTotp = true;
        document.getElementById('totp-field').style.display = 'block';
        errorEl.textContent = 'Enter your 6-digit authenticator code.';
        return;
      }
    }
    window.location.href = '/advohq-home.html';
  } catch (err) {
    errorEl.textContent = err.message || 'Login failed';
  }
};

// Allow Enter key on all fields
['login-username','login-password','totp-input'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
  });
});
</script>
```

Also add a TOTP input field in the HTML (hidden by default):

```html
<div class="field" id="totp-field" style="display:none;">
  <label>Authenticator Code</label>
  <input id="totp-input" type="text" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code">
</div>
```

---

## 6. advohq-home.html  (case dashboard / login.html dashboard section)

The original `login.html` has BOTH the login form AND the full case dashboard.
Move the dashboard section into `advohq-home.html` and replace its `<script>` with:

```html
<script src="/api-client.js"></script>
<script>
// ── Guard ────────────────────────────────────────────────────────────────────
API.requireLogin();

// ── State ────────────────────────────────────────────────────────────────────
let cases         = [];
let searchQuery   = '';
let activeCase    = null;   // id for the points modal

// ── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  const user = API.currentUser();
  if (user) document.getElementById('nav-user').textContent = user.display_name || user.username;

  await loadCases();
  await loadUpcomingDates();
})();

// ── Load ─────────────────────────────────────────────────────────────────────
async function loadCases() {
  try {
    cases = await API.Cases.list(searchQuery || undefined);
    refreshGrid();
  } catch (err) { showToast(err.message, 'fa-circle-xmark'); }
}

async function loadUpcomingDates() {
  try {
    const dates = await API.Cases.upcomingDates();
    if (dates.length) {
      // Show notification banner (your existing renderBanner logic)
      renderBanner(dates);
    }
  } catch { /* silent */ }
}

// ── Search ───────────────────────────────────────────────────────────────────
document.getElementById('search-input').oninput = async (e) => {
  searchQuery = e.target.value;
  await loadCases();
};

// ── New case ─────────────────────────────────────────────────────────────────
document.getElementById('new-case-btn').onclick = async () => {
  const title = prompt('Enter case title:');
  if (!title?.trim()) return;
  try {
    const c = await API.Cases.create(title.trim());
    cases.unshift(c);
    refreshGrid();
    showToast('Case created.');
  } catch (err) { showToast(err.message, 'fa-circle-xmark'); }
};

// ── Grid click handler ────────────────────────────────────────────────────────
async function handleGridClick(e) {
  const btn    = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const caseId = parseInt(btn.dataset.case);
  const c      = cases.find(x => x.id === caseId);

  if (action === 'edit-points' && c) {
    activeCase = caseId;
    document.getElementById('points-editor').value = c.points || '';
    document.getElementById('ai-prompt-input').value = '';
    document.getElementById('points-modal').classList.add('open');
    return;
  }

  if (action === 'add-file' && c) {
    const input = document.getElementById(`new-file-${caseId}`);
    const val   = input.value.trim();
    if (!val) return showToast('Enter a file name.', 'fa-triangle-exclamation');
    try {
      const file = await API.Cases.addFile(caseId, val);
      c.files.push(file);
      input.value = '';
      refreshGrid();
      showToast(`File "${val}" added.`);
    } catch (err) { showToast(err.message, 'fa-circle-xmark'); }
    return;
  }

  if (action === 'del-file' && c) {
    const fileId = parseInt(btn.dataset.idx); // data-idx holds the file ID from the server
    try {
      await API.Cases.deleteFile(caseId, fileId);
      c.files = c.files.filter(f => f.id !== fileId);
      refreshGrid();
    } catch (err) { showToast(err.message, 'fa-circle-xmark'); }
    return;
  }

  if (action === 'add-date' && c) {
    const dateVal  = document.getElementById(`new-date-${caseId}`).value;
    const labelVal = document.getElementById(`new-label-${caseId}`).value.trim();
    if (!dateVal || !labelVal) return showToast('Select a date and label.', 'fa-triangle-exclamation');
    try {
      const d = await API.Cases.addDate(caseId, dateVal, labelVal);
      c.importantDates.push(d);
      document.getElementById(`new-date-${caseId}`).value  = '';
      document.getElementById(`new-label-${caseId}`).value = '';
      refreshGrid();
      showToast(`Date marked: ${labelVal}`);
    } catch (err) { showToast(err.message, 'fa-circle-xmark'); }
    return;
  }

  if (action === 'del-date' && c) {
    const dateId = parseInt(btn.dataset.idx);
    try {
      await API.Cases.deleteDate(caseId, dateId);
      c.importantDates = c.importantDates.filter(d => d.id !== dateId);
      refreshGrid();
    } catch (err) { showToast(err.message, 'fa-circle-xmark'); }
    return;
  }

  if (action === 'del-case') {
    const idx = cases.findIndex(x => x.id === caseId);
    if (idx > -1 && confirm(`Delete case "${cases[idx].title}"? This cannot be undone.`)) {
      try {
        await API.Cases.delete(caseId);
        cases.splice(idx, 1);
        refreshGrid();
        showToast('Case deleted.');
      } catch (err) { showToast(err.message, 'fa-circle-xmark'); }
    }
    return;
  }
}

document.getElementById('cases-grid').addEventListener('click', handleGridClick);

// ── Points modal ─────────────────────────────────────────────────────────────
async function savePoints() {
  if (!activeCase) return;
  const text = document.getElementById('points-editor').value;
  try {
    await API.Cases.savePoints(activeCase, text);
    const c = cases.find(x => x.id === activeCase);
    if (c) c.points = text;
    refreshGrid();
    showToast('Points saved.');
  } catch (err) { showToast(err.message, 'fa-circle-xmark'); }
  closePointsModal();
}

// ── AI Summarise ──────────────────────────────────────────────────────────────
async function aiSummarise() {
  const prompt      = document.getElementById('ai-prompt-input').value.trim();
  const currentText = document.getElementById('points-editor').value.trim();
  const btn         = document.getElementById('ai-summarise-btn');
  if (!prompt && !currentText) return showToast('Write some points first.', 'fa-triangle-exclamation');

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

  try {
    const { text } = await API.AI.summarise(currentText, prompt);
    if (text) {
      document.getElementById('points-editor').value = text;
      document.getElementById('ai-prompt-input').value = '';
      showToast('AI points generated.');
    }
  } catch (err) {
    showToast(err.message || 'AI failed.', 'fa-circle-xmark');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run';
  }
}

// ── Logout ───────────────────────────────────────────────────────────────────
document.getElementById('logout-btn').onclick = () => API.Auth.logout();

// Bind modal buttons (these exist in your original HTML)
document.getElementById('close-points-modal').onclick  = closePointsModal;
document.getElementById('cancel-points-btn').onclick   = closePointsModal;
document.getElementById('save-points-btn').onclick     = savePoints;
document.getElementById('ai-summarise-btn').onclick    = aiSummarise;
document.getElementById('points-modal').onclick = e => {
  if (e.target === document.getElementById('points-modal')) closePointsModal();
};

function closePointsModal() {
  document.getElementById('points-modal').classList.remove('open');
  activeCase = null;
}

// Keep your existing renderCaseCard, refreshGrid, showToast functions —
// just update renderCaseCard to use c.files[i].id instead of index for data-idx:
//   data-idx="${f.id}"   ← server-issued ID, not array index
</script>
```

---

## 7. advohq-home.html  (library page)

Replace the script block with:

```html
<script src="/api-client.js"></script>
<script>
API.requireLogin();

let files = [], trash = [], selectedIds = new Set(), currentNav = 'all';

(async () => {
  await refreshLibrary();
  await refreshStorage();
})();

async function refreshLibrary() {
  try {
    const isTrash = currentNav === 'trash';
    files = await API.Library.list({ trash: isTrash ? 'true' : 'false' });
    render(files);
  } catch (err) { toast(err.message); }
}

async function refreshStorage() {
  try {
    const s = await API.Library.getStorage();
    document.getElementById('storageFill').style.width = s.percent + '%';
    const mb = (s.used_bytes / (1024*1024)).toFixed(1);
    document.getElementById('storageUsed').textContent = mb + ' MB';
  } catch { /* silent */ }
}

async function createFolder() {
  const name = prompt('Folder name:');
  if (!name?.trim()) return;
  try {
    const f = await API.Library.createFolder(name.trim());
    files.unshift({ ...f, items: 0 });
    render(files);
    toast(`Folder "${f.name}" created`);
  } catch (err) { toast(err.message); }
}

async function commitUpload() {
  if (!pendingUploadFiles.length) return;
  const btn = document.getElementById('uploadBtn');
  btn.textContent = 'Uploading…'; btn.disabled = true;
  try {
    const uploaded = await API.Library.upload(pendingUploadFiles, null, pct => {
      btn.textContent = `${pct}%`;
    });
    const count = uploaded.length;
    files.unshift(...uploaded);
    render(files);
    closeUploadModal();
    toast(`${count} file${count > 1 ? 's' : ''} uploaded`);
    await refreshStorage();
  } catch (err) {
    toast(err.message || 'Upload failed');
  } finally {
    btn.textContent = 'Upload'; btn.disabled = false;
  }
}

async function deleteSelected() {
  for (const id of selectedIds) {
    try {
      if (currentNav === 'trash') {
        await API.Library.deletePermanent(id);
      } else {
        await API.Library.trash(id);
      }
      files = files.filter(f => f.id !== id);
    } catch { /* continue */ }
  }
  selectedIds.clear();
  render(files);
  toast(`${currentNav === 'trash' ? 'Deleted' : 'Moved to trash'}`);
  refreshStorage();
}

async function restoreSelected() {
  for (const id of selectedIds) {
    try { await API.Library.restore(id); files = files.filter(f => f.id !== id); }
    catch { /* continue */ }
  }
  selectedIds.clear();
  render(files);
  toast('Restored');
}

// Inline cell edit → save to backend
async function commitCellEdit(id, field, value) {
  try { await API.Library.update(id, { [field]: value }); }
  catch (err) { toast(err.message); }
}

// ── Download link ──────────────────────────────────────────────────────────
function openItem(id) {
  const item = files.find(f => f.id === id);
  if (!item || item.type === 'folder') return;
  window.open(API.Library.downloadUrl(id), '_blank');
}

document.getElementById('logout-btn-lib').onclick = () => API.Auth.logout();
</script>
```

---

## 8. advohq-file.html  (document viewer + AI chat)

Replace the script block:

```html
<script src="/api-client.js"></script>
<script>
API.requireLogin();

let notes = [], aiHistory = [];

// ── Notes ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    notes = await API.Library.getNotes();
    renderNotes();
  } catch { /* silent */ }
})();

async function addNote() {
  const ta   = document.getElementById('notesTextarea');
  const text = ta.value.trim();
  if (!text) return;
  try {
    const note = await API.Library.addNote(text);
    notes.unshift({ ...note, time: new Date(note.created_at) });
    ta.value = ''; ta.style.height = 'auto';
    document.getElementById('noteAddBtn').disabled = true;
    renderNotes();
  } catch (err) { toast(err.message); }
}

async function deleteNote(id) {
  try {
    await API.Library.deleteNote(id);
    notes = notes.filter(n => n.id !== id);
    renderNotes();
  } catch (err) { toast(err.message); }
}

// ── AI Chat ───────────────────────────────────────────────────────────────────
async function sendAiMessage() {
  const input = document.getElementById('aiInput');
  const q     = input.value.trim();
  if (!q) return;
  input.value = ''; input.style.height = 'auto';

  // Add user bubble to UI (your existing function)
  appendUserBubble(q);
  showTyping(true);
  aiHistory.push({ role: 'user', content: q });

  try {
    const { text } = await API.AI.ask(q, null, aiHistory);
    aiHistory.push({ role: 'assistant', content: text });
    showTyping(false);
    appendAiBubble(text);
  } catch (err) {
    showTyping(false);
    appendAiBubble('Sorry, AI request failed: ' + err.message);
  }
}
</script>
```

---

## 9. AdvoHQ-settings.html

Replace the script block:

```html
<script src="/api-client.js"></script>
<script>
API.requireLogin();

// ── Load current profile ───────────────────────────────────────────────────
(async () => {
  try {
    const user = await API.Me.get();
    document.getElementById('displayName').value = user.display_name || '';
    document.getElementById('usernameInput').value = user.username || '';
    if (user.totp_enabled) restoreTotpUI(true);

    // Update avatar initials
    const initial = (user.display_name || user.username || '?').charAt(0).toUpperCase();
    document.querySelectorAll('.user-avatar, .avatar-big').forEach(el => el.textContent = initial);
    const nameEl = document.querySelector('.avatar-name');
    if (nameEl) nameEl.textContent = user.display_name || user.username;
  } catch { /* silent */ }

  try {
    const memories = await API.Me.getMemories();
    renderMemories(memories);
  } catch { /* silent */ }

  try {
    const sessions = await API.Me.getSessions();
    renderSessions(sessions);
  } catch { /* silent */ }
})();

// ── Profile save ──────────────────────────────────────────────────────────
async function saveName() {
  const val = document.getElementById('displayName').value.trim();
  if (!val) { toast('Name cannot be empty'); return; }
  try {
    await API.Me.update({ display_name: val });
    document.querySelector('.avatar-name').textContent = val;
    document.querySelector('.avatar-big').textContent  = val.charAt(0).toUpperCase();
    document.querySelector('.user-avatar').textContent = val.charAt(0).toUpperCase();
    toast('Display name saved');
  } catch (err) { toast(err.message); }
}

async function saveUsername() {
  const val = document.getElementById('usernameInput').value.trim();
  if (!val) { toast('Username cannot be empty'); return; }
  if (!/^[a-z0-9_]+$/i.test(val)) { toast('Only letters, numbers and underscores'); return; }
  try {
    await API.Me.update({ username: val });
    toast('Username saved');
  } catch (err) { toast(err.message); }
}

// ── Password ─────────────────────────────────────────────────────────────────
async function savePassword() {
  const curr = document.getElementById('pw-current').value;
  const nw   = document.getElementById('pw-new').value;
  const conf = document.getElementById('pw-confirm').value;
  if (!curr)          { toast('Enter current password'); return; }
  if (nw.length < 8)  { toast('New password must be at least 8 characters'); return; }
  if (nw !== conf)    { toast('Passwords do not match'); return; }
  try {
    await API.Me.changePassword(curr, nw);
    hidePasswordForm();
    toast('Password updated');
  } catch (err) { toast(err.message); }
}

// ── 2FA ──────────────────────────────────────────────────────────────────────
async function open2faSetup() {
  try {
    const { qr_url, secret } = await API.Me.setup2fa();
    // Show the QR image in your existing modal
    const qrImg = document.getElementById('twofa-qr-img');
    if (qrImg) qrImg.src = qr_url;
    const secEl = document.getElementById('twofa-secret-text');
    if (secEl) secEl.textContent = secret;
    openModal('twofa');
  } catch (err) { toast(err.message); }
}

async function verify2fa() {
  const code = document.getElementById('twofa-code').value.trim();
  if (code.length !== 6 || isNaN(code)) { toast('Enter a valid 6-digit code'); return; }
  try {
    await API.Me.verify2fa(code);
    closeModal();
    restoreTotpUI(true);
    toast('Two-factor authentication enabled');
  } catch (err) { toast(err.message || 'Invalid code'); }
}

async function disable2fa() {
  try {
    await API.Me.disable2fa();
    restoreTotpUI(false);
    toast('Two-factor authentication disabled');
  } catch (err) { toast(err.message); }
}

function restoreTotpUI(enabled) {
  const chip = document.getElementById('twofa-chip');
  const btn  = document.getElementById('twofa-btn');
  if (enabled) {
    if (chip) { chip.className = 'chip active-chip'; chip.textContent = '✓ Enabled'; }
    if (btn)  { btn.textContent = 'Disable 2FA'; btn.className = 'btn btn-outline'; btn.onclick = disable2fa; }
  } else {
    if (chip) { chip.className = 'chip warn-chip'; chip.textContent = 'Not enabled'; }
    if (btn)  { btn.textContent = 'Enable 2FA'; btn.className = 'btn btn-primary'; btn.onclick = open2faSetup; }
  }
}

// ── Sessions ──────────────────────────────────────────────────────────────────
function renderSessions(sessions) {
  const container = document.getElementById('sessions-list');
  if (!container) return;
  container.innerHTML = sessions.map(s => `
    <div class="session-row" id="sess-${s.id}">
      <div>
        <div style="font-size:0.85rem;font-weight:500">${escHtml(s.device_info)}</div>
        <div style="font-size:0.75rem;color:var(--muted)">${s.ip_address} · ${new Date(s.created_at).toLocaleString()}</div>
      </div>
      <button class="btn btn-outline btn-sm" onclick="revokeSession(${s.id})">Revoke</button>
    </div>`).join('');
}

async function revokeSession(id) {
  try {
    await API.Me.revokeSession(id);
    const row = document.getElementById(`sess-${id}`);
    if (row) row.remove();
    toast('Session revoked');
  } catch (err) { toast(err.message); }
}

async function revokeAllOtherSessions() {
  try {
    await API.Me.revokeAllOtherSessions();
    toast('All other sessions signed out');
    const sessions = await API.Me.getSessions();
    renderSessions(sessions);
  } catch (err) { toast(err.message); }
}

// ── Memories ──────────────────────────────────────────────────────────────────
function renderMemories(memories) {
  const container = document.getElementById('memories-list');
  const empty     = document.getElementById('memories-empty');
  if (!container) return;
  if (!memories.length) { if (empty) empty.style.display = 'block'; return; }
  if (empty) empty.style.display = 'none';
  container.innerHTML = memories.map(m => `
    <div class="memory-item" id="mem-${m.id}">
      <div class="memory-text">${escHtml(m.content)}</div>
      <button onclick="removeMemory(${m.id})">✕</button>
    </div>`).join('');
}

async function removeMemory(id) {
  try {
    await API.Me.deleteMemory(id);
    const el = document.getElementById(`mem-${id}`);
    if (el) el.remove();
    toast('Memory removed');
  } catch (err) { toast(err.message); }
}

async function clearAllMemories() {
  try {
    await API.Me.clearMemories();
    document.querySelectorAll('.memory-item').forEach(el => el.remove());
    const empty = document.getElementById('memories-empty');
    if (empty) empty.style.display = 'block';
    toast('All memories cleared');
  } catch (err) { toast(err.message); }
}

// ── Export ────────────────────────────────────────────────────────────────────
function requestExport() { API.Me.exportData(); }

// ── Logout ────────────────────────────────────────────────────────────────────
document.getElementById('logout-btn-settings').onclick = () => API.Auth.logout();

function escHtml(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
</script>
```

---

## 10. API Reference

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/auth/register | — | Create first user (or if ALLOW_REGISTRATION=true) |
| POST | /api/auth/login | — | Login → access + refresh tokens |
| POST | /api/auth/refresh | — | Exchange refresh for new access token |
| POST | /api/auth/logout | ✓ | Invalidate refresh token |
| GET | /api/me | ✓ | Get current user profile |
| PUT | /api/me | ✓ | Update display_name / username / email |
| PUT | /api/me/password | ✓ | Change password |
| POST | /api/me/2fa/setup | ✓ | Generate TOTP secret + QR code |
| POST | /api/me/2fa/verify | ✓ | Verify code → enable 2FA |
| DELETE | /api/me/2fa | ✓ | Disable 2FA |
| GET | /api/me/sessions | ✓ | List active sessions |
| DELETE | /api/me/sessions/:id | ✓ | Revoke one session |
| DELETE | /api/me/sessions | ✓ | Revoke all other sessions |
| GET | /api/me/memories | ✓ | List AI memories |
| POST | /api/me/memories | ✓ | Add a memory |
| DELETE | /api/me/memories/:id | ✓ | Delete one memory |
| DELETE | /api/me/memories | ✓ | Clear all memories |
| GET | /api/me/export | ✓ | Download full data export |
| GET | /api/cases | ✓ | List cases (optional ?q=search) |
| GET | /api/cases/upcoming-dates | ✓ | Dates within next 3 days |
| GET | /api/cases/:id | ✓ | Get one case |
| POST | /api/cases | ✓ | Create case |
| PUT | /api/cases/:id | ✓ | Update case (title, points) |
| DELETE | /api/cases/:id | ✓ | Delete case |
| POST | /api/cases/:id/files | ✓ | Add file reference |
| DELETE | /api/cases/:id/files/:fid | ✓ | Remove file reference |
| POST | /api/cases/:id/dates | ✓ | Add important date |
| PATCH | /api/cases/:id/dates/:did | ✓ | Mark date as notified |
| DELETE | /api/cases/:id/dates/:did | ✓ | Remove important date |
| GET | /api/library | ✓ | List library items |
| GET | /api/library/storage | ✓ | Storage usage stats |
| POST | /api/library/folder | ✓ | Create folder |
| POST | /api/library/upload | ✓ | Upload files (multipart) |
| PUT | /api/library/:id | ✓ | Rename / update item |
| DELETE | /api/library/:id | ✓ | Trash item |
| DELETE | /api/library/:id?permanent=true | ✓ | Hard delete |
| POST | /api/library/:id/restore | ✓ | Restore from trash |
| GET | /api/library/:id/download | ✓ | Download file |
| GET | /api/library/notes/list | ✓ | Get notes (optional ?file_id=) |
| POST | /api/library/notes/list | ✓ | Add note |
| DELETE | /api/library/notes/:id | ✓ | Delete note |
| POST | /api/ai/summarise | ✓ | AI case points summary |
| POST | /api/ai/ask | ✓ | AI chat (file viewer) |
| GET | /api/health | — | Server health check |

---

## 11. Security summary

| Layer | Mechanism |
|-------|-----------|
| Passwords | bcrypt, cost factor 12 |
| Access tokens | JWT, HS256, 15-min TTL |
| Refresh tokens | JWT + SHA-256 hash stored in DB, 7-day TTL |
| 2FA | TOTP (RFC 6238), speakeasy, QR via qrcode |
| Transport | Helmet security headers, strict CORS |
| Rate limiting | 200 req/15 min general; 20 req/15 min auth; 15 req/min AI |
| SQL | better-sqlite3 parameterised queries — no string interpolation |
| File uploads | MIME allow-list, 25 MB limit, randomised on-disk names |
| API key | Anthropic key stays server-side — never sent to browser |
| Token timing | Constant-time bcrypt dummy compare on unknown username |
