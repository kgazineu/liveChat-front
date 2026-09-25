import type {
  AttachmentContentType,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
} from '@/src/types';

export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

const EXTENSIONS_BY_CONTENT_TYPE: Record<AttachmentContentType, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
  'application/pdf': ['pdf'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
  'text/markdown': ['md'],
  'application/json': ['json'],
  'application/msword': ['doc'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'application/vnd.oasis.opendocument.text': ['odt'],
  'application/vnd.oasis.opendocument.spreadsheet': ['ods'],
  'application/vnd.oasis.opendocument.presentation': ['odp'],
};

export const ATTACHMENT_INPUT_ACCEPT = Object.entries(EXTENSIONS_BY_CONTENT_TYPE)
  .flatMap(([contentType, extensions]) => [contentType, ...extensions.map(extension => `.${extension}`)])
  .join(',');

function extensionOf(name: string) {
  const separator = name.lastIndexOf('.');
  return separator > 0 && separator < name.length - 1
    ? name.slice(separator + 1).toLowerCase()
    : '';
}

export function attachmentRequestFor(file: File): AttachmentUploadRequest {
  const originalName = file.name.trim();
  if (!originalName || originalName.length > 255 || originalName.includes('/') || originalName.includes('\\') ||
    [...originalName].some(character => /[\u0000-\u001f\u007f]/.test(character))) {
    throw new Error('O nome do arquivo é inválido ou possui mais de 255 caracteres.');
  }
  if (file.size < 1 || file.size > MAX_ATTACHMENT_SIZE) {
    throw new Error('O arquivo deve ter entre 1 byte e 10 MiB.');
  }

  const contentType = file.type.trim().toLowerCase() as AttachmentContentType;
  const allowedExtensions = EXTENSIONS_BY_CONTENT_TYPE[contentType];
  if (!allowedExtensions) {
    throw new Error('Este tipo de arquivo não é aceito. Áudio, executáveis, SVG, HTML e arquivos compactados não são permitidos.');
  }
  if (!allowedExtensions.includes(extensionOf(originalName))) {
    throw new Error('A extensão do arquivo não corresponde ao tipo informado pelo navegador.');
  }

  return { originalName, contentType, size: file.size };
}

export function attachmentReservationEndpoint(target:
  | { kind: 'DIRECT'; channelId: string }
  | { kind: 'SERVER_TEXT'; serverId: string; channelId: string }) {
  return target.kind === 'DIRECT'
    ? `/direct-channels/${target.channelId}/attachments/uploads`
    : `/servers/${target.serverId}/channels/${target.channelId}/attachments/uploads`;
}

export function uploadAttachmentFile(
  authorization: AttachmentUploadResponse,
  file: File,
  options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
) {
  return new Promise<void>((resolve, reject) => {
    if (authorization.uploadMethod !== 'POST') {
      reject(new Error('O método de upload fornecido pelo servidor não é compatível.'));
      return;
    }

    let uploadUrl: URL;
    try {
      uploadUrl = new URL(authorization.uploadUrl);
    } catch {
      reject(new Error('O servidor forneceu uma URL de upload inválida.'));
      return;
    }
    if (uploadUrl.protocol !== 'https:') {
      reject(new Error('O servidor forneceu uma URL de upload não segura.'));
      return;
    }
    if (options.signal?.aborted) {
      reject(new DOMException('Upload cancelado.', 'AbortError'));
      return;
    }

    const xhr = new XMLHttpRequest();
    const form = new FormData();
    Object.entries(authorization.formFields).forEach(([name, value]) => form.append(name, value));
    form.append('file', file);

    const abort = () => xhr.abort();
    const cleanup = () => options.signal?.removeEventListener('abort', abort);
    options.signal?.addEventListener('abort', abort, { once: true });

    xhr.open('POST', uploadUrl.toString());
    xhr.withCredentials = false;
    xhr.upload.addEventListener('progress', event => {
      if (!event.lengthComputable || event.total <= 0) return;
      options.onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    xhr.addEventListener('load', () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`O armazenamento recusou o upload (HTTP ${xhr.status}).`));
      }
    });
    xhr.addEventListener('error', () => {
      cleanup();
      reject(new Error('Não foi possível enviar o arquivo ao armazenamento.'));
    });
    xhr.addEventListener('abort', () => {
      cleanup();
      reject(new DOMException('Upload cancelado.', 'AbortError'));
    });
    xhr.send(form);
  });
}

export function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
