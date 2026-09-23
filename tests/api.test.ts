import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import Cookies from 'js-cookie';
import { beforeEach, expect, it, vi } from 'vitest';
import api from '@/src/services/api';

vi.mock('@/src/services/runtime-config', () => ({ getRuntimeConfig: async () => ({ apiUrl: 'https://api.example.invalid/v1', brokerUrl: 'wss://ws.example.invalid/ws' }) }));
beforeEach(() => {
  Cookies.set('chat_token', 'test-token', { path: '/' });
  Cookies.remove('chat_refresh_token', { path: '/' });
  vi.restoreAllMocks();
});

function rejectWith(status?: number) {
  return async (config: InternalAxiosRequestConfig) => {
    const response = status ? { status, statusText: 'Failure', data: {}, headers: {}, config } : undefined;
    throw new AxiosError('Failure', undefined, config, undefined, response);
  };
}

it('configura a URL runtime e envia Bearer para endpoints protegidos', async () => {
  const response = await api.get('/users/me', { adapter: async config => ({ status: 200, statusText: 'OK', headers: {}, data: config, config }) });
  expect(response.data.baseURL).toBe('https://api.example.invalid/v1');
  expect(response.data.headers.Authorization).toBe('Bearer test-token');
});
it.each([403, 500, undefined])('preserva a sessão em erro %s', async status => {
  await expect(api.get('/users/me', { adapter: rejectWith(status) })).rejects.toBeInstanceOf(axios.AxiosError);
  expect(Cookies.get('chat_token')).toBe('test-token');
});
it('invalida a sessão apenas em 401 autenticado', async () => {
  await expect(api.get('/users/me', { adapter: rejectWith(401) })).rejects.toThrow();
  expect(Cookies.get('chat_token')).toBeUndefined();
});
it.each([
  '/users/login',
  '/users/register',
  '/users/refresh',
  '/users/password-reset/request',
  '/users/password-reset/confirm',
  '/users/profile-update/confirm',
])('não envia Bearer nem remove sessão por falha em %s', async url => {
  await expect(api.post(url, {}, { adapter: async config => {
    expect(config.headers.Authorization).toBeUndefined();
    return rejectWith(401)(config);
  } })).rejects.toThrow();
  expect(Cookies.get('chat_token')).toBe('test-token');
});

it('renova a sessão e repete uma requisição protegida após 401', async () => {
  Cookies.set('chat_refresh_token', 'refresh-antigo', { path: '/' });
  const refresh = vi.spyOn(axios, 'post').mockResolvedValue({
    data: {
      token: 'token-renovado',
      expiresIn: '2099-01-01T00:00:00Z',
      refreshToken: 'refresh-novo',
      refreshExpiresIn: '2099-01-08T00:00:00Z',
    },
  });
  let attempt = 0;

  const response = await api.get('/users/me', { adapter: async config => {
    attempt += 1;
    if (attempt === 1) return rejectWith(401)(config);
    return { status: 200, statusText: 'OK', headers: {}, data: config, config };
  } });

  expect(refresh).toHaveBeenCalledWith(
    'https://api.example.invalid/v1/users/refresh',
    { refreshToken: 'refresh-antigo' },
    { timeout: 15000 },
  );
  expect(response.data.headers.Authorization).toBe('Bearer token-renovado');
  expect(Cookies.get('chat_refresh_token')).toBe('refresh-novo');
});
