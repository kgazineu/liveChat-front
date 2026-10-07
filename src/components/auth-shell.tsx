import type { ReactNode } from 'react';

export const authInputClassName =
  'h-10 w-full rounded-[3px] bg-floating px-2.5 text-base text-text outline-none transition placeholder:text-faint focus:ring-2 focus:ring-link/70 disabled:cursor-not-allowed disabled:opacity-60';

export const authPrimaryButtonClassName =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-[3px] bg-brand px-4 text-base font-medium text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60';

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
};

function BrandMark() {
  return (
    <span className="grid size-9 place-items-center rounded-xl bg-white text-brand shadow-lg">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none">
        <path
          d="M5.5 6.75h13v8.5h-7.1L7.25 18.5v-3.25H5.5v-8.5Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M9 10.9h.01M12 10.9h.01M15 10.9h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/**
 * Cartão centralizado sobre um fundo ilustrado, como as telas de entrada dos clientes de comunidade.
 * Em telas pequenas o cartão ocupa a tela inteira, sem moldura.
 */
export default function AuthShell({ eyebrow, title, description, children, footer }: AuthShellProps) {
  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-[#3b2fb8] text-text sm:p-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#6e5df6_0%,transparent_45%),radial-gradient(circle_at_80%_85%,#0ea5a4_0%,transparent_40%),linear-gradient(135deg,#2a1f8f,#3b2fb8_45%,#24206b)]" />
        <svg className="absolute inset-0 h-full w-full opacity-[0.12]" preserveAspectRatio="none" viewBox="0 0 1440 900">
          <path d="M0 640 C 240 560 420 720 720 650 S 1200 520 1440 600 L1440 900 L0 900 Z" fill="#fff" />
          <path d="M0 720 C 300 680 520 800 820 740 S 1240 660 1440 700 L1440 900 L0 900 Z" fill="#fff" opacity="0.6" />
        </svg>
        <div className="absolute left-[8%] top-[14%] size-3 rounded-full bg-white/40" />
        <div className="absolute right-[12%] top-[22%] size-2 rounded-full bg-white/50" />
        <div className="absolute bottom-[18%] left-[18%] size-2 rounded-full bg-white/30" />
      </div>

      <div className="absolute left-6 top-6 hidden items-center gap-2.5 sm:flex">
        <BrandMark />
        <span className="text-lg font-bold tracking-tight text-white">LiveChat</span>
      </div>

      <section
        className="relative w-full min-h-svh bg-main px-5 py-10 sm:min-h-0 sm:max-w-[480px] sm:animate-pop-in sm:rounded-md sm:p-8 sm:shadow-[0_2px_10px_0_rgba(0,0,0,0.2)]"
        aria-labelledby="auth-form-heading"
      >
        <div className="mb-6 flex items-center justify-center gap-2 sm:hidden">
          <BrandMark />
          <span className="text-lg font-bold text-white">LiveChat</span>
        </div>
        <header className="text-center">
          <p className="sr-only">{eyebrow}</p>
          <h1 id="auth-form-heading" className="text-2xl font-semibold text-header">{title}</h1>
          <p className="mt-2 text-base text-muted">{description}</p>
        </header>

        <div className="mt-5">{children}</div>

        {footer ? <div className="mt-3">{footer}</div> : null}
      </section>
    </main>
  );
}
