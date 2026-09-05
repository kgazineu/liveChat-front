/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/src/services/api';
import Link from 'next/link';
import toast from 'react-hot-toast';

export default function RegisterPage(){
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const router = useRouter();

    async function handleRegister(e: React.FormEvent) {
        e.preventDefault();

        const loadingToast = toast.loading('Criando sua conta...');

        try {
            await api.post('users/register', { name, email, password });
            
            toast.dismiss(loadingToast);
            toast.success('Conta criada com sucesso! Faça login.');

            router.push('/'); 
            
        } catch (error: any) {
            toast.dismiss(loadingToast);
            console.error('Registration failed:', error);
            
            const message = error.response?.data?.message || 'Falha no cadastro. Verifique os dados.';
            toast.error(message);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
            <form onSubmit={handleRegister} className="w-full max-w-sm p-6 bg-gray-800 rounded-lg shadow-md">
                <h2 className="mb-6 text-2xl font-bold text-center">Crie sua conta</h2>
                
                <div className="mb-4">
                    <label className="block mb-1 text-sm">Nome</label>
                    <input 
                        className="w-full p-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:border-blue-500"
                        type="text" 
                        value={name} 
                        onChange={e => setName(e.target.value)}
                        required 
                    />
                </div>

                <div className="mb-4">
                    <label className="block mb-1 text-sm">Email</label>
                    <input 
                        className="w-full p-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:border-blue-500"
                        type="email" 
                        value={email} 
                        onChange={e => setEmail(e.target.value)}
                        required
                    />
                </div>

                <div className="mb-6">
                    <label className="block mb-1 text-sm">Senha</label>
                    <input 
                        className="w-full p-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:border-blue-500"
                        type="password" 
                        value={password} 
                        onChange={e => setPassword(e.target.value)}
                        required
                    />
                </div>

                <button type="submit" className="w-full p-2 font-bold bg-blue-600 rounded hover:bg-blue-500 transition">
                    Cadastrar
                </button>
                
                <p className="mt-4 text-center text-sm text-gray-400">
                    Já tem conta? <Link href="/" className="text-blue-400 hover:underline">Faça Login</Link>
                </p>
            </form>
        </div>
    );
}