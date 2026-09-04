# TransferGo — Plano 7/9: Progresso real e Cancelamento — Spec de Design

- **Status:** Em revisão pelo autor do produto
- **Data:** 2026-09-03
- **Escopo:** Passos "10 Progresso" + "12 Cancelamento" da ordem de implementação
  da spec do produto (`docs/superpowers/specs/2026-08-24-transfergo-design.md`,
  §12), combinados num único plano — mesma cadência de ~2 passos por plano usada
  nos Planos 4/9, 5/9 e 6/9.
- **Depende de:** Plano 6/9 — Motor de Transferência (concluído e mesclado em
  `main`, merge `a57843b`). O `packages/transfer-engine` já move um lote de
  arquivos host → guest pelo `RTCDataChannel`, emite `onProgress` (throttle
  ~250 ms) e `onCancelled`, e os painéis `SendPanel`/`ReceivePanel` já existem
  com uma barra grosseira baseada em contagem de arquivos.
- **Não inclui:**
  - Verificação de integridade SHA-256 e o estado `verifying` (§3.13 — plano
    dedicado).
  - Retomada real após queda de conexão e o estado `paused` (§3.14 — plano
    dedicado; o Plano 6 já plantou os marcadores `TODO(resume:)`).
  - Transferência bidirecional — os dois peers enviando na mesma sessão
    (§3.8 — plano dedicado).
  - TURN / relay (§3.7 — plano dedicado).
  - Quadro de retorno de progresso do receptor para o emissor. O progresso
    exibido no lado de quem envia é **otimista**: bytes já entregues ao
    `RTCDataChannel`. Nenhuma mudança no protocolo de fio do Plano 6.
  - Botão de pausar/continuar iniciado pelo usuário (não há `paused` de UI).

---

## 1. Objetivo

Trocar a barra de progresso grosseira do Plano 6 (fração de arquivos concluídos)
por **progresso real por bytes**, com velocidade e tempo restante honestos, e
tornar o **cancelamento** um fluxo completo dos dois lados — o estado propaga, o
arquivo em trânsito é descartado sem deixar pedaço no disco, e a tela final diz
quantos arquivos de fato pousaram.

Nada de número inventado (§3.11): velocidade é média medida numa janela curta;
tempo restante só aparece quando a medição estabiliza; quando o canal trava, os
números caem para "calculando…" em vez de congelar.

**Prova de conclusão:** testes automatizados com timers falsos no hook
`useFileTransfer` mostram (a) velocidade `null` até haver 1 s de amostras,
depois um valor estável, depois decaimento a ~0 quando os eventos param;
(b) ETA `null` até 3 s de transferência, depois um valor plausível, depois volta
a `null` numa travada; (c) `overall.bytesDone` = soma dos arquivos concluídos +
bytes do arquivo atual; (d) cancelar no meio do 2º de 3 arquivos leva a
`phase === "cancelled"` com `filesSaved === 1`. Verificação manual complementar:
dois navegadores reais transferem um lote grande — a barra anda por bytes, a
velocidade e o ETA são plausíveis e estáveis, e cancelar de qualquer lado
encerra os dois com a contagem parcial correta.

---

## 2. Divisão em unidades

| Unidade                   | Onde                                               | Responsabilidade                                                                                                                                                                                                                                                          | Muda quanto          |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Motor — receptor**      | `packages/transfer-engine/src/receiver.ts`         | Passar `filesDone` no callback de cancelamento.                                                                                                                                                                                                                           | 1 linha + assinatura |
| **Motor — emissor**       | `packages/transfer-engine/src/sender.ts`           | Idem: passar quantos arquivos completaram ao cancelar.                                                                                                                                                                                                                    | 1 linha + assinatura |
| **Contratos**             | `packages/transfer-engine/src/types.ts`            | `onCancelled?: (filesDone: number) => void` em `ReceiverCallbacks` e `SenderCallbacks`.                                                                                                                                                                                   | assinatura           |
| **Formatação**            | `apps/web/src/lib/transfer-format.ts`              | `formatSpeed(bytesPerSec): string` e `formatDuration(seconds): string`, ambas puras, em pt-BR.                                                                                                                                                                            | +2 funções           |
| **Hook de transferência** | `apps/web/src/lib/use-file-transfer.ts`            | **Coração do plano.** Amostragem com timestamp, janela deslizante de 5 s, velocidade, ETA com portão de estabilização, ticker de decaimento, bytes acumulados do lote, `%` geral, `perFile` enriquecido com `pct`/estado, `filesSaved`. API do resultado cresce (ver §5). | grande               |
| **UI do emissor**         | `apps/web/src/components/transferir/SendPanel.tsx` | Barra geral por bytes com %/bytes/velocidade/ETA; barrinha só no arquivo ativo; telas finais com parcial.                                                                                                                                                                 | médio                |
| **UI do receptor**        | `apps/web/src/components/s/ReceivePanel.tsx`       | Espelho do `SendPanel`, lado "Recebendo".                                                                                                                                                                                                                                 | médio                |

