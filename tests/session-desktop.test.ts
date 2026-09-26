import Cookies from 'js-cookie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  hasRefreshSession,
  persistSession,
  refreshDesktopAccessToken,
  sessionAccessToken,
} from '@/src/services/session';

function installBridge() {
  const session = {
    persist: vi.fn().mockResolvedValue(undefined),
    accessToken: vi.fn().mockResolvedValue('access-em-memoria'),
    hasRefreshToken: vi.fn().mockResolvedValue(true),
    refresh: vi.fn().mockResolvedValue('access-renovado'),
    clear: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, 'liveChatDesktop', {
    configurable: true,
    value: {
      platform: 'linux',
      session,
      call: { setState: vi.fn(), onOpen: vi.fn(() => () => undefined) },
      notifications: { show: vi.fn() },
      updater: { onReady: vi.fn(() => () => undefined), install: vi.fn() },
    } satisfies LiveChatDesktopBridge,
  });
  return session;
}

afterEach(() => {
  Cookies.remove('chat_token', { path: '/' });
  Cookies.remove('chat_refresh_token', { path: '/' });
  Reflect.deleteProperty(window, 'liveChatDesktop');
});

describe('sessão no Electron', () => {
  it('mantém tokens fora dos cookies e usa somente a ponte segura', async () => {
    const bridge = installBridge();
    Cookies.set('chat_token', 'token-antigo', { path: '/' });
    Cookies.set('chat_refresh_token', 'refresh-antigo', { path: '/' });
    const response = {
      token: 'access-novo',
      refreshToken: 'refresh-novo',
      expiresIn: '2099-01-01T00:00:00Z',
      refreshExpiresIn: '2099-01-08T00:00:00Z',
    };

    await persistSession(response);

    expect(bridge.persist).toHaveBeenCalledWith(response);
    expect(Cookies.get('chat_token')).toBeUndefined();
    expect(Cookies.get('chat_refresh_token')).toBeUndefined();
    await expect(sessionAccessToken()).resolves.toBe('access-em-memoria');
    await expect(hasRefreshSession()).resolves.toBe(true);
    await expect(refreshDesktopAccessToken()).resolves.toBe('access-renovado');
  });

  it('limpa a sessão segura ao sair', async () => {
    const bridge = installBridge();

    clearSession();

    expect(bridge.clear).toHaveBeenCalledOnce();
  });
});
