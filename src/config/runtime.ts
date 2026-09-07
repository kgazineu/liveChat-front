export interface RuntimeConfig {
  apiUrl: string;
  brokerUrl: string;
}

export function validateRuntimeConfig(input: RuntimeConfig): RuntimeConfig {
  for (const [key, protocols] of [
    ['apiUrl', ['http:', 'https:']],
    ['brokerUrl', ['ws:', 'wss:']],
  ] as const) {
    let url: URL;
    try {
      url = new URL(input[key]);
    } catch {
      throw new Error(`Configuração inválida: ${key}`);
    }
    if (!(protocols as readonly string[]).includes(url.protocol) || url.username || url.password || url.hash || url.search) {
      throw new Error(`Configuração inválida: ${key}`);
    }
  }
  return { apiUrl: input.apiUrl.replace(/\/+$/, ''), brokerUrl: input.brokerUrl };
}

export function readRuntimeConfig(): RuntimeConfig {
  return validateRuntimeConfig({
    apiUrl: process.env.API_URL || '',
    brokerUrl: process.env.BROKER_URL || '',
  });
}
