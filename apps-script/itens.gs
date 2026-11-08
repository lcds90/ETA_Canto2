/**
 * Arquivo único do Google Apps Script para gerenciar e listar os itens e o contexto do show por dia.
 *
 * Ações suportadas via doGet(e):
 *   - listarItens (ou sem "acao"): lê e retorna o contexto do show e os itens da aba do dia (em JSON ou CSV)
 *       Ex: WEB_APP_URL?acao=listarItens&dia=DOMINGO
 *       Ex: WEB_APP_URL?acao=listarItens&gid=1960210650&formato=csv
 *   - salvarContextoDia: salva/atualiza o contexto do show (título, datas, ensaios, poster) na aba do dia
 *       Ex: WEB_APP_URL?acao=salvarContextoDia&dia=DOMINGO&titulo=...&datas=2026-11-24T19:00|...&ensaios=2026-11-21T19:30|...&poster=...
 *   - adicionarItem: adiciona uma nova linha na aba do dia (incluindo duracao)
 *       Ex: WEB_APP_URL?acao=adicionarItem&dia=DOMINGO&tipo=audio&musica=...&cantor=...&media=...&notes=...&duracao=03:45
 *   - editarItem: edita uma linha existente (busca por id na coluna A ou por cantor+música originais)
 *       Ex: WEB_APP_URL?acao=editarItem&id=...&dia=DOMINGO&tipo=...&musica=...&cantor=...&media=...&notes=...&duracao=03:45
 *   - apagarItem: remove uma linha existente (busca por id na coluna A ou pelo texto formatado em "nome")
 *       Ex: WEB_APP_URL?acao=apagarItem&id=...&dia=DOMINGO&nome=...
 *   - reordenarItens: reordena as linhas da aba do dia conforme a lista de IDs enviada em "ordem"
 *       Ex: WEB_APP_URL?acao=reordenarItens&dia=DOMINGO&ordem=id1,id2,id3
 *
 * Estrutura esperada de cada aba (DOMINGO, SEGUNDA, TERÇA, QUARTA, QUINTA, SEXTA, SABADO):
 *   Linha 1 (cabeçalho): id | cantor | musica | media | tipo | notes | duracao
 *   Linha de contexto do show: __contexto__ | <titulo> | <datas separadas por |> | <poster> | contexto | <ensaios separados por |> |
 */

const ID_CONTEXTO_ = '__contexto__';
const TIPO_CONTEXTO_ = 'contexto';

const MAPA_GID_DIAS_ = {
  '1960210650': 'DOMINGO',
  '1517164028': 'SEGUNDA',
  '216102701':  'TERÇA',
  '911593347':  'QUARTA',
  '1593190716': 'QUINTA',
  '1611821250': 'SEXTA',
  '1644722704': 'SABADO'
};

/**
 * Localiza a aba pelo parâmetro "dia" (ex.: DOMINGO) ou "gid" (ID da aba).
 */
function obterAba_(p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const diaParam = String((p && p.dia) || '').trim().toUpperCase();
  const gidParam = String((p && p.gid) || '').trim();

  if (diaParam) {
    const abaPorNome = ss.getSheetByName(diaParam);
    if (abaPorNome) return abaPorNome;
  }

  if (gidParam) {
    const nomeMapeado = MAPA_GID_DIAS_[gidParam];
    if (nomeMapeado) {
      const abaMapeada = ss.getSheetByName(nomeMapeado);
      if (abaMapeada) return abaMapeada;
    }
    const abas = ss.getSheets();
    for (let i = 0; i < abas.length; i++) {
      if (String(abas[i].getSheetId()) === gidParam) return abas[i];
    }
  }

  if (!diaParam && !gidParam) {
    return ss.getSheetByName('DOMINGO') || ss.getSheets()[0] || null;
  }
  return null;
}

/**
 * Monta a string padrão do item: "Música (Cantor) - Observação"
 */
function formatarStringItem_(cantor, musica, notes) {
  const c = String(cantor || '').trim();
  const m = String(musica || '').trim();
  const n = String(notes || '').trim();
  const base = c ? m + ' (' + c + ')' : m;
  return n ? base + ' - ' + n : base;
}

function resposta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function escaparCSV_(valor) {
  const s = String(valor == null ? '' : valor).replace(/"/g, '""');
  return '"' + s + '"';
}

function normalizarListaDatas_(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) {
    return valor.map(function (v) { return String(v || '').trim(); }).filter(Boolean);
  }
  return String(valor)
    .split('|')
    .map(function (v) { return v.trim(); })
    .filter(Boolean);
}

