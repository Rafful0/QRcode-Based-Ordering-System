/**
 * Açaí Demo — fluxo de pedido do cliente.
 *
 * Só funciona com o par mesa + token vindo do QR Code. Todo o preço mostrado
 * aqui é apenas uma prévia: o servidor recalcula tudo a partir do cardápio.
 */
(function () {
  'use strict';

  const parametros = new URLSearchParams(location.search);
  const MESA = parametros.get('m');
  const TOKEN = parametros.get('t');
  const CHAVE_RASCUNHO = `rascunho-pedido-${MESA}`;

  const dinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatar = (valor) => dinheiro.format(valor || 0);

  const $ = (id) => document.getElementById(id);

  const estado = {
    menu: null,
    quantidade: 1,
    itens: [],
    indiceAtual: 0,
    pedidoEnviado: null,
    enviando: false,
  };

  /* ---------------- Utilidades de tela ---------------- */

  const telas = ['telaInicio', 'telaMontagem', 'telaRevisao', 'telaConfirmacao'];

  function mostrarTela(alvo) {
    telas.forEach((id) => $(id).classList.toggle('oculto', id !== alvo));
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    const progresso = { telaInicio: 12, telaMontagem: 55, telaRevisao: 85, telaConfirmacao: 100 };
    $('barraProgresso').style.width = progresso[alvo] + '%';
  }

  let tempoNotificacao = null;
  function notificar(texto, tipo) {
    const el = $('notificacao');
    el.textContent = texto;
    el.classList.toggle('notificacao--erro', tipo === 'erro');
    el.classList.add('notificacao--visivel');
    clearTimeout(tempoNotificacao);
    tempoNotificacao = setTimeout(() => el.classList.remove('notificacao--visivel'), 3600);
  }

  function mostrarAviso(containerId, texto, tipo) {
    const alvo = $(containerId);
    if (!texto) {
      alvo.innerHTML = '';
      return;
    }
    alvo.innerHTML = `<div class="aviso aviso--${tipo || 'erro'}"></div>`;
    alvo.firstChild.textContent = texto;
  }

  /** Aparência da tela de bloqueio conforme o motivo. */
  const APARENCIA_BLOQUEIO = {
    fechado: { emoji: '🌙', titulo: 'Loja fechada', tentar: true },
    nao_liberada: { emoji: '🙋', titulo: 'Mesa ainda não liberada', tentar: true },
    limite: { emoji: '⏳', titulo: 'Limite de pedidos atingido', tentar: true },
    sem_acesso: { emoji: '🔒', titulo: 'Acesso pelo QR Code', tentar: false },
    offline: { emoji: '📡', titulo: 'Sem conexão com a loja', tentar: true },
  };

  function bloquear(mensagem, codigo) {
    const aparencia = APARENCIA_BLOQUEIO[codigo] || APARENCIA_BLOQUEIO.sem_acesso;
    $('app').classList.add('oculto');
    $('telaBloqueio').classList.remove('oculto');
    $('emojiBloqueio').textContent = aparencia.emoji;
    $('tituloBloqueio').textContent = aparencia.titulo;
    if (mensagem) $('mensagemBloqueio').textContent = mensagem;

    // Só oferece "tentar de novo" quando a situação pode mudar sozinha —
    // sem QR válido, recarregar não adianta nada.
    const botao = $('botaoTentarDeNovo');
    botao.classList.toggle('oculto', !aparencia.tentar);
  }

  function desbloquear() {
    $('telaBloqueio').classList.add('oculto');
    $('app').classList.remove('oculto');
  }

  /* ---------------- Cálculo de preço (espelha o servidor) ---------------- */

  /** Devolve as opções escolhidas de uma categoria, na ordem do cardápio. */
  function selecionadasDaCategoria(item, categoria) {
    const escolhidos = (item.escolhas && item.escolhas[categoria.id]) || [];
    return categoria.opcoes.filter((o) => escolhidos.includes(o.id));
  }

  /** Mapa opcaoId -> true para as opções que entram na cota de cortesia. */
  function cortesias(item, categoria) {
    const gratis = Number(categoria.gratis) || 0;
    const mapa = {};
    selecionadasDaCategoria(item, categoria).forEach((opcao, indice) => {
      if (indice < gratis) mapa[opcao.id] = true;
    });
    return mapa;
  }

  function precoDoItem(item) {
    let total = 0;
    estado.menu.categorias.forEach((categoria) => {
      const livres = cortesias(item, categoria);
      selecionadasDaCategoria(item, categoria).forEach((opcao) => {
        if (!livres[opcao.id]) total += Number(opcao.preco) || 0;
      });
    });
    return Math.round(total * 100) / 100;
  }

  function totalDoPedido() {
    return Math.round(estado.itens.reduce((soma, item) => soma + precoDoItem(item), 0) * 100) / 100;
  }

  /** Categorias obrigatórias sem escolha. */
  function pendencias(item) {
    return estado.menu.categorias
      .filter((c) => c.obrigatorio && selecionadasDaCategoria(item, c).length === 0)
      .map((c) => c.nome);
  }

  /* ---------------- Rascunho ---------------- */

  function salvarRascunho() {
    try {
      sessionStorage.setItem(
        CHAVE_RASCUNHO,
        JSON.stringify({ quantidade: estado.quantidade, itens: estado.itens })
      );
    } catch (e) {
      /* modo privado ou storage cheio: seguir sem rascunho */
    }
  }

  function limparRascunho() {
    try {
      sessionStorage.removeItem(CHAVE_RASCUNHO);
    } catch (e) {
      /* ignora */
    }
  }

  function carregarRascunho() {
    try {
      const bruto = sessionStorage.getItem(CHAVE_RASCUNHO);
      if (!bruto) return null;
      const dados = JSON.parse(bruto);
      if (!Array.isArray(dados.itens) || !dados.itens.length) return null;
      return dados;
    } catch (e) {
      return null;
    }
  }

  /* ---------------- Passo 1: quantidade ---------------- */

  const MAX_ACAIS = 12;

  function atualizarQuantidade() {
    $('valorQuantidade').textContent = estado.quantidade;
    $('legendaQuantidade').textContent = estado.quantidade === 1 ? 'açaí' : 'açaís';
    $('botaoMenos').disabled = estado.quantidade <= 1;
    $('botaoMais').disabled = estado.quantidade >= MAX_ACAIS;
    document.querySelectorAll('#atalhosQuantidade .atalho').forEach((botao) => {
      botao.setAttribute('aria-pressed', Number(botao.dataset.valor) === estado.quantidade);
    });
  }

  function montarAtalhos() {
    const container = $('atalhosQuantidade');
    container.innerHTML = '';
    [1, 2, 3, 4, 5, 6].forEach((valor) => {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'atalho';
      botao.dataset.valor = valor;
      botao.textContent = valor + (valor === 1 ? ' açaí' : ' açaís');
      botao.addEventListener('click', () => {
        estado.quantidade = valor;
        atualizarQuantidade();
      });
      container.appendChild(botao);
    });
  }

  /* ---------------- Passo 2: montagem ---------------- */

  function itemVazio() {
    return { escolhas: {}, obs: '' };
  }

  function prepararItens() {
    const novos = [];
    for (let i = 0; i < estado.quantidade; i++) {
      novos.push(estado.itens[i] || itemVazio());
    }
    estado.itens = novos;
  }

  function textoLimite(categoria) {
    const partes = [];
    const gratis = Number(categoria.gratis) || 0;
    if (gratis > 0) partes.push(`${gratis} ${gratis === 1 ? 'item incluso' : 'itens inclusos'}`);
    if (categoria.tipo === 'multiplo' && categoria.max) partes.push(`até ${categoria.max}`);
    return partes.join(' · ');
  }

  function renderizarCategorias() {
    const item = estado.itens[estado.indiceAtual];
    const container = $('categorias');
    container.innerHTML = '';

    estado.menu.categorias.forEach((categoria) => {
      const unica = categoria.tipo === 'unico';
      const grupo = document.createElement('section');
      grupo.className = 'grupo';

      const topo = document.createElement('div');
      topo.className = 'grupo__topo';

      const bloco = document.createElement('div');
      const titulo = document.createElement('h3');
      titulo.className = 'grupo__titulo';
      titulo.textContent = categoria.nome;
      bloco.appendChild(titulo);
      if (categoria.descricao) {
        const ajuda = document.createElement('p');
        ajuda.className = 'grupo__ajuda';
        ajuda.textContent = categoria.descricao;
        bloco.appendChild(ajuda);
      }
      topo.appendChild(bloco);

      const etiquetas = document.createElement('div');
      etiquetas.className = 'grupo__etiquetas';
      const etiqueta = document.createElement('span');
      etiqueta.className = categoria.obrigatorio ? 'etiqueta etiqueta--obrigatorio' : 'etiqueta etiqueta--opcional';
      etiqueta.textContent = categoria.obrigatorio ? 'Obrigatório' : 'Opcional';
      etiquetas.appendChild(etiqueta);
      const limite = textoLimite(categoria);
      if (limite) {
        const marca = document.createElement('span');
        marca.className = 'etiqueta etiqueta--limite';
        marca.textContent = limite;
        etiquetas.appendChild(marca);
      }
      topo.appendChild(etiquetas);
      grupo.appendChild(topo);

      const lista = document.createElement('div');
      lista.className = 'opcoes';

      categoria.opcoes.forEach((opcao) => {
        const escolhidos = item.escolhas[categoria.id] || [];
        const marcado = escolhidos.includes(opcao.id);

        const rotulo = document.createElement('label');
        rotulo.className = 'opcao' + (unica ? ' opcao--unica' : '');
        rotulo.dataset.categoria = categoria.id;
        rotulo.dataset.opcao = opcao.id;

        const entrada = document.createElement('input');
        entrada.type = unica ? 'radio' : 'checkbox';
        entrada.name = `${categoria.id}-${estado.indiceAtual}`;
        entrada.value = opcao.id;
        entrada.checked = marcado;
        entrada.addEventListener('change', () => alternarOpcao(categoria, opcao, entrada.checked));

        const marcador = document.createElement('span');
        marcador.className = 'marcador';
        marcador.setAttribute('aria-hidden', 'true');

        const texto = document.createElement('span');
        texto.className = 'opcao__texto';
        const nome = document.createElement('span');
        nome.className = 'opcao__nome';
        nome.textContent = opcao.nome;
        const preco = document.createElement('span');
        preco.className = 'opcao__preco';
        preco.dataset.precoDe = `${categoria.id}:${opcao.id}`;
        texto.appendChild(nome);
        texto.appendChild(preco);

        rotulo.appendChild(entrada);
        rotulo.appendChild(marcador);
        rotulo.appendChild(texto);
        lista.appendChild(rotulo);
      });

      grupo.appendChild(lista);
      container.appendChild(grupo);
    });

    $('campoObservacao').value = item.obs || '';
    atualizarEstadoVisual();
  }

  function alternarOpcao(categoria, opcao, marcado) {
    const item = estado.itens[estado.indiceAtual];
    if (!item.escolhas[categoria.id]) item.escolhas[categoria.id] = [];

    if (categoria.tipo === 'unico') {
      item.escolhas[categoria.id] = marcado ? [opcao.id] : [];
    } else {
      const atual = item.escolhas[categoria.id];
      if (marcado) {
        const max = Number(categoria.max) || categoria.opcoes.length;
        if (atual.length >= max) {
          notificar(`Você já escolheu o máximo de ${max} em ${categoria.nome}.`, 'erro');
          renderizarCategorias();
          return;
        }
        if (!atual.includes(opcao.id)) atual.push(opcao.id);
      } else {
        item.escolhas[categoria.id] = atual.filter((id) => id !== opcao.id);
      }
    }

    mostrarAviso('avisoMontagem', '');
    atualizarEstadoVisual();
    salvarRascunho();
  }

  /** Atualiza preços exibidos, bloqueios de limite e o rodapé. */
  function atualizarEstadoVisual() {
    const item = estado.itens[estado.indiceAtual];

    estado.menu.categorias.forEach((categoria) => {
      const livres = cortesias(item, categoria);
      const escolhidos = item.escolhas[categoria.id] || [];
      const max = Number(categoria.max) || categoria.opcoes.length;
      const cheio = categoria.tipo === 'multiplo' && escolhidos.length >= max;
      const gratis = Number(categoria.gratis) || 0;
      const cotaLivre = escolhidos.length < gratis;

      categoria.opcoes.forEach((opcao) => {
        const seletor = `[data-preco-de="${CSS.escape(categoria.id + ':' + opcao.id)}"]`;
        const alvo = document.querySelector(seletor);
        if (!alvo) return;

        const marcado = escolhidos.includes(opcao.id);
        const semCusto = marcado ? livres[opcao.id] : cotaLivre;

        if (Number(opcao.preco) === 0) {
          alvo.textContent = 'Incluso';
          alvo.className = 'opcao__preco opcao__preco--gratis';
        } else if (semCusto) {
          alvo.textContent = 'Incluso';
          alvo.className = 'opcao__preco opcao__preco--gratis';
        } else {
          alvo.textContent = '+ ' + formatar(opcao.preco);
          alvo.className = 'opcao__preco';
        }

        const rotulo = document.querySelector(
          `.opcao[data-categoria="${CSS.escape(categoria.id)}"][data-opcao="${CSS.escape(opcao.id)}"]`
        );
        if (rotulo) {
          const bloqueada = cheio && !marcado;
          rotulo.classList.toggle('opcao--marcada', marcado);
          rotulo.classList.toggle('opcao--bloqueada', bloqueada);
          rotulo.querySelector('input').disabled = bloqueada;
        }
      });
    });

    $('precoItemAtual').textContent = formatar(precoDoItem(item));
    renderizarTrilha();

    const ultimo = estado.indiceAtual === estado.itens.length - 1;
    $('botaoAvancar').textContent = ultimo ? 'Revisar pedido →' : 'Próximo açaí →';
    $('botaoVoltarMontagem').textContent = estado.indiceAtual === 0 ? '← Quantidade' : '← Anterior';

    $('tituloMontagem').textContent = `Açaí ${estado.indiceAtual + 1}`;
    $('subtituloMontagem').textContent =
      estado.itens.length > 1
        ? `Personalizando o açaí ${estado.indiceAtual + 1} de ${estado.itens.length}.`
        : 'Escolha as opções abaixo.';
  }

  function renderizarTrilha() {
    const trilha = $('trilhaAcais');
    trilha.innerHTML = '';
    if (estado.itens.length < 2) return;

    estado.itens.forEach((item, indice) => {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'trilha__item';
      if (indice === estado.indiceAtual) botao.setAttribute('aria-current', 'true');
      else if (pendencias(item).length === 0) botao.classList.add('trilha__item--completo');
      botao.textContent = `Açaí ${indice + 1}`;
      botao.addEventListener('click', () => {
        guardarObservacao();
        estado.indiceAtual = indice;
        mostrarAviso('avisoMontagem', '');
        renderizarCategorias();
      });
      trilha.appendChild(botao);
    });
  }

  function guardarObservacao() {
    const item = estado.itens[estado.indiceAtual];
    if (item) item.obs = $('campoObservacao').value.trim();
  }

  /* ---------------- Passo 3: revisão ---------------- */

  function renderizarRevisao() {
    const lista = $('listaRevisao');
    lista.innerHTML = '';

    estado.itens.forEach((item, indice) => {
      const cartao = document.createElement('article');
      cartao.className = 'resumo-item';

      const topo = document.createElement('div');
      topo.className = 'resumo-item__topo';

      const identificacao = document.createElement('span');
      identificacao.className = 'resumo-item__indice';
      const bolha = document.createElement('span');
      bolha.className = 'bolha';
      bolha.textContent = indice + 1;
      identificacao.appendChild(bolha);
      identificacao.appendChild(document.createTextNode(`Açaí ${indice + 1}`));

      const editar = document.createElement('button');
      editar.type = 'button';
      editar.className = 'botao botao--fantasma botao--pequeno';
      editar.textContent = 'Editar';
      editar.addEventListener('click', () => {
        estado.indiceAtual = indice;
        renderizarCategorias();
        mostrarTela('telaMontagem');
      });

      topo.appendChild(identificacao);
      topo.appendChild(editar);
      cartao.appendChild(topo);

      estado.menu.categorias.forEach((categoria) => {
        const selecionadas = selecionadasDaCategoria(item, categoria);
        if (!selecionadas.length) return;
        const livres = cortesias(item, categoria);

        const linha = document.createElement('div');
        linha.className = 'resumo-linha';

        const rotulo = document.createElement('span');
        rotulo.className = 'resumo-linha__rotulo';
        rotulo.textContent = categoria.nome;

        const valor = document.createElement('span');
        valor.className = 'resumo-linha__valor';
        valor.textContent = selecionadas
          .map((o) => {
            const custo = livres[o.id] || Number(o.preco) === 0 ? '' : ` (+${formatar(o.preco)})`;
            return o.nome + custo;
          })
          .join(', ');

        linha.appendChild(rotulo);
        linha.appendChild(valor);
        cartao.appendChild(linha);
      });

      if (item.obs) {
        const linha = document.createElement('div');
        linha.className = 'resumo-linha';
        const rotulo = document.createElement('span');
        rotulo.className = 'resumo-linha__rotulo';
        rotulo.textContent = 'Observação';
        const valor = document.createElement('span');
        valor.className = 'resumo-linha__valor';
        valor.textContent = item.obs;
        linha.appendChild(rotulo);
        linha.appendChild(valor);
        cartao.appendChild(linha);
      }

      const rodape = document.createElement('div');
      rodape.className = 'resumo-item__rodape';
      rodape.appendChild(document.createTextNode('Subtotal'));
      const subtotal = document.createElement('span');
      subtotal.textContent = formatar(precoDoItem(item));
      rodape.appendChild(subtotal);
      cartao.appendChild(rodape);

      lista.appendChild(cartao);
    });

    $('totalPedido').textContent = formatar(totalDoPedido());
  }

  /* ---------------- Envio ---------------- */

  async function enviarPedido() {
    if (estado.enviando) return;

    for (let i = 0; i < estado.itens.length; i++) {
      const faltando = pendencias(estado.itens[i]);
      if (faltando.length) {
        mostrarAviso('avisoRevisao', `No açaí ${i + 1} falta escolher: ${faltando.join(', ')}.`, 'erro');
        estado.indiceAtual = i;
        return;
      }
    }

    estado.enviando = true;
    $('botaoEnviar').disabled = true;
    $('botaoEnviar').textContent = 'Enviando…';

    try {
      const resposta = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mesa: Number(MESA),
          token: TOKEN,
          cliente: $('campoNome').value.trim(),
          itens: estado.itens.map((item) => ({ escolhas: item.escolhas, obs: item.obs })),
        }),
      });

      const dados = await resposta.json();

      // A loja pode ter fechado, ou a liberação expirado, com a tela aberta.
      // Nesse caso não adianta mostrar um aviso no rodapé: o pedido não vai
      // sair, e o cliente precisa saber o motivo.
      if (resposta.status === 403 && dados.codigo) {
        bloquear(dados.erro, dados.codigo);
        ligarBotaoTentarDeNovo();
        acompanharLiberacao();
        return;
      }

      if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível enviar o pedido.');

      estado.pedidoEnviado = dados.pedido;
      limparRascunho();
      $('numeroPedido').textContent = '#' + String(dados.pedido.numero).padStart(3, '0');
      $('totalConfirmado').textContent = formatar(dados.pedido.total);
      if (estado.menu.loja.mensagemFinal) {
        $('mensagemConfirmacao').textContent = estado.menu.loja.mensagemFinal;
      }
      pintarStatus('novo');
      mostrarTela('telaConfirmacao');
      notificar('Pedido enviado para o caixa!');
    } catch (erro) {
      mostrarAviso('avisoRevisao', erro.message, 'erro');
      notificar(erro.message, 'erro');
    } finally {
      estado.enviando = false;
      $('botaoEnviar').disabled = false;
      $('botaoEnviar').textContent = 'Enviar pedido';
    }
  }

  const ORDEM_STATUS = ['novo', 'preparo', 'pronto', 'entregue'];

  function pintarStatus(status) {
    const posicao = ORDEM_STATUS.indexOf(status);
    document.querySelectorAll('#linhaStatus .etapa').forEach((etapa) => {
      const indice = ORDEM_STATUS.indexOf(etapa.dataset.etapa);
      etapa.classList.toggle('etapa--ativa', posicao >= 0 && indice <= posicao);
    });

    if (status === 'cancelado') {
      $('mensagemConfirmacao').textContent = 'Este pedido foi cancelado. Fale com o caixa.';
    } else if (status === 'pronto') {
      $('mensagemConfirmacao').textContent = 'Seu açaí está pronto! 🎉';
    } else if (status === 'entregue') {
      $('mensagemConfirmacao').textContent = 'Pedido entregue. Bom apetite!';
    }
  }

  function acompanharStatus() {
    const fonte = new EventSource(
      `/api/stream-mesa?m=${encodeURIComponent(MESA)}&t=${encodeURIComponent(TOKEN)}`
    );
    fonte.addEventListener('pedido:status', (evento) => {
      try {
        const pedido = JSON.parse(evento.data);
        if (estado.pedidoEnviado && pedido.id === estado.pedidoEnviado.id) {
          pintarStatus(pedido.status);
          notificar('Status atualizado: ' + rotuloStatus(pedido.status));
        }
      } catch (e) {
        /* evento malformado: ignora */
      }
    });
  }

  function rotuloStatus(status) {
    return (
      { novo: 'recebido', preparo: 'em preparo', pronto: 'pronto', entregue: 'entregue', cancelado: 'cancelado' }[
        status
      ] || status
    );
  }

  /* ---------------- Ligações da interface ---------------- */

  function ligarEventos() {
    $('botaoMenos').addEventListener('click', () => {
      if (estado.quantidade > 1) estado.quantidade--;
      atualizarQuantidade();
    });

    $('botaoMais').addEventListener('click', () => {
      if (estado.quantidade < MAX_ACAIS) estado.quantidade++;
      atualizarQuantidade();
    });

    $('botaoComecar').addEventListener('click', () => {
      prepararItens();
      estado.indiceAtual = 0;
      renderizarCategorias();
      mostrarTela('telaMontagem');
      salvarRascunho();
    });

    $('campoObservacao').addEventListener('input', () => {
      guardarObservacao();
      salvarRascunho();
    });

    $('botaoAvancar').addEventListener('click', () => {
      guardarObservacao();
      const item = estado.itens[estado.indiceAtual];
      const faltando = pendencias(item);
      if (faltando.length) {
        mostrarAviso('avisoMontagem', `Falta escolher: ${faltando.join(', ')}.`, 'erro');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      mostrarAviso('avisoMontagem', '');
      salvarRascunho();

      if (estado.indiceAtual < estado.itens.length - 1) {
        estado.indiceAtual++;
        renderizarCategorias();
      } else {
        renderizarRevisao();
        mostrarTela('telaRevisao');
      }
    });

    $('botaoVoltarMontagem').addEventListener('click', () => {
      guardarObservacao();
      if (estado.indiceAtual === 0) {
        mostrarTela('telaInicio');
      } else {
        estado.indiceAtual--;
        renderizarCategorias();
      }
    });

    $('botaoVoltarRevisao').addEventListener('click', () => {
      estado.indiceAtual = estado.itens.length - 1;
      renderizarCategorias();
      mostrarTela('telaMontagem');
    });

    $('botaoEnviar').addEventListener('click', enviarPedido);

    $('botaoNovoPedido').addEventListener('click', () => {
      estado.itens = [];
      estado.quantidade = 1;
      estado.indiceAtual = 0;
      estado.pedidoEnviado = null;
      $('campoNome').value = '';
      mostrarAviso('avisoRevisao', '');
      atualizarQuantidade();
      mostrarTela('telaInicio');
    });
  }

  /* ---------------- Início ---------------- */

  let religando = false;

  function ligarBotaoTentarDeNovo() {
    const botao = $('botaoTentarDeNovo');
    if (botao.dataset.ligado) return;
    botao.dataset.ligado = '1';
    botao.addEventListener('click', () => {
      botao.disabled = true;
      botao.textContent = 'Verificando…';
      iniciar().finally(() => {
        botao.disabled = false;
        botao.textContent = 'Tentar de novo';
      });
    });
  }

  /**
   * Enquanto a mesa estiver bloqueada, escuta o aviso do caixa. Assim, no
   * momento em que o atendente libera, a tela do cliente destrava sozinha.
   */
  function acompanharLiberacao() {
    if (religando) return;
    religando = true;
    const fonte = new EventSource(
      `/api/stream-mesa?m=${encodeURIComponent(MESA)}&t=${encodeURIComponent(TOKEN)}`
    );
    const reagir = () => {
      fonte.close();
      religando = false;
      iniciar();
    };
    fonte.addEventListener('mesa:liberacao', reagir);
    fonte.addEventListener('acesso:atualizado', reagir);
    fonte.addEventListener('error', () => {
      /* o EventSource reconecta sozinho */
    });
  }

  async function iniciar() {
    if (!MESA || !TOKEN) {
      bloquear();
      return;
    }

    let dados;
    try {
      const resposta = await fetch(
        `/api/menu?m=${encodeURIComponent(MESA)}&t=${encodeURIComponent(TOKEN)}`
      );
      dados = await resposta.json();
      if (!resposta.ok) {
        bloquear(dados.erro, 'sem_acesso');
        return;
      }
    } catch (erro) {
      bloquear('Não conseguimos falar com a loja. Chame um atendente, por favor.', 'offline');
      return;
    }

    // A mesa é válida, mas a loja pode estar fechada ou a mesa não liberada.
    if (dados.bloqueio) {
      bloquear(dados.bloqueio.erro, dados.bloqueio.codigo);
      ligarBotaoTentarDeNovo();
      acompanharLiberacao();
      return;
    }

    estado.menu = dados;
    desbloquear();
    $('seloMesa').textContent = 'Mesa ' + dados.mesa;
    document.title = `${dados.loja.nome} — Mesa ${dados.mesa}`;
    if (dados.loja.slogan) $('sloganLoja').textContent = dados.loja.slogan;

    montarAtalhos();
    ligarEventos();

    const rascunho = carregarRascunho();
    if (rascunho) {
      estado.quantidade = Math.min(MAX_ACAIS, Math.max(1, Number(rascunho.quantidade) || 1));
      estado.itens = rascunho.itens.map((item) => ({
        escolhas: item && typeof item.escolhas === 'object' ? item.escolhas : {},
        obs: typeof item.obs === 'string' ? item.obs : '',
      }));
    }

    atualizarQuantidade();
    mostrarTela('telaInicio');
    acompanharStatus();
  }

  iniciar();
})();
