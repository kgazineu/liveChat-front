'use client'

import { useState, useEffect, useRef } from 'react';
import api from '@/src/services/api';
import { Message, ChatWindowProps } from '@/src/types';
import Cookies from 'js-cookie';
import { Client } from '@stomp/stompjs';
import toast from 'react-hot-toast';
import { getRuntimeConfig } from '@/src/services/runtime-config';
import { belongsToConversation, mergeMessages, parseMessage } from '@/src/services/messages';


export default function ChatWindow({ currentUser, selectedUser }: ChatWindowProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState('');
    
    const stompClientRef = useRef<Client | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const [connected, setConnected] = useState(false);

    useEffect(() => {
        let active = true;
        let historyController: AbortController | undefined;
        let historyVersion = 0;
        let client: Client | undefined;

        async function loadHistory() {
            historyController?.abort();
            historyController = new AbortController();
            const version = ++historyVersion;
            try {
                const response = await api.get<Message[]>(`/messages/${selectedUser.id}`, { signal: historyController.signal });
                if (active && version === historyVersion) {
                    if (!Array.isArray(response.data)) throw new Error('Histórico inválido');
                    setMessages(previous => mergeMessages(response.data, previous));
                }
            } catch {
                if (active && version === historyVersion) toast.error('Erro ao carregar histórico. Tente reabrir a conversa.');
            }
        }

        void loadHistory();
        async function connect() {
            try {
                const config = await getRuntimeConfig();
                if (!active) return;
                const token = Cookies.get('chat_token');
                if (!token) return;
                client = new Client({
                    brokerURL: config.brokerUrl,
                    connectHeaders: { Authorization: `Bearer ${token}` },
                    reconnectDelay: 5000,
                    connectionTimeout: 10000,
                    heartbeatIncoming: 4000,
                    heartbeatOutgoing: 4000,
                });
                client.beforeConnect = () => {
                    const currentToken = Cookies.get('chat_token');
                    if (!currentToken) { void client?.deactivate(); return; }
                    client!.connectHeaders = { Authorization: `Bearer ${currentToken}` };
                };
                client.onConnect = () => {
                    if (!active) return;
                    setConnected(true);
                    client!.subscribe('/user/queue/messages', frame => {
                        if (!active) return;
                        const message = parseMessage(frame.body);
                        if (!message) { toast.error('Mensagem recebida em formato inválido.'); return; }
                        if (belongsToConversation(message, currentUser, selectedUser)) {
                            setMessages(previous => mergeMessages(previous, [message]));
                        } else if (String(message.senderId) !== String(currentUser.id)) {
                            toast(`Nova mensagem de ${message.senderName || 'outro contato'}`, { icon: '📩' });
                        }
                    });
                    // Recupera mensagens perdidas durante uma desconexão, preservando eventos ao vivo.
                    void loadHistory();
                };
                client.onWebSocketClose = () => { if (active) setConnected(false); };
                client.onWebSocketError = () => { if (active) setConnected(false); };
                client.onStompError = () => {
                    if (active) { setConnected(false); toast.error('O servidor recusou a conexão do chat.'); }
                };
                stompClientRef.current = client;
                client.activate();
            } catch {
                if (active) toast.error('Não foi possível configurar a conexão do chat. Reabra a conversa.');
            }
        }
        void connect();
        return () => {
            active = false;
            historyController?.abort();
            stompClientRef.current = null;
            void client?.deactivate();
        };
    }, [currentUser, selectedUser]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSendMessage = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!newMessage.trim()) return;
        if (!stompClientRef.current?.connected) {
            toast.error('Chat desconectado. Aguarde a reconexão.');
            return;
        }
        try {
            stompClientRef.current.publish({
                destination: '/app/chat',
                body: JSON.stringify({ receiverId: selectedUser.id, content: newMessage }),
            });
            setNewMessage('');
        } catch {
            toast.error('Erro ao enviar mensagem. Seu texto foi preservado.');
        }
    };

    return (
        <div className="flex flex-col h-full w-full bg-gray-900">
            <div className="p-4 border-b border-gray-800 bg-gray-800 flex items-center justify-between shadow-md">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-linear-to-tr from-blue-500 to-purple-500 rounded-full flex items-center justify-center font-bold text-white">
                        {selectedUser.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h2 className="font-bold text-white">{selectedUser.name}</h2>
                        <span className="text-xs text-green-400 flex items-center gap-1">
                            {connected ? 'Chat conectado' : 'Chat desconectado — reconectando...'}
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-900 scrollbar-thin scrollbar-thumb-gray-700">
                {messages.length === 0 && (
                    <div className="text-center text-gray-500 mt-10">
                        Comece a conversar com {selectedUser.name}! 👋
                    </div>
                )}
                
                {messages.map((msg) => {
                    const isMe = String(msg.senderId) === String(currentUser.id);
                    return (
                        <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                            <div 
                                className={`max-w-[70%] p-3 rounded-2xl shadow-md text-sm ${
                                    isMe 
                                        ? 'bg-blue-600 text-white rounded-tr-none' 
                                        : 'bg-gray-700 text-gray-100 rounded-tl-none'
                                }`}
                            >
                                <p>{msg.content}</p>
                                <span className="text-[10px] opacity-70 block text-right mt-1">
                                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="p-4 bg-gray-800 border-t border-gray-700 flex gap-2">
                <input
                    type="text"
                    className="flex-1 bg-gray-700 text-white rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600"
                    placeholder="Digite sua mensagem..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                />
                <button 
                    type="submit" 
                    className="bg-blue-600 hover:bg-blue-500 text-white rounded-full p-3 transition-colors flex items-center justify-center"
                    aria-label="Enviar mensagem"
                    disabled={!newMessage.trim() || !connected}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                        <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                    </svg>
                </button>
            </form>
        </div>
    );
}