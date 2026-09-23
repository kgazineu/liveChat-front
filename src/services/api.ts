import axios, { type InternalAxiosRequestConfig } from 'axios';
import Cookies from 'js-cookie';
import { getRuntimeConfig } from './runtime-config';
import { clearSession, persistSession, type SessionResponse } from './session';

const api = axios.create({
    timeout: 15000,
});

api.interceptors.request.use(async (config) => {
    config.baseURL = (await getRuntimeConfig()).apiUrl;
    const token = Cookies.get('chat_token');
    if (token && !isPublicAuthRequest(config.url)) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

interface RetryableRequest extends InternalAxiosRequestConfig {
    _sessionRetry?: boolean;
}

let pendingRefresh: Promise<string> | undefined;

async function refreshAccessToken() {
    const refreshToken = Cookies.get('chat_refresh_token');
    if (!refreshToken) throw new Error('Refresh token ausente.');
    const { apiUrl } = await getRuntimeConfig();
    const response = await axios.post<SessionResponse>(`${apiUrl}/users/refresh`, { refreshToken }, { timeout: 15000 });
    persistSession(response.data);
    return response.data.token;
}

function redirectToLogin() {
    clearSession();
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        // Fora da árvore React: recarregar também limpa o estado autenticado em memória.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/';
    }
}

api.interceptors.response.use(
    response => response,
    async error => {
        const config = error.config as RetryableRequest | undefined;
        const protectedRequest = config && !isPublicAuthRequest(config.url);
        if (error.response?.status !== 401 || !protectedRequest) return Promise.reject(error);

        if (!config._sessionRetry && Cookies.get('chat_refresh_token')) {
            config._sessionRetry = true;
            try {
                pendingRefresh ??= refreshAccessToken().finally(() => { pendingRefresh = undefined; });
                const token = await pendingRefresh;
                config.headers.Authorization = `Bearer ${token}`;
                return api(config);
            } catch {
                redirectToLogin();
                return Promise.reject(error);
            }
        }

        redirectToLogin();
        return Promise.reject(error);
    }
);

export default api;

function isPublicAuthRequest(url?: string) {
    return [
        '/users/login',
        '/users/register',
        '/users/refresh',
        '/users/password-reset/request',
        '/users/password-reset/confirm',
        '/users/profile-update/confirm',
    ].includes('/' + (url || '').replace(/^\/+/, ''));
}
