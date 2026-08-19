/**
 * Açaí Demo — painel do caixa.
 * Recebe os pedidos em tempo real e controla o andamento de cada um.
 */
(function () {
  'use strict';

  const { api, comSessao, sair, notificar, formatar, hora, conectarPainel } = window.Painel;
  const $ = (id) => document.getElementById(id);

  const CHAVE_FILTROS = 'filtros-caixa';

  const estado = {
    pedidos: [],
    somLigado: true,
    recemChegados: new Set(),
    acesso: null,
    filtros: {
      // Etapas visíveis. Vazio nunca acontece: desmarcar a última religa todas.
      etapas: new Set(['novo', 'preparo', 'pronto', 'finalizado']),
      mesa: 'todas',
      busca: '',
    },
  };

  const ETAPAS = [
    { id: 'novo', nome: 'Novos' },
    { id: 'preparo', nome: 'Em preparo' },
    { id: 'pronto', nome: 'Prontos' },
    { id: 'finalizado', nome: 'Finalizados' },
  ];

  function salvarFiltros() {
    try {
      localStorage.setItem(
        CHAVE_FILTROS,
        JSON.stringify({
          etapas: [...estado.filtros.etapas],
          mesa: estado.filtros.mesa,
        })
      );
    } catch (e) {
      /* modo privado: segue sem lembrar a preferência */
    }
  }

  function carregarFiltros() {
    try {
      const bruto = localStorage.getItem(CHAVE_FILTROS);
      if (!bruto) return;
      const dados = JSON.parse(bruto);
      if (Array.isArray(dados.etapas) && dados.etapas.length) {
        const validas = dados.etapas.filter((e) => ETAPAS.some((x) => x.id === e));
        if (validas.length) estado.filtros.etapas = new Set(validas);
      }
      if (typeof dados.mesa === 'string') estado.filtros.mesa = dados.mesa;
    } catch (e) {
      /* dados corrompidos: fica com o padrão */
    }
  }

  const COLUNAS = {
    novo: 'colunaNovo',
    preparo: 'colunaPreparo',
    pronto: 'colunaPronto',
    finalizado: 'colunaFinalizado',
  };

  /* ---------------- Aviso sonoro ---------------- */

  let contexto = null;

  function tocarAviso() {
    if (!estado.somLigado) return;
    try {
      contexto = contexto || new (window.AudioContext || window.webkitAudioContext)();
      if (contexto.state === 'suspended') contexto.resume();

      [0, 0.16].forEach((atraso, indice) => {
        const oscilador = contexto.createOscillator();
        const ganho = contexto.createGain();
        oscilador.type = 'sine';
        oscilador.frequency.value = indice === 0 ? 880 : 1180;
        ganho.gain.setValueAtTime(0.0001, contexto.currentTime + atraso);
        ganho.gain.exponentialRampToValueAtTime(0.22, contexto.currentTime + atraso + 0.02);
        ganho.gain.exponentialRampToValueAtTime(0.0001, contexto.currentTime + atraso + 0.16);
        oscilador.connect(ganho).connect(contexto.destination);
        oscilador.start(contexto.currentTime + atraso);
        oscilador.stop(contexto.currentTime + atraso + 0.18);
      });
    } catch (e) {
      /* navegador bloqueou o áudio: segue sem som */
    }
  }

  /* ---------------- Montagem dos cartões ---------------- */

  function grupoDoStatus(status) {
    if (status === 'novo' || status === 'preparo' || status === 'pronto') return status;
    return 'finalizado';
  }

  /* ---------------- Filtros ---------------- */

  /** Texto pesquisável de um pedido: número, cliente, mesa e itens escolhidos. */
  function textoDoPedido(pedido) {
    const partes = [
      String(pedido.numero),
      String(pedido.numero).padStart(3, '0'),
      pedido.cliente || '',
      'mesa ' + pedido.mesa,
    ];
    pedido.itens.forEach((item) => {
      if (item.obs) partes.push(item.obs);
      item.escolhas.forEach((escolha) => {
        partes.push(escolha.categoria);
        escolha.opcoes.forEach((o) => partes.push(o.nome));
      });
    });
    return partes.join(' ').toLowerCase();
  }

  /** Remove acentos para "acai" encontrar "açaí". */
  function semAcento(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function passaNoFiltro(pedido) {
    const f = estado.filtros;
    if (!f.etapas.has(grupoDoStatus(pedido.status))) return false;
    if (f.mesa !== 'todas' && String(pedido.mesa) !== f.mesa) return false;
    if (f.busca) {
      const alvo = semAcento(textoDoPedido(pedido));
      const termos = semAcento(f.busca.toLowerCase()).split(/\s+/).filter(Boolean);
      // Todos os termos precisam aparecer: permite "3 morango" achar o cruzamento.
      if (!termos.every((t) => alvo.includes(t))) return false;
    }
    return true;
  }

  function filtroAtivo() {
    const f = estado.filtros;
    return f.etapas.size !== ETAPAS.length || f.mesa !== 'todas' || f.busca !== '';
  }

  function etiquetaFiltro(texto, ligada, aoClicar, extra) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'etiqueta-filtro' + (ligada ? ' etiqueta-filtro--ligada' : '');
    botao.setAttribute('aria-pressed', ligada ? 'true' : 'false');
    botao.textContent = texto;
    if (extra !== undefined && extra !== null) {
      const contagem = document.createElement('span');
      contagem.className = 'etiqueta-filtro__contagem';
      contagem.textContent = extra;
      botao.appendChild(contagem);
    }
    botao.addEventListener('click', aoClicar);
    return botao;
  }

  function renderizarFiltros() {
    /* --- Etapas --- */
    const alvoStatus = $('filtroStatus');
    alvoStatus.innerHTML = '';

    // Contagem por etapa considerando mesa e busca, mas não a própria etapa:
    // o número mostrado é o que apareceria se aquela etapa fosse ligada.
    const contarEtapa = (id) =>
      estado.pedidos.filter((p) => {
        if (grupoDoStatus(p.status) !== id) return false;
        const f = estado.filtros;
        if (f.mesa !== 'todas' && String(p.mesa) !== f.mesa) return false;
        if (f.busca) {
          const alvo = semAcento(textoDoPedido(p));
          const termos = semAcento(f.busca.toLowerCase()).split(/\s+/).filter(Boolean);
          if (!termos.every((t) => alvo.includes(t))) return false;
        }
        return true;
      }).length;

    ETAPAS.forEach((etapa) => {
      const ligada = estado.filtros.etapas.has(etapa.id);
      alvoStatus.appendChild(
        etiquetaFiltro(etapa.nome, ligada, () => alternarEtapa(etapa.id), contarEtapa(etapa.id))
      );
    });

    /* --- Mesas --- */
    const alvoMesa = $('filtroMesa');
    alvoMesa.innerHTML = '';

    const mesasComPedido = [...new Set(estado.pedidos.map((p) => p.mesa))].sort((a, b) => a - b);
    alvoMesa.appendChild(
      etiquetaFiltro('Todas', estado.filtros.mesa === 'todas', () => {
        estado.filtros.mesa = 'todas';
        salvarFiltros();
        renderizar();
      })
    );
    mesasComPedido.forEach((numero) => {
      const chave = String(numero);
      const quantos = estado.pedidos.filter((p) => p.mesa === numero).length;
      alvoMesa.appendChild(
        etiquetaFiltro(
          'Mesa ' + numero,
          estado.filtros.mesa === chave,
          () => {
            estado.filtros.mesa = estado.filtros.mesa === chave ? 'todas' : chave;
            salvarFiltros();
            renderizar();
          },
          quantos
        )
      );
    });

    if (!mesasComPedido.length) {
      const vazio = document.createElement('span');
      vazio.className = 'filtros__vazio';
      vazio.textContent = 'nenhum pedido hoje';
      alvoMesa.appendChild(vazio);
    }

    $('botaoLimparFiltros').classList.toggle('oculto', !filtroAtivo());
  }

  function alternarEtapa(id) {
    const etapas = estado.filtros.etapas;
    if (etapas.has(id)) {
      etapas.delete(id);
      // Desmarcar a última deixaria o quadro vazio sem explicação: religa todas.
      if (etapas.size === 0) ETAPAS.forEach((e) => etapas.add(e.id));
    } else {
      etapas.add(id);
    }
    salvarFiltros();
    renderizar();
  }

  function limparFiltros() {
    estado.filtros.etapas = new Set(ETAPAS.map((e) => e.id));
    estado.filtros.mesa = 'todas';
    estado.filtros.busca = '';
    $('filtroBusca').value = '';
    salvarFiltros();
    renderizar();
  }

  function criarLinhaAcai(item, indice) {
    const bloco = document.createElement('div');
    bloco.className = 'acai-bloco';

    const titulo = document.createElement('strong');
    titulo.textContent = `Açaí ${indice + 1} — ${formatar(item.preco)}`;
    bloco.appendChild(titulo);

    item.escolhas.forEach((escolha) => {
      const linha = document.createElement('span');
      linha.style.display = 'block';
      const nomes = escolha.opcoes.map((o) => o.nome).join(', ');
      linha.textContent = `${escolha.categoria}: ${nomes}`;
      bloco.appendChild(linha);
    });

    if (item.obs) {
      const obs = document.createElement('em');
      obs.textContent = '⚠ ' + item.obs;
      bloco.appendChild(obs);
    }

    return bloco;
  }

  function botaoAcao(texto, classe, aoClicar) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = `botao ${classe} botao--pequeno`;
    botao.textContent = texto;
    botao.addEventListener('click', aoClicar);
    return botao;
  }

  function criarCartao(pedido) {
    const cartao = document.createElement('article');
    cartao.className = `cartao-pedido cartao-pedido--${pedido.status}`;
    cartao.dataset.id = pedido.id;
    if (estado.recemChegados.has(pedido.id)) {
      cartao.classList.add('cartao-pedido--piscando');
    }

    const topo = document.createElement('div');
    topo.className = 'cartao-pedido__topo';

    const esquerda = document.createElement('div');
    const mesa = document.createElement('div');
    mesa.className = 'cartao-pedido__mesa';
    mesa.textContent = `Mesa ${pedido.mesa}`;
    const numero = document.createElement('div');
    numero.className = 'cartao-pedido__num';
    numero.textContent =
      `PEDIDO #${String(pedido.numero).padStart(3, '0')}` +
      (pedido.cliente ? ` · ${pedido.cliente}` : '');
    esquerda.appendChild(mesa);
    esquerda.appendChild(numero);

    const relogio = document.createElement('div');
    relogio.className = 'cartao-pedido__hora';
    relogio.textContent = hora(pedido.criadoEm);

    topo.appendChild(esquerda);
    topo.appendChild(relogio);
    cartao.appendChild(topo);

    pedido.itens.forEach((item, indice) => cartao.appendChild(criarLinhaAcai(item, indice)));

    const total = document.createElement('div');
    total.className = 'cartao-pedido__total';
    total.textContent = `Total ${formatar(pedido.total)}`;
    cartao.appendChild(total);

    const acoes = document.createElement('div');
    acoes.className = 'cartao-pedido__acoes';

    if (pedido.status === 'novo') {
      acoes.appendChild(botaoAcao('Iniciar preparo', 'botao--roxo', () => mudarStatus(pedido.id, 'preparo')));
      acoes.appendChild(botaoAcao('Cancelar', 'botao--fantasma', () => confirmarCancelamento(pedido)));
    } else if (pedido.status === 'preparo') {
      acoes.appendChild(botaoAcao('Marcar pronto', 'botao--principal', () => mudarStatus(pedido.id, 'pronto')));
      acoes.appendChild(botaoAcao('Voltar', 'botao--fantasma', () => mudarStatus(pedido.id, 'novo')));
    } else if (pedido.status === 'pronto') {
      acoes.appendChild(botaoAcao('Entregue', 'botao--roxo', () => mudarStatus(pedido.id, 'entregue')));
      acoes.appendChild(botaoAcao('Voltar', 'botao--fantasma', () => mudarStatus(pedido.id, 'preparo')));
    } else if (pedido.status === 'entregue') {
      acoes.appendChild(botaoAcao('Reabrir', 'botao--fantasma', () => mudarStatus(pedido.id, 'pronto')));
    } else if (pedido.status === 'cancelado') {
      const marca = document.createElement('span');
      marca.className = 'etiqueta etiqueta--opcional';
      marca.textContent = 'Cancelado';
      acoes.appendChild(marca);
      acoes.appendChild(botaoAcao('Reabrir', 'botao--fantasma', () => mudarStatus(pedido.id, 'novo')));
    }

    cartao.appendChild(acoes);
    return cartao;
  }

  function confirmarCancelamento(pedido) {
    const confirmado = window.confirm(
      `Cancelar o pedido #${String(pedido.numero).padStart(3, '0')} da mesa ${pedido.mesa}?`
    );
    if (confirmado) mudarStatus(pedido.id, 'cancelado');
  }

  /* ---------------- Renderização ---------------- */

  function renderizar() {
    const visiveis = estado.pedidos.filter(passaNoFiltro);

    const baldes = { novo: [], preparo: [], pronto: [], finalizado: [] };
    visiveis.forEach((pedido) => baldes[grupoDoStatus(pedido.status)].push(pedido));

    // Mais antigos primeiro nas filas ativas; mais recentes primeiro nos finalizados.
    baldes.novo.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
    baldes.preparo.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
    baldes.pronto.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
    baldes.finalizado.sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm));

    Object.keys(COLUNAS).forEach((chave) => {
      const container = $(COLUNAS[chave]);
      const secao = document.querySelector(`.coluna[data-coluna="${chave}"]`);
      const ligada = estado.filtros.etapas.has(chave);

      // Etapa desligada some do quadro — é o que deixa a página compacta.
      if (secao) secao.classList.toggle('oculto', !ligada);
      if (!ligada) {
        container.innerHTML = '';
        return;
      }

      container.innerHTML = '';
      const lista = baldes[chave];

      const contagem = $('contagem' + chave.charAt(0).toUpperCase() + chave.slice(1));
      if (contagem) contagem.textContent = lista.length;

      if (!lista.length) {
        const vazio = document.createElement('div');
        vazio.className = 'vazio';
        const emoji = document.createElement('div');
        emoji.className = 'vazio__emoji';
        const filtrando = filtroAtivo();
        emoji.textContent = filtrando ? '🔍' : chave === 'novo' ? '🫐' : '—';
        const texto = document.createElement('div');
        texto.textContent = filtrando
          ? 'Nada aqui com este filtro'
          : chave === 'novo'
            ? 'Nenhum pedido novo'
            : 'Vazio';
        vazio.appendChild(emoji);
        vazio.appendChild(texto);
        container.appendChild(vazio);
        return;
      }

      lista.forEach((pedido) => container.appendChild(criarCartao(pedido)));
    });

    renderizarFiltros();
    atualizarResultado(visiveis.length);
    atualizarMetricas();
  }

  function atualizarResultado(quantos) {
    const total = estado.pedidos.length;
    const alvo = $('filtroResultado');
    if (!filtroAtivo()) {
      alvo.textContent = total ? `${total} pedido${total === 1 ? '' : 's'} hoje` : '';
      alvo.classList.remove('filtros__resultado--ativo');
      return;
    }
    alvo.textContent = `${quantos} de ${total}`;
    alvo.classList.add('filtros__resultado--ativo');
  }

  function atualizarMetricas() {
    const validos = estado.pedidos.filter((p) => p.status !== 'cancelado');
    const aguardando = estado.pedidos.filter((p) => p.status === 'novo' || p.status === 'preparo');
    const acais = validos.reduce((soma, p) => soma + p.itens.length, 0);
    const faturamento = validos
      .filter((p) => p.status === 'entregue')
      .reduce((soma, p) => soma + p.total, 0);

    $('metricaAguardando').textContent = aguardando.length;
    $('metricaPedidos').textContent = validos.length;
    $('metricaAcais').textContent = acais;
    $('metricaFaturamento').textContent = formatar(faturamento);

    const pendentes = aguardando.length;
    document.title = (pendentes ? `(${pendentes}) ` : '') + 'Caixa — Açaí Demo';
  }

  /* ---------------- Liberação de mesas ---------------- */

  async function carregarAcesso() {
    try {
      const dados = await api('/api/painel/acesso');
      estado.acesso = dados;
      renderizarLiberacao();
    } catch (erro) {
      /* sem permissão ou rede caiu: o quadro de pedidos segue funcionando */
    }
  }

  function renderizarLiberacao() {
    const secao = $('secaoLiberacao');
    const acesso = estado.acesso;
    if (!acesso) return;

    // O painel só faz sentido quando a liberação é exigida.
    secao.classList.toggle('oculto', !acesso.exigirLiberacao);
    if (!acesso.exigirLiberacao) return;

    $('ajudaLiberacao').textContent =
      `Só mesas liberadas conseguem enviar pedido. Cada liberação vale ${acesso.liberacaoMinutos} minutos.`;

    const grade = $('gradeLiberacao');
    grade.innerHTML = '';

    acesso.mesas
      .filter((m) => m.ativa)
      .forEach((mesa) => {
        const cartao = document.createElement('div');
        cartao.className = 'mesa-liberacao' + (mesa.liberada ? ' mesa-liberacao--aberta' : '');

        const numero = document.createElement('div');
        numero.className = 'mesa-liberacao__numero';
        numero.textContent = 'Mesa ' + mesa.numero;
        cartao.appendChild(numero);

        const estadoTexto = document.createElement('div');
        estadoTexto.className = 'mesa-liberacao__estado';
        if (mesa.liberada) {
          const restam = Math.max(0, Math.round((mesa.liberadaAte - Date.now()) / 60000));
          estadoTexto.textContent = `aberta · ${restam} min`;
        } else {
          estadoTexto.textContent = 'fechada';
        }
        cartao.appendChild(estadoTexto);

        const acao = document.createElement('button');
        acao.type = 'button';
        acao.className = 'botao botao--pequeno ' + (mesa.liberada ? 'botao--fantasma' : 'botao--principal');
        acao.textContent = mesa.liberada ? 'Fechar' : 'Liberar';
        acao.addEventListener('click', () => alternarLiberacao(mesa.numero, mesa.liberada));
        cartao.appendChild(acao);

        grade.appendChild(cartao);
      });
  }

  async function alternarLiberacao(numero, estaAberta) {
    try {
      await api('/api/painel/liberar-mesa', { corpo: { numero, fechar: !!estaAberta } });
      notificar(estaAberta ? `Mesa ${numero} fechada.` : `Mesa ${numero} liberada.`);
      carregarAcesso();
    } catch (erro) {
      notificar(erro.message, 'erro');
    }
  }

  /* ---------------- Ações ---------------- */

  async function mudarStatus(id, status) {
    try {
      const dados = await api('/api/painel/status', { corpo: { id, status } });
      aplicarPedido(dados.pedido);
      renderizar();
    } catch (erro) {
      notificar(erro.message, 'erro');
    }
  }

  function aplicarPedido(pedido) {
    const indice = estado.pedidos.findIndex((p) => p.id === pedido.id);
    if (indice >= 0) estado.pedidos[indice] = pedido;
    else estado.pedidos.push(pedido);
  }

  async function carregar() {
    try {
      const dados = await api('/api/painel/pedidos');
      estado.pedidos = dados.pedidos;
      renderizar();
    } catch (erro) {
      notificar(erro.message, 'erro');
    }
  }

  /* ---------------- Início ---------------- */

  function iniciar() {
    $('painel').classList.remove('oculto');

    $('botaoSair').addEventListener('click', sair);
    $('alternarSom').addEventListener('change', (evento) => {
      estado.somLigado = evento.target.checked;
      if (estado.somLigado) tocarAviso();
    });

    carregarFiltros();

    let esperaBusca = null;
    $('filtroBusca').addEventListener('input', (evento) => {
      // Espera a digitação parar: redesenhar a cada tecla piscaria o quadro.
      clearTimeout(esperaBusca);
      const valor = evento.target.value.trim();
      esperaBusca = setTimeout(() => {
        estado.filtros.busca = valor;
        renderizar();
      }, 180);
    });

    $('filtroBusca').addEventListener('keydown', (evento) => {
      if (evento.key === 'Escape') {
        evento.target.value = '';
        estado.filtros.busca = '';
        renderizar();
      }
    });

    $('botaoLimparFiltros').addEventListener('click', limparFiltros);

    carregar();
    carregarAcesso();
    setInterval(carregarAcesso, 60000);

    conectarPainel((nome, dados) => {
      if (nome === 'pedido:novo') {
        aplicarPedido(dados);
        estado.recemChegados.add(dados.id);
        setTimeout(() => {
          estado.recemChegados.delete(dados.id);
        }, 6000);
        tocarAviso();
        // Avisa quando o pedido novo não aparece por causa do filtro ativo, para
        // ninguém achar que o pedido se perdeu.
        const escondido = !passaNoFiltro(dados);
        notificar(
          escondido
            ? `Novo pedido da mesa ${dados.mesa} — oculto pelo filtro atual`
            : `Novo pedido da mesa ${dados.mesa}!`,
          escondido ? 'erro' : undefined
        );
        renderizar();
      } else if (nome === 'mesa:liberacao' || nome === 'acesso:atualizado') {
        carregarAcesso();
      } else if (nome === 'pedido:status') {
        aplicarPedido(dados);
        renderizar();
      }
    });

    // Rede pode cair sem o SSE perceber: recarrega de tempos em tempos.
    setInterval(carregar, 60000);
  }

  comSessao(iniciar);
})();
