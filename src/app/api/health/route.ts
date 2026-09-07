import { readRuntimeConfig } from '@/src/config/runtime';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    readRuntimeConfig();
    return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'configuration-error' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
