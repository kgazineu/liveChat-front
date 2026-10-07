const AVATAR_COLORS = ['#6e5df6', '#3b82f6', '#0ea5a4', '#23a55a', '#e08a00', '#e5484d', '#d6409f', '#64748b'];

export function initials(name: string, max = 1) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words.slice(0, max).map(word => word.charAt(0).toUpperCase()).join('');
}

/** Cor estável por nome: a mesma pessoa ou servidor sempre recebe a mesma cor. */
export function colorFor(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const SIZES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-20 w-20 text-3xl',
} as const;

const STATUS_SIZES = {
  xs: 'h-2.5 w-2.5 border-2',
  sm: 'h-3 w-3 border-[2.5px]',
  md: 'h-3.5 w-3.5 border-[3px]',
  lg: 'h-6 w-6 border-[5px]',
} as const;

export type AvatarStatus = 'online' | 'in-call' | 'reconnecting' | 'offline';

const STATUS_COLORS: Record<AvatarStatus, string> = {
  online: 'bg-success',
  'in-call': 'bg-success',
  reconnecting: 'bg-warning',
  offline: 'bg-faint',
};

export function Avatar({
  name,
  seed,
  size = 'md',
  speaking = false,
  status,
  statusRing = 'border-sidebar',
}: {
  name: string;
  seed?: string;
  size?: keyof typeof SIZES;
  speaking?: boolean;
  status?: AvatarStatus;
  /** Cor da borda do indicador de status, igual ao fundo em que o avatar está. */
  statusRing?: string;
}) {
  return (
    <span className="relative inline-flex shrink-0" aria-hidden="true">
      <span
        className={`grid place-items-center rounded-full font-semibold text-white transition-shadow ${SIZES[size]} ${speaking ? 'ring-2 ring-success ring-offset-2 ring-offset-sidebar' : ''}`}
        style={{ backgroundColor: colorFor(seed ?? name) }}
      >
        {initials(name)}
      </span>
      {status && (
        <span className={`absolute -bottom-0.5 -right-0.5 rounded-full ${statusRing} ${STATUS_SIZES[size]} ${STATUS_COLORS[status]}`} />
      )}
    </span>
  );
}
