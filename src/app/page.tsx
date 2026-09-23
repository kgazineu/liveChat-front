'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import AuthShell, {
  authInputClassName,
  authPrimaryButtonClassName,
} from '@/src/components/auth-shell';
import api from '@/src/services/api';
import { errorMessage } from '@/src/services/errors';
import { persistSession, type SessionResponse } from '@/src/services/session';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      toast.error('Preencha seu email e sua senha.');
      return;
    }

    setLoading(true);
    const loadingToast = toast.loading('Entrando...');

    try {
      const response = await api.post<SessionResponse>('/users/login', {
        email: normalizedEmail,
        password,
      });
      persistSession(response.data);
      toast.dismiss(loadingToast);
      toast.success('Bem-vindo de volta!');
      router.replace('/chat');
    } catch (error: unknown) {
      toast.dismiss(loadingToast);
      toast.error(errorMessage(error, 'Email ou senha inválidos.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Bem-vindo de volta"
      title="Entre na sua conta"
      description="Continue suas conversas e encontre sua comunidade."
      footer={
        <p className="text-center text-sm text-slate-400">
          Ainda não tem conta?{' '}
          <Link href="/register" className="font-semibold text-violet-300 transition hover:text-violet-200 hover:underline">
            Cadastre-se
          </Link>
        </p>
      }
    >
      <form onSubmit={handleLogin} className="space-y-5">
        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-200">
            Email
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

        <div>
          <div className="mb-2 flex items-center justify-between gap-4">
            <label htmlFor="password" className="text-sm font-medium text-slate-200">
              Senha
            </label>
            <Link href="/forgot-password" className="text-xs font-medium text-cyan-300 transition hover:text-cyan-200 hover:underline">
              Esqueci minha senha
            </Link>
          </div>
          <input
            id="password"
            name="password"
            className={authInputClassName}
            type="password"
            autoComplete="current-password"
            placeholder="Digite sua senha"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
            required
          />
        </div>

        <button type="submit" disabled={loading} aria-busy={loading} className={authPrimaryButtonClassName}>
          {loading ? (
            <>
              <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Entrando...
            </>
          ) : (
            'Entrar no LiveChat'
          )}
        </button>
      </form>
    </AuthShell>
  );
}