Sem arquivos novos. `packages/transfer-engine` é quase intocado; o grosso do
trabalho é hook + formatação + os dois painéis.

---

## 3. Progresso por bytes

### 3.1 Bytes acumulados do lote

O motor emite `TransferProgress { batchId, fileId, fileBytes, fileSize,
filesDone, filesTotal }` a cada ~250 ms e um evento forçado quando um arquivo
fecha (`fileBytes === fileSize`, `filesDone` incrementado).

O hook conhece todos os tamanhos e a ordem dos arquivos (de `selectedFiles` no
emissor, de `incomingBatch.files` no receptor). A cada evento calcula:

```
files = ordem do lote
bytesEmConcluidos = Σ(size de files[0 .. filesDone-1])
bytesDoAtual = (fileId === files[filesDone]?.id) ? fileBytes : 0
bytesDone = bytesEmConcluidos + bytesDoAtual
bytesTotal = Σ(size de todos os arquivos do lote)
```

O guard `fileId === files[filesDone]?.id` evita dupla contagem na borda de
conclusão: tanto o motor-emissor quanto o motor-receptor emitem, ao fechar um
arquivo, um evento forçado com `filesDone` **já incrementado** mas `fileId`/
`fileBytes` ainda apontando para o arquivo recém-concluído. Nesse evento
`files[filesDone]` já é o **próximo** arquivo, então `bytesDoAtual = 0` e
`bytesDone` fica igual a `bytesEmConcluidos` (correto). Durante o envio de um
arquivo, `fileId === files[filesDone].id`, então `fileBytes` entra normalmente.

### 3.2 Barra geral

`overall.bytesDone / overall.bytesTotal` → porcentagem. É isso que a barra do
topo mostra, substituindo a fração `filesDone/filesTotal` do Plano 6. O texto
"arquivo N de M" continua vindo de `filesDone`/`filesTotal`.

### 3.3 Progresso por arquivo

`perFile[id].pct = size === 0 ? 100 : min(100, round(bytes / size * 100))`.

A barrinha individual aparece **só no arquivo cujo estado é `sending`/`receiving`**
e **só quando `filesTotal > 1`**. Arquivos `queued`/`completed`/`failed` mostram
apenas o rótulo de estado.

---

## 4. Velocidade e tempo restante

### 4.1 Constantes (um só lugar, no topo de `use-file-transfer.ts`)

```
SPEED_WINDOW_MS   = 5000   // janela deslizante da média de velocidade
SPEED_MIN_SPAN_MS = 1000   // abaixo disso, velocidade = null ("calculando…")
ETA_MIN_ELAPSED_MS = 3000  // ETA só depois deste tempo de transferência
STATS_TICK_MS     = 1000   // recálculo periódico enquanto sending/receiving
```

### 4.2 Amostragem

Buffer circular de `{ t: number; bytes: number }`, `t = performance.now()`.
A cada `onProgress` empurra `{ t: agora, bytes: bytesDone }`. Depois de inserir,
descarta do início toda amostra com `agora - t > SPEED_WINDOW_MS`, **mantendo
sempre pelo menos 2 amostras** (para haver um par mesmo com eventos esparsos).

