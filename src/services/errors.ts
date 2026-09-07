import axios from 'axios';

export function errorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (!error.response) return 'Não foi possível conectar ao serviço. Tente novamente.';
  }
  return fallback;
}
