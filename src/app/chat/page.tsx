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

    useEffect(() => {
    const token = Cookies.get('chat_token');

    if (!token) {
        router.replace('/');
        return;
    }

    api.get('/users/me')
        .then(res => setCurrentUser(res.data))
        .catch(() => {
        Cookies.remove('chat_token');
        router.replace('/');
        });
    }, [router]);


    if (!currentUser) {
        return <div className="flex h-screen items-center justify-center bg-gray-950 text-white">Carregando...</div>;
    }

    return (
        <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
            <Sidebar onUserSelected={(user) => setSelectedFriend(user)} />

            <main className="flex-1 flex flex-col bg-gray-900 border-l border-gray-800 relative">
                
                {selectedFriend ? (
                    <ChatWindow 
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
