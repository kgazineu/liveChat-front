'use client';

import { useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import { useRouter } from 'next/navigation';
import Sidebar from '@/src/components/sidebar'; 
import ChatWindow from '@/src/components/chatWindow';
import api from '@/src/services/api';
import { User } from '@/src/types';

export default function ChatPage() {
    const router = useRouter();
    const [selectedFriend, setSelectedFriend] = useState<User | null>(null);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
    const token = Cookies.get('chat_token');

    if (!token) {
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
            <button onClick={() => { Cookies.remove('chat_token', { path: '/' }); router.replace('/'); }}>Sair</button>
        </div>;
    }

    if (!currentUser) {
        return <div className="flex h-screen items-center justify-center bg-gray-950 text-white">Carregando...</div>;
    }

    return (
        <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
            <Sidebar onUserSelected={(user) => setSelectedFriend(user)} />

            <main className="flex-1 flex flex-col bg-gray-900 border-l border-gray-800 relative">
                
                {selectedFriend ? (
                    <ChatWindow
                        key={selectedFriend.id}
                        currentUser={currentUser} 
                        selectedUser={selectedFriend} 
                    />
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center opacity-50">
                        <div className="text-6xl mb-4">💬</div>
                        <h2 className="text-2xl font-bold mb-2">Bem-vindo ao LiveChat</h2>
                        <p>Olá, <span className="text-blue-400">{currentUser.name}</span>!</p>
                        <p>Selecione um amigo na barra lateral para começar.</p>
                    </div>
                )}
            </main>
        </div>
    );
}
