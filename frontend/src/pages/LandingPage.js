import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const FEATURES = [
  { icon: '🧠', title: 'AI Classification', desc: 'Claude Vision reads your doc and identifies it — Aadhaar, PAN, marksheet, payslip, and more.' },
  { icon: '📂', title: 'Smart Folders',    desc: 'Files land in the right folder. Identity › PAN Card. Finance › Payslips. No sorting needed.' },
  { icon: '✏️', title: 'Auto Renaming',    desc: 'RaviKumar_Aadhaar_2024.pdf instead of scan_001.jpg — or rename it yourself before upload.' },
  { icon: '🔒', title: 'Your Drive Only',  desc: 'Files go straight to your Google Drive. DocVault never stores anything.' },
];

const TAGS = [
  { label: 'Aadhaar', c: '#4A7C59', b: '#EEF5F0' },
  { label: 'PAN Card', c: '#3B6EA5', b: '#EEF3FB' },
  { label: 'Passport', c: '#6B4FA0', b: '#F2EEFB' },
  { label: 'Marksheet', c: '#9C6B1A', b: '#FBF3E4' },
  { label: 'Resume',   c: '#CC785C', b: '#FDF3EE' },
  { label: 'Payslip',  c: '#B03030', b: '#FCEAEA' },
  { label: 'Bank Statement', c: '#3B6EA5', b: '#EEF3FB' },
  { label: 'Offer Letter',   c: '#4A7C59', b: '#EEF5F0' },
];

export default function LandingPage() {
  const { login, auth } = useAuth();
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', overflowX: 'hidden' }}>
      {/* Nav */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px',
        background: 'white', borderBottom: '1px solid var(--border-soft)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 30, height: 30, background: 'var(--accent)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🗄️</div>
          <span style={{ fontWeight: 600, fontSize: 15 }}>DocVault</span>
        </div>
        <button className="btn btn-primary" style={{ fontSize: 13, padding: '8px 16px', minHeight: 38 }}
          onClick={auth ? () => navigate('/dashboard') : login}>
          {auth ? 'Open App' : 'Sign in'}
        </button>
      </nav>

      {/* Hero */}
      <section style={{ padding: '48px 20px 40px', textAlign: 'center', maxWidth: 500, margin: '0 auto' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: 'var(--accent-bg)', color: 'var(--accent)',
          border: '1px solid var(--accent-light)',
          padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 500, marginBottom: 20,
        }}>✦ Claude AI + Google Drive</div>

        <h1 style={{ fontSize: 'clamp(1.7rem, 8vw, 2.4rem)', marginBottom: 16, lineHeight: 1.15 }}>
          Documents,<br />
          <span style={{ color: 'var(--accent)' }}>organised automatically.</span>
        </h1>

        <p style={{ fontSize: 15, color: 'var(--ink-3)', marginBottom: 32, lineHeight: 1.7 }}>
          Upload any document from your phone. Claude reads it, names it, and files it in your Google Drive — instantly.
        </p>

        <button className="btn btn-primary btn-full" style={{ fontSize: 16, padding: '14px', borderRadius: 'var(--r-lg)', marginBottom: 12 }}
          onClick={auth ? () => navigate('/dashboard') : login}>
          {auth ? 'Go to Dashboard →' : 'Get Started Free →'}
        </button>
        <p style={{ fontSize: 12, color: 'var(--ink-4)' }}>Free · No credit card · Just Google</p>

        {/* Tags */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, justifyContent: 'center', marginTop: 32 }}>
          {TAGS.map(t => (
            <span key={t.label} className="badge" style={{ background: t.b, color: t.c, fontSize: 12, padding: '5px 12px' }}>{t.label}</span>
          ))}
        </div>
      </section>

      {/* Steps */}
      <section style={{ background: 'white', borderTop: '1px solid var(--border-soft)', borderBottom: '1px solid var(--border-soft)', padding: '36px 20px' }}>
        <div style={{ maxWidth: 500, margin: '0 auto' }}>
          <h2 style={{ textAlign: 'center', marginBottom: 28, fontSize: 'clamp(.95rem, 4vw, 1.1rem)' }}>How it works</h2>
          {[
            { n: '1', t: 'Sign in with Google',  d: 'One tap. DocVault gets permission to create files in your Drive — nothing else.' },
            { n: '2', t: 'Tap + and pick a file', d: 'Snap a photo or pick from Files — Aadhaar, marksheet, invoice, anything.' },
            { n: '3', t: 'Claude reads it',        d: 'AI identifies the type, extracts your name, ID number, and dates.' },
            { n: '4', t: 'Filed perfectly',        d: 'Renamed and filed in the right folder in your Drive. Done.' },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, marginBottom: 22 }}>
              <div style={{
                width: 32, height: 32, minWidth: 32, borderRadius: '50%',
                background: 'var(--accent)', color: 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 600, fontSize: 13,
              }}>{s.n}</div>
              <div>
                <h3 style={{ marginBottom: 3 }}>{s.t}</h3>
                <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features grid */}
      <section style={{ padding: '36px 16px', maxWidth: 500, margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center', marginBottom: 20 }}>Everything handled for you</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{ background: 'white', border: '1px solid var(--border-soft)', borderRadius: 'var(--r-lg)', padding: 16 }}>
              <div style={{ fontSize: 26, marginBottom: 8 }}>{f.icon}</div>
              <h3 style={{ fontSize: 13, marginBottom: 5 }}>{f.title}</h3>
              <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: 'var(--accent)', padding: '44px 20px', textAlign: 'center' }}>
        <h2 style={{ color: 'white', marginBottom: 10, fontSize: 'clamp(1rem, 5vw, 1.3rem)' }}>Start organising in seconds</h2>
        <p style={{ color: 'rgba(255,255,255,.8)', marginBottom: 24, fontSize: 14 }}>Free to use. No credit card. Just Google.</p>
        <button className="btn" style={{ background: 'white', color: 'var(--accent)', fontWeight: 600, fontSize: 15, padding: '13px 28px', borderRadius: 'var(--r-lg)' }}
          onClick={auth ? () => navigate('/dashboard') : login}>
          {auth ? 'Open Dashboard' : 'Get Started Free'} →
        </button>
      </section>

      <footer style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--ink-4)', fontSize: 12, borderTop: '1px solid var(--border-soft)' }}>
        DocVault · Claude AI + Google Drive · 100% free
      </footer>
    </div>
  );
}