O buffer, o marco `transferStartedAt` e o último valor calculado ficam em `ref`s
(não em `state`) — não precisam causar render por si; quem dispara render é o
`state` de `stats` atualizado pelo fluxo de eventos e pelo ticker.

### 4.3 Velocidade

```
oldest = buffer[0]; newest = buffer[buffer.length - 1]
span = newest.t - oldest.t
if (span < SPEED_MIN_SPAN_MS) speed = null
else speed = max(0, (newest.bytes - oldest.bytes)) / span * 1000   // bytes/s
```

`speed === 0` (janela cheia, zero bytes no período) é um valor legítimo →
UI mostra "parado". `speed === null` → "calculando…".

### 4.4 Tempo restante (ETA)

```
elapsed = performance.now() - transferStartedAt
remaining = overall.bytesTotal - overall.bytesDone
if (speed == null || speed <= 0) eta = null
else if (elapsed < ETA_MIN_ELAPSED_MS || buffer.length < 3) eta = null
else eta = remaining / speed   // segundos
```

### 4.5 Ticker de decaimento

Enquanto `phase` for `sending` ou `receiving`, um `setInterval(STATS_TICK_MS)`
recalcula §4.3–§4.4 usando `performance.now()` atual **sem inserir amostra
nova**. Efeito: numa travada de canal, `oldest` permanece, o tempo avança, a
velocidade cai para ~0 e o ETA volta a `null`. O intervalo é limpo ao sair de
`sending`/`receiving` (efeito com cleanup).

### 4.6 Formatação (pt-BR, em `transfer-format.ts`)

- `formatSpeed(bps)`: reaproveita a escala de `formatBytes` + "/s" — `"0 B/s"`,
  `"820 KB/s"`, `"12,3 MB/s"`. `null` não chega aqui (a UI decide antes).
- `formatDuration(seconds)` em faixas, para não tremer:
  - `< 10` → "menos de 10 s"
  - `< 60` → "cerca de " + (arredonda para 10 s) + " s" (ex.: "cerca de 40 s")
  - `< 3600` → "cerca de " + (arredonda para 1 min, mínimo 1) + " min"
  - `>= 3600` → "mais de 1 h"

### 4.7 Reset

`startSend` (emissor) e `acceptBatch` (receptor), e o `rearm()` do receptor
(segundo lote na mesma sessão, do Plano 6): zeram o buffer, `transferStartedAt`
e `stats` (`{ speedBytesPerSec: null, etaSeconds: null }`).

---

## 5. Modelo de estado do hook

### 5.1 `phase`

Vocabulário do §3.11, com `sending`/`receiving` resolvidos por `role`:

```
idle → offering → preparing → (sending | receiving) → completed | cancelled | failed
```

| Valor       | Quando                                                                                                                          | Lado        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `idle`      | sem lote em andamento                                                                                                           | ambos       |
| `offering`  | `startSend` disparado, aguardando `batch-accept`                                                                                | só emissor  |
| `preparing` | aceito; montando (receptor: `pickSaveTarget` resolveu e abrindo o 1º sink; emissor: abrindo o 1º `ChunkSource`) — até o 1º byte | ambos       |
| `sending`   | bytes saindo                                                                                                                    | só emissor  |
| `receiving` | bytes entrando                                                                                                                  | só receptor |
| `completed` | `batch-complete`                                                                                                                | ambos       |
| `cancelled` | `cancel` local ou remoto                                                                                                        | ambos       |
| `failed`    | `TransferError`                                                                                                                 | ambos       |

Internamente o hook continua com uma transição única "está transferindo"; expõe
`"sending"` se `role === "host"`, `"receiving"` se `role === "guest"`.

Observação sobre `preparing` no receptor: enquanto o seletor nativo de pasta
está aberto (`acceptBatch` parado em `pickSaveTarget()`), o `phase` permanece
`idle` com `incomingBatch` presente (tela de convite), exatamente como no
Plano 6. `preparing` começa **depois** que o alvo é escolhido e vai até o
primeiro `onProgress`.

### 5.2 `UseFileTransferResult` — diferença em relação ao Plano 6

