import Cookies from 'js-cookie';
import { desktopBridge } from './desktop';

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

export async function persistSession(session: SessionResponse) {
  if (!session.token?.trim() || !session.refreshToken?.trim()) {
    throw new Error('Resposta de autenticação inválida.');
  }

  const desktop = desktopBridge();
  if (desktop) {
    await desktop.session.persist(session);
    Cookies.remove('chat_token', { path: '/' });
    Cookies.remove('chat_refresh_token', { path: '/' });
    return;
  }

  Cookies.set('chat_token', session.token, cookieOptions(validExpiry(session.expiresIn, 2)));
  Cookies.set('chat_refresh_token', session.refreshToken, cookieOptions(validExpiry(session.refreshExpiresIn, 24 * 7)));
}

export async function sessionAccessToken() {
  return desktopBridge()?.session.accessToken() ?? Promise.resolve(Cookies.get('chat_token') ?? null);
}

export async function hasRefreshSession() {
  return desktopBridge()?.session.hasRefreshToken() ?? Promise.resolve(!!Cookies.get('chat_refresh_token'));
}

export async function refreshDesktopAccessToken() {
  const desktop = desktopBridge();
  return desktop ? desktop.session.refresh() : null;
}

export function clearSession() {
  Cookies.remove('chat_token', { path: '/' });
  Cookies.remove('chat_refresh_token', { path: '/' });
  void desktopBridge()?.session.clear().catch(() => undefined);
}
