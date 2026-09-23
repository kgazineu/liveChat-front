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

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const normalizedName = name.trim();
    const normalizedEmail = email.trim();
    if (!normalizedName || !normalizedEmail || !password || !passwordConfirmation) {
      toast.error('Preencha todos os campos.');
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
    const loadingToast = toast.loading('Criando sua conta...');

    try {
      await api.post('/users/register', {
        name: normalizedName,
        email: normalizedEmail,
        password,
      });
      toast.dismiss(loadingToast);
      toast.success('Conta criada com sucesso! Faça login.');
      router.push('/');
    } catch (error: unknown) {
      toast.dismiss(loadingToast);
      toast.error(errorMessage(error, 'Falha no cadastro. Verifique os dados.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Comece agora"
      title="Crie sua conta"
      description="Seu espaço para conversar, reunir amigos e participar de comunidades."
      footer={
        <p className="text-center text-sm text-slate-400">
          Já tem uma conta?{' '}
          <Link href="/" className="font-semibold text-violet-300 transition hover:text-violet-200 hover:underline">
            Fazer login
          </Link>
        </p>
      }
    >
      <form onSubmit={handleRegister} className="space-y-4">
        <div>
          <label htmlFor="name" className="mb-2 block text-sm font-medium text-slate-200">
            Nome
          </label>
          <input
            id="name"
            name="name"
            className={authInputClassName}
            type="text"
            autoComplete="name"
            placeholder="Como devemos chamar você?"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={loading}
            required
          />
        </div>

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

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-200">
              Senha
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
              disabled={loading}
              minLength={8}
              maxLength={72}
              required
            />
          </div>
          <div>
            <label htmlFor="password-confirmation" className="mb-2 block text-sm font-medium text-slate-200">
              Confirmar
            </label>
            <input
              id="password-confirmation"
              name="passwordConfirmation"
              className={authInputClassName}
              type="password"
              autoComplete="new-password"
              placeholder="Repita a senha"
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
              disabled={loading}
              minLength={8}
              maxLength={72}
              required
            />
          </div>
        </div>

        <button type="submit" disabled={loading} aria-busy={loading} className={authPrimaryButtonClassName}>
          {loading ? (
            <>
              <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Criando conta...
            </>
          ) : (
            'Criar minha conta'
          )}
        </button>
      </form>
    </AuthShell>
  );
}
