'use strict';

/**
 * Açaí Demo — servidor de pedidos por mesa.
 *
 * Node.js puro (sem dependências). Serve os arquivos estáticos de /public,
 * expõe a API de pedidos e mantém o caixa atualizado em tempo real via SSE.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
/** Páginas do caixa e da administração: servidas só pelas rotas secretas. */
const PRIVADO_DIR = path.join(ROOT, 'privado');

/**
 * Configuração de ambiente. Os padrões servem para rodar na rede da loja;
 * ao publicar na internet, veja a seção "Colocar no ar" do LEIAME.
 *
 * DATA_DIR     — onde os JSON são gravados. Aponte para um disco persistente
 *                se o serviço de hospedagem apagar o sistema de arquivos a
 *                cada publicação; do contrário os QR Codes impressos param de
 *                funcionar, porque os códigos das mesas são regerados.
 * TRUST_PROXY  — ligue com "1" apenas quando houver um proxy HTTPS na frente
 *                (túnel ou hospedagem). Sem proxy, confiar nos cabeçalhos
 *                permitiria a qualquer um forjar o próprio IP.
 * ROTA_CAIXA   — endereço do caixa. Sem valor definido, um endereço aleatório
 * ROTA_ADMIN     é sorteado no primeiro arranque e guardado em config.json.
 *                Serve para tirar /caixa e /admin da mira de varredores
 *                automáticos; a proteção de verdade continua sendo o PIN.
 */
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 3000;
const CONFIAR_PROXY = process.env.TRUST_PROXY === '1';

/** Senha inicial desta versão de demonstração. Divulgada no README. */
const SENHA_DEMO = 'demo1234';

const ARQ_MENU = path.join(DATA_DIR, 'menu.json');
const ARQ_MESAS = path.join(DATA_DIR, 'mesas.json');
const ARQ_CONFIG = path.join(DATA_DIR, 'config.json');
const ARQ_PEDIDOS = path.join(DATA_DIR, 'pedidos.json');

/* ------------------------------------------------------------------ */
/* Persistência                                                        */
/* ------------------------------------------------------------------ */

function lerJSON(arquivo, padrao) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch (e) {
    return padrao;
  }
}

function salvarJSON(arquivo, valor) {
  const tmp = arquivo + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(valor, null, 2), 'utf8');
  fs.renameSync(tmp, arquivo);
}

function novoToken(bytes) {
  return crypto.randomBytes(bytes || 12).toString('base64url');
}

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

const MENU_PADRAO = {
  loja: {
    nome: 'Açaí Demo',
    slogan: 'Escolha tamanho, base, condimentos, coberturas e acompanhamentos. Sem fila, sem papel.',
    mensagemFinal: 'Seu pedido foi para a cozinha! Fique de olho no status.',
  },
  categorias: [
    {
      id: 'tamanho',
      nome: 'Tamanho',
      descricao: 'Escolha o tamanho do copo',
      tipo: 'unico',
      obrigatorio: true,
      gratis: 0,
      max: 1,
      opcoes: [
        { id: 'tam-300', nome: '300 ml', preco: 16.9, ativo: true },
        { id: 'tam-400', nome: '400 ml', preco: 21.9, ativo: true },
        { id: 'tam-500', nome: '500 ml', preco: 26.9, ativo: true },
        { id: 'tam-700', nome: '700 ml', preco: 33.9, ativo: true },
      ],
    },
    {
      id: 'base',
      nome: 'Tipo de Açaí',
      descricao: 'A base do seu copo',
      tipo: 'unico',
      obrigatorio: true,
      gratis: 0,
      max: 1,
      opcoes: [
        { id: 'base-tradicional', nome: 'Tradicional', preco: 0, ativo: true },
        { id: 'base-zero', nome: 'Zero açúcar', preco: 2, ativo: true },
        { id: 'base-cupuacu', nome: 'Açaí com cupuaçu', preco: 2, ativo: true },
        { id: 'base-morango', nome: 'Açaí com morango', preco: 2, ativo: true },
        { id: 'base-banana', nome: 'Açaí com banana', preco: 0, ativo: true },
      ],
    },
    {
      id: 'condimentos',
      nome: 'Condimentos',
      descricao: 'Leite em pó, granola e cia — 2 inclusos',
      tipo: 'multiplo',
      obrigatorio: false,
      gratis: 2,
      max: 6,
      opcoes: [
        { id: 'cond-granola', nome: 'Granola', preco: 3, ativo: true },
        { id: 'cond-leitepo', nome: 'Leite em pó', preco: 3, ativo: true },
        { id: 'cond-pacoca', nome: 'Paçoca', preco: 3, ativo: true },
        { id: 'cond-choco-branco', nome: 'Chocolate branco ralado', preco: 3.5, ativo: true },
        { id: 'cond-confete', nome: 'Confete colorido', preco: 3, ativo: true },
        { id: 'cond-castanha', nome: 'Castanha de caju', preco: 4.5, ativo: true },
        { id: 'cond-amendoim', nome: 'Amendoim triturado', preco: 3, ativo: true },
        { id: 'cond-aveia', nome: 'Aveia em flocos', preco: 2.5, ativo: true },
      ],
    },
    {
      id: 'coberturas',
      nome: 'Coberturas',
      descricao: 'Escolha até 2 caldas — 1 inclusa',
      tipo: 'multiplo',
      obrigatorio: false,
      gratis: 1,
      max: 2,
      opcoes: [
        { id: 'cob-chocolate', nome: 'Calda de chocolate', preco: 3, ativo: true },
        { id: 'cob-morango', nome: 'Calda de morango', preco: 3, ativo: true },
        { id: 'cob-leite-condensado', nome: 'Leite condensado', preco: 3.5, ativo: true },
        { id: 'cob-mel', nome: 'Mel', preco: 3.5, ativo: true },
        { id: 'cob-nutella', nome: 'Nutella', preco: 6, ativo: true },
        { id: 'cob-caramelo', nome: 'Caramelo salgado', preco: 4, ativo: true },
      ],
    },
    {
      id: 'frutas',
      nome: 'Frutas',
      descricao: 'Fresquinhas, cortadas na hora',
      tipo: 'multiplo',
      obrigatorio: false,
      gratis: 1,
      max: 4,
      opcoes: [
        { id: 'fru-banana', nome: 'Banana', preco: 2.5, ativo: true },
        { id: 'fru-morango', nome: 'Morango', preco: 4.5, ativo: true },
        { id: 'fru-kiwi', nome: 'Kiwi', preco: 4.5, ativo: true },
        { id: 'fru-manga', nome: 'Manga', preco: 4, ativo: true },
        { id: 'fru-uva', nome: 'Uva verde', preco: 4, ativo: true },
        { id: 'fru-abacaxi', nome: 'Abacaxi', preco: 3.5, ativo: true },
      ],
    },
    {
      id: 'acompanhamentos',
      nome: 'Acompanhamentos',
      descricao: 'Para deixar o copo completo',
      tipo: 'multiplo',
      obrigatorio: false,
      gratis: 0,
      max: 5,
      opcoes: [
        { id: 'acp-bis', nome: 'Bis picado', preco: 4, ativo: true },
        { id: 'acp-kitkat', nome: 'Kit Kat', preco: 6, ativo: true },
        { id: 'acp-oreo', nome: 'Oreo triturado', preco: 5, ativo: true },
        { id: 'acp-brigadeiro', nome: 'Brigadeiro', preco: 5.5, ativo: true },
        { id: 'acp-ninho', nome: 'Creme de ninho', preco: 6, ativo: true },
        { id: 'acp-ovomaltine', nome: 'Ovomaltine', preco: 6, ativo: true },
        { id: 'acp-sorvete', nome: 'Bola de sorvete', preco: 7, ativo: true },
      ],
    },
  ],
};

