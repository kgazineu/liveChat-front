import axios from 'axios';
import { retryAfterSecondsFrom } from './rate-limit';

function formatWait(seconds: number) {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`;
  if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
  }
  if (seconds < 86400) {
    const hours = Math.ceil(seconds / 3600);
    return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  }
  const days = Math.ceil(seconds / 86400);
  return `${days} ${days === 1 ? 'dia' : 'dias'}`;
}

export function errorMessage(error: unknown, fallback: string): string {
  const retryAfterSeconds = retryAfterSecondsFrom(error);
  if (retryAfterSeconds) {
    return `Muitas tentativas. Tente novamente em ${formatWait(retryAfterSeconds)}.`;
  }

  if (axios.isAxiosError(error)) {
    if (error.response?.status === 429) {
      return 'Muitas tentativas. Aguarde antes de tentar novamente.';
    }
    const message = error.response?.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (!error.response) return 'Não foi possível conectar ao serviço. Tente novamente.';
  }
  return fallback;
}
