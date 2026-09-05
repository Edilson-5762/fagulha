# Fagulha V1 — Plano 10: TURN real com Metered (design)

## Contexto

O Fagulha hoje conecta os dois lados de uma transferência via WebRTC usando só STUN público (`stun:stun.l.google.com:19302`). Isso funciona na maioria das redes domésticas, mas falha quando os dois lados estão simultaneamente atrás de uma rede restritiva (NAT de operadora/CGNAT, Wi-Fi corporativo, VPN) — nesse caso não existe caminho direto possível e a conexão nunca se estabelece.

Essa limitação era conhecida desde o Plano 5/9 (WebRTC) e foi documentada como decisão deliberada em `apps/web/src/lib/peer-connection.ts`:

```ts
// TODO(turn): a próxima peça da V1 adiciona um servidor TURN gerenciado
// (credenciais temporárias via endpoint no signaling). Até lá, só STUN —
// pares atrás de NAT simétrico / rede corporativa podem não conectar.
```

Em 2026-09-05, com o app já publicado publicamente (`fagulha-web.vercel.app` + `fagulha-signaling.onrender.com`), o usuário decidiu resolver essa limitação usando o **Metered.ca** — free tier, sem cartão, com suporte a credenciais TURN temporárias (não é o caso de todo provedor: o ExpressTURN, por exemplo, só libera credencial temporária no plano pago). Este documento cobre só essa peça: TURN real + mensagens de erro diferenciadas. Migração pro plano pago do Metered (Growth, US$99/mês, 150GB) fica fora de escopo — a decisão de negócio é usar o free tier agora e reavaliar depois, conforme o uso real do app.

## Objetivo

1. Adicionar um servidor TURN real (Metered, free tier) como fallback de conexão quando o STUN sozinho não é suficiente.
2. Nunca expor a Secret Key do Metered no navegador — ela fica só no servidor de sinalização.
3. Quando a conexão falhar especificamente por causa do TURN (credencial rejeitada, cota mensal do Metered esgotada), mostrar ao usuário uma mensagem diferente e acionável, em vez da mensagem genérica de "conexão perdida" — para não parecer bug do site.
4. Degradar graciosamente: se a busca de credenciais do TURN falhar (rede, cota, Metered fora do ar), a conexão continua tentando via STUN normalmente, como hoje.

## Fora de escopo

- Migração ou avaliação do plano pago do Metered.
- Rate limiting / hardening da rota nova (fica para o item "segurança básica" já planejado depois do bidirecional no checklist geral da V1).
- Renovação de credencial em transferências que ultrapassem a validade da credencial (ver "Duração da credencial" abaixo — a validade escolhida cobre o caso realista).
- Qualquer mudança no protocolo de sinalização (`SignalPayload`, `ClientMessage`, `ServerMessage`).

## Arquitetura

### Novo endpoint no servidor de sinalização

`apps/signaling-server` ganha uma rota HTTP nova: `GET /turn-credentials`.

- Reaproveita o padrão de checagem de origem já usado no `upgrade` do WebSocket em `server.ts` (`req.headers.origin !== ALLOWED_ORIGIN` → recusa). Requisições de fora do próprio site (`WEB_ORIGIN`) são recusadas.
- Ao receber um pedido válido, o servidor chama a API do Metered server-to-server:
  `POST https://{seu-subdominio}.metered.live/api/v1/turn/credential?secretKey={METERED_SECRET_KEY}&expiryInSeconds=14400`
  (a Secret Key nunca é enviada ao cliente — só usada nessa chamada servidor-a-servidor.)
- A resposta do Metered (username, credential, urls) é repassada ao navegador como um array `RTCIceServer[]`, no formato que o `RTCPeerConnection` já espera.
- Se a chamada ao Metered falhar por qualquer motivo (erro de rede, credencial rejeitada, cota mensal esgotada — a Metered retorna erro nesses casos), o endpoint responde com uma lista vazia de servidores TURN (`{ iceServers: [] }`) em vez de erro 500 — o cliente trata isso como "sem TURN disponível agora" e segue só com STUN, sem quebrar o fluxo.

