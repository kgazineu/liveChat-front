interface LiveChatDesktopSessionResponse {
  token: string;
  expiresIn?: string;
  refreshToken: string;
  refreshExpiresIn?: string;
}

interface LiveChatDesktopBridge {
  readonly platform: string;
  readonly session: {
    persist(session: LiveChatDesktopSessionResponse): Promise<void>;
    accessToken(): Promise<string | null>;
    hasRefreshToken(): Promise<boolean>;
    refresh(): Promise<string>;
    clear(): Promise<void>;
  };
  readonly call: {
    setState(state: { active: boolean; title?: string }): Promise<void>;
    onOpen(listener: () => void): () => void;
  };
  readonly notifications: {
    show(notification: { title: string; body: string; kind: 'message' | 'call' }): Promise<void>;
  };
  readonly updater: {
    onReady(listener: (version: string) => void): () => void;
    install(): Promise<void>;
  };
}

interface Window {
  readonly liveChatDesktop?: LiveChatDesktopBridge;
}
