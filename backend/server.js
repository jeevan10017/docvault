require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const driveRoutes = require('./routes/drive');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/auth', authRoutes);
app.use('/upload', uploadRoutes);
app.use('/drive', driveRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'DocVault backend running' });
});

// ── DEBUG ROUTE ──────────────────────────────────────────────────────────────
// Visit http://localhost:5000/debug to instantly see which .env vars are loaded
app.get('/debug', (req, res) => {
  res.json({
    env_check: {
      GOOGLE_CLIENT_ID:     process.env.GOOGLE_CLIENT_ID     ? '✅ ' + process.env.GOOGLE_CLIENT_ID.slice(0, 12) + '...'  : '❌ MISSING',
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? '✅ set'                                                   : '❌ MISSING',
      GOOGLE_REDIRECT_URI:  process.env.GOOGLE_REDIRECT_URI  || '❌ MISSING — should be http://localhost:5000/auth/google/callback',
      ANTHROPIC_API_KEY:    process.env.ANTHROPIC_API_KEY    ? '✅ ' + process.env.ANTHROPIC_API_KEY.slice(0, 14) + '...' : '❌ MISSING',
      FRONTEND_URL:         process.env.FRONTEND_URL         || '❌ MISSING — should be http://localhost:3000',
    },
    next_steps: {
      test_oauth: 'Open http://localhost:5000/auth/google in your browser',
      if_no_redirect: 'Means GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is wrong/missing',
    },
  });
});

app.listen(PORT, () => {
  console.log(`\n🗄️  DocVault backend running at http://localhost:${PORT}`);
  console.log(`\n🔍 Env check:`);
  console.log(`   GOOGLE_CLIENT_ID:     ${process.env.GOOGLE_CLIENT_ID     ? '✅ loaded' : '❌ MISSING'}`);
  console.log(`   GOOGLE_CLIENT_SECRET: ${process.env.GOOGLE_CLIENT_SECRET ? '✅ loaded' : '❌ MISSING'}`);
  console.log(`   GOOGLE_REDIRECT_URI:  ${process.env.GOOGLE_REDIRECT_URI  ? '✅ ' + process.env.GOOGLE_REDIRECT_URI : '❌ MISSING'}`);
  console.log(`   ANTHROPIC_API_KEY:    ${process.env.ANTHROPIC_API_KEY    ? '✅ loaded' : '❌ MISSING'}`);
  console.log(`   FRONTEND_URL:         ${process.env.FRONTEND_URL         || '❌ MISSING (defaulting to localhost:3000)'}`);
  console.log(`\n📋 Debug: http://localhost:${PORT}/debug`);
  console.log(`🔑 Test OAuth: http://localhost:${PORT}/auth/google\n`);
});