function mesasPadrao() {
  const mesas = [];
  for (let i = 1; i <= 12; i++) {
    mesas.push({ numero: i, token: `demo-mesa-${i}`, ativa: true });
  }
  return mesas;
}

function hashPin(pin, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pin), s, 32).toString('hex');
  return { salt: s, hash: h };
}

function garantirDados() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ARQ_MENU)) salvarJSON(ARQ_MENU, MENU_PADRAO);
  if (!fs.existsSync(ARQ_MESAS)) salvarJSON(ARQ_MESAS, mesasPadrao());
  if (!fs.existsSync(ARQ_PEDIDOS)) salvarJSON(ARQ_PEDIDOS, { sequencia: 0, dia: '', lista: [] });
  if (!fs.existsSync(ARQ_CONFIG)) {
    const { salt, hash } = hashPin(SENHA_DEMO);
    salvarJSON(ARQ_CONFIG, Object.assign({ pinSalt: salt, pinHash: hash, baseUrl: '' }, ACESSO_PADRAO));
  }
}

/**
 * Regras de acesso do cliente.
 *
 * Um QR Code impresso é uma credencial ao portador: quem copia a URL tem
 * exatamente a mesma informação de quem escaneou na mesa. Não dá para
 * distinguir os dois só pelo link — por isso estas três camadas, que atacam
 * o problema por ângulos diferentes.
 */
const ACESSO_PADRAO = {
  // 1) Horário: fecha a porta fora do expediente, sem atrito nenhum no balcão.
  horario: {
    ativo: true,
    abre: '10:00',
    fecha: '22:00',
    dias: [0, 1, 2, 3, 4, 5, 6], // 0 = domingo
  },
  // 2) Liberação pelo caixa: a única barreira que de fato separa quem está na
  //    loja de quem copiou o link. Custa um clique por mesa, então vem
  //    desligado — ligue se houver abuso.
  exigirLiberacao: false,
  liberacaoMinutos: 90,
  // 3) Teto por mesa: não impede o primeiro pedido falso, mas limita o estrago.
  maxPedidosMesaHora: 8,
};

garantirDados();

let menu = lerJSON(ARQ_MENU, MENU_PADRAO);
let mesas = lerJSON(ARQ_MESAS, []);
let config = lerJSON(ARQ_CONFIG, {});
let pedidos = lerJSON(ARQ_PEDIDOS, { sequencia: 0, dia: '', lista: [] });

// Instalações antigas não têm as chaves de acesso: completa sem sobrescrever.
(function completarConfig() {
  let mudou = false;
  Object.keys(ACESSO_PADRAO).forEach((chave) => {
    if (config[chave] === undefined) {
      config[chave] = ACESSO_PADRAO[chave];
      mudou = true;
    }
  });
  if (mudou) salvarJSON(ARQ_CONFIG, config);
})();

/* ------------------------------------------------------------------ */
/* Rotas do painel                                                     */
/* ------------------------------------------------------------------ */

