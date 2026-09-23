import type { ReactNode } from 'react';

export const authInputClassName =
  'w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white shadow-inner shadow-black/20 outline-none transition placeholder:text-slate-600 hover:border-white/15 focus:border-violet-400/70 focus:ring-4 focus:ring-violet-500/10 disabled:cursor-not-allowed disabled:opacity-60';

export const authPrimaryButtonClassName =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/30 transition hover:from-violet-500 hover:to-cyan-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 disabled:cursor-not-allowed disabled:opacity-60 disabled:saturate-50';

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
};

function BrandMark() {
  return (
    <span className="grid size-10 place-items-center rounded-xl border border-violet-400/25 bg-gradient-to-br from-violet-500/25 to-cyan-400/15 shadow-lg shadow-violet-950/30">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 text-violet-200" fill="none">
        <path
          d="M5.5 6.75h13v8.5h-7.1L7.25 18.5v-3.25H5.5v-8.5Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M9 10.9h.01M12 10.9h.01M15 10.9h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export default function AuthShell({ eyebrow, title, description, children, footer }: AuthShellProps) {
  return (
    <main className="relative min-h-svh overflow-hidden bg-[#070a12] text-slate-100">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 size-[32rem] rounded-full bg-violet-600/15 blur-3xl" />
        <div className="absolute -bottom-48 -right-32 size-[34rem] rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      <div className="relative mx-auto grid min-h-svh w-full max-w-7xl items-center gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16 lg:px-12">
        <section className="mx-auto w-full max-w-2xl lg:mx-0" aria-labelledby="auth-brand-heading">
          <div className="mb-8 flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-sm font-semibold tracking-wide text-white">LiveChat</p>
              <p className="text-xs text-slate-500">Sua comunidade, ao vivo.</p>
            </div>
          </div>

          <div className="max-w-xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/5 px-3 py-1.5 text-xs font-medium text-cyan-200">
              <span className="size-1.5 rounded-full bg-cyan-300 shadow-[0_0_12px_currentColor]" />
              Conversas em tempo real
            </div>
            <h1 id="auth-brand-heading" className="text-3xl font-semibold leading-tight tracking-[-0.035em] text-white sm:text-4xl lg:text-6xl">
              O lugar onde sua comunidade{' '}
              <span className="bg-gradient-to-r from-violet-300 via-fuchsia-200 to-cyan-300 bg-clip-text text-transparent">
                acontece.
              </span>
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-7 text-slate-400 sm:text-base">
              Entre em canais, converse com seus amigos e mantenha tudo que importa perto de você.
            </p>
          </div>

          <div className="mt-10 hidden max-w-lg grid-cols-3 gap-3 lg:grid">
            {[
              ['# geral', 'Comunidades'],
              ['● online', 'Presença ao vivo'],
              ['↗ agora', 'Conexão rápida'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4 backdrop-blur-sm">
                <p className="font-mono text-xs text-violet-200">{value}</p>
                <p className="mt-2 text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-md" aria-labelledby="auth-form-heading">
          <div className="relative rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <div aria-hidden="true" className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/80 to-transparent" />
            <div className="rounded-[1.5rem] border border-white/[0.045] bg-[#0b0f1a]/90 px-5 py-7 sm:px-8 sm:py-9">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">{eyebrow}</p>
              <h2 id="auth-form-heading" className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                {title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">{description}</p>

              <div className="mt-7">{children}</div>

              {footer ? <div className="mt-7 border-t border-white/[0.07] pt-6">{footer}</div> : null}
            </div>
          </div>
          <p className="mt-5 text-center text-xs text-slate-600">Conexão protegida para suas conversas.</p>
        </section>
      </div>
    </main>
  );
}
