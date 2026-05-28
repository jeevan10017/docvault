import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LandingPage  from './pages/LandingPage';
import AuthSuccess  from './pages/AuthSuccess';
import Dashboard    from './pages/Dashboard';
import UploadPage   from './pages/UploadPage';
import ScannerPage  from './pages/scanner/ScannerPage';

function Loader() {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'var(--cream)' }}>
      <div style={{ textAlign:'center' }}>
        <div className="spin" style={{ width:32, height:32, border:'2px solid var(--sand)', borderTopColor:'var(--accent)', borderRadius:'50%', margin:'0 auto 12px' }} />
        <p style={{ color:'var(--ink-4)', fontSize:14 }}>Loading…</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { auth, loading } = useAuth();
  if (loading) return <Loader />;
  return auth ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/"             element={<LandingPage />} />
          <Route path="/auth/success" element={<AuthSuccess />} />
          <Route path="/dashboard"    element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/upload"       element={<ProtectedRoute><UploadPage /></ProtectedRoute>} />
          <Route path="/scan"         element={<ProtectedRoute><ScannerPage /></ProtectedRoute>} />
          <Route path="*"             element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
