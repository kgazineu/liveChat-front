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
        return <div className="flex h-screen flex-col gap-4 items-center justify-center bg-gray-950 text-white">
            <p>Não foi possível carregar seu perfil.</p>
            <button onClick={() => { setLoadError(false); setAttempt(value => value + 1); }}>Tentar novamente</button>
            <button onClick={() => { clearSession(); router.replace('/'); }}>Sair</button>
        </div>;
    }

    if (!currentUser) {
        return <div className="flex h-screen items-center justify-center bg-gray-950 text-white">Carregando...</div>;
    }

    return <WorkspaceShell currentUser={currentUser} />;
}
