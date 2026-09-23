import Cookies from 'js-cookie';

export interface SessionResponse {
  token: string;
  expiresIn?: string;
  refreshToken: string;
  refreshExpiresIn?: string;
}

function validExpiry(value: string | undefined, fallbackHours: number) {
  const parsed = value ? new Date(value) : new Date(Date.now() + fallbackHours * 60 * 60 * 1000);
  return Number.isNaN(parsed.valueOf()) ? new Date(Date.now() + fallbackHours * 60 * 60 * 1000) : parsed;
}

function cookieOptions(expires: Date) {
  return {
    expires,
    path: '/',
    secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
    sameSite: 'lax' as const,
  };
}

export function persistSession(session: SessionResponse) {
  if (!session.token?.trim() || !session.refreshToken?.trim()) {
    throw new Error('Resposta de autenticação inválida.');
  }
  Cookies.set('chat_token', session.token, cookieOptions(validExpiry(session.expiresIn, 2)));
  Cookies.set('chat_refresh_token', session.refreshToken, cookieOptions(validExpiry(session.refreshExpiresIn, 24 * 7)));
}

export function clearSession() {
  Cookies.remove('chat_token', { path: '/' });
  Cookies.remove('chat_refresh_token', { path: '/' });
}