| Campo         | Plano 6                                                             | Plano 7                                                                                                     |
| ------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `phase`       | `idle\|offering\|transferring\|completed\|cancelled\|failed`        | `idle\|offering\|preparing\|sending\|receiving\|completed\|cancelled\|failed`                               |
| `overall`     | `{ done: number; total: number }` (contagem)                        | `{ bytesDone: number; bytesTotal: number; filesDone: number; filesTotal: number }`                          |
| `perFile[id]` | `{ bytes; size; state: "queued"\|"active"\|"completed"\|"failed" }` | `{ bytes; size; pct: number; state: "queued"\|"preparing"\|"sending"\|"receiving"\|"completed"\|"failed" }` |
| `stats`       | —                                                                   | `{ speedBytesPerSec: number \| null; etaSeconds: number \| null }`                                          |
| `filesSaved`  | —                                                                   | `number`                                                                                                    |

Demais campos inalterados: `ready`, `selectedFiles`, `totalBytes`, `limitError`,
`addFiles`, `removeFile`, `clearSelection`, `startSend`, `incomingBatch`,
`acceptBatch`, `rejectBatch`, `errorMessage`, `cancel`.

- `perFile[id].state`: o hook grava `"sending"` ou `"receiving"` (conforme
  `role`) no arquivo ativo; os demais ficam `"queued"` até virarem `"completed"`.
  `"preparing"` é usado só se algum dia um sink demorar a abrir no meio do lote;
  na prática o arquivo ativo alterna `queued → sending/receiving → completed`.
- `filesSaved`: em `completed` vale `filesTotal`. Em `cancelled` vale o número
  vindo de `onCancelled(filesDone)` do motor (arquivos com `file-end`/`close()`
  concluídos antes do corte; o arquivo em trânsito **não** conta — seu sink é
  abortado). Em `failed` idem (parcial).

### 5.3 Mudança de forma que quebra o Plano 6

Componentes e testes do Plano 6 leem `overall.done`/`overall.total` como
contagem de arquivos. Serão atualizados para `overall.filesDone`/`filesTotal`
(contagem) e `overall.bytesDone`/`bytesTotal` (barra). Mesma linhagem de plano;
a atualização entra nas tarefas do Plano 7.

---

## 6. Mudanças no motor

`packages/transfer-engine` **não ganha lógica de progresso nova**. O
`TransferProgress` fica byte a byte como está. Única mudança:

- `ReceiverCallbacks.onCancelled` e `SenderCallbacks.onCancelled`:
  `() => void` → `(filesDone: number) => void`.
- `receiver.ts`: nas duas chamadas de `this.cb.onCancelled?.()` (cancel local em
  `cancel()`, cancel remoto no `case "cancel"`), passar `this.filesDone`.
- `sender.ts`: em `cancel()` e no `case cancel` de `handleControl`, passar o
  índice de arquivos já finalizados (contador de `file-end` emitidos).
- Callers que ignoram o argumento continuam type-safe (parâmetro a mais num
  callback é compatível).

O `fail()` do receptor (rota de `size-mismatch`/`bad-frame`/`channel-error`)
chama `onError`, não `onCancelled` — a contagem parcial em `failed` vem de o
hook ter observado os `onFileComplete` até ali, então **o hook** mantém seu
próprio contador `filesCompleted` incrementado em `onFileComplete`, e usa esse
para `filesSaved` tanto em `failed` quanto como conferência em `cancelled`.
(Se `onCancelled(n)` e o contador do hook divergirem, vence o `min` dos dois —
nunca reportar mais arquivos salvos do que realmente fecharam.)

---

## 7. UI

### 7.1 Fase ativa (`sending` / `receiving`) — os dois painéis, espelhados

```
Enviando arquivo 2 de 5                        (1 arquivo: "Enviando video.mp4")
████████████░░░░░░░░░░░░  47%                  ← barra geral por BYTES
1,4 GB de 3,0 GB · 12,3 MB/s · ~cerca de 3 min ← linha de status

✓ contrato.pdf                    Concluído
▸ video.mp4   ███████░░░  68%                  ← barrinha só no arquivo ativo
  ferias.zip                      Na fila
  ...
[ Cancelar ]
```

