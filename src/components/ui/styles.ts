export const inputClass =
  'w-full rounded-[3px] bg-floating/70 px-2.5 py-2.5 text-[15px] text-text outline-none transition placeholder:text-faint focus:ring-2 focus:ring-link/60 disabled:cursor-not-allowed disabled:opacity-60';

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-[3px] px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

export const primaryButtonClass = `${buttonBase} bg-brand text-white hover:bg-brand-hover`;
export const secondaryButtonClass = `${buttonBase} bg-[#4e5058] text-white hover:bg-[#6d6f78]`;
export const successButtonClass = `${buttonBase} bg-success text-white hover:bg-success-hover`;
export const dangerButtonClass = `${buttonBase} bg-danger text-white hover:bg-danger-hover`;
export const linkButtonClass =
  'inline-flex items-center gap-1 rounded px-2 py-2 text-sm font-medium text-white hover:underline disabled:opacity-50';

export const sectionLabelClass = 'text-xs font-bold uppercase tracking-[0.02em] text-muted';
