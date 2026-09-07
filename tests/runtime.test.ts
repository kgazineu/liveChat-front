import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateRuntimeConfig } from '@/src/config/runtime';
import { GET as health } from '@/src/app/api/health/route';
import { GET as config } from '@/src/app/api/runtime-config/route';

afterEach(() => vi.unstubAllEnvs());
describe('configuração em execução', () => {
  it('preserva o caminho da API e exige WebSocket nativo', () => {
    expect(validateRuntimeConfig({ apiUrl: 'https://api.example.invalid/v1/', brokerUrl: 'wss://ws.example.invalid/native' }).apiUrl).toBe('https://api.example.invalid/v1');
    expect(() => validateRuntimeConfig({ apiUrl: 'https://api.example.invalid', brokerUrl: 'https://ws.example.invalid/sockjs' })).toThrow();
  });
  it.each(['', '/api', 'https://user:password@api.example.invalid', 'https://api.example.invalid?token=secret'])('rejeita URL inválida ou credenciais: %s', apiUrl => {
    expect(() => validateRuntimeConfig({ apiUrl, brokerUrl: 'wss://example.invalid/ws' })).toThrow();
  });
  it('falha de forma explícita quando faltam variáveis', async () => {
    vi.stubEnv('API_URL', ''); vi.stubEnv('BROKER_URL', '');
    expect(health().status).toBe(503);
    expect(config().status).toBe(503);
  });
  it('lê novas variáveis sem rebuild e não permite cache', async () => {
    vi.stubEnv('API_URL', 'https://first.example.invalid');
    vi.stubEnv('BROKER_URL', 'wss://ws.example.invalid/ws');
    expect(await config().json()).toEqual({ apiUrl: 'https://first.example.invalid', brokerUrl: 'wss://ws.example.invalid/ws' });
    vi.stubEnv('API_URL', 'https://second.example.invalid');
    expect((await config().json()).apiUrl).toBe('https://second.example.invalid');
    expect(health().status).toBe(200);
    expect(config().headers.get('cache-control')).toBe('no-store');
    expect(health().headers.get('cache-control')).toBe('no-store');
  });
});