Linha de status, montada por partes separadas por " · ":
`formatBytes(bytesDone) + " de " + formatBytes(bytesTotal)`;
se `stats.speedBytesPerSec != null` → `formatSpeed(...)`;
se `stats.etaSeconds != null` → `formatDuration(stats.etaSeconds)`.
Se ambos `null` → uma única palavra "calculando…" no lugar dos dois trechos.
Se `speed === 0` → "parado" no lugar da velocidade, sem ETA.

### 7.2 `preparing`

"Preparando a transferência…" centralizado, sem barra. (Reaproveita o padrão de
texto simples que os painéis já usam para `offering`.)

### 7.3 Telas finais

- `completed` — inalterado do Plano 6: `n === 1 ? "Arquivo … com sucesso" :
"${n} arquivos … com sucesso"` (n = `overall.filesTotal`), "Enviar mais
  arquivos" no emissor.
- `cancelled` — usa `filesSaved` e `overall.filesTotal`:
  - `filesSaved === 0` → título "Transferência cancelada", descrição
    "Nenhum arquivo foi salvo." (receptor) / "Nenhum arquivo chegou." (emissor).
  - `filesSaved >= 1` → descrição
    "`${filesSaved}` de `${filesTotal}` arquivos foram salvos neste
    dispositivo." (receptor) / "`${filesSaved}` de `${filesTotal}` arquivos
    chegaram." (emissor).
  - Ação: "Nova transferência" (emissor, → `clearSelection`); receptor sem ação
    (como no Plano 6).
- `failed` — inalterado: `errorMessage ?? "Algo deu errado durante a
transferência."`.

---

## 8. Casos de borda

| Situação                                     | Tratamento                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Lote de 1 arquivo                            | Sem barrinha individual; texto "Enviando `<nome>`".                                                      |
| Arquivo de 0 byte                            | `pct = 100` assim que `file-end` chega; não gera amostra de velocidade útil (delta 0), o que é ok.       |
| `bytes > size` na exibição                   | UI trava em `size`/`bytesTotal` (o motor já barra overrun no Plano 6; a UI não confia).                  |
| ETA gigante (velocidade minúscula)           | `formatDuration` tem teto "mais de 1 h".                                                                 |
| Canal trava sem erro                         | Ticker (§4.5) derruba velocidade → 0 e ETA → `null`; barra congela na posição.                           |
| Canal falha com `channel-error`              | `phase = failed`, `filesSaved` = contador do hook.                                                       |
| Cancelar em `preparing`                      | `onCancelled(0)` → `filesSaved = 0` → "Nenhum arquivo …".                                                |
| Cancelar com o seletor de pasta aberto       | Já tratado no Plano 6: volta pra tela de convite, sem erro, sem `cancelled`.                             |
| Segundo lote na mesma sessão (`rearm` do P6) | `startSend`/`acceptBatch`/`rearm` zeram buffer, `transferStartedAt`, `stats`, contador `filesCompleted`. |
| `performance.now` indisponível               | Fallback para `Date.now()` (só afeta testes/ambientes exóticos).                                         |

---

## 9. Testes

### 9.1 `apps/web/src/lib/transfer-format.test.ts`

- `formatSpeed`: `0 → "0 B/s"`, `820*1024 → "820 KB/s"`, `12.3*1024*1024 →
"12,3 MB/s"` (vírgula pt-BR).
- `formatDuration`: `5 → "menos de 10 s"`, `44 → "cerca de 40 s"`,
  `95 → "cerca de 2 min"`, `4000 → "mais de 1 h"`, e as bordas 10 / 60 / 3600.

### 9.2 `apps/web/src/lib/use-file-transfer.test.ts` (`vi.useFakeTimers`, `performance.now` mockado/avançado)

- Velocidade `null` enquanto `span < 1 s`; valor estável e correto após várias
  amostras a taxa constante; decai a ~0 quando os eventos param e o ticker roda
  ≥ 1 tick.
- ETA `null` antes de 3 s de `elapsed` mesmo com velocidade válida; valor
  plausível depois; volta a `null` quando a velocidade zera.
- `overall.bytesDone` = Σ(concluídos) + `fileBytes`; `overall` expõe
  `filesDone`/`filesTotal` também.
