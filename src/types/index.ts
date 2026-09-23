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

export type ServerRole = 'OWNER' | 'MEMBER';
export type ChannelType = 'TEXT' | 'VOICE';
export type MediaChannelKind = 'SERVER_VOICE' | 'DIRECT';
export type MediaSessionStatus = 'CONNECTING' | 'ACTIVE' | 'RECONNECTING';

export interface ServerSummary {
    id: string;
    name: string;
    ownerId: string;
    role: ServerRole;
    createdAt: string;
}

export interface ServerChannel {
    id: string;
    name: string;
    type: ChannelType;
    position: number;
    createdAt: string;
}

export interface DirectChannel {
    id: string;
    participantId: string;
    participantName: string;
    createdAt: string;
}

export interface ServerInvite {
    id: number;
    serverId: string;
    serverName: string;
    inviterId: string;
    inviterName: string;
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
    createdAt: string;
}

export interface ServerMember {
    userId: string;
    userName: string;
    userEmail: string;
    role: ServerRole;
    joinedAt: string;
}

export interface FriendshipEvent {
    type: 'friendship.request.created' | 'friendship.request.accepted' | 'friendship.request.rejected';
    friendshipId: number;
    requesterId: string;
    requesterName: string;
    addresseeId: string;
    addresseeName: string;
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
    createdAt: string;
}

export interface ServerInviteEvent {
    type: 'server.invite.created' | 'server.invite.accepted';
    inviteId: number;
    serverId: string;
    serverName: string;
    inviterId: string;
    inviterName: string;
    inviteeId: string;
    inviteeName: string;
    status: 'PENDING' | 'ACCEPTED';
    createdAt: string;
}

export interface ServerMemberEvent {
    type: 'server.member.joined';
    serverId: string;
    member: ServerMember;
}

export interface ChannelMessage {
    id: number;
    channelId: string;
    content: string;
    authorId: string;
    authorName: string;
    createdAt: string;
}

export interface LiveKitConnection {
    url: string;
    roomName: string;
    token: string;
    expiresAt: string;
}

export interface MediaSession {
    channelKind: MediaChannelKind;
    serverId: string | null;
    channelId: string;
    userId: string;
    userName: string;
    status: MediaSessionStatus;
    microphoneEnabled: boolean;
    cameraEnabled: boolean;
    screenShareEnabled: boolean;
    joinedAt: string;
    lastSeenAt: string;
    connection?: LiveKitConnection;
}

export interface MediaPresenceEvent {
    type: 'media.participant.joined' | 'media.participant.left' | 'media.participant.updated';
    participant: MediaSession;
}

export type TextTarget =
    | { kind: 'DIRECT'; channelId: string; title: string; subtitle?: string }
    | { kind: 'SERVER_TEXT'; serverId: string; channelId: string; title: string; subtitle?: string };

export type MediaTarget =
    | { kind: 'DIRECT'; channelId: string; title: string }
    | { kind: 'SERVER_VOICE'; serverId: string; channelId: string; title: string };
