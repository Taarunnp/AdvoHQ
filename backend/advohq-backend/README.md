# AdvoHQ — Backend

Full Node.js/Express backend for AdvoHQ with PostgreSQL, AWS S3 file storage, JWT auth, and Anthropic AI proxy.

---

## Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 4 |
| Database | PostgreSQL (via `pg`) |
| File Storage | AWS S3 |
| Auth | JWT (bcryptjs) |
| AI | Anthropic Claude API |
| Deploy | Railway |

---

## Project Structure

```
advohq-backend/
├── server.js           ← Entry point
├── railway.toml        ← Railway deploy config
├── .env.example        ← Copy to .env and fill in values
├── db/
│   ├── db.js           ← PostgreSQL connection pool
│   └── migrate.js      ← Creates all tables (run once)
├── config/
│   └── s3.js           ← AWS S3 client + multer config
├── middleware/
│   └── auth.js         ← JWT verification
├── routes/
│   ├── auth.js         ← /api/auth/*
│   ├── cases.js        ← /api/cases/*
│   ├── files.js        ← /api/files/*
│   ├── schedule.js     ← /api/schedule/*
│   └── ai.js           ← /api/ai/*
└── api-client.js       ← Drop into your frontend folder
```

---

## Step 1 — Local Setup

```bash
# Clone your repo and enter the backend folder
cd advohq-backend

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# → Open .env and fill in all values (see sections below)

# Run DB migrations (creates all tables)
npm run migrate

# Start dev server (auto-restarts on save)
npm run dev
```

Server starts at `http://localhost:3000`

---

## Step 2 — PostgreSQL Setup

### Local (Mac)
```bash
brew install postgresql@16
brew services start postgresql@16
createdb advohq
# Connection string:
DATABASE_URL=postgresql://your_mac_username@localhost:5432/advohq
```

### Local (Windows)
Download the installer from https://www.postgresql.org/download/windows/  
Create a DB named `advohq` in pgAdmin, then:
```
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/advohq
```

---

## Step 3 — AWS S3 Setup

1. Go to **AWS Console → S3 → Create bucket**
   - Name: `advohq-files` (or anything)
   - Region: `ap-south-1` (Mumbai) or your preferred region
   - Uncheck "Block all public access" → confirm
   - Enable versioning (optional but recommended)

2. Add this **Bucket Policy** (replace `advohq-files` with your bucket name):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::advohq-files/*"
    }
  ]
}
```

3. Go to **IAM → Users → Create user**
   - Name: `advohq-backend`
   - Attach policy: **AmazonS3FullAccess** (or a custom policy scoped to just your bucket)
   - Create → **Security credentials → Create access key**
   - Copy `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` into your `.env`

---

## Step 4 — GitHub

```bash
# Inside the advohq-backend folder
git init
git add .
git commit -m "Initial AdvoHQ backend"

# Create a repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/advohq-backend.git
git branch -M main
git push -u origin main
```

> ⚠️ Make sure `.gitignore` includes `.env` — never push your secrets.

---

## Step 5 — Deploy to Railway

1. Go to **https://railway.app** → New Project → **Deploy from GitHub repo**
2. Select your `advohq-backend` repo → Railway auto-detects Node.js

3. **Add PostgreSQL:**
   - In your project → **+ New** → **Database** → **Add PostgreSQL**
   - Railway automatically injects `DATABASE_URL` into your service ✅

4. **Add environment variables** (Settings → Variables):
   ```
   JWT_SECRET         = (generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
   JWT_EXPIRES_IN     = 7d
   NODE_ENV           = production
   FRONTEND_URL       = https://YOUR-GITHUB-PAGES-URL
   AWS_ACCESS_KEY_ID  = ...
   AWS_SECRET_ACCESS_KEY = ...
   AWS_REGION         = ap-south-1
   AWS_S3_BUCKET      = advohq-files
   ANTHROPIC_API_KEY  = ...
   ```

5. **Run migrations on Railway:**
   - Go to your service → **Settings → Deploy** → add a deploy command:
     ```
     node db/migrate.js && node server.js
     ```
   - Or run it once manually via Railway shell:
     ```
     node db/migrate.js
     ```

6. Railway gives you a public URL like:  
   `https://advohq-backend-production.up.railway.app`

---

## Step 6 — Connect Frontend

1. Copy `api-client.js` into the same folder as your HTML files
2. Open `api-client.js` and update line 8:
   ```js
   const BASE_URL = 'https://YOUR-APP.up.railway.app';
   ```
3. Add to every HTML page's `<head>` (before your own scripts):
   ```html
   <script src="api-client.js"></script>
   ```

### Login page (`login2.html`)
```html
<script src="api-client.js"></script>
<script>
  document.querySelector('button').addEventListener('click', async () => {
    try {
      const user = await API.login(
        document.querySelector('[autocomplete="username"]').value,
        document.querySelector('[autocomplete="current-password"]').value
      );
      window.location.href = 'advohq-home.html';
    } catch (err) {
      alert(err.message);
    }
  });
</script>
```

### Schedule page (`advohq-schedule.html`)
Replace `localStorage.getItem('advohq_events')` calls with:
```js
// Load
const events = await API.getEvents();

// Save new event
await API.createEvent({ case_name, event_type, event_date, event_time, location, judge, notes });

// Delete
await API.deleteEvent(id);
```

---

## API Reference

### Auth
| Method | Path | Body | Auth |
|--------|------|------|------|
| POST | `/api/auth/register` | `{name, email, username, password}` | ✗ |
| POST | `/api/auth/login` | `{login, password}` | ✗ |
| GET  | `/api/auth/me` | — | ✓ |
| PATCH | `/api/auth/me` | `{name?, username?}` | ✓ |

### Cases
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/cases` | All cases |
| POST | `/api/cases` | Create |
| PATCH | `/api/cases/:id` | Update |
| DELETE | `/api/cases/:id` | Delete |

### Files
| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/files/upload` | `multipart/form-data`, field: `file` |
| GET  | `/api/files` | `?case_id=` optional |
| GET  | `/api/files/:id/download` | Returns 15-min signed S3 URL |
| DELETE | `/api/files/:id` | Deletes from S3 + DB |

### Schedule
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/schedule` | `?month=YYYY-MM` optional |
| POST | `/api/schedule` | Create event |
| PATCH | `/api/schedule/:id` | Update |
| DELETE | `/api/schedule/:id` | Delete |

### AI
| Method | Path | Body |
|--------|------|------|
| POST | `/api/ai/ask` | `{prompt, system?}` |

---

## Health Check

```
GET /health
→ { status: "ok", ts: "2026-04-06T..." }
```

Railway uses this endpoint to verify the service is alive.
