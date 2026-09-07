import axios from 'axios';
import Cookies from 'js-cookie';
import { getRuntimeConfig } from './runtime-config';

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

api.interceptors.response.use(
    (response) => {
        return response;
    },
    (error) => {
        if (error.response?.status === 401 && error.config?.headers?.Authorization &&
            !isPublicAuthRequest(error.config?.url)) {
            Cookies.remove('chat_token', { path: '/' });

            if (typeof window !== 'undefined' && window.location.pathname !== '/') {
                // Fora da árvore React: recarregar também limpa o estado autenticado em memória.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.href = '/';
            }
        }
        return Promise.reject(error);
    }
);

export default api;

function isPublicAuthRequest(url?: string) {
    return ['/users/login', '/users/register'].includes('/' + (url || '').replace(/^\/+/, ''));
}
