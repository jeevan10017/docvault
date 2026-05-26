import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { BASE } from '../utils/api';

const AuthContext = createContext(null);

const STORAGE_KEY = 'docvault_auth';

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(null); // { access_token, refresh_token, expiry_date, user }
  const [loading, setLoading] = useState(true);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Check if not obviously expired
        if (parsed.expiry_date && Date.now() < parsed.expiry_date) {
          setAuth(parsed);
        } else if (parsed.refresh_token) {
          // Will refresh on next API call
          setAuth(parsed);
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  // Save to localStorage whenever auth changes
  useEffect(() => {
    if (auth) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [auth]);

  /**
   * Returns a base64-encoded token string for the Authorization header.
   * Auto-refreshes if expired.
   */
  const getAuthHeader = useCallback(async () => {
    if (!auth) throw new Error('Not authenticated');

    let currentAuth = auth;

    // Refresh if expired or expiring in <5 minutes
    if (currentAuth.expiry_date && Date.now() > currentAuth.expiry_date - 300000) {
      try {
        const { data } = await axios.post(`${BASE}/auth/refresh`, {
          refresh_token: currentAuth.refresh_token,
        });
        currentAuth = { ...currentAuth, ...data };
        setAuth(currentAuth);
      } catch {
        setAuth(null);
        throw new Error('Session expired. Please log in again.');
      }
    }

    return 'Bearer ' + btoa(JSON.stringify(currentAuth));
  }, [auth]);

  const login = useCallback(() => {
    // Must use the ABSOLUTE backend URL — window.location.href does NOT
    // go through React's dev proxy (that only works for fetch/axios).
    const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';
    window.location.href = `${backendUrl}/auth/google`;
  }, []);

  const logout = useCallback(() => {
    setAuth(null);
  }, []);

  return (
    <AuthContext.Provider value={{ auth, loading, login, logout, getAuthHeader }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