/** Aceita só o que pode virar segmento de URL sem escapar nada. */
function normalizarRota(valor) {
  const limpo = String(valor || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  return /^[A-Za-z0-9_-]{3,60}$/.test(limpo) ? limpo : null;
}

/**
 * Define o endereço de uma página do painel. A variável de ambiente tem
 * prioridade — é onde ela deve ficar em produção, fora do repositório.
 *
 * VERSÃO DE DEMONSTRAÇÃO: sem variável, cai no endereço previsível (/caixa e
 * /admin) para que qualquer visitante consiga abrir o painel a partir do
 * README. Em uso real, sorteie um endereço no primeiro arranque —
 * `${prefixo}-${novoToken(8)}` — e guarde em config.json: /admin é o primeiro
 * caminho que varredores automáticos tentam.
 */
function resolverRota(variavel, chave, padraoDemo) {
  const doAmbiente = normalizarRota(process.env[variavel]);
  if (doAmbiente) return doAmbiente;

  const guardada = normalizarRota(config[chave]);
  if (guardada) return guardada;

  return padraoDemo;
}

const ROTA_CAIXA = resolverRota('ROTA_CAIXA', 'rotaCaixa', 'caixa');
const ROTA_ADMIN = resolverRota('ROTA_ADMIN', 'rotaAdmin', 'admin');

/** Sessões do caixa/admin: token -> expiração (ms). */
const sessoes = new Map();
const DURACAO_SESSAO = 12 * 60 * 60 * 1000;

/** Clientes SSE conectados. */
let ouvintes = [];

/** Controle simples de flood por IP: ip -> instante do último pedido. */
const ultimoEnvio = new Map();

/**
 * Tentativas de login por IP: ip -> { erros, bloqueadoAte }.
 * Na rede da loja o PIN só era alcançável por quem estava lá dentro; exposto
 * na internet, quatro dígitos caem por tentativa e erro sem um freio destes.
 */
const tentativasLogin = new Map();
const MAX_TENTATIVAS = 5;
const BLOQUEIO_LOGIN = 15 * 60 * 1000;

function estadoLogin(ip) {
  return tentativasLogin.get(ip) || { erros: 0, bloqueadoAte: 0 };
}

function registrarFalhaLogin(ip) {
  const atual = estadoLogin(ip);
  atual.erros += 1;
  if (atual.erros >= MAX_TENTATIVAS) {
    atual.bloqueadoAte = Date.now() + BLOQUEIO_LOGIN;
    atual.erros = 0;
  }
  tentativasLogin.set(ip, atual);
}

/**
 * Limpeza periódica: sem isso, os mapas indexados por IP cresceriam sem parar
 * com o servidor exposto à internet.
 */
setInterval(() => {
  const agora = Date.now();
  sessoes.forEach((expira, token) => {
    if (expira < agora) sessoes.delete(token);
  });
  ultimoEnvio.forEach((instante, ip) => {
    if (agora - instante > 60 * 60 * 1000) ultimoEnvio.delete(ip);
  });
  tentativasLogin.forEach((dados, ip) => {
    if (dados.bloqueadoAte < agora && dados.erros === 0) tentativasLogin.delete(ip);
  });
}, 10 * 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/* Utilidades HTTP                                                     */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function responder(res, status, corpo, headers) {
  res.writeHead(status, Object.assign({ 'Cache-Control': 'no-store' }, headers || {}));
  res.end(corpo);
}

function json(res, status, dados) {
  responder(res, status, JSON.stringify(dados), { 'Content-Type': 'application/json; charset=utf-8' });
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let bruto = '';
    let tamanho = 0;
    req.on('data', (parte) => {
      tamanho += parte.length;
      if (tamanho > 256 * 1024) {
        reject(new Error('corpo muito grande'));
        req.destroy();
        return;
      }
      bruto += parte;
    });
    req.on('end', () => {
      if (!bruto) return resolve({});
      try {
        resolve(JSON.parse(bruto));
      } catch (e) {
        reject(new Error('json inválido'));
      }
    });
    req.on('error', reject);
  });
}

function lerCookies(req) {
  const bruto = req.headers.cookie || '';
  const saida = {};
  bruto.split(';').forEach((parte) => {
    const i = parte.indexOf('=');
    if (i > 0) saida[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  });
  return saida;
}

function autenticado(req) {
  const token = lerCookies(req).painel_sessao;
  if (!token) return false;
  const exp = sessoes.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessoes.delete(token);
    return false;
  }
  return true;
}

