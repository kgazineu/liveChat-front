'use client';

import { LogOut, X } from 'lucide-react';
import { useEffect, type FormEvent } from 'react';
import type { CurrentUser } from '@/src/types';
import { Avatar, colorFor } from '../ui/avatar';
import { dangerButtonClass, inputClass, primaryButtonClass, secondaryButtonClass, sectionLabelClass } from '../ui/styles';

/** Configurações em tela cheia com navegação à esquerda, como nos clientes desktop de comunidade. */
export function AccountSettings({
  currentUser,
  accountName,
  accountEmail,
  profileUpdatePending,
  busyAction,
  onAccountNameChange,
  onAccountEmailChange,
  onSubmitProfile,
  onRequestPasswordChange,
  onDeleteAccount,
  onLogout,
  onClose,
}: {
  currentUser: CurrentUser;
  accountName: string;
  accountEmail: string;
  profileUpdatePending: boolean;
  busyAction: string | null;
  onAccountNameChange: (value: string) => void;
  onAccountEmailChange: (value: string) => void;
  onSubmitProfile: (event: FormEvent<HTMLFormElement>) => void;
  onRequestPasswordChange: () => void;
  onDeleteAccount: () => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Configurações da conta" className="fixed inset-0 z-50 flex animate-fade-in bg-main">
      <nav className="hidden w-[218px] shrink-0 justify-end bg-sidebar py-14 pr-2 sm:flex lg:w-[35%]" aria-label="Seções de configurações">
        <div className="w-[192px] space-y-0.5">
          <p className={`${sectionLabelClass} px-2.5 pb-1.5`}>Configurações de usuário</p>
          <span className="block rounded bg-selected px-2.5 py-1.5 text-[15px] font-medium text-header">Minha conta</span>
          <div className="mx-2.5 my-2 h-px bg-divider" />
          <button type="button" onClick={onLogout} className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-[15px] font-medium text-muted transition hover:bg-hover hover:text-text">
            Sair <LogOut size={16} />
          </button>
        </div>
      </nav>

      <div className="relative min-w-0 flex-1 overflow-y-auto">
        <div className="max-w-[740px] px-4 pb-20 pt-14 sm:px-10">
          <h2 className="mb-5 text-xl font-semibold text-header">Minha conta</h2>

          <section className="overflow-hidden rounded-lg bg-floating">
            <div className="h-24" style={{ backgroundColor: colorFor(currentUser.id) }} />
            <div className="flex items-end gap-4 px-4">
              <div className="-mt-10 rounded-full border-[7px] border-floating">
                <Avatar name={currentUser.name} seed={currentUser.id} size="lg" status="online" statusRing="border-floating" />
              </div>
              <p className="mb-3 min-w-0 truncate text-xl font-semibold text-header">{currentUser.name}</p>
            </div>

            <form onSubmit={onSubmitProfile} className="m-4 mt-3 space-y-4 rounded-lg bg-sidebar p-4">
              <div>
                <label htmlFor="account-name" className={`mb-2 block ${sectionLabelClass}`}>Nome de usuário</label>
                <input
                  id="account-name"
                  className={inputClass}
                  value={accountName}
                  onChange={event => onAccountNameChange(event.target.value)}
                  maxLength={100}
                  required
                />
              </div>
              <div>
                <label htmlFor="account-email" className={`mb-2 block ${sectionLabelClass}`}>E-mail</label>
                <input
                  id="account-email"
                  type="email"
                  className={inputClass}
                  value={accountEmail}
                  onChange={event => onAccountEmailChange(event.target.value)}
                  maxLength={254}
                  required
                />
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  A alteração só é aplicada depois que você confirmar o link enviado para <strong className="text-text">{currentUser.email}</strong>.
                </p>
              </div>
              {profileUpdatePending && (
                <p role="status" className="rounded border border-success/40 bg-success/10 p-3 text-sm text-text">
                  Solicitação criada. Verifique o seu e-mail atual; o link expira em aproximadamente 15 minutos.
                </p>
              )}
              <div className="flex justify-end">
                <button type="submit" disabled={busyAction !== null} className={primaryButtonClass}>
                  {busyAction === 'profile-update' ? 'Enviando confirmação…' : 'Salvar alterações'}
                </button>
              </div>
            </form>
          </section>

          <div className="my-10 h-px bg-divider" />

          <section>
            <h3 className="text-xl font-semibold text-header">Senha e autenticação</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Enviaremos um link de uso único para seu e-mail. Ao concluir a troca, todas as sessões anteriores serão encerradas.
            </p>
            <button type="button" onClick={onRequestPasswordChange} disabled={busyAction !== null} className={`${primaryButtonClass} mt-4`}>
              {busyAction === 'password-reset' ? 'Enviando link…' : 'Alterar minha senha'}
            </button>
          </section>

          <div className="my-10 h-px bg-divider" />

          <section>
            <h3 className={sectionLabelClass}>Remoção da conta</h3>
            <p className="mt-2 text-sm text-muted">A exclusão da conta é permanente e não pode ser desfeita.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={onDeleteAccount} disabled={busyAction !== null} className={dangerButtonClass}>
                {busyAction === 'delete-account' ? 'Excluindo…' : 'Excluir minha conta'}
              </button>
              <button type="button" onClick={onLogout} className={`${secondaryButtonClass} sm:hidden`}>Sair da conta</button>
            </div>
          </section>
        </div>

        <div className="absolute right-4 top-4 flex flex-col items-center gap-1 sm:right-10 sm:top-14">
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border-2 border-interactive text-interactive transition hover:border-header hover:text-header"
            aria-label="Fechar configurações"
          >
            <X size={18} />
          </button>
          <span className="text-xs font-semibold text-interactive">ESC</span>
        </div>
      </div>
    </div>
  );
}
