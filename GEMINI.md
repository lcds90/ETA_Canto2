# Contexto do Projeto: Canto ETA (`ETA_Canto2`)

Este arquivo fornece contexto imediato para o **Antigravity** ao visitar este repositório. O projeto é uma aplicação web progressiva (**PWA**) de gerenciamento e reprodução de repertórios musicais, estudos vocais e contexto de shows por dia da semana para o **Canto ETA**, integrada ao **Google Sheets** via **Google Apps Script**.

---

## 1. Arquitetura e Arquivos Principais

- **[`index.html`](file:///home/lcds/projects/ETA_Canto2/index.html)**: Aplicação frontend _single-file_ (HTML5 + CSS3 + Vanilla JS) com suporte a PWA, player unificado (Áudio HTML5 + YouTube IFrame API), controles de navegação de faixas e tela cheia, cache offline de mídias (Cache Storage API), ordenação drag-and-drop (`SortableJS`) e sincronização otimista (`localStorage` + Google Apps Script).
- **[`apps-script/itens.gs`](file:///home/lcds/projects/ETA_Canto2/apps-script/itens.gs)**: Backend _single-file_ do Google Apps Script vinculado à planilha do Google Sheets. Expõe um roteador único via `doGet(e)` para leitura e escrita das abas de cada dia da semana, utilizando `LockService` para concorrência segura.
- **[`sw.js`](file:///home/lcds/projects/ETA_Canto2/sw.js) e [`manifest.json`](file:///home/lcds/projects/ETA_Canto2/manifest.json)**:
  - `sw.js`: Service Worker que mantém dois caches separados (`canto-eta-shell-v1` para os assets da aplicação e `canto-eta-media-v1` para os áudios baixados pelo usuário). Usa _Network-First_ para navegação HTML, _Cache-First_ com atualização em segundo plano para estáticos/CDNs e nunca intercepta chamadas ao Google Apps Script, Google Sheets ou YouTube.
  - `manifest.json` e ícones (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`): Configuração standalone portrait-primary para instalação em Android, Desktop e iOS/iPadOS.
- **Arquivos Auxiliares / Legados**:
  - `image_6.png`, `image_7.png`, `image_del.png`: Imagens de fundo da interface e posters padrão.
  - `local.html`, `delete.html`: Versões anteriores/auxiliares mantidas no repositório (a referência principal e ativa é sempre `index.html`).

---

## 2. Modelo de Dados (Planilha Google Sheets)

A planilha possui **7 abas**, correspondendo aos dias da semana, mapeadas tanto pelo nome quanto pelo `gid`:

| Dia (`dia`) | GID (`gid`)  |
| :---------- | :----------- |
| `DOMINGO`   | `1960210650` |
| `SEGUNDA`   | `1517164028` |
| `TERÇA`     | `216102701`  |
| `QUARTA`    | `911593347`  |
| `QUINTA`    | `1593190716` |
| `SEXTA`     | `1611821250` |
| `SABADO`    | `1644722704` |

### Estrutura de Colunas (A–G) em cada aba

1. **Linha 1 (Cabeçalho)**: `id | cantor | musica | media | tipo | notes | duracao`
2. **Linha Especial de Contexto do Show**:
   - Identificada por `id = "__contexto__"` (Coluna A) ou `tipo = "contexto"` (Coluna E).
   - **Coluna A (`id`)**: `__contexto__`
   - **Coluna B (`cantor`)**: Título do Show
   - **Coluna C (`musica`)**: Datas/horários do show separados por pipe `|` (formato `YYYY-MM-DDTHH:mm`)
   - **Coluna D (`media`)**: URL ou caminho da imagem do Poster
   - **Coluna E (`tipo`)**: `contexto`
   - **Coluna F (`notes`)**: Datas/horários dos ensaios no teatro separados por `|` (formato `YYYY-MM-DDTHH:mm`)
   - **Coluna G (`duracao`)**: Vazio
3. **Linhas de Itens da Playlist**:
   - **`id`**: Identificador único do item (ex.: UUID curto ou `novo-...`).
   - **`cantor`**: Nome do intérprete (ou descrição do exercício quando `tipo = "estudo"`).
   - **`musica`**: Nome da música, nome do exercício (`estudo`) ou título da seção (`separador`).
   - **`media`**: Link de áudio (MP3 direto, link do Dropbox, ID de arquivo do Google Drive) ou link/ID de vídeo do YouTube (11 caracteres).
   - **`tipo`**:
     - `audio`: Música reproduzida no `<audio id="audio-player">`.
     - `youtube`: Vídeo/música reproduzida via YouTube IFrame API (`YT.Player`).
     - `estudo`: Exercício vocal/estudo (inverte destaque visual entre exercício e descrição).
     - `separador`: Cabeçalho divisório de seção na lista (ex.: Aquecimento, Repertório, Encerramento); não entra na soma de tempo nem na reprodução.
   - **`notes`**: Observações da faixa (editáveis inline na visão normal com `contenteditable="true"`).
   - **`duracao`**: Duração da faixa no formato `mm:ss` (ou `hh:mm:ss`). Para áudios sem duração cadastrada, o frontend detecta automaticamente via metadados do elemento `Audio` (`loadedmetadata`).

---

## 3. API do Backend (`apps-script/itens.gs`)

Todas as operações passam por `doGet(e)` através do parâmetro `acao` (com `dia` ou `gid`):

- **`listarItens` / `lerItens`** (padrão quando `acao` é omitida):
  - Retorna JSON `{ ok: true, dia, contexto, itens }` ou CSV quando `formato=csv` / `output=csv`.
  - Separa automaticamente a linha `__contexto__` no objeto `contexto` (`{ titulo, datas, poster, ensaios }`) e formata cada item com `nome` no padrão `"Música (Cantor) - Observação"`.
- **`salvarContextoDia`**:
  - Parâmetros: `dia` (ou `gid`), `titulo`, `datas` (separadas por `|`), `ensaios` (separados por `|`), `poster`.
  - Atualiza a linha `__contexto__` existente ou insere uma nova.
- **`adicionarItem`**:
  - Parâmetros: `dia`, `id` (opcional, gera UUID se omitido), `cantor`, `musica` (obrigatório), `media`, `tipo`, `notes`, `duracao`.
- **`editarItem`**:
  - Parâmetros: `id`, `dia`, `cantor`, `musica`, `media`, `tipo`, `notes`, `duracao`, além de `cantorOriginal` e `musicaOriginal` como fallback de busca caso o item antigo não possua `id` na coluna A.
- **`apagarItem`**:
  - Parâmetros: `dia`, `id` e/ou `nome` (faz busca prioritária pelo `id` na coluna A e fallback pelo texto concatenado `Música (Cantor) - Observação`).
- **`reordenarItens`**:
  - Parâmetros: `dia`, `ordem` (lista de IDs separados por vírgula `id1,id2,id3`).
  - Reescreve a aba mantendo o cabeçalho na linha 1 e preservando a linha `__contexto__` no topo.

---

## 4. Funcionalidades e Diretrizes do Frontend (`index.html`)

### Sistema de Design e UI

- **Grid de 8 Pontos (8-Point Grid)**: Espaçamentos, paddings, margens, raios de borda e tamanhos de botões seguem múltiplos de `8px` (`8px`, `16px`, `24px`, `32px`, `48px`), garantindo alvos de toque mobile-first (`40px`–`48px`).
- **Estilo Glassmorphism**: Painéis utilizam `.glass-panel` com fundo escuro translúcido e `backdrop-filter: blur(16px)`.
- **Feedback Visual e Modais**:
  - Notificações temporárias via `mostrarToast(mensagem, duracao)` no topo da tela (sem uso de `alert()` nativo).
  - Confirmações e avisos via modal customizado `abrirModalConfirmacao({ titulo, mensagem, detalhe, textoBotao, tipo, ocultarCancelar, onConfirmar })` (suporta `tipo: 'perigo' | 'aviso' | 'info'` e `ocultarCancelar: true` para diálogos informativos de botão único).

### Player Unificado, Navegação e Tela Cheia

- **Controles Superiores (`#player-top-controls`) e Flutuantes (`#float-ctrl`)**:
  - `↺` (`restartMedia()`): Reinicia a mídia atual do zero.
  - `⏮️` (`tocarMusicaAnterior()`): Volta para a faixa reproduzível anterior da lista (`obterItemAnteriorReproduzivel()`), fazendo scroll suave até o item.
  - `⏸️` / `▶️` (`pauseMedia()`): Pausa ou retoma tanto `<audio>` quanto `YT.Player`.
  - `⏭️` (`tocarProximaMusica()`): Avança manualmente para a próxima faixa reproduzível (`obterProximoItemReproduzivel()`), fazendo scroll suave até o item.
  - `⛶` (`alternarFullscreenYouTube()`): Botão exibido exclusivamente quando a mídia ativa é do YouTube (`atualizarVisibilidadeBotaoFullscreen()`). Ativa tela cheia via Fullscreen API nativa + classe `.yt-fullscreen-ativo` (fallback para iOS/mobile) e exibe o botão sobreposto `✕ Sair da Tela Cheia` (`sairFullscreenYouTube()`).
  - `🔁 Auto` (`alternarAutoAvanco()`): Alterna o avanço automático (`player_auto_avanco` no `localStorage`) ao término de cada áudio ou vídeo do YouTube.
  - `⏹️` (`stopAll()`): Para a reprodução, sai da tela cheia do YouTube se ativa e minimiza o player.

### Instalação PWA Multiplataforma (`instalarPWA()`)

- **Android / Desktop**: Captura o evento `beforeinstallprompt`, exibe o botão `📲 Instalar App` (`#btn-instalar-pwa`) e dispara o prompt nativo de instalação.
- **iOS / iPadOS**: Detecta iPhone, iPad e iPadOS (`isDispositivoIOS()`) quando fora do modo standalone (`!isModoStandalone()`), exibe o botão `📲 Instalar App` e abre um modal informativo explicando o passo a passo no Safari (_Compartilhar ⬆️ → Adicionar à Tela de Início_).

### Modos de Operação da Interface

1. **Modo Normal (Apresentação / Estudo)**:
   - Exibe o painel de contexto do show (poster clicável, título, chips de datas do show e ensaios, e badge com a soma total de tempo das músicas).
   - Permite busca instantânea (`filtrarLista()`), marcação de itens concluídos (`.chk-done`), edição rápida de anotações locais (`.notes-field`), download de mídias para cache offline (`Cache Storage` `canto-eta-media-v1`) e reprodução.
2. **Modo Gerenciamento (`body.modo-gerenciamento`)**:
   - Alternado pelo botão `⚙️ Modo de Gerenciamento`. Altera o tema visual para tons âmbar/dourado e oculta o player e os controles de reprodução.
   - Exibe o formulário de edição do **Contexto do Show** (título, poster, múltiplas datas de show e de ensaios com `datetime-local`), cujo salvamento ocorre de forma explícita ao clicar no botão `💾 Salvar na Planilha` (`salvarContextoShow(true)`).
   - Habilita alças de arrasto (`.drag-handle` do `SortableJS`), inputs numéricos de posição (`.order-input`), edição inline de duração (`.duration-inline-input`), botões de editar item (`✏️`), excluir item (`🗑️`), apagar todas as músicas do dia (`apagarTodasMusicas()`) e adicionar nova música (`➕ Adicionar Música`).

### Sincronização Local e Modo Mock (`USE_MOCK`)

- A constante `USE_MOCK` (próxima ao início da tag `<script>` em `index.html`) controla se o app roda 100% offline com dados simulados (`USE_MOCK = true`) ou conectado ao Google Apps Script / CSV publicado (`USE_MOCK = false`, utilizando `WEB_APP_URL` e `BASE_URL`).
- O estado local é persistido no `localStorage` (`sync_extras_v1`, `sync_edicoes_v1`, `sync_excluidos_v1`, `ordem_<gid>`, `ordem_global_<gid>`, `duracoes_<gid>`, `contexto_show_<gid>`, `player_auto_avanco`), garantindo atualização imediata da interface mesmo quando as chamadas ao Apps Script são feitas com `fetch(..., { mode: 'no-cors' })`.

---

## 5. Convenções para Modificações Futuras

1. **Sincronia Frontend ↔ Apps Script**: Qualquer novo campo adicionado aos itens ou ao contexto do show em `index.html` deve respeitar a ordem das 7 colunas (`A:G`) em `apps-script/itens.gs` (ou expandir o range em ambos os arquivos de forma consistente).
2. **Preservação do Modo Mock**: Toda funcionalidade de leitura ou escrita (criar, editar, excluir, reordenar, contexto) deve funcionar tanto com `USE_MOCK = true` quanto com `USE_MOCK = false`.
3. **UX Mobile-First**: Não utilizar `alert()` ou `confirm()` nativos do navegador; utilizar sempre `mostrarToast()` e `abrirModalConfirmacao()`. Manter o padrão de espaçamento do Grid de 8 Pontos.
