/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState } from 'react';
import api from '@/src/services/api';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import Link from 'next/link';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const loadingToast = toast.loading('Entrando...');

    try {
      const response = await api.post('/users/login', { email, password });
      const { token } = response.data;

      Cookies.set('chat_token', token, {
        expires: 1 / 12, 
        path: '/',       
        secure: false,  
        sameSite: 'lax'
      });

      toast.dismiss(loadingToast);
      toast.success('Bem-vindo de volta!');

      router.replace('/chat');

    } catch (error: any) {
      toast.dismiss(loadingToast);
      console.error(error);

      const message = error.response?.data?.message || 'Email ou senha inválidos';
      toast.error(message);
      
      setLoading(false); 
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
      <form onSubmit={handleLogin} className="w-full max-w-sm p-6 bg-gray-800 rounded-lg shadow-md">
        <h2 className="mb-6 text-2xl font-bold text-center">Entrar no Chat</h2>

        <div className="mb-4">
          <label className="block mb-1 text-sm">Email</label>
          <input
            className="w-full p-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:border-blue-500"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="mb-6">
          <label className="block mb-1 text-sm">Senha</label>
          <input
            className="w-full p-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:border-blue-500"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`w-full p-2 font-bold rounded transition ${
            loading 
              ? 'bg-green-800 cursor-not-allowed text-gray-300' 
              : 'bg-green-600 hover:bg-green-500 text-white'
          }`}
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>

        <p className="mt-4 text-center text-sm text-gray-400">
          Não tem conta? <Link href="/register" className="text-blue-400 hover:underline">Cadastre-se</Link>
        </p>
      </form>
    </div>
  );
}