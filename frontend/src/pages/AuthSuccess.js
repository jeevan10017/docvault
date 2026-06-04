import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// This page is the redirect target after Google OAuth.
// The backend encodes tokens in the URL hash — we parse them here.
export default function AuthSuccess() {
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (!hash) {
      navigate('/', { replace: true });
      return;
    }

    try {
      const parsed = JSON.parse(atob(hash));
      // Store in localStorage via the auth context
      localStorage.setItem('docvault_auth', JSON.stringify(parsed));
      // Clear the hash from the URL before redirecting
      window.history.replaceState(null, '', window.location.pathname);
      navigate('/dashboard', { replace: true });
    } catch {
      navigate('/?auth_error=parse_failed', { replace: true });
    }
  }, [navigate]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--cream)',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div className="spin" style={{
          width: 36, height: 36,
          border: '2px solid var(--sand)', borderTopColor: 'var(--accent)',
          borderRadius: '50%', margin: '0 auto 14px',
        }} />
        <p style={{ color: 'var(--ink-3)', fontSize: 14 }}>Signing you in…</p>
      </div>
    </div>
  );
}
