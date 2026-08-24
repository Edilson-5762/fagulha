# TransferGo — Plano 2/9: Design System & UI Base — Spec de Design

- **Status:** Aprovada para planejamento de implementação
- **Data:** 2026-08-24
- **Escopo:** Passos "02 Design System" + "03 UI básica" da ordem de implementação da spec do produto (`docs/superpowers/specs/2026-08-24-transfergo-design.md`, §12)
- **Depende de:** Plano 1/9 — Fundação & Monorepo (concluído e mesclado em `main`, commit `14d002e`)
- **Não inclui:** sessões, signaling/WebSocket, WebRTC ou qualquer transferência real de arquivos — isso começa no Plano 4/9 ("Sessões") em diante

## 1. Objetivo

Construir o design system próprio do TransferGo (`@transfergo/ui`) e substituir a
página placeholder de `apps/web` por uma home page premium real, cumprindo os
requisitos obrigatórios de UI/UX da spec do produto (§6): tipografia, spacing,
radius, elevação, cores semânticas, ícones, botões, inputs, cards, dialogs,
notifications, progress, badges, os 17 estados de interface obrigatórios e os
componentes de segurança (Normal/Sensível/Confidencial).

Nenhum componente é conectado a dados reais nesta etapa — todos recebem props e
são demonstrados isoladamente no Storybook. A home page usa dados estáticos.

## 2. Direção visual (decidida via companheiro visual)

- **Estilo:** "Dark Tech / Neo-Security" — fundo quase-preto, vidro fosco
  discreto, acentos elétricos. Referências: Linear, Vercel, Stripe (modo
  escuro).
- **Tipografia:** Inter, self-hosted via `next/font` (carregada por `apps/web`;
  `@transfergo/ui` não força carregamento de fonte). Dados técnicos (velocidade,
  hash, bytes) usam fonte monoespaçada do sistema (`ui-monospace`/Consolas) —
  sem segunda fonte customizada.
- **Cor de destaque (accent):** azul elétrico `#4F8CFF` (botões primários,
  links, foco, barras de progresso).
- **Escada de segurança** (spec §6 — precisa ser diferenciável sem depender só
  de cor; sempre acompanhada de ícone + texto + título + descrição + ação):
  - Normal → verde `#5FD68A`
  - Sensível → âmbar `#F5A623`
  - Confidencial → violeta `#A78BFA`
- **Semânticas de estado de transferência:** sucesso = verde, aviso = âmbar
  (reaproveita o tom de Sensível), erro = vermelho `#E85A5A` (reservado — não
  usado na escada de segurança, para não colidir visualmente com Confidencial).
- **Spacing/radius/elevação:** escala de espaçamento em múltiplos de 4px;
  radius em 3 tamanhos (sm/md/lg, cantos generosos); elevação via
  blur + borda translúcida (glass discreto), não uma escala pesada de
  `box-shadow`.
- Contraste e estados de foco seguem WCAG AA (spec §6 — acessibilidade).

## 3. Stack e arquitetura

`packages/ui` deixa de ser o stub do Plano 1 (`PACKAGE_NAME` apenas) e passa a
conter:

```
packages/ui/
├── src/
│   ├── tokens/          # cores, tipografia, spacing, radius, elevação (Tailwind @theme)
│   ├── components/      # Button, Input, Card, Badge, ProgressBar, Dialog, Toast, StateScreen, ...
│   ├── icons/            # re-export curado do lucide-react (só os ícones usados)
│   └── index.ts
├── .storybook/
└── package.json
```

Decisões de tooling (spec §7.1 delega bibliotecas específicas para esta fase):

| Camada | Escolha | Motivo |
| --- | --- | --- |
| Estilo | Tailwind CSS v4 (`@theme`) | Tokens como CSS nativo, produtividade alta, integra bem com Next.js/React 19 |
| Comportamento acessível (Dialog/Toast/Dropdown/Tooltip) | Radix UI Primitives | Foco/teclado/ARIA prontos e testados — evita reimplementar a11y do zero, exigida pela spec §6 |
| Variantes tipadas (size/variant/state) | class-variance-authority (CVA) | Padrão atual de mercado para variantes de componente, tipagem forte |
| Ícones | lucide-react | Padrão de mercado em produtos SaaS modernos, tree-shakeable, combina com a estética escolhida |
| Fonte | Inter via `next/font` | Self-hosted (Privacy by Default — sem chamada a serviço externo de fontes) |
| Showcase de componentes | Storybook | Padrão de mercado para design systems; entra como task própria no `turbo.json` |

`apps/web` consome `@transfergo/ui` da mesma forma que já consome
`@transfergo/shared` (workspace, sem build step, via `transpilePackages`).

