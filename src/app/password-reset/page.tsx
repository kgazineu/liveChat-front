'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import AuthShell, {
  authInputClassName,
  authPrimaryButtonClassName,
} from '@/src/components/auth-shell';
import api from '@/src/services/api';
import { errorMessage } from '@/src/services/errors';
import { clearSession } from '@/src/services/session';

function PasswordResetForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    if (!token) {
      toast.error('Este link de redefinição é inválido.');
      return;
    }
    if (!password || !passwordConfirmation) {
      toast.error('Preencha e confirme a nova senha.');
      return;
    }
    if (password.length < 8 || password.length > 72) {
      toast.error('A senha deve ter entre 8 e 72 caracteres.');
      return;
    }
    if (password !== passwordConfirmation) {
      toast.error('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    const loadingToast = toast.loading('Redefinindo sua senha...');

    try {
      await api.post('/users/password-reset/confirm', { token, password });
      clearSession();
      toast.dismiss(loadingToast);
      toast.success('Senha redefinida. Entre com sua nova senha.');
      router.replace('/');
    } catch (error: unknown) {
      toast.dismiss(loadingToast);
      toast.error(errorMessage(error, 'Não foi possível redefinir a senha. Solicite um novo link.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Nova credencial"
      title="Defina uma nova senha"
      description="Escolha uma senha nova para recuperar o acesso às suas conversas."
      footer={
        <p className="text-sm text-muted">
          Precisa de um novo link?{' '}
          <Link href="/forgot-password" className="font-medium text-link hover:underline">
            Solicitar novamente
          </Link>
        </p>
      }
    >
      <form onSubmit={handleReset} className="space-y-5">
        {!token ? (
          <div role="alert" className="rounded border border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-6 text-text">
            Este link não contém um token válido. Solicite uma nova recuperação de senha.
          </div>
        ) : null}

        <div>
          <label htmlFor="password" className="mb-2 block text-xs font-bold uppercase tracking-[0.02em] text-muted">
            Nova senha
          </label>
          <input
            id="password"
            name="password"
            className={authInputClassName}
            type="password"
            autoComplete="new-password"
            placeholder="Entre 8 e 72 caracteres"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading || !token}
            minLength={8}
            maxLength={72}
            required
          />
        </div>

        <div>
          <label htmlFor="password-confirmation" className="mb-2 block text-xs font-bold uppercase tracking-[0.02em] text-muted">
            Confirme a nova senha
          </label>
          <input
            id="password-confirmation"
            name="passwordConfirmation"
            className={authInputClassName}
            type="password"
            autoComplete="new-password"
            placeholder="Repita a nova senha"
            value={passwordConfirmation}
            onChange={(event) => setPasswordConfirmation(event.target.value)}
            disabled={loading || !token}
            minLength={8}
            maxLength={72}
            required
          />
        </div>

        <button type="submit" disabled={loading || !token} aria-busy={loading} className={authPrimaryButtonClassName}>
          {loading ? (
            <>
              <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Redefinindo...
            </>
          ) : (
            'Salvar nova senha'
          )}
        </button>
      </form>
    </AuthShell>
  );
}

function PasswordResetFallback() {
  return (
    <AuthShell
      eyebrow="Nova credencial"
      title="Validando seu link"
      description="Aguarde enquanto preparamos a redefinição da sua senha."
    >
      <div role="status" aria-live="polite" className="flex items-center gap-3 rounded bg-sidebar px-4 py-4 text-sm text-text">
        <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />
        Carregando recuperação de senha...
      </div>
    </AuthShell>
  );
}

export default function PasswordResetPage() {
  return (
    <Suspense fallback={<PasswordResetFallback />}>
      <PasswordResetForm />
    </Suspense>
  );
}
