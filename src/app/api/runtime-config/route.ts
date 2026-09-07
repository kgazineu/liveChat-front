import { readRuntimeConfig } from '@/src/config/runtime';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    return Response.json(readRuntimeConfig(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ message: 'Configuração do serviço indisponível.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
