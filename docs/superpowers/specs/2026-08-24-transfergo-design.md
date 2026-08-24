# TransferGo — Especificação do Produto

- **Versão:** 1.1 (consolidada — base 1.0 do autor + decisões técnicas de infraestrutura)
- **Status:** Aprovada para planejamento de implementação (V1)
- **Data:** 2026-08-24
- **Natureza inicial:** Projeto de portfólio com arquitetura preparada para uso pessoal e futura evolução comercial
- **Plataforma inicial:** Web responsiva
- **Princípios:** P2P First · Security by Design · Privacy by Default

> Este documento consolida a totalidade da SPEC 1.0 original (100 itens) escrita
> pelo autor do produto, reorganizada por tema, **sem remover nenhum requisito**,
> e resolve os pontos que a versão 1.0 deixava como "será definido posteriormente"
> — principalmente hospedagem, TURN e a camada WebRTC. Nada do conteúdo original
> foi descartado; apenas reagrupado e, onde havia lacuna, decidido.

---

## 0. O que mudou da v1.0 para a v1.1 (decisões novas desta sessão)

A SPEC 1.0 do autor already decide praticamente toda a arquitetura funcional e de
segurança. As lacunas que restavam eram técnicas/operacionais. Ficaram assim:

| Lacuna na v1.0 | Decisão tomada |
|---|---|
| Hospedagem Node.js (Hostinger premium não suporta) | Frontend Next.js na **Vercel**; signaling server Node+WebSocket na **Railway** (ou Fly.io como equivalente); domínio permanece na Hostinger, apontado via DNS para os dois serviços (ex.: `app.dominio.com` → Vercel, `ws.dominio.com` → Railway). Sem VPS, sem custo de hospedagem nova. |
| TURN (item 16) | Provedor de TURN **gerenciado com free tier** (Metered.ca ou Cloudflare Calls TURN), credenciais temporárias via API. Sem coturn auto-hospedado na V1. |
| Camada WebRTC (item 80) | **APIs nativas do navegador** (`RTCPeerConnection`/`RTCDataChannel`) com wrapper próprio no pacote `transfer-engine`, em vez de biblioteca de abstração (simple-peer/PeerJS) — necessário para controle fino de backpressure, múltiplos arquivos e retomada (itens 20–26). |
| Ferramenta de monorepo (item 81) | `pnpm workspaces` + `Turborepo` orquestrando `apps/*` e `packages/*`. |
| Bibliotecas específicas (item 80) | Decididas na fase de plano de implementação (writing-plans), não nesta spec. |
| Banco de dados (item 85) | Confirmado: nenhum banco na V1. Escolha de banco adiada para quando a V3 for formalizada. |
| Método de autenticação (item 39) | Adiado para V3, conforme a v1.0 já previa. |

Essas decisões não alteram nenhum requisito funcional ou de segurança da v1.0 —
apenas viabilizam a V1 dentro da hospedagem que o autor já possui.

---

## 1. Visão do produto

O TransferGo será uma plataforma web para transferência remota, segura e
bidirecional de arquivos entre dispositivos pela internet.

O sistema deverá permitir:

- 📱 Celular ⇄ 💻 Computador
- 📱 Celular ⇄ 📱 Celular
- 💻 Computador ⇄ 💻 Computador

A arquitetura não trata especificamente "celular" e "computador". O conceito
técnico é **Peer A ⇄ Peer B** — qualquer dispositivo compatível pode atuar como
remetente ou destinatário.

### Proposta principal

Resolver situações em que usuários hoje dependem de WhatsApp, e-mail,
armazenamento em nuvem, Telegram, cabos ou outros intermediários apenas para
transferir arquivos entre dispositivos.

Experiência desejada: **Selecionar → Conectar → Transferir**, sem armazenamento
permanente dos arquivos nos servidores do TransferGo.

### Princípios obrigatórios

Toda decisão técnica deve considerar:

1. P2P First
2. Security by Design
3. Privacy by Default
4. Zero armazenamento permanente de arquivos no backend
5. Transferência incremental para arquivos grandes
6. Link seguro em vez de código numérico
7. Interface premium e profissional
8. Nenhuma instalação obrigatória na V1
9. Arquitetura Peer A ⇄ Peer B
10. Tecnologias gratuitas/open source quando adequadas
11. TURN somente quando P2P não for possível
12. Arquitetura preparada para evolução comercial

---

## 2. Roadmap oficial

```
V1 — Core Transfer         V2 — Remote Download        V3 — Identity & Trust
─────────────────────      ─────────────────────       ─────────────────────
Web app                    Download remoto por URL      Contas
Sessões/links temporários  Um dispositivo ordena que     Identidade persistente
WebRTC + STUN + TURN       outro baixe de uma URL        Dispositivos autorizados
Bidirecional                                             Contatos confiáveis
Arquivos grandes/chunks                                  Solicitações offline
SHA-256                                                  Notificações
UI/UX premium                                            Normal/Sensível/Confidencial
```

A execução segue **estritamente essa ordem**: V1 até completar todos os
critérios de conclusão (seção 9), depois V2, e só depois de estabilizado, V3.

---

## 3. V1 — Core Transfer

### 3.1 Dispositivos suportados

Android ⇄ Windows, Android ⇄ Android, Windows ⇄ Windows, iPhone ⇄ Windows,
iPhone ⇄ Android, iPhone ⇄ iPhone — desde que navegador e plataforma ofereçam
as APIs necessárias. O suporte real é confirmado por testes (ver seção 8).

### 3.2 Nenhuma instalação obrigatória

O destinatário não precisa instalar software:

```
Recebe link → Abre navegador → TransferGo → Aceita → Transferência
```

Crítico para a demonstração pública.

### 3.3 Sessão de transferência

Usuário cria uma sessão temporária:

```
[ Nova transferência ] → Sessão criada → Link seguro
```

### 3.4 Convite por link (não código numérico)

**Não** usamos códigos de seis dígitos como fluxo principal — pode ser
confundido pelo usuário com 2FA, autenticação bancária, clonagem de WhatsApp
ou phishing.

Formato: `https://dominio/s/<token-seguro>` com botão `[ Copiar link ]`,
compartilhável por qualquer canal (WhatsApp, Telegram, e-mail, SMS etc. —
esses canais transportam só o convite; o arquivo trafega pelo TransferGo).

**QR Code** é complementar, útil quando os dois dispositivos estão fisicamente
próximos. Para transferência remota, o link compartilhável é o fluxo
principal.

### 3.5 Aceitar ou recusar

Abrir o link não inicia a transferência automaticamente. O destinatário vê um
convite explícito com `[ Recusar ]` / `[ Aceitar ]`. (Na V3, o remetente será
identificado nominalmente.)

### 3.6 WebRTC e sinalização

Núcleo de transferência: **WebRTC + RTCDataChannel**, usando **APIs nativas do
navegador** (decisão da seção 0), caminho preferencial P2P direto:

```
Peer A ═══════════════ Peer B   (P2P)
```

**Servidor de sinalização** (Node.js + WebSocket) é responsável apenas por:
criação/entrada de sessão, troca de SDP e ICE candidates, estado da sessão,
expiração, desconexão. **Nunca** recebe os arquivos em si — só os dados
necessários para estabelecer a conexão P2P (sessão, SDP, ICE, status; nunca
foto/vídeo/PDF/documento).

### 3.7 STUN e TURN

STUN para descoberta e tentativa de conexão direta pela internet. **TURN
obrigatório como fallback** desde a versão pública funcional (via provedor
gerenciado com free tier, decisão da seção 0):

```
tenta P2P → funciona → P2P
          → falha    → TURN (relay, nunca armazenamento)
```

O usuário nunca escolhe manualmente o modo — a negociação ICE/WebRTC decide.
Regra arquitetural: **sempre preferir P2P direto; TURN só quando necessário**
(reduz custo, infraestrutura, latência, tráfego do servidor).