/** Comparação em tempo constante para não vazar o token por timing. */
function iguaisSeguro(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function validarMesa(numero, token) {
  const n = Number(numero);
  if (!Number.isInteger(n)) return null;
  const mesa = mesas.find((m) => m.numero === n);
  if (!mesa || !mesa.ativa) return null;
  if (!token || !iguaisSeguro(mesa.token, token)) return null;
  return mesa;
}

/* ------------------------------------------------------------------ */
/* Regras de acesso do cliente                                         */
/* ------------------------------------------------------------------ */

/** Converte "HH:MM" em minutos desde a meia-noite, ou null se não for válido. */
function minutosDoDia(texto) {
  const casou = /^(\d{1,2}):(\d{2})$/.exec(String(texto || '').trim());
  if (!casou) return null;
  const h = Number(casou[1]);
  const m = Number(casou[2]);
  // Sem a checagem de faixa, "25:99" viraria um número plausível e passaria.
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * A loja está aceitando pedidos agora? Suporta horário que atravessa a
 * meia-noite (ex.: abre 18:00, fecha 02:00).
 */
function lojaAberta(agora) {
  const h = config.horario;
  if (!h || !h.ativo) return { aberta: true };

  const data = agora || new Date();
  const abre = minutosDoDia(h.abre);
  const fecha = minutosDoDia(h.fecha);
  if (abre === null || fecha === null) return { aberta: true };

  const dias = Array.isArray(h.dias) && h.dias.length ? h.dias : [0, 1, 2, 3, 4, 5, 6];
  const agoraMin = data.getHours() * 60 + data.getMinutes();

  // Vira o dia: o expediente que começou ontem ainda conta como "hoje".
  const atravessaMeiaNoite = fecha <= abre;
  const diaDeHoje = data.getDay();
  const diaDeOntem = (diaDeHoje + 6) % 7;

  let dentro = false;
  if (atravessaMeiaNoite) {
    if (dias.includes(diaDeHoje) && agoraMin >= abre) dentro = true;
    if (dias.includes(diaDeOntem) && agoraMin < fecha) dentro = true;
  } else {
    dentro = dias.includes(diaDeHoje) && agoraMin >= abre && agoraMin < fecha;
  }

  return { aberta: dentro, abre: h.abre, fecha: h.fecha };
}

/** A mesa foi liberada pelo caixa e a liberação ainda vale? */
function mesaLiberada(mesa) {
  if (!config.exigirLiberacao) return true;
  return !!(mesa.liberadaAte && mesa.liberadaAte > Date.now());
}

function pedidosDaMesaNaUltimaHora(numero) {
  const limite = Date.now() - 60 * 60 * 1000;
  return pedidos.lista.filter(
    (p) => p.mesa === numero && p.status !== 'cancelado' && new Date(p.criadoEm).getTime() > limite
  ).length;
}

/**
 * Motivo pelo qual esta mesa não pode pedir agora, ou null se puder.
 * Usado tanto para bloquear o envio quanto para explicar na tela do cliente.
 */
function bloqueioDaMesa(mesa) {
  const horario = lojaAberta();
  if (!horario.aberta) {
    return {
      codigo: 'fechado',
      erro: `A loja está fechada no momento. Atendemos das ${horario.abre} às ${horario.fecha}.`,
    };
  }
  if (!mesaLiberada(mesa)) {
    return {
      codigo: 'nao_liberada',
      erro: 'Esta mesa ainda não foi liberada. Chame um atendente para abrir seu atendimento.',
    };
  }
  const teto = Number(config.maxPedidosMesaHora) || 0;
  if (teto > 0 && pedidosDaMesaNaUltimaHora(mesa.numero) >= teto) {
    return {
      codigo: 'limite',
      erro: 'Esta mesa atingiu o limite de pedidos por hora. Chame um atendente.',
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Identificação do cliente atrás de proxy                             */
/* ------------------------------------------------------------------ */

/**
 * IP real de quem fez a requisição. Sem esta leitura, atrás de um proxy todos
 * os clientes compartilhariam o IP do proxy e o limite de envios valeria para
 * a loja inteira — um pedido a cada três segundos no total.
 */
function ipDoCliente(req) {
  if (CONFIAR_PROXY) {
    const encaminhado = req.headers['x-forwarded-for'];
    if (encaminhado) {
      const primeiro = String(encaminhado).split(',')[0].trim();
      if (primeiro) return primeiro;
    }
  }
  return req.socket.remoteAddress || 'desconhecido';
}

/** A conexão chegou por HTTPS (direto ou através do proxy)? */
function conexaoSegura(req) {
  if (req.socket.encrypted) return true;
  if (CONFIAR_PROXY) {
    const protocolo = req.headers['x-forwarded-proto'];
    if (protocolo) return String(protocolo).split(',')[0].trim() === 'https';
  }
  return false;
}

function cookieSessao(req, valor, segundos) {
  const partes = [`painel_sessao=${valor}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${segundos}`];
  if (conexaoSegura(req)) partes.push('Secure');
  return partes.join('; ');
}

/* ------------------------------------------------------------------ */
/* SSE                                                                 */
/* ------------------------------------------------------------------ */

function abrirSSE(req, res, filtro) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const ouvinte = { res, filtro };
  ouvintes.push(ouvinte);

  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (e) {
      /* conexão já caiu */
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    ouvintes = ouvintes.filter((o) => o !== ouvinte);
  });
}

function emitir(evento, dados) {
  const pacote = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
  ouvintes.forEach((o) => {
    if (o.filtro && !o.filtro(evento, dados)) return;
    try {
      o.res.write(pacote);
    } catch (e) {
      /* ignora conexões mortas */
    }
  });
}

/* ------------------------------------------------------------------ */
/* Regras de pedido                                                    */
/* ------------------------------------------------------------------ */

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

function proximoNumero() {
  const dia = hoje();
  if (pedidos.dia !== dia) {
    pedidos.dia = dia;
    pedidos.sequencia = 0;
  }
  pedidos.sequencia += 1;
  return pedidos.sequencia;
}

/**
 * Recalcula o item a partir do menu do servidor. O cliente envia apenas ids —
 * preço nunca vem do navegador.
 */
function montarItem(itemBruto) {
  const escolhas = [];
  let total = 0;

  for (const categoria of menu.categorias) {
    const enviados = Array.isArray(itemBruto && itemBruto.escolhas && itemBruto.escolhas[categoria.id])
      ? itemBruto.escolhas[categoria.id]
      : [];

    const ativas = categoria.opcoes.filter((o) => o.ativo !== false);
    const selecionadas = ativas.filter((o) => enviados.includes(o.id));

    if (categoria.tipo === 'unico') {
      if (selecionadas.length > 1) {
        return { erro: `Escolha apenas uma opção em "${categoria.nome}".` };
      }
      if (categoria.obrigatorio && selecionadas.length === 0) {
        return { erro: `Selecione uma opção em "${categoria.nome}".` };
      }
    } else {
      const max = Number(categoria.max) || ativas.length;
      if (selecionadas.length > max) {
        return { erro: `Máximo de ${max} itens em "${categoria.nome}".` };
      }
      if (categoria.obrigatorio && selecionadas.length === 0) {
        return { erro: `Selecione ao menos uma opção em "${categoria.nome}".` };
      }
    }

    const gratis = Number(categoria.gratis) || 0;
    const detalhadas = selecionadas.map((opcao, indice) => {
      const cobrado = indice < gratis ? 0 : Number(opcao.preco) || 0;
      total += cobrado;
      return { id: opcao.id, nome: opcao.nome, preco: cobrado, incluso: indice < gratis };
    });

    if (detalhadas.length) {
      escolhas.push({ categoriaId: categoria.id, categoria: categoria.nome, opcoes: detalhadas });
    }
  }

  const obs = String((itemBruto && itemBruto.obs) || '').slice(0, 180).trim();
  return { item: { escolhas, obs, preco: Math.round(total * 100) / 100 } };
}

function resumoMesa(numero) {
  return pedidos.lista.filter((p) => p.mesa === numero);
}

/* ------------------------------------------------------------------ */
/* Rotas da API                                                        */
/* ------------------------------------------------------------------ */

async function rotaAPI(req, res, url) {
  const rota = url.pathname;
  const q = url.searchParams;

  /* ---------- Cliente (exige token da mesa) ---------- */

  if (rota === '/api/menu' && req.method === 'GET') {
    const mesa = validarMesa(q.get('m'), q.get('t'));
    if (!mesa) return json(res, 403, { erro: 'Acesso permitido apenas pelo QR Code da mesa.' });
    // O bloqueio vai junto do cardápio para a tela do cliente já abrir
    // explicando o motivo, em vez de só falhar na hora de enviar.
    const bloqueio = bloqueioDaMesa(mesa);
    return json(res, 200, {
      loja: menu.loja,
      categorias: menu.categorias
        .map((c) => Object.assign({}, c, { opcoes: c.opcoes.filter((o) => o.ativo !== false) }))
        .filter((c) => c.opcoes.length > 0),
      mesa: mesa.numero,
      bloqueio: bloqueio || null,
    });
  }

  if (rota === '/api/pedidos' && req.method === 'POST') {
    const corpo = await lerCorpo(req);
    const mesa = validarMesa(corpo.mesa, corpo.token);
    if (!mesa) return json(res, 403, { erro: 'Sessão da mesa inválida. Escaneie o QR Code novamente.' });

    // Revalida no envio: a tela pode ter ficado aberta desde antes do
    // fechamento, ou a liberação da mesa pode ter expirado nesse meio-tempo.
    const bloqueio = bloqueioDaMesa(mesa);
    if (bloqueio) return json(res, 403, { erro: bloqueio.erro, codigo: bloqueio.codigo });

    const ip = ipDoCliente(req);
    const anterior = ultimoEnvio.get(ip) || 0;
    if (Date.now() - anterior < 3000) {
      return json(res, 429, { erro: 'Aguarde alguns segundos antes de enviar outro pedido.' });
    }

    const brutos = Array.isArray(corpo.itens) ? corpo.itens : [];
    if (brutos.length < 1 || brutos.length > 20) {
      return json(res, 400, { erro: 'Informe de 1 a 20 açaís por pedido.' });
    }

    const itens = [];
    for (const bruto of brutos) {
      const r = montarItem(bruto);
      if (r.erro) return json(res, 400, { erro: r.erro });
      itens.push(r.item);
    }

    const pedido = {
      id: novoToken(8),
      numero: proximoNumero(),
      mesa: mesa.numero,
      cliente: String(corpo.cliente || '').slice(0, 40).trim(),
      itens,
      total: Math.round(itens.reduce((s, i) => s + i.preco, 0) * 100) / 100,
      status: 'novo',
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };

    pedidos.lista.push(pedido);
    if (pedidos.lista.length > 2000) pedidos.lista = pedidos.lista.slice(-2000);
    salvarJSON(ARQ_PEDIDOS, pedidos);
    ultimoEnvio.set(ip, Date.now());

    emitir('pedido:novo', pedido);
    return json(res, 201, { ok: true, pedido });
  }

  if (rota === '/api/meus-pedidos' && req.method === 'GET') {
    const mesa = validarMesa(q.get('m'), q.get('t'));
    if (!mesa) return json(res, 403, { erro: 'Acesso negado.' });
    return json(res, 200, { pedidos: resumoMesa(mesa.numero).slice(-10) });
  }

  if (rota === '/api/stream-mesa' && req.method === 'GET') {
    const mesa = validarMesa(q.get('m'), q.get('t'));
    if (!mesa) return json(res, 403, { erro: 'Acesso negado.' });
    // mesa === null significa aviso geral (mudou horário, cardápio, regras) e
    // vale para todo mundo; o resto só chega à mesa correspondente.
    return abrirSSE(req, res, (evento, dados) => {
      if (!dados) return false;
      return dados.mesa === null || dados.mesa === mesa.numero;
    });
  }

  /* ---------- Sessão ---------- */

  if (rota === '/api/login' && req.method === 'POST') {
    const ip = ipDoCliente(req);
    const tentativas = estadoLogin(ip);
    if (tentativas.bloqueadoAte > Date.now()) {
      const minutos = Math.ceil((tentativas.bloqueadoAte - Date.now()) / 60000);
      return json(res, 429, {
        erro: `Muitas tentativas. Tente de novo em ${minutos} minuto${minutos === 1 ? '' : 's'}.`,
      });
    }

    const corpo = await lerCorpo(req);
    const { hash } = hashPin(corpo.pin || '', config.pinSalt);
    if (!iguaisSeguro(hash, config.pinHash)) {
      registrarFalhaLogin(ip);
      await new Promise((r) => setTimeout(r, 600));
      return json(res, 401, { erro: 'PIN incorreto.' });
    }

    tentativasLogin.delete(ip);
    const token = novoToken(24);
    sessoes.set(token, Date.now() + DURACAO_SESSAO);
    return responder(res, 200, JSON.stringify({ ok: true }), {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': cookieSessao(req, token, DURACAO_SESSAO / 1000),
    });
  }

  if (rota === '/api/logout' && req.method === 'POST') {
    const token = lerCookies(req).painel_sessao;
    if (token) sessoes.delete(token);
    return responder(res, 200, JSON.stringify({ ok: true }), {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': cookieSessao(req, '', 0),
    });
  }

  if (rota === '/api/sessao' && req.method === 'GET') {
    return json(res, 200, { autenticado: autenticado(req) });
  }

  /* ---------- Área protegida (caixa e admin) ---------- */

  if (rota.startsWith('/api/painel/')) {
    if (!autenticado(req)) return json(res, 401, { erro: 'Não autenticado.' });

    if (rota === '/api/painel/pedidos' && req.method === 'GET') {
      const dia = q.get('dia') || hoje();
      const lista = pedidos.lista.filter((p) => p.criadoEm.slice(0, 10) === dia);
      return json(res, 200, { pedidos: lista, dia });
    }

    if (rota === '/api/painel/status' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      const validos = ['novo', 'preparo', 'pronto', 'entregue', 'cancelado'];
      if (!validos.includes(corpo.status)) return json(res, 400, { erro: 'Status inválido.' });
      const pedido = pedidos.lista.find((p) => p.id === corpo.id);
      if (!pedido) return json(res, 404, { erro: 'Pedido não encontrado.' });
      pedido.status = corpo.status;
      pedido.atualizadoEm = new Date().toISOString();
      salvarJSON(ARQ_PEDIDOS, pedidos);
      emitir('pedido:status', pedido);
      return json(res, 200, { ok: true, pedido });
    }

    if (rota === '/api/painel/stream' && req.method === 'GET') {
      return abrirSSE(req, res, null);
    }

    if (rota === '/api/painel/menu' && req.method === 'GET') {
      return json(res, 200, menu);
    }

    if (rota === '/api/painel/menu' && req.method === 'PUT') {
      const corpo = await lerCorpo(req);
      const validacao = validarMenu(corpo);
      if (validacao) return json(res, 400, { erro: validacao });
      menu = corpo;
      salvarJSON(ARQ_MENU, menu);
      emitir('menu:atualizado', { mesa: null });
      return json(res, 200, { ok: true });
    }

    if (rota === '/api/painel/mesas' && req.method === 'GET') {
      return json(res, 200, {
        mesas,
        baseUrl: config.baseUrl || '',
        sugestoes: urlsLocais(),
        // Endereço de rede recomendado: é o que o QR Code deve carregar, já que
        // "localhost" no QR só funcionaria no próprio computador.
        baseDeRede: baseDeRede(),
        rotaCaixa: ROTA_CAIXA,
        rotaAdmin: ROTA_ADMIN,
      });
    }

    if (rota === '/api/painel/mesas' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      const acao = corpo.acao;

      if (acao === 'adicionar') {
        const n = Number(corpo.numero);
        if (!Number.isInteger(n) || n < 1 || n > 999) return json(res, 400, { erro: 'Número de mesa inválido.' });
        if (mesas.some((m) => m.numero === n)) return json(res, 400, { erro: 'Essa mesa já existe.' });
        mesas.push({ numero: n, token: novoToken(9), ativa: true });
        mesas.sort((a, b) => a.numero - b.numero);
      } else if (acao === 'remover') {
        mesas = mesas.filter((m) => m.numero !== Number(corpo.numero));
      } else if (acao === 'alternar') {
        const mesa = mesas.find((m) => m.numero === Number(corpo.numero));
        if (mesa) mesa.ativa = !mesa.ativa;
      } else if (acao === 'regerar') {
        const mesa = mesas.find((m) => m.numero === Number(corpo.numero));
        if (mesa) mesa.token = novoToken(9);
      } else if (acao === 'baseUrl') {
        config.baseUrl = String(corpo.baseUrl || '').replace(/\/+$/, '');
        salvarJSON(ARQ_CONFIG, config);
      } else {
        return json(res, 400, { erro: 'Ação desconhecida.' });
      }

      salvarJSON(ARQ_MESAS, mesas);
      return json(res, 200, { ok: true, mesas, baseUrl: config.baseUrl || '' });
    }

    if (rota === '/api/painel/acesso' && req.method === 'GET') {
      return json(res, 200, {
        horario: config.horario,
        exigirLiberacao: !!config.exigirLiberacao,
        liberacaoMinutos: Number(config.liberacaoMinutos) || 90,
        maxPedidosMesaHora: Number(config.maxPedidosMesaHora) || 0,
        lojaAberta: lojaAberta().aberta,
        mesas: mesas.map((m) => ({
          numero: m.numero,
          ativa: m.ativa,
          liberadaAte: m.liberadaAte || null,
          liberada: mesaLiberada(m),
          pedidosNaHora: pedidosDaMesaNaUltimaHora(m.numero),
        })),
      });
    }

    if (rota === '/api/painel/acesso' && req.method === 'PUT') {
      const corpo = await lerCorpo(req);

      if (corpo.horario) {
        const h = corpo.horario;
        if (minutosDoDia(h.abre) === null || minutosDoDia(h.fecha) === null) {
          return json(res, 400, { erro: 'Horário inválido. Use o formato 10:00.' });
        }
        const dias = Array.isArray(h.dias) ? h.dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
        if (h.ativo && !dias.length) {
          return json(res, 400, { erro: 'Escolha ao menos um dia de funcionamento.' });
        }
        config.horario = { ativo: !!h.ativo, abre: h.abre, fecha: h.fecha, dias };
      }

      if (corpo.exigirLiberacao !== undefined) config.exigirLiberacao = !!corpo.exigirLiberacao;

      if (corpo.liberacaoMinutos !== undefined) {
        const minutos = Number(corpo.liberacaoMinutos);
        if (!Number.isInteger(minutos) || minutos < 5 || minutos > 720) {
          return json(res, 400, { erro: 'A validade da liberação deve ficar entre 5 e 720 minutos.' });
        }
        config.liberacaoMinutos = minutos;
      }

      if (corpo.maxPedidosMesaHora !== undefined) {
        const teto = Number(corpo.maxPedidosMesaHora);
        if (!Number.isInteger(teto) || teto < 0 || teto > 200) {
          return json(res, 400, { erro: 'O teto por mesa deve ficar entre 0 e 200.' });
        }
        config.maxPedidosMesaHora = teto;
      }

      salvarJSON(ARQ_CONFIG, config);
      emitir('acesso:atualizado', { mesa: null });
      return json(res, 200, { ok: true });
    }

    if (rota === '/api/painel/liberar-mesa' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      const mesa = mesas.find((m) => m.numero === Number(corpo.numero));
      if (!mesa) return json(res, 404, { erro: 'Mesa não encontrada.' });

      if (corpo.fechar) {
        delete mesa.liberadaAte;
      } else {
        const minutos = Number(config.liberacaoMinutos) || 90;
        mesa.liberadaAte = Date.now() + minutos * 60 * 1000;
      }
      salvarJSON(ARQ_MESAS, mesas);
      emitir('mesa:liberacao', { mesa: mesa.numero, liberada: mesaLiberada(mesa) });
      return json(res, 200, {
        ok: true,
        mesa: { numero: mesa.numero, liberadaAte: mesa.liberadaAte || null, liberada: mesaLiberada(mesa) },
      });
    }

    if (rota === '/api/painel/pin' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      const atual = hashPin(corpo.atual || '', config.pinSalt);
      if (!iguaisSeguro(atual.hash, config.pinHash)) return json(res, 401, { erro: 'PIN atual incorreto.' });
      const novo = String(corpo.novo || '');
      // Exposto na internet, quatro dígitos são só dez mil combinações: mesmo
      // com o bloqueio por tentativas, quem revezar IPs percorre isso em dias.
      // Aceitamos qualquer caractere para permitir uma frase no lugar do PIN.
      if (novo.length < 6 || novo.length > 64) {
        return json(res, 400, { erro: 'A nova senha deve ter de 6 a 64 caracteres.' });
      }
      if (/^\d+$/.test(novo) && novo.length < 8) {
        return json(res, 400, {
          erro: 'Só com números, use no mínimo 8 dígitos — ou misture letras para poder usar menos.',
        });
      }
      const gerado = hashPin(novo);
      config.pinSalt = gerado.salt;
      config.pinHash = gerado.hash;
      salvarJSON(ARQ_CONFIG, config);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { erro: 'Rota não encontrada.' });
  }

  return json(res, 404, { erro: 'Rota não encontrada.' });
}

function validarMenu(dados) {
  if (!dados || typeof dados !== 'object') return 'Formato inválido.';
  if (!dados.loja || typeof dados.loja.nome !== 'string') return 'Dados da loja inválidos.';
  if (!Array.isArray(dados.categorias) || dados.categorias.length === 0) return 'Inclua ao menos uma categoria.';
  const idsCategorias = new Set();
  for (const c of dados.categorias) {
    if (!c.id || typeof c.id !== 'string') return 'Categoria sem identificador.';
    if (idsCategorias.has(c.id)) return `Categoria duplicada: ${c.id}`;
    idsCategorias.add(c.id);
    if (!c.nome) return 'Categoria sem nome.';
    if (c.tipo !== 'unico' && c.tipo !== 'multiplo') return `Tipo inválido em "${c.nome}".`;
    if (!Array.isArray(c.opcoes)) return `Opções inválidas em "${c.nome}".`;
    const idsOpcoes = new Set();
    for (const o of c.opcoes) {
      if (!o.id || !o.nome) return `Opção incompleta em "${c.nome}".`;
      if (idsOpcoes.has(o.id)) return `Opção duplicada em "${c.nome}": ${o.id}`;
      idsOpcoes.add(o.id);
      if (typeof o.preco !== 'number' || o.preco < 0 || !isFinite(o.preco)) {
        return `Preço inválido em "${o.nome}".`;
      }
    }
  }
  return null;
}

/**
 * Endereços IPv4 desta máquina na rede, do mais provável para o menos.
 *
 * Descarta os "link-local" (169.254.x.x), que o Windows inventa quando uma
 * placa não conseguiu IP: eles aparecem na lista do sistema mas nenhum celular
 * alcança. É por isso que o endereço bom precisa vir ordenado na frente.
 */
function ipsDaRede() {
  const encontrados = [];
  const interfaces = os.networkInterfaces();
  Object.keys(interfaces).forEach((nome) => {
    (interfaces[nome] || []).forEach((rede) => {
      if (rede.family !== 'IPv4' || rede.internal) return;
      if (rede.address.startsWith('169.254.')) return;
      encontrados.push(rede.address);
    });
  });

  // Redes domésticas típicas primeiro (192.168.x.x), depois as demais privadas.
  const peso = (ip) => {
    if (ip.startsWith('192.168.')) return 0;
    if (ip.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    return 3;
  };
  return encontrados.sort((a, b) => peso(a) - peso(b));
}

/** O melhor endereço para o celular do cliente usar, ou null se não houver. */
function baseDeRede() {
  const ips = ipsDaRede();
  return ips.length ? `http://${ips[0]}:${PORT}` : null;
}

function urlsLocais() {
  const saida = ipsDaRede().map((ip) => `http://${ip}:${PORT}`);
  saida.push(`http://localhost:${PORT}`);
  return saida;
}

/* ------------------------------------------------------------------ */
/* Arquivos estáticos                                                  */
/* ------------------------------------------------------------------ */

/**
 * Entrega uma página do painel. Os arquivos ficam fora de /public justamente
 * para não existir um segundo endereço (tipo /caixa.html) contornando a rota
 * secreta. Os marcadores viram os endereços reais na hora de servir.
 */
function servirPainel(res, arquivo) {
  fs.readFile(path.join(PRIVADO_DIR, arquivo), 'utf8', (erro, conteudo) => {
    if (erro) {
      responder(res, 500, 'Página indisponível.', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    const pronto = conteudo
      .split('{{ROTA_CAIXA}}')
      .join(ROTA_CAIXA)
      .split('{{ROTA_ADMIN}}')
      .join(ROTA_ADMIN);
    responder(res, 200, pronto, { 'Content-Type': 'text/html; charset=utf-8' });
  });
}

function servirEstatico(req, res, url) {
  let relativo = decodeURIComponent(url.pathname);
  if (relativo === '/') relativo = '/index.html';
  if (relativo.endsWith('/')) relativo += 'index.html';
  if (!path.extname(relativo)) relativo += '.html';

  const destino = path.join(PUBLIC_DIR, path.normalize(relativo).replace(/^([\\/])+/, ''));
  if (!destino.startsWith(PUBLIC_DIR)) return responder(res, 403, 'Acesso negado.');

  fs.readFile(destino, (erro, conteudo) => {
    if (erro) {
      responder(res, 404, 'Página não encontrada.', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    const tipo = MIME[path.extname(destino).toLowerCase()] || 'application/octet-stream';
    responder(res, 200, conteudo, { 'Content-Type': tipo });
  });
}

/* ------------------------------------------------------------------ */
/* Servidor                                                            */
/* ------------------------------------------------------------------ */

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Todo o front é local: nada de CDN, fonte externa ou script embutido.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  if (conexaoSegura(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  if (url.pathname.startsWith('/api/')) {
    rotaAPI(req, res, url).catch((erro) => {
      json(res, 400, { erro: erro.message || 'Requisição inválida.' });
    });
    return;
  }

  const caminho = url.pathname.replace(/\/+$/, '');
  if (caminho === `/${ROTA_CAIXA}`) return servirPainel(res, 'caixa.html');
  if (caminho === `/${ROTA_ADMIN}`) return servirPainel(res, 'admin.html');

  servirEstatico(req, res, url);
});

servidor.listen(PORT, () => {
  console.log('');
  console.log('  \x1b[45m\x1b[97m  AÇAÍ DEMO  \x1b[0m  servidor de pedidos no ar');
  console.log('');

  const rede = baseDeRede();
  const par = (base) => {
    console.log(`    Caixa .......... ${base}/${ROTA_CAIXA}`);
    console.log(`    Administração .. ${base}/${ROTA_ADMIN}`);
  };

  console.log('  Neste computador:');
  par(`http://localhost:${PORT}`);

  if (rede) {
    console.log('');
    console.log('  Na rede da loja (outro PC, tablet, celular — mesmo Wi-Fi):');
    par(rede);
    const outros = ipsDaRede().slice(1);
    if (outros.length) {
      console.log(`    Outras interfaces: ${outros.map((ip) => `http://${ip}:${PORT}`).join('  ')}`);
    }
  } else {
    console.log('');
    console.log('  \x1b[43m\x1b[30m  SEM REDE  \x1b[0m Nenhum IP de rede encontrado nesta máquina.');
    console.log('  Os QR Codes das mesas não vão funcionar até haver conexão de rede.');
  }

  console.log('');
  console.log('  Guarde esses endereços: eles não aparecem em nenhum link público.');
  console.log('');
  console.log(`  Dados em ....... ${DATA_DIR}`);
  console.log(`  Atrás de proxy . ${CONFIAR_PROXY ? 'sim (TRUST_PROXY=1)' : 'não'}`);
  console.log('');
  console.log('  Clientes só entram pelo link do QR Code de cada mesa.');

  const { hash } = hashPin(SENHA_DEMO, config.pinSalt);
  if (iguaisSeguro(hash, config.pinHash)) {
    console.log('');
    console.log('  \x1b[43m\x1b[30m  ATENÇÃO  \x1b[0m Senha de demonstração em uso (demo1234).');
    console.log('  Troque em Administração > Segurança antes de publicar na internet.');
  }
  console.log('');
});
