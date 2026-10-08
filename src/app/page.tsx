'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import AuthShell, {
  authInputClassName,
  authPrimaryButtonClassName,
} from '@/src/components/auth-shell';
import api from '@/src/services/api';
import { desktopBridge } from '@/src/services/desktop';
import { errorMessage } from '@/src/services/errors';
import { hasRefreshSession, persistSession, type SessionResponse } from '@/src/services/session';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!desktopBridge()) return;
    let active = true;
    void hasRefreshSession().then(hasSession => {
      if (active && hasSession) router.replace('/chat');
    }).catch(() => undefined);
    return () => { active = false; };
  }, [router]);

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
      await persistSession(response.data);
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
      eyebrow="LiveChat"
      title="Boas-vindas de volta!"
      description="Estamos muito animados em ver você novamente!"
      footer={
        <p className="text-sm text-muted">
          Precisando de uma conta?{' '}
          <Link href="/register" className="font-medium text-link hover:underline">
            Registre-se
          </Link>
        </p>
      }
    >
      <form onSubmit={handleLogin} className="space-y-5">
        <div>
          <label htmlFor="email" className="mb-2 block text-xs font-bold uppercase tracking-[0.02em] text-muted">
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
          <label htmlFor="password" className="mb-2 block text-xs font-bold uppercase tracking-[0.02em] text-muted">
            Senha
          </label>
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
          <Link href="/forgot-password" className="mt-1.5 inline-block text-sm font-medium text-link hover:underline">
            Esqueceu sua senha?
          </Link>
        </div>

        <button type="submit" disabled={loading} aria-busy={loading} className={authPrimaryButtonClassName}>
          {loading ? (
            <>
              <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Entrando...
            </>
          ) : (
            'Entrar'
          )}
        </button>
      </form>
    </AuthShell>
  );
}