### 3.8 Transferência bidirecional

Após conectados, ambos os peers podem enviar arquivos na mesma sessão, sem
precisar criar nova sessão para inverter remetente/destinatário.

### 3.9 Múltiplos arquivos

Seleção de vários arquivos, cada um exibindo nome, tamanho, tipo, estado e
progresso individual.

### 3.10 Arquivos grandes, chunking e backpressure

Nunca carregar o arquivo inteiro na RAM:

```
arquivo → chunk → transmite → grava/processa → próximo chunk
```

Tamanho do chunk determinado por benchmark durante a implementação. A
implementação **deve** controlar a velocidade de envio via `bufferedAmount`
do `RTCDataChannel`, com pausa/retomada conforme limites de memória e
velocidade do receptor — nunca preencher o buffer indefinidamente.

### 3.11 Progresso e estados

UI mostra progresso real (nunca estimativas inventadas): nome do arquivo,
barra, bytes transferidos/total, velocidade, tempo restante.

Estados mínimos (nomenclatura interna em inglês, UI localizada em PT-BR):
`queued`, `preparing`, `connecting`, `sending`, `receiving`, `verifying`,
`completed`, `paused`, `cancelled`, `failed`.

### 3.12 Cancelamento

Ambos os lados podem cancelar; o estado se propaga ao outro peer.

### 3.13 Integridade

Verificação via **SHA-256**: hash calculado na origem e no destino;
"Transferência concluída" e "Integridade verificada" só aparecem quando
`hash A === hash B`.

### 3.14 Retomada de transferência (preparação arquitetural)

O protocolo **não pode ser construído de forma que torne impossível** retomar
depois de queda de conexão (ex.: "5,1 GB recebidos → [ Continuar ]"). Resume
completo pode não estar na V1, mas a arquitetura precisa suportá-lo.

### 3.15 Segurança de transporte

Produção usa **HTTPS, WSS, WebRTC/DTLS** — nunca transporte inseguro.

### 3.16 Tokens

Tokens de sessão: criptograficamente aleatórios, alta entropia,
imprevisíveis, com expiração e escopo limitado. Nunca identificadores
sequenciais.

### 3.17 Rate limiting

Proteção contra abuso em endpoints sensíveis: criação de sessões, tentativa
de entrada, validação de tokens (autenticação/recuperação ficam para V3).

### 3.18 Proteção de caminhos

Dados do remetente jamais controlam arbitrariamente o filesystem do
receptor. Proteção contra `../`, `../../`, path traversal, nomes inválidos,
caminhos absolutos maliciosos.

### 3.19 Arquivos executáveis

TransferGo nunca afirma que um arquivo é seguro. Arquivos potencialmente
executáveis recebem alerta explícito antes de execução pelo usuário.

### 3.20 Privacidade

Nenhum armazenamento permanente de arquivos transferidos. TURN atua só como
relay, nunca como storage. Logs minimizados (ver observabilidade, seção 8.5).

### 3.21 Criptografia no nível da aplicação

Além da proteção de transporte, a arquitetura permite criptografia adicional
do conteúdo (necessária de fato só na V3/Confidencial), usando APIs e
algoritmos consolidados (Web Crypto API / Node Crypto) — nunca criptografia
própria.

---

## 4. V2 — Remote Download (visão, detalhamento no plano da V2)

Um dispositivo ordena que outro faça um download diretamente de uma URL — o
arquivo não passa pelo dispositivo que ordenou:

```
📱 Celular → URL → 💻 Computador → download → 🌐 Origem
```

Progresso remoto acompanhável pelo celular mesmo com o computador executando
o download.

**Segurança obrigatória:** SSRF, localhost/redes privadas, validação de
protocolo, redirects controlados, DNS rebinding quando aplicável, limites de
tamanho e timeout, validação de nome/destino/URL. Nunca `fetch(urlDoUsuario)`
sem controles.

---

