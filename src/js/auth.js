const AUTH = {
  CLIENT_ID: '0c8c92ad128e4b89be7097c6b8082797',
  SCOPES: [
    'user-library-read',
    'user-library-modify',
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-public',
    'playlist-modify-private',
    'user-top-read',
    'user-read-recently-played',
    'user-follow-read',
  ].join(' '),
  TOKEN_KEY: 'sp_access_token',
  REFRESH_KEY: 'sp_refresh_token',
  EXPIRY_KEY: 'sp_token_expiry',
  VERIFIER_KEY: 'sp_code_verifier',
};

function getRedirectUri() {
  const loc = window.location;
  if (loc.hostname === '127.0.0.1' || loc.hostname === 'localhost') {
    return `${loc.protocol}//${loc.host}/callback.html`;
  }
  return `${loc.protocol}//${loc.host}${loc.pathname.replace(/\/[^/]*$/, '/callback.html')}`;
}

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, v => chars[v % chars.length]).join('');
}

async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  bytes.forEach(b => str += String.fromCharCode(b));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function loginWithSpotify() {
  const verifier = generateRandomString(64);
  localStorage.setItem(AUTH.VERIFIER_KEY, verifier);

  const challenge = base64UrlEncode(await sha256(verifier));

  const params = new URLSearchParams({
    client_id: AUTH.CLIENT_ID,
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    scope: AUTH.SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  if (error) {
    throw new Error(`Spotify auth error: ${error}`);
  }

  if (!code) {
    throw new Error('No authorization code in callback');
  }

  const verifier = localStorage.getItem(AUTH.VERIFIER_KEY);
  if (!verifier) {
    throw new Error('No code verifier found — login flow broken');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: AUTH.CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(),
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  saveTokens(data);
  localStorage.removeItem(AUTH.VERIFIER_KEY);
  return data;
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem(AUTH.REFRESH_KEY);
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: AUTH.CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    logout();
    throw new Error('Token refresh failed — logged out');
  }

  const data = await response.json();
  saveTokens(data);
  return data;
}

function saveTokens(data) {
  localStorage.setItem(AUTH.TOKEN_KEY, data.access_token);
  if (data.refresh_token) {
    localStorage.setItem(AUTH.REFRESH_KEY, data.refresh_token);
  }
  const expiresAt = Date.now() + (data.expires_in * 1000) - 60000;
  localStorage.setItem(AUTH.EXPIRY_KEY, expiresAt.toString());
}

async function getValidToken() {
  const expiry = parseInt(localStorage.getItem(AUTH.EXPIRY_KEY) || '0');
  if (Date.now() >= expiry) {
    await refreshAccessToken();
  }
  return localStorage.getItem(AUTH.TOKEN_KEY);
}

function isLoggedIn() {
  return !!localStorage.getItem(AUTH.TOKEN_KEY);
}

function logout() {
  localStorage.removeItem(AUTH.TOKEN_KEY);
  localStorage.removeItem(AUTH.REFRESH_KEY);
  localStorage.removeItem(AUTH.EXPIRY_KEY);
  localStorage.removeItem(AUTH.VERIFIER_KEY);
  window.location.hash = '';
  window.location.reload();
}

export { loginWithSpotify, handleCallback, getValidToken, refreshAccessToken, isLoggedIn, logout };
