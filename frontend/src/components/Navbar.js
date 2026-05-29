import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Navbar({ darkBg = false }) {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const bg     = darkBg ? '#1a1a1a' : 'white';
  const border = darkBg ? 'rgba(255,255,255,.1)' : 'var(--border-soft)';
  const txtCol = darkBg ? 'rgba(255,255,255,.9)' : 'var(--ink)';
  const mutCol = darkBg ? 'rgba(255,255,255,.45)' : 'var(--ink-4)';

  return (
    <>
      {/* Top bar */}
      <header style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'12px 16px', background:bg, borderBottom:`1px solid ${border}`,
        position:'sticky', top:0, zIndex:100, height:'var(--nav-h)',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }} onClick={() => navigate('/dashboard')}>
          <div style={{ width:28, height:28, background:'var(--accent)', borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>🗄️</div>
          <span style={{ fontWeight:600, fontSize:15, color:txtCol }}>DocVault</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {auth?.user?.picture && (
            <img src={auth.user.picture} alt="" onError={e => e.target.style.display='none'}
              style={{ width:26, height:26, borderRadius:'50%', border:'1.5px solid rgba(255,255,255,.3)' }} />
          )}
          <button onClick={logout} style={{
            background:'transparent', border:`1px solid ${border}`, borderRadius:'var(--r)',
            color:mutCol, fontSize:12, padding:'5px 10px', cursor:'pointer',
            fontFamily:'var(--font)', minHeight:32,
          }}>Sign out</button>
        </div>
      </header>

      {/* Bottom nav */}
      <nav style={{
        position:'fixed', bottom:0, left:0, right:0,
        height:'var(--bottom-bar-h)',
        background:'white', borderTop:'1px solid var(--border-soft)',
        display:'flex', alignItems:'stretch',
        paddingBottom:'env(safe-area-inset-bottom, 0px)',
        zIndex:100, boxShadow:'0 -4px 16px rgba(0,0,0,.06)',
      }}>
        {/* Home */}
        <button className={`bottom-nav-item ${pathname === '/dashboard' ? 'active' : ''}`}
          onClick={() => navigate('/dashboard')}>
          <span className="nav-icon">🏠</span><span>Home</span>
        </button>

        {/* Scan — centre raised button */}
        <button className={`bottom-nav-item ${pathname === '/scan' ? 'active' : ''}`}
          onClick={() => navigate('/scan')} style={{ position:'relative' }}>
          <div style={{
            width:52, height:52, borderRadius:'50%', marginTop:-18,
            background: pathname === '/scan' ? 'var(--accent)' : '#1a1a1a',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:22, boxShadow: '0 4px 14px rgba(0,0,0,.35)',
            transition:'background .15s',
          }}>📷</div>
          <span style={{ color: pathname === '/scan' ? 'var(--accent)' : 'var(--ink-3)', marginTop:2 }}>Scan</span>
        </button>

        {/* Upload */}
        <button className={`bottom-nav-item ${pathname === '/upload' ? 'active' : ''}`}
          onClick={() => navigate('/upload')}>
          <span className="nav-icon">☁️</span><span>Upload</span>
        </button>
      </nav>
    </>
  );
}