## 5. V3 — Identity & Trust (visão, detalhamento no plano da V3)

Introduz identidade persistente: contas (ID, perfil, autenticação — método
final definido tecnicamente na fase de plano da V3), múltiplos dispositivos
autorizados por conta, contatos confiáveis (opt-in após primeira
transferência), identidade/fingerprint criptográfico por dispositivo, alerta
de "novo dispositivo" para contato já conhecido.

**Solicitações offline:** servidor guarda a solicitação (remetente,
destinatário, metadados mínimos, estado), nunca o arquivo — o arquivo
permanece no dispositivo do remetente até ambos os peers estarem online
simultaneamente para o P2P. Aceitar/recusar propaga status ao remetente.

**Notificações:** via recursos Web/PWA compatíveis, respeitando limitações
reais do navegador (uma aba fechada não é um serviço desktop permanente; app
desktop nativo pode ser estudado no futuro).

**Classificação obrigatória de segurança, declarada pelo remetente** (nunca
"detectada" pelo TransferGo, a menos que exista mecanismo real futuro):

| Nível | Comportamento |
|---|---|
| Normal | Confirmação padrão |
| Sensível | Alerta reforçado + confirmação explícita |
| Confidencial | Normal + Sensível + metadados minimizados + chave externa (fora do link, por outro canal) + criptografia adicional vinculada à chave + proteção contra força bruta (atraso progressivo, bloqueio temporário, alerta) + desbloqueio explícito |

Regra de confiança fundamental: contato conhecido aumenta a confiança sobre
**quem** solicitou, nunca sobre **o que** existe dentro do arquivo — mesmo
contato conhecido pode gerar alerta de "transferência inesperada" se não
combinada por outro canal. Regra do dispositivo compartilhado: acesso ao
dispositivo correto não implica pessoa correta — por isso conteúdo
Confidencial exige defesa em profundidade (link + identidade + dispositivo +
autorização + chave independente + criptografia), nunca dependendo só do
link.

---

## 6. UI/UX (aplica-se a V1, evolui em V2/V3)

Qualidade visual **premium obrigatória** — nunca aparência de projeto
acadêmico, dashboard genérico ou template básico. Objetivo: produto comercial
contemporâneo. Linguagem visual deve transmitir segurança, confiança,
tecnologia, simplicidade, velocidade.

Um **design system próprio** cobre tipografia, spacing, radius, elevação,
cores semânticas, ícones, botões, inputs, cards, dialogs, notifications,
progress, badges, estados e componentes de segurança. Hierarquia visual deve
deixar claro: o que está acontecendo, quem está conectado, qual arquivo, qual
nível de segurança, qual progresso, qual ação é necessária.

Microinterações discretas (conexão, upload, progresso, sucesso, erro,
mudança de estado, dialogs, notificações) — sem excesso decorativo;
glassmorphism/gradiente/blur/animação só quando melhoram a experiência real.

**Responsividade** com qualidade equivalente em desktop/tablet/mobile — nunca
UI desktop "espremida". **Acessibilidade**: contraste, navegação por teclado,
foco, labels, leitores de tela, estados não dependentes só de cor, alvo touch
adequado, mensagens compreensíveis.

Estados de interface obrigatórios (todos com tela dedicada, nunca
improvisada): `loading, empty, connecting, connected, offline, waiting,
sending, receiving, verifying, success, warning, error, cancelled, rejected,
expired, sensitive, confidential`. Normal/Sensível/Confidencial devem ser
visualmente diferenciáveis por ícone + texto + título + descrição + ação —
nunca só por cor.

Tela confidencial deve comunicar risco e ação necessária sem provocar pânico
— sóbria, clara, sem alertas assustadores desnecessários.

---

## 7. Stack técnica e estrutura de repositório

