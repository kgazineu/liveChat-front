import type { InternalAxiosRequestConfig } from 'axios';

const cooldowns = new Map<string, number>();

export class RateLimitError extends Error {
  readonly status = 429;

  constructor(readonly retryAfterSeconds: number) {
    super('Limite de requisições excedido.');
    this.name = 'RateLimitError';
  }
}

function requestScope(config?: Pick<InternalAxiosRequestConfig, 'method' | 'url'>) {
  if (!config?.url) return null;
  const method = (config.method || 'get').toUpperCase();
  const path = config.url.split('?')[0].replace(/^https?:\/\/[^/]+/, '');

  // O backend compartilha estes limites por usuário entre canais diretos e de servidor.
  if (method === 'POST' && /\/messages\/?$/.test(path)) return 'POST:/messages';
  if (method === 'POST' && /\/attachments\/uploads\/?$/.test(path)) {
    return 'POST:/attachments/uploads';
  }
  return `${method}:${path}`;
}

function retryAfterValue(headers: unknown) {
  if (!headers || typeof headers !== 'object') return undefined;
  const candidate = headers as { get?: (name: string) => unknown; [key: string]: unknown };
  return candidate.get?.('retry-after') ?? candidate['retry-after'] ?? candidate['Retry-After'];
}

export function parseRetryAfter(headers: unknown, now = Date.now()) {
  const value = retryAfterValue(headers);
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);

  const retryAt = Date.parse(raw);
  if (!Number.isFinite(retryAt) || retryAt <= now) return null;
  return Math.max(1, Math.ceil((retryAt - now) / 1000));
}

export function registerRateLimit(
  config: InternalAxiosRequestConfig | undefined,
  headers: unknown,
) {
  const scope = requestScope(config);
  const retryAfterSeconds = parseRetryAfter(headers);
  if (scope && retryAfterSeconds) {
    cooldowns.set(scope, Date.now() + retryAfterSeconds * 1000);
  }
  return retryAfterSeconds;
}

export function enforceRateLimitCooldown(config: InternalAxiosRequestConfig) {
  const scope = requestScope(config);
  if (!scope) return;
  const retryAt = cooldowns.get(scope);
  if (!retryAt) return;

  const remaining = Math.ceil((retryAt - Date.now()) / 1000);
  if (remaining <= 0) {
    cooldowns.delete(scope);
    return;
  }
  throw new RateLimitError(remaining);
}

export function retryAfterSecondsFrom(error: unknown) {
  if (error instanceof RateLimitError) return error.retryAfterSeconds;
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { response?: { status?: number; headers?: unknown } };
  if (candidate.response?.status !== 429) return null;
  return parseRetryAfter(candidate.response.headers);
}

export function clearRateLimitCooldowns() {
  cooldowns.clear();
}
