// @vitest-environment node
import { expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/src/proxy';

it.each(['/', '/register'])('redireciona usuário com cookie em %s para /chat', path => {
  const response = proxy(new NextRequest(`https://frontend.example.invalid${path}`, { headers: { Cookie: 'chat_token=example' } }));
  expect(response.headers.get('location')).toBe('https://frontend.example.invalid/chat');
});
it('protege acesso direto ao chat sem cookie', () => {
  expect(proxy(new NextRequest('https://frontend.example.invalid/chat')).headers.get('location')).toBe('https://frontend.example.invalid/');
});