### 7.1 Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js + TypeScript |
| Backend (signaling) | Node.js + WebSocket |
| Transferência | WebRTC + RTCDataChannel (APIs nativas) |
| Rede | ICE, STUN, TURN (gerenciado, free tier) |
| Arquivos | Streams / Chunks |
| Segurança | Web Crypto API, Node Crypto, SHA-256 |
| UI | Design System próprio |
| Monorepo | pnpm workspaces + Turborepo |

Bibliotecas específicas (ex.: framework de UI/estilo, testes) são decididas
na fase de plano de implementação, não nesta spec.

### 7.2 Estrutura do repositório

```
transfergo/
│
├── apps/
│   ├── web/                    # Next.js
│   └── signaling-server/       # Node.js + WebSocket
│
├── packages/
│   ├── transfer-engine/        # WebRTC, chunking, backpressure, resume
│   ├── security/                # tokens, hashing, path-safety, crypto helpers
│   ├── shared/                  # tipos e utilidades compartilhadas
│   └── ui/                      # design system
│
├── docs/
│   ├── architecture.md
│   ├── security.md
│   ├── protocol.md
│   └── screenshots/
│
├── tests/
│
├── .github/
│   └── workflows/
│
├── README.md
├── LICENSE
└── package.json
```

Estrutura pode ser ajustada durante a implementação, se justificado.

### 7.3 Infraestrutura e deploy

```
Domínio (Hostinger, já existente)
        │
        ├── DNS: app.dominio.com  ──────► Vercel (Next.js, HTTPS automático)
        │
        └── DNS: ws.dominio.com   ──────► Railway (Node.js signaling + WebSocket, WSS)

TURN: provedor gerenciado com free tier (Metered.ca / Cloudflare Calls TURN),
      credenciais temporárias via API — sem servidor próprio.
```

Antes do deploy final, confirmar na prática que a plataforma escolhida para o
signaling server suporta processo Node persistente, WebSocket, HTTPS/WSS —
conforme já exigido no item original sobre infraestrutura.

### 7.4 Banco de dados

V1 **não usa banco** (sessões efêmeras em memória/estrutura leve no
signaling server). Banco entra só na V3, quando os requisitos de contas,
dispositivos, contatos e solicitações estiverem formalizados no plano
daquela versão.

---

## 8. Qualidade, testes e observabilidade

### 8.1 Testes funcionais (dispositivos)

Android→Windows, Windows→Android, Android→Android, Windows→Windows e,
quando disponível, todos os pares envolvendo iPhone.

### 8.2 Testes de rede

Wi-Fi⇄Wi-Fi, Wi-Fi⇄4G/5G, 4G/5G⇄Wi-Fi, 4G/5G⇄4G/5G — verificando P2P, TURN,
estabilidade e problemas de NAT.

### 8.3 Testes de arquivos

Pequenos, múltiplos, médios, grandes, nomes Unicode/longos, tipos variados,
cancelamento, falha de rede, reconexão, integridade.

### 8.4 Testes de segurança (antes de publicar)

Sessão expirada, token inválido/reutilizado, força bruta, path traversal,
nomes maliciosos, arquivos executáveis, acesso não autorizado, rate
limiting (URLs maliciosas/SSRF ficam para o plano da V2; proteção
Confidencial fica para o plano da V3).

### 8.5 Testes de UI e observabilidade

Desktop/tablet/celular, touch, teclado, responsividade, acessibilidade,
mensagens, estados, progresso, erros, diferentes tamanhos de tela.

Observabilidade sem comprometer privacidade: falha de signaling, falha ICE,
P2P vs TURN, desconexões, erros de transferência, tempo de sessão — **nunca**
registrar conteúdo dos arquivos.

---

## 9. Critérios de conclusão

### V1
✓ sessão por link · ✓ dois dispositivos conectam · ✓ P2P funciona · ✓ TURN
fallback validado · ✓ transferência bidirecional · ✓ múltiplos arquivos ·
✓ chunks · ✓ arquivos grandes testados · ✓ progresso real · ✓ cancelamento ·
✓ SHA-256 valida integridade · ✓ segurança básica validada · ✓ UI premium
concluída · ✓ mobile validado · ✓ desktop validado · ✓ demo pública funciona
· ✓ documentação concluída

