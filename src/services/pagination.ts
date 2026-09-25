import type { AxiosRequestConfig } from 'axios';
import api from './api';
import type { PageResponse } from '@/src/types';

const MAX_PAGE_SIZE = 100;

export function parsePageResponse<T>(value: unknown, label = 'Página inválida'): PageResponse<T> {
  if (!value || typeof value !== 'object') throw new Error(label);
  const page = value as Partial<PageResponse<T>>;
  if (!Array.isArray(page.content) || !Number.isInteger(page.page) || page.page! < 0 ||
    !Number.isInteger(page.size) || page.size! < 1 ||
    typeof page.totalElements !== 'number' || page.totalElements < 0 ||
    !Number.isInteger(page.totalPages) || page.totalPages! < 0 ||
    typeof page.last !== 'boolean') {
    throw new Error(label);
  }
  return page as PageResponse<T>;
}

export async function fetchAllPages<T>(
  url: string,
  config: AxiosRequestConfig = {},
): Promise<T[]> {
  const content: T[] = [];
  let requestedPage = 0;

  while (true) {
    const response = await api.get<PageResponse<T>>(url, {
      ...config,
      params: { ...config.params, page: requestedPage, size: MAX_PAGE_SIZE },
    });
    const page = parsePageResponse<T>(response.data);
    if (page.page !== requestedPage) throw new Error('A API retornou uma página diferente da solicitada.');
    content.push(...page.content);
    if (page.last) return content;
    requestedPage += 1;
  }
}
