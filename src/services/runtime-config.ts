import { type RuntimeConfig, validateRuntimeConfig } from '@/src/config/runtime';

let pending: Promise<RuntimeConfig> | undefined;

export function getRuntimeConfig(): Promise<RuntimeConfig> {
  pending ??= fetch('/api/runtime-config', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    .then(async (response) => {
      if (!response.ok) throw new Error('Configuração do serviço indisponível.');
      const config = validateRuntimeConfig(await response.json());
      if (window.location.protocol === 'https:' &&
          (!config.apiUrl.startsWith('https:') || !config.brokerUrl.startsWith('wss:'))) {
        throw new Error('Acesso HTTPS exige API HTTPS e WebSocket WSS.');
      }
      return config;
    })
    .catch((error) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