### V2
✓ URL enviada remotamente · ✓ dispositivo remoto recebe comando · ✓ download
acontece no destino · ✓ progresso remoto · ✓ cancelamento · ✓ validação de
URL · ✓ SSRF mitigado · ✓ redirects controlados · ✓ limites implementados ·
✓ erros tratados

### V3
✓ contas · ✓ autenticação · ✓ dispositivos autorizados · ✓ contatos
confiáveis · ✓ identidade/fingerprint · ✓ solicitações offline · ✓
aceitar/recusar · ✓ status para remetente · ✓ notificações · ✓ novo
dispositivo · ✓ transferência inesperada · ✓ Normal/Sensível/Confidencial ·
✓ chave externa · ✓ criptografia vinculada à chave · ✓ proteção contra
brute force · ✓ metadados minimizados

---

## 10. Fora do escopo inicial

Não são prioridade (não significa que nunca existirão — apenas não devem
atrasar o núcleo): armazenamento em nuvem de arquivos, apps nativos
Android/iOS, pagamentos/assinatura, painel comercial, Kubernetes,
microserviços desnecessários, IA classificando arquivos, antivírus próprio.

---

## 11. Arquitetura consolidada

```
                         TRANSFERGO
                              │
                    ┌─────────▼─────────┐
                    │    Web App        │
                    │ Next.js/TypeScript│  ← Vercel
                    └─────────┬─────────┘
                              │
                        HTTPS / WSS
                              │
                    ┌─────────▼─────────┐
                    │    Signaling      │
                    │ Node + WebSocket  │  ← Railway
                    └─────────┬─────────┘
                              │
                         SDP / ICE
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
           PEER A                           PEER B
        📱 ou 💻                         📱 ou 💻
              │                               │
              └════════ WebRTC P2P ══════════┘
                              │
                        se P2P falhar
                              │
                              ▼
                        ┌──────────┐
                        │   TURN   │  ← provedor gerenciado
                        └──────────┘
```

Arquitetura futura de identidade (V3) e níveis de proteção
(Normal/Sensível/Confidencial) seguem exatamente como descrito na SPEC 1.0
original, seção 5 deste documento.

---

## 12. Ordem de implementação (V1)

```
01 Fundação → 02 Design System → 03 UI básica → 04 Sessões →
05 Signaling/WebSocket → 06 WebRTC → 07 P2P → 08 Transfer engine →
09 Chunks/backpressure → 10 Progresso → 11 Múltiplos arquivos →
12 Bidirecional → 13 Links seguros → 14 STUN → 15 TURN → 16 SHA-256 →
17 Segurança → 18 Erros/reconexão → 19 Mobile/cross-browser → 20 Testes →
21 Deploy → 22 Hardening → 23 Documentação → 24 GitHub → 25 Demo pública
```

Depois: V2 — Remote Download. Só após estabilização: V3 — Identity & Trust.

---

## 13. Definição final do produto

TransferGo é uma plataforma web de transferência remota, bidirecional e
segura de arquivos entre dispositivos, baseada prioritariamente em
comunicação WebRTC peer-to-peer, com fallback TURN, transferência
incremental de arquivos grandes, verificação de integridade, sessões
temporárias por links seguros e arquitetura orientada à privacidade.

Sua evolução permitirá downloads remotos, identidades persistentes,
dispositivos e contatos confiáveis, solicitações offline e um sistema de
proteção progressiva Normal / Sensível / Confidencial, incluindo
criptografia adicional e chave independente para conteúdos confidenciais.

**Resultado esperado:** o produto final não deve transmitir a impressão de
"fiz um projeto com Next.js e WebRTC", e sim "projetei e implementei um
sistema real de transferência de arquivos, considerando redes, P2P, NAT
traversal, fallback, streaming, integridade, criptografia, identidade,
segurança, privacidade, UX, acessibilidade e evolução de infraestrutura."