Usar Radix como base não contradiz "design system próprio" (spec §6/item 69):
Radix fornece apenas comportamento de baixo nível sem estilo; a aparência, a
API dos componentes e o que é exportado de `@transfergo/ui` são inteiramente
definidos por este projeto.

## 4. Biblioteca de componentes

Cobertura completa exigida pela spec §6, cada um com story no Storybook
mostrando todas as variantes/estados:

| Categoria | Componentes |
| --- | --- |
| Ações | `Button` (variants: primary/secondary/ghost/danger; sizes sm/md/lg; loading state) |
| Entrada | `Input`, `Textarea` (estados: default/focus/error/disabled) |
| Conteúdo | `Card`, `Badge` (inclui as 3 variantes de segurança) |
| Progresso | `ProgressBar` (determinado, com % e velocidade), `Spinner` |
| Overlays | `Dialog` (Radix), `Toast`/`Notification` (Radix), `Tooltip` (Radix) |
| Feedback de estado | `StateScreen` — componente genérico parametrizável (ícone + título + descrição + ação) para os 17 estados obrigatórios |
| Segurança | `SecurityLevelCard` (Normal/Sensível/Confidencial) — usa `StateScreen` internamente com a escada de cor da seção 2 |

### 4.1 Estados de interface cobertos pelo `StateScreen`

Os 17 estados obrigatórios da spec §6 (`loading, empty, connecting, connected,
offline, waiting, sending, receiving, verifying, success, warning, error,
cancelled, rejected, expired, sensitive, confidential`) são todos a mesma
estrutura visual (ícone + título + descrição + ação), então usam um único
componente parametrizável em vez de 17 componentes distintos — evita
duplicação e mantém consistência visual obrigatória entre eles.

## 5. Home page (`apps/web`)

Substitui `apps/web/src/app/page.tsx` (hoje só lista `TRANSFER_STATES`) por uma
landing premium, montada exclusivamente com componentes de `@transfergo/ui`:

- **Hero** — logo/wordmark, headline ("Transfira arquivos com segurança entre
  seus dispositivos"), subtexto, CTA primário `[ Nova transferência ]` (spec
  item 77).
- **Como funciona** — 3 passos: Selecionar → Conectar → Transferir (spec §1),
  com ícones lucide.
- **Confiança/segurança** — seção curta reforçando P2P, zero armazenamento
  permanente, criptografia — sem métricas ou depoimentos inventados.
- **Footer** — link para o GitHub do projeto; nada além disso na V1.

O CTA `[ Nova transferência ]` fica visualmente pronto mas **sem
funcionalidade real** nesta etapa (não há sessão/backend ainda — isso é o
Plano 4/9). Navega para uma rota placeholder (`/transferir`) que mostra um
`StateScreen` de "em construção", em vez de ficar sem `href` — dá um alvo real
para o próximo plano conectar.

## 6. Testes

Mesmo padrão do Plano 1 (Vitest + Testing Library, `pnpm --filter <pkg> run
test`, agregado via `turbo run test`):

- **`packages/ui`** — teste de render + variantes para os componentes simples
  (`Button`, `Badge`, `Input`, `ProgressBar`); componentes Radix (`Dialog`,
  `Toast`) ganham teste de comportamento básico (abre, fecha, foco, Esc) via
  Testing Library — não reimplementação de a11y.
- **`apps/web`** — teste da home page renderizando as seções principais e
  confirmando que o CTA aponta para a rota placeholder.
- **Storybook** — não entra em CI como teste automatizado nesta etapa (visual
  regression tipo Chromatic fica fora de escopo); serve para revisão visual
  manual.
- Lint/typecheck seguem via `eslint.config.js`/`tsconfig.base.json` já
  existentes na raiz, sem mudança de regra.

## 7. Fora de escopo deste plano

- Qualquer lógica de sessão, signaling, WebSocket ou WebRTC (Planos 4+).
- Conectar os componentes de segurança a uma transferência real.
- Testes de regressão visual automatizados (Chromatic ou equivalente).
- Internacionalização além do português (a spec já define PT-BR como único
  idioma de UI na V1 — nomenclatura interna de estados em inglês).

## 8. Critérios de conclusão

- `pnpm turbo run lint typecheck test build` passa com zero erros incluindo
  `packages/ui`.
- Storybook builda sem erros e mostra todos os componentes da seção 4 com
  suas variantes.
- Home page de `apps/web` usa exclusivamente componentes de `@transfergo/ui`,
  passa nos testes e no build de produção do Next.js.
- Contraste de cor e navegação por teclado verificados manualmente nos
  componentes interativos (Button, Input, Dialog, Toast).
