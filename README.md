# 🗄️ DocVault — AI Document Organiser

Upload any document → Claude reads it → filed in the right Google Drive folder, automatically.

**Tech stack:** React · Node.js/Express · Google Drive API · Anthropic Claude Vision  
**Cost:** 100% free for normal personal usage

---

## 📁 Project Structure

```
docvault/
├── backend/                  ← Node.js + Express API server
│   ├── server.js             ← Entry point
│   ├── .env.example          ← Copy to .env and fill in
│   ├── config/
│   │   └── google.js         ← OAuth2 client setup
│   ├── routes/
│   │   ├── auth.js           ← /auth/google + /auth/google/callback
│   │   ├── upload.js         ← POST /upload (multer + classify + Drive)
│   │   └── drive.js          ← GET /drive/files
│   └── services/
│       ├── classifier.js     ← Claude Vision AI classification
│       └── driveService.js   ← Google Drive API helpers
│
└── frontend/                 ← React app
    ├── public/index.html
    └── src/
        ├── App.js            ← Routes
        ├── index.js + index.css
        ├── hooks/
        │   └── useAuth.js    ← Auth context + token management
        ├── pages/
        │   ├── LandingPage.js
        │   ├── AuthSuccess.js
        │   ├── Dashboard.js
        │   └── UploadPage.js
        └── components/
            └── Navbar.js
```

---

## 🔑 Step 1 — Get Your API Keys

### A. Google OAuth2 + Drive API (Free)

1. Go to **https://console.cloud.google.com**
2. Create a new project (e.g. "DocVault")
3. **Enable APIs:**
   - Search "Google Drive API" → Enable
   - Search "Google People API" → Enable (for user info)
4. **Create OAuth Credentials:**
   - Left menu: **APIs & Services → Credentials**
   - Click **+ Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Name: DocVault
   - **Authorized JavaScript origins:** `http://localhost:3000`
   - **Authorized redirect URIs:** `http://localhost:5000/auth/google/callback`
   - Click **Create**
   - Copy your **Client ID** and **Client Secret**
5. **OAuth Consent Screen** (required once):
   - Left menu: **OAuth consent screen**
   - User Type: **External** → Create
   - App name: DocVault, your email as support email
   - Scopes: add `../auth/drive.file` and `../auth/userinfo.profile`
   - Test users: add your own Gmail address
   - Save

### B. Anthropic API Key (Free $5 credit on signup)

1. Go to **https://console.anthropic.com**
2. Sign up / log in
3. Go to **Settings → API Keys → Create Key**
4. Copy your key (starts with `sk-ant-...`)
5. Free credit: $5 on signup, enough for hundreds of document classifications

---

## 🚀 Step 2 — Setup & Run

### Backend

```bash
cd docvault/backend

# Install dependencies
npm install

# Create your .env file
cp .env.example .env
```

Open `backend/.env` and fill in:
```
GOOGLE_CLIENT_ID=      ← from Google Cloud Console
GOOGLE_CLIENT_SECRET=  ← from Google Cloud Console
ANTHROPIC_API_KEY=     ← from console.anthropic.com
SESSION_SECRET=        ← any random 32-char string (e.g. run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

```bash
# Start the backend
npm run dev
# → Running at http://localhost:5000
```

### Frontend

```bash
cd docvault/frontend

# Install dependencies
npm install

# Start the React app
npm start
# → Opens http://localhost:3000
```

---

## ✅ How to Test

1. Open **http://localhost:3000**
2. Click **"Get Started Free"**
3. You'll be redirected to Google → sign in with a test user you added
4. After auth, you land on the Dashboard
5. Click **Upload Documents**
6. Drop an image of your Aadhaar / PAN / marksheet / resume
7. Click **Upload to Drive** — watch Claude classify it!
8. Check your Google Drive → a **DocVault** folder will appear with your file inside

---

## 🗂️ Auto-Folder Structure in Drive

```
My Drive/
└── DocVault/
    ├── Identity/
    │   ├── Aadhaar/          ← Aadhaar cards
    │   ├── PAN Card/         ← PAN cards
    │   ├── Passport/
    │   └── Driving License/
    ├── Education/
    │   ├── Marksheets/
    │   └── Degrees/
    ├── Career/
    │   ├── Resumes/
    │   └── Offer Letters/
    ├── Finance/
    │   ├── Payslips/
    │   ├── Bank Statements/
    │   ├── Tax Documents/
    │   └── Insurance/
    ├── Medical/
    │   ├── Reports/
    │   └── Prescriptions/
    └── Other/
```

---

## 🏭 Production Deployment (Later)

When you're ready to deploy:

1. **Backend** → Deploy to Railway, Render, or Fly.io (all have free tiers)
2. **Frontend** → Deploy to Vercel or Netlify (free)
3. Update `.env`:
   - `FRONTEND_URL` = your Vercel URL
   - `GOOGLE_REDIRECT_URI` = your backend URL + `/auth/google/callback`
4. Update Google Cloud Console redirect URIs with your production URLs
5. For tokens: switch from URL-hash passing to HTTP-only session cookies + a DB (Redis or Postgres)

---

## 💡 Extending DocVault

| Feature | How |
|---------|-----|
| Multiple users | Add user table, store tokens per user in DB |
| Search documents | Use Drive API `files.list` with fullText query |
| Preview thumbnails | Use Drive API `files.get` with alt=media |
| Bulk upload | Already supported (up to 5 files per batch) |
| Share a document | Use Drive API `permissions.create` |
| Delete a document | Use Drive API `files.delete` |
| Edit classification | Let user override before upload (`/upload/classify-only` endpoint) |

---

## ❓ Troubleshooting

**"redirect_uri_mismatch"** → The redirect URI in your Google Cloud Console must exactly match `http://localhost:5000/auth/google/callback` (no trailing slash).

**"Access blocked: app not verified"** → Add your email as a test user in OAuth Consent Screen → Test users.

**"401 Unauthorized"** on upload → Your token may have expired; sign out and sign in again.

**"File type not supported"** → Only JPG, PNG, WEBP, HEIC, PDF are accepted.

**Claude returns wrong type** → For very blurry or small images, confidence will be low. Ensure good lighting and a clear photo.