/**
 * Handler para leitura e listagem de itens e contexto do dia ("listarItens" / "lerItens").
 *
 * Aceita:
 *   - dia=DOMINGO (ou gid=1960210650)
 *   - formato=json (padrão) ou formato=csv (ou output=csv)
 */
function listarItens(p) {
  const aba = obterAba_(p);
  if (!aba) {
    return resposta_({ ok: false, erro: 'Aba não encontrada: ' + (p.dia || p.gid || '') });
  }

  const valores = aba.getDataRange().getDisplayValues();
  const itens = [];
  const linhasCSV = ['id,cantor,musica,media,tipo,notes,duracao'];
  let contexto = null;

  for (let i = 1; i < valores.length; i++) {             // i = 0 é o cabeçalho
    const linha = valores[i];
    const vId     = String(linha[0] || '').trim();
    const cantor  = String(linha[1] || '').trim();
    const musica  = String(linha[2] || '').trim();
    const media   = String(linha[3] || '').trim();
    const tipo    = String(linha[4] || '').trim().toLowerCase();
    const notes   = String(linha[5] || '').trim();
    const duracao = String(linha[6] || '').trim();

    if (vId === ID_CONTEXTO_ || tipo === TIPO_CONTEXTO_) {
      contexto = {
        titulo: cantor,
        datas: normalizarListaDatas_(musica),
        poster: media,
        ensaios: normalizarListaDatas_(notes)
      };
      linhasCSV.push([ID_CONTEXTO_, cantor, musica, media, TIPO_CONTEXTO_, notes, ''].map(escaparCSV_).join(','));
      continue;
    }

    if (!musica && !cantor) continue;

    const id = vId || ('item-' + (i - 1));
    itens.push({
      id: id,
      cantor: cantor,
      musica: musica,
      media: media,
      tipo: tipo,
      notes: notes,
      duracao: duracao,
      nome: formatarStringItem_(cantor, musica, notes)
    });

    linhasCSV.push([id, cantor, musica, media, tipo, notes, duracao].map(escaparCSV_).join(','));
  }

  const formato = String(p.formato || p.output || 'json').trim().toLowerCase();
  if (formato === 'csv') {
    return ContentService.createTextOutput(linhasCSV.join('\n'))
      .setMimeType(ContentService.MimeType.CSV);
  }

  return resposta_({
    ok: true,
    dia: aba.getName(),
    contexto: contexto,
    itens: itens
  });
}

/**
 * Handler para salvar/atualizar o contexto do show na aba do dia ("salvarContextoDia").
 * Armazena na linha com id="__contexto__" e tipo="contexto":
 *   col A (id): __contexto__
 *   col B (cantor): titulo do show
 *   col C (musica): datas do show separadas por "|" (ex: 2026-11-24T19:00|2026-11-25T20:00)
 *   col D (media): link para o poster
 *   col E (tipo): contexto
 *   col F (notes): ensaios no teatro separados por "|" (ex: 2026-11-21T19:30|2026-11-23T15:00)
 *   col G (duracao): vazio
 */
