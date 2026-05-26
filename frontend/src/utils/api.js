import axios from 'axios';

const BASE = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

/**
 * All API calls go to the backend directly via absolute URL.
 * CRA's proxy field is unreliable — do not use relative paths like '/drive/folders'.
 */
const api = axios.create({ baseURL: BASE });

export function authApi(authHeader) {
  return axios.create({
    baseURL: BASE,
    headers: { Authorization: authHeader },
  });
}

export default api;
export { BASE };