### Configuração

- Nova variável de ambiente no servidor de sinalização: `METERED_SECRET_KEY` (secreta, `sync: false` no `render.yaml`, igual ao padrão já usado para `WEB_ORIGIN`).
- Nova variável: `METERED_SUBDOMAIN` (ou o valor completo da URL da API do Metered) — necessário porque a URL da API do Metered inclui o subdomínio escolhido na criação do app (`fagulha.metered.live` ou o que tiver sido escolhido no cadastro).

### Cliente (`apps/web`)

- `usePeerConnection` (`peer-connection.ts`) passa a buscar `GET {SIGNALING_URL}/turn-credentials` antes de criar o `RTCPeerConnection`, e monta `iceServers` como STUN (fixo, como hoje) + o que vier do endpoint (pode ser vazio).
- Essa busca acontece uma vez por tentativa de conexão (mesmo timing em que o STUN já é usado hoje) — não há necessidade de lógica de "tentar STUN primeiro, cair pro TURN depois": o próprio ICE já testa todos os candidatos (diretos e via relay) em paralelo e prioriza a conexão direta automaticamente por causa da prioridade de candidato padrão do protocolo.

### Duração da credencial

`expiryInSeconds: 14400` (4 horas). Cobre transferências grandes em conexões lentas sem precisar de lógica de renovação. O link de convite continua expirando em 15 minutos como hoje (isso é sobre o convite, não sobre a transferência em si, que não tem prazo máximo depois de aceita).

## Mensagens de erro diferenciadas

Hoje, qualquer falha de conexão em `SendPanel.tsx`/`ReceivePanel.tsx` mostra:

> "Conexão com o outro dispositivo perdida. Peça um novo link para tentar de novo."

Isso passa a se dividir em dois casos, usando o evento `RTCPeerConnection.onicecandidateerror` (que reporta o código de erro e a URL do servidor STUN/TURN que falhou):

- **Falha específica do TURN** (evento com `errorCode` de recusa — 401/403 — vindo de uma URL `turn:` ou `turns:`, indicando credencial rejeitada ou cota esgotada): nova mensagem —
  > "Não foi possível usar o servidor de apoio à conexão agora. Tente novamente mais tarde ou use outra rede (Wi-Fi em vez de dados móveis)."
- **Qualquer outra falha** (perda de conexão comum, rede caiu, etc.): mantém a mensagem atual, sem mudança.

Sem menção a "cota", "upgrade" ou qualquer termo técnico/comercial na mensagem visível ao usuário — decisão explícita do usuário do produto durante o brainstorming.

`PeerChannelState` (hoje `"idle" | "connecting" | "open" | "failed"`) ganha um motivo opcional de falha para carregar essa distinção até a UI — o tipo exato (`failureReason?: "turn_unavailable" | "connection_lost"` ou equivalente) fica a critério do plano de implementação.

## Testes

- Servidor de sinalização: teste do endpoint `/turn-credentials` cobrindo (a) origem inválida → recusado, (b) sucesso → repassa `iceServers` do Metered, (c) falha na chamada ao Metered → responde lista vazia sem erro 500. Chamada ao Metered mockada, sem bater na API real nos testes automatizados.
- Cliente: teste do hook `usePeerConnection` cobrindo (a) busca de credenciais incluída no `iceServers` ao conectar, (b) fetch de credenciais falha → segue só com STUN, (c) `onicecandidateerror` vindo de URL `turn:` com 401/403 → estado de falha carrega o motivo "turn_unavailable"; qualquer outro erro → motivo padrão.
- Sem teste de integração real contra a API do Metered (exigiria a Secret Key real em CI) — mockar a chamada HTTP nos testes do servidor de sinalização.

## Verificação manual (pelo usuário, só isso exige o usuário)

Depois de implementado e publicado, o único jeito de confirmar de verdade que o TURN funciona é um teste com 2 dispositivos em redes restritivas (ex. os dois no 4G/5G de operadoras diferentes) — isso já estava na lista de pendências da V1 ("validação formal cross-browser/mobile") e continua precisando do usuário, como sempre.
