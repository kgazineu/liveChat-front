'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import AuthShell, {
  authInputClassName,
  authPrimaryButtonClassName,
} from '@/src/components/auth-shell';
import api from '@/src/services/api';

const SECURITY_MESSAGE =
  'Se houver uma conta com esse email, enviaremos as instruções para redefinir sua senha.';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [requestComplete, setRequestComplete] = useState(false);

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      toast.error('Informe seu email.');
      return;
    }

    setLoading(true);
    setRequestComplete(false);
    const loadingToast = toast.loading('Enviando instruções...');

    try {
      await api.post('/users/password-reset/request', { email: normalizedEmail });
    } catch {
      // A resposta é intencionalmente indistinguível para não revelar contas cadastradas.
    } finally {
      toast.dismiss(loadingToast);
      toast.success(SECURITY_MESSAGE);
      setRequestComplete(true);
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Recuperação de acesso"
      title="Esqueceu sua senha?"
      description="Informe seu email e enviaremos o próximo passo, caso exista uma conta associada."
      footer={
        <p className="text-center text-sm text-slate-400">
          Lembrou sua senha?{' '}
          <Link href="/" className="font-semibold text-violet-300 transition hover:text-violet-200 hover:underline">
            Voltar para o login
          </Link>
        </p>
      }
    >
      <form onSubmit={handleRequest} className="space-y-5">
        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-200">
            Email da conta
          </label>
          <input
            id="email"
            name="email"
            className={authInputClassName}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="voce@exemplo.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={loading}
            required
          />
        </div>

        {requestComplete ? (
          <div role="status" aria-live="polite" className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] px-4 py-3 text-sm leading-6 text-cyan-100">
            {SECURITY_MESSAGE}
          </div>
        ) : null}

        <button type="submit" disabled={loading} aria-busy={loading} className={authPrimaryButtonClassName}>
          {loading ? (
            <>
              <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Enviando...
            </>
          ) : (
            'Enviar instruções'
          )}
        </button>
      </form>
    </AuthShell>
  );
}
