/**
 * Açaí Demo — utilidades compartilhadas pelo caixa e pela administração.
 * Cuida do login por PIN, das chamadas à API e das notificações.
 */
(function (global) {
  'use strict';

  const dinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function formatar(valor) {
    return dinheiro.format(valor || 0);
  }

  function hora(iso) {
    try {
      return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '--:--';
    }
  }

  async function api(caminho, opcoes) {
    const cfg = Object.assign({ headers: {} }, opcoes || {});
    if (cfg.corpo !== undefined) {
      cfg.method = cfg.method || 'POST';
      cfg.headers['Content-Type'] = 'application/json';
      cfg.body = JSON.stringify(cfg.corpo);
      delete cfg.corpo;
    }
    const resposta = await fetch(caminho, cfg);
    let dados = {};
    try {
      dados = await resposta.json();
    } catch (e) {
      dados = {};
    }
    if (resposta.status === 401) {
      mostrarLogin();
      throw new Error(dados.erro || 'Sessão expirada.');
    }
    if (!resposta.ok) throw new Error(dados.erro || 'Falha na operação.');
    return dados;
  }

  let tempoNotificacao = null;
  function notificar(texto, tipo) {
    let el = document.getElementById('notificacao');
    if (!el) {
      el = document.createElement('div');
      el.id = 'notificacao';
      el.className = 'notificacao';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = texto;
    el.classList.toggle('notificacao--erro', tipo === 'erro');
    el.classList.add('notificacao--visivel');
    clearTimeout(tempoNotificacao);
    tempoNotificacao = setTimeout(() => el.classList.remove('notificacao--visivel'), 3600);
  }

  /* ---------------- Login ---------------- */

  let aoAutenticar = null;

  function mostrarLogin() {
    if (document.getElementById('telaLogin')) return;

    const tela = document.createElement('div');
    tela.className = 'tela-login';
    tela.id = 'telaLogin';
    tela.innerHTML = [
      '<form class="cartao-login" id="formLogin">',
      '  <span class="marca marca--escura">',
      '    <span class="marca__primaria" style="color:#ffd400">Açaí</span>',
      '    <span class="marca__secundaria">Demo</span>',
      '  </span>',
      '  <h1>Área da loja</h1>',
      '  <p>Digite a senha para abrir o caixa e a administração.</p>',
      '  <input class="entrada-pin" id="campoPin" type="password"',
      '         autocomplete="current-password" maxlength="64" aria-label="Senha de acesso" />',
      '  <div id="avisoLogin"></div>',
      '  <button class="botao botao--principal botao--largo" type="submit">Entrar</button>',
      '</form>',
    ].join('\n');

    document.body.appendChild(tela);
    const campo = document.getElementById('campoPin');
    campo.focus();

    document.getElementById('formLogin').addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const aviso = document.getElementById('avisoLogin');
      aviso.innerHTML = '';
      try {
        const resposta = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: campo.value }),
        });
        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.erro || 'PIN incorreto.');
        tela.remove();
        if (aoAutenticar) aoAutenticar();
      } catch (erro) {
        const caixa = document.createElement('div');
        caixa.className = 'aviso aviso--erro';
        caixa.textContent = erro.message;
        aviso.appendChild(caixa);
        campo.value = '';
        campo.focus();
      }
    });
  }

  /** Garante que a sessão existe; se não, pede o PIN e só então executa `callback`. */
  async function comSessao(callback) {
    aoAutenticar = callback;
    try {
      const dados = await (await fetch('/api/sessao')).json();
      if (dados.autenticado) {
        callback();
      } else {
        mostrarLogin();
      }
    } catch (erro) {
      mostrarLogin();
    }
  }

  async function sair() {
    await fetch('/api/logout', { method: 'POST' });
    location.reload();
  }

  /* ---------------- Conexão em tempo real ---------------- */

  /**
   * Abre o fluxo SSE do painel e devolve a instância. `aoEvento` recebe
   * (nomeDoEvento, dados). O ponto de conexão no cabeçalho reflete o estado.
   */
  function conectarPainel(aoEvento) {
    const fonte = new EventSource('/api/painel/stream');
    const ponto = document.getElementById('pontoConexao');
    const rotulo = document.getElementById('rotuloConexao');

    const marcar = (ativo) => {
      if (ponto) ponto.classList.toggle('ponto-conexao--ativo', ativo);
      if (rotulo) rotulo.textContent = ativo ? 'Conectado' : 'Reconectando…';
    };

    fonte.addEventListener('open', () => marcar(true));
    fonte.addEventListener('error', () => marcar(false));

    // SSE entrega por nome de evento: o que não estiver nesta lista simplesmente
    // não chega ao painel, mesmo o servidor tendo emitido.
    const EVENTOS = [
      'pedido:novo',
      'pedido:status',
      'menu:atualizado',
      'mesa:liberacao',
      'acesso:atualizado',
    ];

    EVENTOS.forEach((nome) => {
      fonte.addEventListener(nome, (evento) => {
        let dados = null;
        try {
          dados = JSON.parse(evento.data);
        } catch (e) {
          return;
        }
        aoEvento(nome, dados);
      });
    });

    return fonte;
  }

  global.Painel = { api, comSessao, sair, notificar, formatar, hora, conectarPainel, mostrarLogin };
})(window);
