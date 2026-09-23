'use client';

import { useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import { useRouter } from 'next/navigation';
import WorkspaceShell from '@/src/components/workspace-shell';
import api from '@/src/services/api';
import { User } from '@/src/types';
import { clearSession } from '@/src/services/session';

export default function ChatPage() {
    const router = useRouter();
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
    const token = Cookies.get('chat_token');
    const refreshToken = Cookies.get('chat_refresh_token');

    if (!token && !refreshToken) {
        router.replace('/');
        return;
    }

    let active = true;
    const controller = new AbortController();
    api.get('/users/me', { signal: controller.signal })
        .then(res => { if (active) setCurrentUser(res.data); })
        .catch(() => { if (active) setLoadError(true); });
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