function salvarContextoDia(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const aba = obterAba_(p);
    if (!aba) return resposta_({ ok: false, erro: 'Aba não encontrada: ' + (p.dia || p.gid || '') });

    const titulo  = String(p.titulo || '').trim();
    const datas   = normalizarListaDatas_(p.datas).join('|');
    const poster  = String(p.poster || '').trim();
    const ensaios = normalizarListaDatas_(p.ensaios).join('|');

    const novaLinha = [ID_CONTEXTO_, titulo, datas, poster, TIPO_CONTEXTO_, ensaios, ''];
    const valores = aba.getDataRange().getDisplayValues();

    let linhaExistente = -1;
    for (let i = 1; i < valores.length; i++) {
      const vId  = String(valores[i][0] || '').trim();
      const tipo = String(valores[i][4] || '').trim().toLowerCase();
      if (vId === ID_CONTEXTO_ || tipo === TIPO_CONTEXTO_) {
        linhaExistente = i;
        break;
      }
    }

    if (linhaExistente >= 0) {
      aba.getRange(linhaExistente + 1, 1, 1, 7).setValues([novaLinha]);
    } else {
      aba.appendRow(novaLinha);
    }

    return resposta_({
      ok: true,
      dia: aba.getName(),
      contexto: {
        titulo: titulo,
        datas: normalizarListaDatas_(datas),
        poster: poster,
        ensaios: normalizarListaDatas_(ensaios)
      }
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Handler para a ação "adicionarItem" chamada pelo formulário "Adicionar Música".
 */
function adicionarItem(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const aba = obterAba_(p);
    if (!aba) return resposta_({ ok: false, erro: 'Aba não encontrada: ' + (p.dia || p.gid || '') });

    const musica = String(p.musica || '').trim();
    if (!musica) return resposta_({ ok: false, erro: 'Campo "musica" obrigatório' });

    const id = String(p.id || '').trim() || Utilities.getUuid().slice(0, 8);
    aba.appendRow([
      id,
      String(p.cantor || '').trim(),
      musica,
      String(p.media || '').trim(),
      String(p.tipo || '').trim(),
      String(p.notes || '').trim(),
      String(p.duracao || '').trim()
    ]);

    return resposta_({ ok: true, id: id });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Handler para a ação "editarItem" (botão ✏️ ou edição de duração no modo Gerenciamento).
 * Localiza a linha pelo id (coluna A). Se não achar, usa cantor+música originais (colunas B e C).
 */
function editarItem(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const aba = obterAba_(p);
    if (!aba) return resposta_({ ok: false, erro: 'Aba não encontrada: ' + (p.dia || p.gid || '') });

    const valores = aba.getDataRange().getDisplayValues();
    const id = String(p.id || '').trim();
    const cantorOrig = String(p.cantorOriginal || '').trim();
    const musicaOrig = String(p.musicaOriginal || '').trim();

    let linha = -1;
    for (let i = 1; i < valores.length; i++) {           // i = 0 é o cabeçalho
      if (id && String(valores[i][0]).trim() === id) { linha = i; break; }
    }
    if (linha < 0 && (cantorOrig || musicaOrig)) {
      for (let i = 1; i < valores.length; i++) {
        if (String(valores[i][1]).trim() === cantorOrig && String(valores[i][2]).trim() === musicaOrig) { linha = i; break; }
      }
    }
    if (linha < 0 && id && id.indexOf('item-') === 0) {
      const idx = parseInt(id.replace('item-', ''), 10) + 1;
      if (!isNaN(idx) && idx >= 1 && idx < valores.length) linha = idx;
    }
    if (linha < 0) return resposta_({ ok: false, erro: 'Item não encontrado' });

    const atual = valores[linha];
    const idFinal = String(atual[0] || '').trim() || (id && id.indexOf('item-') !== 0 ? id : Utilities.getUuid().slice(0, 8));
    const cantorFinal  = p.cantor  !== undefined ? String(p.cantor).trim()  : String(atual[1] || '').trim();
    const musicaFinal  = p.musica  !== undefined ? String(p.musica).trim()  : String(atual[2] || '').trim();
    const mediaFinal   = p.media   !== undefined ? String(p.media).trim()   : String(atual[3] || '').trim();
    const tipoFinal    = p.tipo    !== undefined ? String(p.tipo).trim()    : String(atual[4] || '').trim();
    const notesFinal   = p.notes   !== undefined ? String(p.notes).trim()   : String(atual[5] || '').trim();
    const duracaoFinal = p.duracao !== undefined ? String(p.duracao).trim() : String(atual[6] || '').trim();

    if (!musicaFinal) return resposta_({ ok: false, erro: 'Campo "musica" obrigatório' });

    aba.getRange(linha + 1, 1, 1, 7).setValues([[
      idFinal,
      cantorFinal,
      musicaFinal,
      mediaFinal,
      tipoFinal,
      notesFinal,
      duracaoFinal
    ]]);

    return resposta_({ ok: true, id: idFinal, linha: linha + 1 });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Handler para a ação "apagarItem" (botão 🗑️ no modo Gerenciamento).
 * Prioriza o "id" (coluna A); se não encontrar, faz fallback pelo "nome" formatado.
 */
function apagarItem(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const aba = obterAba_(p);
    if (!aba) return resposta_({ ok: false, erro: 'Aba não encontrada: ' + (p.dia || p.gid || '') });

    const valores = aba.getDataRange().getDisplayValues();
    const id = String(p.id || '').trim();
    const nome = String(p.nome || '').trim();
    if (!id && !nome) return resposta_({ ok: false, erro: 'Informe "id" ou "nome"' });

    let linha = -1;
    let linhaSemNotas = -1;
    for (let i = 1; i < valores.length; i++) {           // i = 0 é o cabeçalho
      const [vId, cantor, musica, , tipo, notes] = valores[i].map(function (v) { return String(v).trim(); });
      if (vId === ID_CONTEXTO_ || String(tipo).toLowerCase() === TIPO_CONTEXTO_) continue;
      if (id && vId === id) { linha = i; break; }
      if (!nome) continue;

      const candidatosBase = [
        musica + ' (' + cantor + ')',
        cantor + ' (' + musica + ')',
        musica
      ];
      for (let c = 0; c < candidatosBase.length; c++) {
        const base = candidatosBase[c];
        const comNotas = notes ? base + ' - ' + notes : base;
        if (comNotas === nome && linha < 0) linha = i;
        if ((base === nome || nome.indexOf(base + ' - ') === 0) && linhaSemNotas < 0) linhaSemNotas = i;
      }
    }
    if (linha < 0) linha = linhaSemNotas;
    if (linha < 0) return resposta_({ ok: false, erro: 'Item não encontrado' });

    aba.deleteRow(linha + 1);
    return resposta_({ ok: true, linha: linha + 1 });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Handler para reordenar os itens da aba do dia ("reordenarItens").
 * Mantém o cabeçalho na linha 1 e preserva a linha "__contexto__" se existir.
 */
function reordenarItens(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const aba = obterAba_(p);
    if (!aba) return resposta_({ ok: false, erro: 'Aba não encontrada: ' + (p.dia || p.gid || '') });

    const ordemIds = String(p.ordem || '')
      .split(',')
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    if (ordemIds.length === 0) return resposta_({ ok: false, erro: 'Parâmetro "ordem" vazio' });

    const valores = aba.getDataRange().getDisplayValues();
    if (valores.length <= 1) return resposta_({ ok: true });

    let linhaContexto = null;
    const mapaItens = {};
    const ordemOriginalIds = [];

    for (let i = 1; i < valores.length; i++) {
      const l = valores[i];
      const vId  = String(l[0] || '').trim();
      const tipo = String(l[4] || '').trim().toLowerCase();
      const reg  = [
        vId,
        String(l[1] || '').trim(),
        String(l[2] || '').trim(),
        String(l[3] || '').trim(),
        String(l[4] || '').trim(),
        String(l[5] || '').trim(),
        String(l[6] || '').trim()
      ];

      if (vId === ID_CONTEXTO_ || tipo === TIPO_CONTEXTO_) {
        linhaContexto = reg;
        continue;
      }
      if (!reg[1] && !reg[2]) continue;

      const idEfetivo = vId || ('item-' + (i - 1));
      reg[0] = vId || Utilities.getUuid().slice(0, 8);
      mapaItens[idEfetivo] = reg;
      ordemOriginalIds.push(idEfetivo);
    }

    const novasLinhas = [];
    if (linhaContexto) novasLinhas.push(linhaContexto);

    const usados = {};
    for (let k = 0; k < ordemIds.length; k++) {
      const id = ordemIds[k];
      if (mapaItens[id] && !usados[id]) {
        novasLinhas.push(mapaItens[id]);
        usados[id] = true;
      }
    }
    for (let k = 0; k < ordemOriginalIds.length; k++) {
      const id = ordemOriginalIds[k];
      if (mapaItens[id] && !usados[id]) {
        novasLinhas.push(mapaItens[id]);
        usados[id] = true;
      }
    }

    const totalLinhasAntigas = valores.length - 1;
    if (totalLinhasAntigas > 0) {
      aba.getRange(2, 1, totalLinhasAntigas, 7).clearContent();
    }
    if (novasLinhas.length > 0) {
      aba.getRange(2, 1, novasLinhas.length, 7).setValues(novasLinhas);
    }

    return resposta_({ ok: true, total: novasLinhas.length });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Roteador único: mantém leitura/listagem, contexto do show, adição, edição, exclusão e reordenação em um só arquivo.
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const acao = String(p.acao || 'listarItens').trim();

  switch (acao) {
    case 'listarItens':
    case 'lerItens':
      return listarItens(p);
    case 'salvarContextoDia':
      return salvarContextoDia(p);
    case 'adicionarItem':
      return adicionarItem(p);
    case 'editarItem':
      return editarItem(p);
    case 'apagarItem':
      return apagarItem(p);
    case 'reordenarItens':
      return reordenarItens(p);
    default:
      return resposta_({ ok: false, erro: 'Ação desconhecida: ' + acao });
  }
}
