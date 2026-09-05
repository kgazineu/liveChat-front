'use client'

import { useState, useEffect, useRef } from 'react';
import api from '@/src/services/api';
import { Message, ChatWindowProps } from '@/src/types';
import Cookies from 'js-cookie';
import { Client } from '@stomp/stompjs';
import toast from 'react-hot-toast';


export default function ChatWindow({ currentUser, selectedUser }: ChatWindowProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState('');
    
    const stompClientRef = useRef<Client | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const selectedUserRef = useRef(selectedUser);
    const currentUserRef = useRef(currentUser);

    const scrollToBottom = () => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
    };

    useEffect(() => {
        selectedUserRef.current = selectedUser;
        currentUserRef.current = currentUser;
        
        if (selectedUser) {
            api.get(`/messages/${selectedUser.id}`)
                .then(res => {
                    setMessages(res.data);
                    scrollToBottom();
                })
                .catch(err => console.error("Erro ao carregar histórico", err));
        }
    }, [selectedUser, currentUser]);

    useEffect(() => {
        const token = Cookies.get('chat_token');
        if (!token) return;

        const client = new Client({
            brokerURL: process.env.NEXT_PUBLIC_BROKER_URL,
            connectHeaders: {
                Authorization: `Bearer ${token}`,
            },
            reconnectDelay: 5000, 
            heartbeatIncoming: 4000,
            heartbeatOutgoing: 4000,
        });

        client.onConnect = (frame) => {
            client.subscribe(`/user/queue/messages`, (message) => {
                const receivedMsg: Message = JSON.parse(message.body);

                setMessages(prev => {
                    if (prev.some(m => m.id === receivedMsg.id)) return prev;

                    const myId = String(currentUser.id);
                    const myEmail = String(currentUser.email);

                    const otherId = String(selectedUserRef.current.id);
                    const otherEmail = String(selectedUserRef.current.email);

                    const msgSenderId = String(receivedMsg.senderId);
                    const msgSenderEmail = String(receivedMsg.senderEmail);

                    const msgReceiverId = String(receivedMsg.receiverId);
                    const msgReceiverEmail = String(receivedMsg.receiverEmail);

                    const isMyMessageToSelected = 
                        (msgSenderId === myId || msgSenderEmail === myEmail) && 
                        (msgReceiverId === otherId || msgReceiverEmail === otherEmail);

                    const isMessageFromSelectedToMe = 
                        (msgSenderId === otherId || msgSenderEmail === otherEmail) &&
                        (msgReceiverId === myId || msgReceiverEmail === myEmail);

                    if (isMyMessageToSelected || isMessageFromSelectedToMe) {
                        return [...prev, receivedMsg];
                    }

                    if (msgSenderId !== myId && msgSenderEmail !== myEmail) {
                        toast(`Nova mensagem de ${receivedMsg.senderName}`, { icon: '📩' });
                    }
                    
                    return prev;
                });
                scrollToBottom();
            });
        };

        client.onStompError = (frame) => {
            console.error('Erro no Broker: ' + frame.headers['message']);
        };
        
        client.activate();
        stompClientRef.current = client;

        return () => {
            client.deactivate();
        };
     
    }, [currentUser.email, currentUser.id]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSendMessage = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!newMessage.trim() || !stompClientRef.current?.connected) return;

        const timestamp = new Date().toISOString();

        const chatMessage = {
            receiverId: selectedUser.id,
            content: newMessage
        };

        setMessages(prev => [...prev]);
        setNewMessage("");


        try {
            stompClientRef.current.publish({
                destination: "/app/chat",
                body: JSON.stringify(chatMessage)
            });          
        } catch (error) {
            console.error(error);
            toast.error("Erro ao enviar mensagem");
        }
    };

    return (
        <div className="flex flex-col h-full w-full bg-gray-900">
            <div className="p-4 border-b border-gray-800 bg-gray-800 flex items-center justify-between shadow-md">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-tr from-blue-500 to-purple-500 rounded-full flex items-center justify-center font-bold text-white">
                        {selectedUser.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h2 className="font-bold text-white">{selectedUser.name}</h2>
                        <span className="text-xs text-green-400 flex items-center gap-1">
                            <span className="w-2 h-2 bg-green-500 rounded-full"></span> Online
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
                    disabled={!newMessage.trim()}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                        <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                    </svg>
                </button>
            </form>
        </div>
    );
}