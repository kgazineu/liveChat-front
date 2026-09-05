export interface User {
    id: string;
    name: string;
    email: string;
}

export interface FriendRequest {
    id: number; // ID da Amizade
    requesterName: string;
    requesterId: string;
}

export interface Message {
    id: number;
    content: string;
    senderId: string;
    senderName: string;
    senderEmail: string;
    timestamp: string;
    receiverId: string;
    receiverEmail: string;
}

export interface ChatWindowProps {
    currentUser: User;
    selectedUser: User;
}
