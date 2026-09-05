/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect, useCallback } from 'react';
import api from '@/src/services/api';
import { User, FriendRequest } from '@/src/types';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import toast from 'react-hot-toast';

interface SidebarProps {
    onUserSelected: (user: User) => void;
}

export default function Sidebar({ onUserSelected }: SidebarProps) {
    const router = useRouter();

    const [friends, setFriends] = useState<User[]>([]);
    const [requests, setRequests] = useState<FriendRequest[]>([]);
    const [emailSearch, setEmailSearch] = useState('');
    const [foundUser, setFoundUser] = useState<User | null>(null);
    const [activeTab, setActiveTab] = useState<'friends' | 'requests'>('friends');
    
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [loggedUser, setLoggedUser] = useState<User | null>(null);

    const fetchFriends = useCallback(async () => {
        try {
            const res = await api.get('/friendships');
            setFriends(res.data);
        } catch (error) {
            console.error("Erro ao buscar amigos", error);
        }
    }, []);

    const fetchRequests = useCallback(async () => {
        try {
            const res = await api.get('/friendships/requests');
            setRequests(res.data);
        } catch (error) {
            console.error("Erro ao buscar solicitações", error);
        }
    }, []);

    const refreshData = useCallback(async () => {
        await Promise.all([fetchFriends(), fetchRequests()]);
    }, [fetchFriends, fetchRequests]);

    useEffect(() => { async function loadInitialData() { await refreshData(); } loadInitialData(); }, []);


    async function handleSearch() {
        if (!emailSearch.trim()) return;

        const loading = toast.loading('Buscando usuário...');

        try {
            setFoundUser(null);
            
            const res = await api.get('/users/search', {
                params: { email: emailSearch.trim() }
            });

            if (Array.isArray(res.data) && res.data.length > 0) {
                const user = res.data[0]; 
                setFoundUser(user);
                toast.success('Usuário encontrado!');
            } else {
                toast.error('Usuário não encontrado!');
            }
            toast.dismiss(loading);

        } catch (error: any) {
            toast.dismiss(loading);
            console.error("Erro na busca:", error);
            
            if (error.response?.status === 404) {
                toast.error('Usuário não encontrado.');
            } else {
                toast.error('Erro ao buscar.');
            }
            setFoundUser(null);
        }
    }

    async function sendRequest() {
        if (!foundUser) return;

        const loading = toast.loading('Enviando pedido...');

        try {
            await api.post('/friendships/send', { targetUserId: foundUser.id });

            toast.dismiss(loading);
            toast.success(`Pedido enviado para ${foundUser.name}!`);
            
            setFoundUser(null);
            setEmailSearch('');
            await refreshData();

        } catch (error: any) {
            toast.dismiss(loading);
            console.error("Erro ao enviar pedido:", error);
            const msg = error.response?.data?.message || 'Erro ao enviar pedido';
            toast.error(msg);
        }
    }

    async function acceptRequest(id: number) {
        await toast.promise(
            api.patch(`/friendships/${id}/accept`),
            {
                loading: 'Aceitando...',
                success: 'Agora vocês são amigos! 🎉',
                error: (err) => {
                    return err.response?.data?.message || 'Erro ao aceitar';
                },
            }
        );
        refreshData();
    }

    async function rejectRequest(id: number) {
        await toast.promise(
            api.patch(`/friendships/${id}/reject`),
            {
                loading: 'Rejeitando...',
                success: 'Solicitação removida.',
                error: 'Erro ao rejeitar',
            }
        );
        refreshData();
    }

    function handleLogout() {
        Cookies.remove('chat_token');
        router.replace('/');
        toast.success('Você saiu do chat.');
    }


    return (
        <aside className="w-80 bg-gray-900 text-white flex flex-col border-r border-gray-700 h-screen">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                <h1 className="font-bold text-xl">LiveChat</h1>
                <button onClick={handleLogout} className="text-xs text-red-400 hover:text-red-300">
                    Sair
                </button>
            </div>

            <div className="p-4">
                <div className="flex gap-2">
                    <input
                        type="text"
                        placeholder="Buscar por email..."
                        className="w-full p-2 text-sm bg-gray-800 rounded border border-gray-600 focus:border-blue-500 outline-none"
                        value={emailSearch}
                        onChange={e => setEmailSearch(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    />
                    <button onClick={handleSearch} className="bg-blue-600 p-2 rounded hover:bg-blue-500">
                        🔍
                    </button>
                </div>

                {foundUser && (
                    <div className="mt-4 p-3 bg-gray-800 rounded border border-blue-500 flex justify-between items-center animate-fade-in">
                        <div>
                            <p className="font-bold text-sm">{foundUser.name}</p>
                            <p className="text-xs text-gray-400">{foundUser.email}</p>
                        </div>
                        <button
                            onClick={sendRequest}
                            className="text-xs bg-green-600 px-2 py-1 rounded hover:bg-green-500"
                        >
                            Add
                        </button>
                    </div>
                )}
            </div>

            <div className="flex border-b border-gray-700">
                <button
                    onClick={() => setActiveTab('friends')}
                    className={`flex-1 p-3 text-sm font-medium transition-colors ${
                        activeTab === 'friends'
                            ? 'border-b-2 border-blue-500 text-blue-400'
                            : 'text-gray-400 hover:text-gray-200'
                    }`}
                >
                    Amigos ({friends.length})
                </button>

                <button
                    onClick={() => setActiveTab('requests')}
                    className={`flex-1 p-3 text-sm font-medium transition-colors ${
                        activeTab === 'requests'
                            ? 'border-b-2 border-blue-500 text-blue-400'
                            : 'text-gray-400 hover:text-gray-200'
                    }`}
                >
                    Pedidos ({requests.length})
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
                {activeTab === 'friends' && (
                    <div className="space-y-2">
                        {friends.map(friend => (
                            <div
                                key={friend.id}
                                // 3. APLICAÇÃO DO ONCLICK AQUI
                                onClick={() => onUserSelected(friend)}
                                className="p-3 hover:bg-gray-800 rounded cursor-pointer flex items-center gap-3 transition-colors"
                            >
                                <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center font-bold text-lg text-blue-200">
                                    {friend.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <p className="font-medium">{friend.name}</p>
                                    <p className="text-xs text-green-400">Online</p>
                                </div>
                            </div>
                        ))}

                        {friends.length === 0 && (
                            <p className="text-center text-gray-500 text-sm mt-10">Nenhum amigo ainda.</p>
                        )}
                    </div>
                )}

                {activeTab === 'requests' && (
                    <div className="space-y-2">
                        {requests.map(req => (
                            <div key={req.id} className="p-3 bg-gray-800 rounded border border-gray-700">
                                <p className="text-sm mb-2">
                                    <span className="font-bold">{req.requesterName}</span> quer ser seu amigo.
                                </p>

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => acceptRequest(req.id)}
                                        className="flex-1 bg-green-600 text-white text-xs py-1 rounded hover:bg-green-500"
                                    >
                                        Aceitar
                                    </button>

                                    <button
                                        onClick={() => rejectRequest(req.id)}
                                        className="flex-1 bg-red-600 text-white text-xs py-1 rounded hover:bg-red-500"
                                    >
                                        Rejeitar
                                    </button>
                                </div>
                            </div>
                        ))}

                        {requests.length === 0 && (
                            <p className="text-center text-gray-500 text-sm mt-10">Nenhuma solicitação pendente.</p>
                        )}
                    </div>
                )}
            </div>
        </aside>
    );
}