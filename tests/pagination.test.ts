import { beforeEach, expect, it, vi } from 'vitest';
import { fetchAllPages, parsePageResponse } from '@/src/services/pagination';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/src/services/api', () => ({ default: { get: mocks.get } }));

beforeEach(() => {
  mocks.get.mockReset();
});

it('percorre todas as páginas preservando parâmetros adicionais', async () => {
  mocks.get
    .mockResolvedValueOnce({
      data: {
        content: [{ id: '1' }],
        page: 0,
        size: 100,
        totalElements: 2,
        totalPages: 2,
        last: false,
      },
    })
    .mockResolvedValueOnce({
      data: {
        content: [{ id: '2' }],
        page: 1,
        size: 100,
        totalElements: 2,
        totalPages: 2,
        last: true,
      },
    });

  await expect(fetchAllPages<{ id: string }>('/friendships', {
    params: { status: 'ACCEPTED' },
  })).resolves.toEqual([{ id: '1' }, { id: '2' }]);

  expect(mocks.get).toHaveBeenNthCalledWith(1, '/friendships', {
    params: { status: 'ACCEPTED', page: 0, size: 100 },
  });
  expect(mocks.get).toHaveBeenNthCalledWith(2, '/friendships', {
    params: { status: 'ACCEPTED', page: 1, size: 100 },
  });
});

it('rejeita envelopes incompletos em vez de interpretar arrays antigos', () => {
  expect(() => parsePageResponse([])).toThrow('Página inválida');
  expect(() => parsePageResponse({ content: [], page: 0 })).toThrow('Página inválida');
});
