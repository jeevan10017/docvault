import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/* Mobile bottom nav + top bar */
export default function Navbar() {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <>
      {/* Top bar */}
      <header className="top-nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, background: 'var(--accent)',
            borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
          }}>🗄️</div>
          <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-.01em' }}>DocVault</span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {auth?.user && (
            <img
              src={auth.user.picture || ''}
              alt={auth.user.name || ''}
              onError={e => { e.target.style.display = 'none'; }}
              style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid var(--border)' }}
            />
          )}
          <button
            className="btn btn-ghost"
            onClick={logout}
            style={{ fontSize: 12, padding: '6px 10px', minHeight: 32, color: 'var(--ink-4)' }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Bottom nav */}
      <nav className="bottom-nav">
        <button
          className={`bottom-nav-item ${pathname === '/dashboard' ? 'active' : ''}`}
          onClick={() => navigate('/dashboard')}
        >
          <span className="nav-icon">🏠</span>
          <span>Home</span>
        </button>
        <button
          className={`bottom-nav-item ${pathname === '/upload' ? 'active' : ''}`}
          onClick={() => navigate('/upload')}
          style={{ position: 'relative' }}
        >
          {/* Upload tab gets accent pill */}
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: pathname === '/upload' ? 'var(--accent)' : 'var(--sand)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, marginBottom: 2, transition: 'background .15s',
            marginTop: -14,
            boxShadow: pathname === '/upload' ? '0 4px 12px rgba(204,120,92,.4)' : 'none',
          }}>
            <span style={{ fontSize: 20 }}>＋</span>
          </div>
          <span style={{ color: pathname === '/upload' ? 'var(--accent)' : 'var(--ink-4)' }}>Upload</span>
        </button>
        <button
          className={`bottom-nav-item ${pathname === '/search' ? 'active' : ''}`}
          onClick={() => navigate('/dashboard')}
        >
          <span className="nav-icon">🔍</span>
          <span>Search</span>
        </button>
      </nav>
    </>
  );
}
