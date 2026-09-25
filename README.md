# LiveChat — frontend

Cliente web do LiveChat, uma plataforma de comunicação em tempo real organizada em servidores, canais e conversas privadas 1:1. O projeto usa Next.js 16, React 19, STOMP/WebSocket e o SDK WebRTC do LiveKit.

## Funcionalidades

- cadastro, login, recuperação segura de senha e renovação automática por refresh token rotativo;
- amizades: busca, envio, aceite e rejeição de solicitações;
- criação e listagem de servidores;
- canais de texto e voz, com criação restrita ao proprietário;
- convites direcionados a amigos e aceite explícito;
- canais privados 1:1 idempotentes;
- mensagens persistidas por canal, histórico paginado e atualização em tempo real por STOMP;
- anexos de imagens/GIF, vídeos e documentos, com preview, progresso, cancelamento e upload multipart direto assinado para o Cloudinary;
- renovação das URLs temporárias de download por meio da reconciliação do histórico;
- áudio, câmera e compartilhamento de tela por LiveKit;
- visualização ampliada e fullscreen das telas compartilhadas;
- controles compactos de chamada integrados ao painel lateral;
- presença de mídia, fala ativa e estados de reconexão;
- seleção de microfone, câmera e saída de áudio quando suportada pelo navegador;
- painel recolhível de métricas WebRTC: RTT, jitter, perda, bitrate e jitter buffer;
- menu de configurações com atualização confirmada de nome/e-mail, troca de senha, logout e exclusão da conta;
- sincronização social por filas STOMP privadas e reconciliação REST após cada conexão;
- consumo completo das listagens paginadas de amizades, solicitações, canais e membros;
- privacidade por contrato: e-mail disponível apenas para o próprio usuário em `/users/me`;
- tratamento de `429 Too Many Requests` com cooldown baseado em `Retry-After`;
- listagem autorizada dos membros de cada servidor.

## Pré-requisitos

- Node.js `>=24 <25`;
- npm `>=11 <12`;
- API LiveChat em execução;
- broker STOMP da API acessível;
- LiveKit configurado no backend para usar chamadas;
- Cloudinary e o preset privado assinado configurados no backend para anexos.

## Configuração

A configuração é lida no servidor Next.js e exposta ao cliente por `/api/runtime-config`:

```env
API_URL=http://localhost:8080
BROKER_URL=ws://localhost:8080/ws
```

Em páginas HTTPS, `API_URL` precisa usar `https://` e `BROKER_URL` precisa usar `wss://`. A URL do LiveKit não é configurada no frontend: ela é entregue pelo backend apenas na resposta autenticada de entrada em uma sessão de mídia.

No backend, `FRONTEND_PASSWORD_RESET_URL` deve apontar para `/password-reset` e `FRONTEND_PROFILE_UPDATE_URL` para `/profile-update` neste frontend. O backend da PR #15 já expõe `Retry-After` no CORS, permitindo que o navegador respeite o cooldown retornado em respostas `429`. Anexos não exigem segredo no frontend: a API retorna somente os campos temporários assinados, e o arquivo é enviado diretamente ao endpoint HTTPS do Cloudinary.

## Desenvolvimento

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Validação

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Contratos de tempo real

O cliente abre uma única conexão STOMP autenticada por sessão e assina:

- `/user/queue/messages` para mensagens persistidas;
- `/user/queue/media-presence` para entrada, saída e atualização de participantes;
- `/user/queue/friendships` para solicitações e mudanças de amizade;
- `/user/queue/server-invites` para criação e aceite de convites;
- `/user/queue/server-members` para novos membros de servidores.

Áudio, câmera e tela não trafegam pelo backend Spring ou pelo STOMP. Depois do `POST .../media-sessions`, o cliente usa `connection.url` e `connection.token` para entrar na sala autorizada do LiveKit. A credencial fica apenas em memória e é descartada ao sair ou trocar de canal.

## Observações de produção

Chamadas em produção dependem da infraestrutura do backend descrita em `IDEIA_DO_PROJETO.md`: LiveKit fora do modo de desenvolvimento, domínio/TLS, portas WebRTC, IP público e TURN para redes restritivas. Os testes unitários do frontend não substituem a validação real com 2 e 5 participantes nem os testes de fallback de rede.

Anexos dependem da configuração de produção da PR #15: credenciais Cloudinary somente no backend, preset `signed` com limite de 10 MiB e Strict Transformations habilitado. O frontend nunca envia seu JWT ao Cloudinary; o upload externo contém apenas os `formFields` assinados e o campo `file`.
