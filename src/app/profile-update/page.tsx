'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import toast from 'react-hot-toast';
import AuthShell, { authPrimaryButtonClassName } from '@/src/components/auth-shell';
import api from '@/src/services/api';
import { errorMessage } from '@/src/services/errors';
import { clearSession } from '@/src/services/session';

function ProfileUpdateConfirmation() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function confirmUpdate() {
    if (!token || loading) return;
    setLoading(true);
    try {
      await api.post('/users/profile-update/confirm', { token });
      clearSession();
      setConfirmed(true);
      toast.success('Perfil atualizado com sucesso.');
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível confirmar a atualização. Solicite uma nova alteração.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Segurança da conta"
      title={confirmed ? 'Perfil atualizado' : 'Confirme suas alterações'}
      description={confirmed
        ? 'Por segurança, entre novamente para carregar os dados atualizados em todos os dispositivos.'
        : 'Este link aplica a alteração de nome e/ou e-mail solicitada nas configurações da conta.'}
      footer={
        <p className="text-sm text-muted">
          <Link href="/" className="font-medium text-link hover:underline">
            Ir para o login
          </Link>
        </p>
      }
    >
      {confirmed ? (
        <div role="status" className="rounded border border-success/40 bg-success/10 px-4 py-4 text-sm leading-6 text-text">
          A confirmação foi concluída e a sessão local foi encerrada.
        </div>
      ) : (
        <div className="space-y-5">
          {!token && (
            <div role="alert" className="rounded border border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-6 text-text">
              Este link não contém um token válido. Abra novamente o link recebido no seu e-mail anterior.
            </div>
          )}
          <button
            type="button"
            onClick={() => void confirmUpdate()}
            disabled={loading || !token}
            aria-busy={loading}
            className={authPrimaryButtonClassName}
          >
            {loading ? 'Confirmando…' : 'Confirmar atualização do perfil'}
          </button>
        </div>
      )}
    </AuthShell>
  );
}

export default function ProfileUpdatePage() {
  return (
    <Suspense fallback={
      <AuthShell eyebrow="Segurança da conta" title="Validando link" description="Preparando a confirmação do seu perfil.">
        <div className="text-sm text-muted">Carregando confirmação…</div>
      </AuthShell>
    }>
      <ProfileUpdateConfirmation />
    </Suspense>
  );
}
