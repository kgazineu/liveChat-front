import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ATTACHMENT_SIZE,
  attachmentRequestFor,
  uploadAttachmentFile,
} from '@/src/services/attachments';
import type { AttachmentUploadResponse } from '@/src/types';

const originalXhr = globalThis.XMLHttpRequest;

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.XMLHttpRequest = originalXhr;
});

describe('anexos de mensagem', () => {
  it('replica a allowlist, o limite e a validação de extensão do backend', () => {
    expect(attachmentRequestFor(new File(['png'], 'foto.PNG', { type: 'image/png' }))).toEqual({
      originalName: 'foto.PNG',
      contentType: 'image/png',
      size: 3,
    });
    expect(() => attachmentRequestFor(new File(['audio'], 'voz.mp3', { type: 'audio/mpeg' })))
      .toThrow(/não é aceito/i);
    expect(() => attachmentRequestFor(new File(['pdf'], 'foto.png', { type: 'application/pdf' })))
      .toThrow(/extensão/i);
    expect(() => attachmentRequestFor(new File([new Uint8Array(MAX_ATTACHMENT_SIZE + 1)], 'grande.pdf', { type: 'application/pdf' })))
      .toThrow(/10 MiB/i);
  });

  it('envia somente os campos assinados e o arquivo em um POST multipart direto', async () => {
    const capture: { sentBody?: FormData; opened?: { method: string; url: string } } = {};
    const uploadListeners = new Map<string, (event: ProgressEvent) => void>();
    const listeners = new Map<string, () => void>();

    class FakeXMLHttpRequest {
      status = 200;
      withCredentials = true;
      upload = {
        addEventListener: (name: string, listener: (event: ProgressEvent) => void) => uploadListeners.set(name, listener),
      };
      open(method: string, url: string) { capture.opened = { method, url }; }
      addEventListener(name: string, listener: () => void) { listeners.set(name, listener); }
      send(body: FormData) {
        capture.sentBody = body;
        uploadListeners.get('progress')?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
        listeners.get('load')?.();
      }
      abort() { listeners.get('abort')?.(); }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest as unknown as typeof XMLHttpRequest);
    const progress = vi.fn();
    const authorization: AttachmentUploadResponse = {
      attachmentId: 'attachment-1',
      uploadUrl: 'https://api.cloudinary.com/v1_1/demo/image/upload',
      uploadMethod: 'POST',
      formFields: {
        api_key: 'public-key',
        upload_preset: 'private-preset',
        signature: 'signature-value',
      },
      expiresAt: '2099-01-01T00:00:00Z',
    };
    const file = new File(['image'], 'foto.png', { type: 'image/png' });

    await uploadAttachmentFile(authorization, file, { onProgress: progress });

    expect(capture.opened).toEqual({ method: 'POST', url: authorization.uploadUrl });
    expect(progress).toHaveBeenCalledWith(50);
    expect(progress).toHaveBeenLastCalledWith(100);
    expect(capture.sentBody).toBeDefined();
    if (!capture.sentBody) throw new Error('FormData não enviado');
    const entries = Array.from(capture.sentBody.entries());
    expect(entries.slice(0, 3)).toEqual([
      ['api_key', 'public-key'],
      ['upload_preset', 'private-preset'],
      ['signature', 'signature-value'],
    ]);
    expect(entries[3]?.[0]).toBe('file');
    expect(entries[3]?.[1]).toBe(file);
    expect(entries.some(([name]) => name.toLowerCase() === 'authorization')).toBe(false);
  });

  it('cancela a requisição externa usando AbortSignal', async () => {
    const listeners = new Map<string, () => void>();
    let aborted = false;
    class PendingXMLHttpRequest {
      status = 0;
      withCredentials = false;
      upload = { addEventListener: vi.fn() };
      open() { /* URL validada antes do envio. */ }
      addEventListener(name: string, listener: () => void) { listeners.set(name, listener); }
      send() { /* Mantém o upload pendente até o cancelamento. */ }
      abort() {
        aborted = true;
        listeners.get('abort')?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', PendingXMLHttpRequest as unknown as typeof XMLHttpRequest);
    const controller = new AbortController();
    const upload = uploadAttachmentFile({
      attachmentId: 'attachment-1',
      uploadUrl: 'https://api.cloudinary.com/v1_1/demo/image/upload',
      uploadMethod: 'POST',
      formFields: {},
      expiresAt: '2099-01-01T00:00:00Z',
    }, new File(['image'], 'foto.png', { type: 'image/png' }), { signal: controller.signal });

    controller.abort();

    await expect(upload).rejects.toMatchObject({ name: 'AbortError' });
    expect(aborted).toBe(true);
  });

  it('recusa URL de upload sem HTTPS antes de enviar o arquivo', async () => {
    const file = new File(['image'], 'foto.png', { type: 'image/png' });
    await expect(uploadAttachmentFile({
      attachmentId: 'attachment-1',
      uploadUrl: 'http://cloudinary.example/upload',
      uploadMethod: 'POST',
      formFields: {},
      expiresAt: '2099-01-01T00:00:00Z',
    }, file)).rejects.toThrow(/não segura/i);
  });
});