- `perFile[ativo].pct` acompanha `bytes/size`; arquivo de 0 byte → `pct 100`.
- Cancelar no meio (motor manda `cancel` após 1 `file-end` de 3) →
  `phase === "cancelled"`, `filesSaved === 1`.
- `phase` passa por `preparing` entre `batch-accept`/`accept()` e o 1º
  `onProgress`.
- `rearm` (2º lote) zera `stats` e o contador.

### 9.3 `packages/transfer-engine/src/receiver.test.ts` e `sender.test.ts`

- Cancelar (local e remoto) no meio do 2º de 3 arquivos → `onCancelled`
  chamado com `1`.
- Cancelar antes de qualquer `file-end` → `onCancelled` com `0`.
- Testes existentes do Plano 6 que passam `onCancelled: vi.fn()` seguem válidos.

### 9.4 `apps/web/src/components/transferir/SendPanel.test.tsx` e `s/ReceivePanel.test.tsx`

- Fase ativa renderiza `formatBytes`/`formatSpeed`/`formatDuration` a partir de
  um `transfer` de fixture.
- `stats` com os dois campos `null` → renderiza "calculando…".
- Barrinha individual presente só no arquivo ativo; ausente quando
  `filesTotal === 1`.
- `cancelled` com `filesSaved = 3`, `filesTotal = 5` → texto "3 de 5 arquivos
  foram salvos …"; com `filesSaved = 0` → "Nenhum arquivo …".

### 9.5 Portão

`pnpm turbo run lint typecheck test build` verde (19/19 tarefas turbo).

---

## 10. Textos pt-BR (referência única)

| Contexto                                   | Texto                                                                |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Fase ativa, >1 arquivo, emissor            | `Enviando arquivo ${n} de ${total}`                                  |
| Fase ativa, >1 arquivo, receptor           | `Recebendo arquivo ${n} de ${total}`                                 |
| Fase ativa, 1 arquivo, emissor             | `Enviando ${nome}`                                                   |
| Fase ativa, 1 arquivo, receptor            | `Recebendo ${nome}`                                                  |
| Linha de status                            | `${bytesDone} de ${bytesTotal}` · `${velocidade}` · `${eta}`         |
| Velocidade indisponível / ETA indisponível | `calculando…`                                                        |
| Velocidade zero                            | `parado`                                                             |
| ETA                                        | `cerca de 40 s` / `cerca de 2 min` / `menos de 10 s` / `mais de 1 h` |
| `preparing`                                | `Preparando a transferência…`                                        |
| Rótulo de arquivo — `queued`               | `Na fila`                                                            |
| Rótulo de arquivo — ativo, emissor         | `Enviando`                                                           |
| Rótulo de arquivo — ativo, receptor        | `Recebendo`                                                          |
| Rótulo de arquivo — `completed`            | `Concluído`                                                          |
| Rótulo de arquivo — `failed`               | `Falhou`                                                             |
| `cancelled`, receptor, parcial             | `${k} de ${total} arquivos foram salvos neste dispositivo.`          |
| `cancelled`, receptor, zero                | `Nenhum arquivo foi salvo.`                                          |
| `cancelled`, emissor, parcial              | `${k} de ${total} arquivos chegaram.`                                |
| `cancelled`, emissor, zero                 | `Nenhum arquivo chegou.`                                             |
| `cancelled`, título (ambos)                | `Transferência cancelada`                                            |

---

## 11. Sequência de implementação sugerida

1. `transfer-format.ts` — `formatSpeed` + `formatDuration` + testes (puro, sem
   dependência).
2. Motor — `onCancelled(filesDone)` em `types.ts`/`receiver.ts`/`sender.ts` +
   testes do motor.
3. Hook — buffer de amostras, velocidade, ETA, ticker, `overall` por bytes,
   `perFile.pct`, `filesSaved`, `phase` com `preparing`/`sending`/`receiving` +
   testes do hook com timers falsos.
4. `SendPanel.tsx` + testes — barra por bytes, linha de status, barrinha do
   ativo, telas finais.
5. `ReceivePanel.tsx` + testes — espelho.
6. Atualizar os testes/páginas do Plano 6 que liam `overall.done/total`.
7. Portão completo.
