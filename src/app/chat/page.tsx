'use client';

import { useEffect, useState } from 'react';

import { useRouter } from 'next/navigation';
import WorkspaceShell from '@/src/components/workspace-shell';
import api from '@/src/services/api';
import type { CurrentUser } from '@/src/types';
import { clearSession, hasRefreshSession, sessionAccessToken } from '@/src/services/session';

export default function ChatPage() {
    const router = useRouter();
    const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let active = true;
        const controller = new AbortController();

        async function loadCurrentUser() {
            const [token, refreshAvailable] = await Promise.all([sessionAccessToken(), hasRefreshSession()]);
            if (!active) return;
            if (!token && !refreshAvailable) {
                router.replace('/');
                return;
            }

            try {
                const response = await api.get<CurrentUser>('/users/me', { signal: controller.signal });
                if (active) setCurrentUser(response.data);
            } catch {
                if (active && !controller.signal.aborted) setLoadError(true);
            }
        }

        void loadCurrentUser();
        return () => { active = false; controller.abort(); };
    }, [router, attempt]);


    if (loadError && !currentUser) {
        return (
            <main className="flex h-dvh flex-col items-center justify-center gap-4 bg-main px-6 text-center text-text">
                <h1 className="text-xl font-semibold text-header">Não foi possível carregar seu perfil.</h1>
                <p className="text-sm text-muted">Verifique sua conexão e tente novamente.</p>
                <div className="flex gap-2">
                    <button
                        className="rounded-[3px] bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
                        onClick={() => { setLoadError(false); setAttempt(value => value + 1); }}
                    >
                        Tentar novamente
                    </button>
                    <button
                        className="rounded-[3px] px-4 py-2 text-sm font-medium text-text hover:underline"
                        onClick={() => { clearSession(); router.replace('/'); }}
                    >
                        Sair
                    </button>
                </div>
            </main>
        );
    }

    if (!currentUser) {
        return (
            <main className="flex h-dvh flex-col items-center justify-center gap-4 bg-main text-text" role="status" aria-label="Carregando">
                <span className="grid size-16 animate-pulse place-items-center rounded-3xl bg-brand text-white shadow-lg">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-8" fill="none">
                        <path d="M5.5 6.75h13v8.5h-7.1L7.25 18.5v-3.25H5.5v-8.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                        <path d="M9 10.9h.01M12 10.9h.01M15 10.9h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                </span>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Você sabia?</p>
                <p className="max-w-xs text-center text-sm text-text">Pressione Ctrl + K para pular para qualquer conversa.</p>
            </main>
        );
    }

    return <WorkspaceShell currentUser={currentUser} />;
}
