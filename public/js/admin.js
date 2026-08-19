/**
 * Açaí Demo — administração.
 * Edita o cardápio, gerencia as mesas e gera os QR Codes de acesso.
 */
(function () {
  'use strict';

  const { api, comSessao, sair, notificar } = window.Painel;
  const $ = (id) => document.getElementById(id);

  const estado = {
    menu: null,
    mesas: [],
    baseUrl: '',
    sugestoes: [],
    baseDeRede: null,
    rotaCaixa: '',
    rotaAdmin: '',
    secaoVisivel: 'tudo',
    buscaCardapio: '',
    // ids de categorias recolhidas; a busca ignora isso e abre o que casar.
    recolhidas: new Set(),
    acesso: null,
  };

  /* ---------------- Auxiliares ---------------- */

  function identificador(prefixo) {
    return prefixo + '-' + Math.random().toString(36).slice(2, 8);
  }

  function aviso(containerId, texto, tipo) {
    const alvo = $(containerId);
    alvo.innerHTML = '';
    if (!texto) return;
    const caixa = document.createElement('div');
    caixa.className = `aviso aviso--${tipo || 'erro'}`;
    caixa.textContent = texto;
    alvo.appendChild(caixa);
  }

  function campoTexto(rotulo, valor, aoMudar, opcoes) {
    const cfg = opcoes || {};
    const label = document.createElement('label');
    label.className = 'campo';

    const titulo = document.createElement('span');
    titulo.className = 'campo__rotulo';
    titulo.textContent = rotulo;

    const entrada = document.createElement('input');
    entrada.className = 'campo__entrada';
    entrada.type = cfg.tipo || 'text';
    if (cfg.tipo === 'number') {
      entrada.min = cfg.min !== undefined ? cfg.min : 0;
      entrada.step = cfg.step || 1;
    }
    entrada.value = valor;
    entrada.addEventListener('input', () => aoMudar(entrada.value));

    label.appendChild(titulo);
    label.appendChild(entrada);
    return label;
  }

  function interruptor(rotulo, marcado, aoMudar) {
    const label = document.createElement('label');
    label.className = 'interruptor';
    const entrada = document.createElement('input');
    entrada.type = 'checkbox';
    entrada.checked = marcado;
    entrada.addEventListener('change', () => aoMudar(entrada.checked));
    label.appendChild(entrada);
    label.appendChild(document.createTextNode(rotulo));
    return label;
  }

  function botao(texto, classe, aoClicar) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `botao ${classe} botao--pequeno`;
    el.textContent = texto;
    el.addEventListener('click', aoClicar);
    return el;
  }

  /* ---------------- Filtro de seções ---------------- */

  const CHAVE_SECAO = 'secao-admin';

  const SECOES = [
    { id: 'tudo', nome: 'Tudo' },
    { id: 'loja', nome: 'Identidade' },
    { id: 'cardapio', nome: 'Cardápio' },
    { id: 'mesas', nome: 'Mesas e QR' },
    { id: 'acesso', nome: 'Acesso' },
    { id: 'seguranca', nome: 'Segurança' },
  ];

  /** Remove acentos para "cardapio" casar com "cardápio". */
  function semAcento(texto) {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function renderizarFiltroSecoes() {
    const alvo = $('filtroSecao');
    alvo.innerHTML = '';

    SECOES.forEach((secao) => {
      const ligada = estado.secaoVisivel === secao.id;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'etiqueta-filtro' + (ligada ? ' etiqueta-filtro--ligada' : '');
      el.setAttribute('aria-pressed', ligada ? 'true' : 'false');
      el.textContent = secao.nome;

      if (secao.id === 'cardapio' && estado.menu) {
        const contagem = document.createElement('span');
        contagem.className = 'etiqueta-filtro__contagem';
        contagem.textContent = estado.menu.categorias.length;
        el.appendChild(contagem);
      }
      if (secao.id === 'mesas' && estado.mesas.length) {
        const contagem = document.createElement('span');
        contagem.className = 'etiqueta-filtro__contagem';
        contagem.textContent = estado.mesas.length;
        el.appendChild(contagem);
      }

      el.addEventListener('click', () => {
        // Clicar na seção já ativa volta para "Tudo".
        estado.secaoVisivel = estado.secaoVisivel === secao.id ? 'tudo' : secao.id;
        guardarSecao();
        aplicarFiltroSecoes();
      });
      alvo.appendChild(el);
    });
  }

  function aplicarFiltroSecoes() {
    document.querySelectorAll('.painel-secao[data-secao]').forEach((secao) => {
      const chave = secao.dataset.secao;
      const mostrar = estado.secaoVisivel === 'tudo' || estado.secaoVisivel === chave;
      secao.classList.toggle('oculto', !mostrar);
    });
    renderizarFiltroSecoes();
  }

  function guardarSecao() {
    try {
      localStorage.setItem(CHAVE_SECAO, estado.secaoVisivel);
    } catch (e) {
      /* segue sem lembrar */
    }
  }

  function carregarSecao() {
    try {
      const salva = localStorage.getItem(CHAVE_SECAO);
      if (salva && SECOES.some((s) => s.id === salva)) estado.secaoVisivel = salva;
    } catch (e) {
      /* fica em "tudo" */
    }
  }

  /* ---------------- Editor do cardápio ---------------- */

  /**
   * A categoria entra no resultado se o nome dela casar, ou se alguma das suas
   * opções casar. Assim, buscar "nutella" traz a categoria que a contém.
   */
  function categoriaCasaBusca(categoria) {
    if (!estado.buscaCardapio) return true;
    const termos = semAcento(estado.buscaCardapio.toLowerCase()).split(/\s+/).filter(Boolean);
    const alvo = semAcento(
      [categoria.nome, categoria.descricao || '', ...categoria.opcoes.map((o) => o.nome)]
        .join(' ')
        .toLowerCase()
    );
    return termos.every((t) => alvo.includes(t));
  }

  function renderizarMenu() {
    $('lojaNome').value = estado.menu.loja.nome || '';
    $('lojaSlogan').value = estado.menu.loja.slogan || '';
    $('lojaMensagem').value = estado.menu.loja.mensagemFinal || '';

    const container = $('editorCategorias');
    container.innerHTML = '';

    // O índice real precisa ser preservado: mover e remover mexem no array
    // completo, não na lista filtrada.
    const visiveis = estado.menu.categorias
      .map((categoria, indice) => ({ categoria, indice }))
      .filter(({ categoria }) => categoriaCasaBusca(categoria));

    visiveis.forEach(({ categoria, indice }) => {
      container.appendChild(criarEditorCategoria(categoria, indice));
    });

    if (!estado.menu.categorias.length) {
      const vazio = document.createElement('div');
      vazio.className = 'vazio';
      vazio.textContent = 'Nenhuma categoria ainda. Clique em "+ Categoria".';
      container.appendChild(vazio);
    } else if (!visiveis.length) {
      const vazio = document.createElement('div');
      vazio.className = 'vazio';
      const emoji = document.createElement('div');
      emoji.className = 'vazio__emoji';
      emoji.textContent = '🔍';
      const texto = document.createElement('div');
      texto.textContent = `Nada no cardápio para "${estado.buscaCardapio}".`;
      vazio.appendChild(emoji);
      vazio.appendChild(texto);
      container.appendChild(vazio);
    }

    atualizarResultadoCardapio(visiveis.length);
    renderizarFiltroSecoes();
  }

  function atualizarResultadoCardapio(quantas) {
    const alvo = $('resultadoCardapio');
    if (!alvo) return;
    const total = estado.menu.categorias.length;
    if (!estado.buscaCardapio) {
      alvo.textContent = `${total} categoria${total === 1 ? '' : 's'}`;
      alvo.classList.remove('filtros__resultado--ativo');
      return;
    }
    alvo.textContent = `${quantas} de ${total}`;
    alvo.classList.add('filtros__resultado--ativo');
  }

  function criarEditorCategoria(categoria, indice) {
    const bloco = document.createElement('div');
    bloco.className = 'cat-editor';

    /* --- Cabeça --- */
    const cabeca = document.createElement('div');
    cabeca.className = 'cat-editor__cabeca';

    // Recolhido é o estado compacto: só o cabeçalho fica visível.
    const buscando = estado.buscaCardapio !== '';
    const recolhida = buscando ? false : estado.recolhidas.has(categoria.id);
    if (recolhida) bloco.classList.add('cat-editor--recolhida');

    const seta = document.createElement('button');
    seta.type = 'button';
    seta.className = 'cat-editor__seta';
    seta.textContent = recolhida ? '▸' : '▾';
    seta.setAttribute('aria-expanded', recolhida ? 'false' : 'true');
    seta.setAttribute('aria-label', recolhida ? 'Expandir categoria' : 'Recolher categoria');
    seta.addEventListener('click', () => {
      if (estado.recolhidas.has(categoria.id)) estado.recolhidas.delete(categoria.id);
      else estado.recolhidas.add(categoria.id);
      renderizarMenu();
    });
    cabeca.appendChild(seta);

    const nome = document.createElement('span');
    nome.className = 'cat-editor__nome';
    nome.textContent = categoria.nome || '(sem nome)';
    cabeca.appendChild(nome);

    const resumo = document.createElement('span');
    resumo.className = 'cat-editor__resumo';
    const ativas = categoria.opcoes.filter((o) => o.ativo !== false).length;
    resumo.textContent =
      `${categoria.opcoes.length} ${categoria.opcoes.length === 1 ? 'opção' : 'opções'}` +
      (ativas !== categoria.opcoes.length ? ` · ${ativas} ativa${ativas === 1 ? '' : 's'}` : '') +
      (categoria.tipo === 'unico' ? ' · escolha única' : ' · múltipla');
    cabeca.appendChild(resumo);

    cabeca.appendChild(
      botao('↑', 'botao--fantasma', () => moverCategoria(indice, -1))
    );
    cabeca.appendChild(
      botao('↓', 'botao--fantasma', () => moverCategoria(indice, 1))
    );
    cabeca.appendChild(
      botao('Remover', 'botao--fantasma', () => {
        if (!window.confirm(`Remover a categoria "${categoria.nome}"?`)) return;
        estado.menu.categorias.splice(indice, 1);
        renderizarMenu();
      })
    );
    bloco.appendChild(cabeca);

    /* --- Corpo --- */
    const corpo = document.createElement('div');
    corpo.className = 'cat-editor__corpo';

    const linha = document.createElement('div');
    linha.className = 'linha-campos';
    linha.appendChild(
      campoTexto('Nome da categoria', categoria.nome, (v) => {
        categoria.nome = v;
        nome.textContent = v || '(sem nome)';
      })
    );
    linha.appendChild(
      campoTexto('Texto de ajuda', categoria.descricao || '', (v) => {
        categoria.descricao = v;
      })
    );
    corpo.appendChild(linha);

    const linha2 = document.createElement('div');
    linha2.className = 'linha-campos';

    // Tipo de escolha
    const rotuloTipo = document.createElement('label');
    rotuloTipo.className = 'campo';
    const tituloTipo = document.createElement('span');
    tituloTipo.className = 'campo__rotulo';
    tituloTipo.textContent = 'Tipo de escolha';
    const seletor = document.createElement('select');
    seletor.className = 'campo__entrada';
    [
      ['unico', 'Uma opção só (bolinha)'],
      ['multiplo', 'Várias opções (caixinha)'],
    ].forEach(([valor, texto]) => {
      const item = document.createElement('option');
      item.value = valor;
      item.textContent = texto;
      if (categoria.tipo === valor) item.selected = true;
      seletor.appendChild(item);
    });
    seletor.addEventListener('change', () => {
      categoria.tipo = seletor.value;
      if (categoria.tipo === 'unico') categoria.max = 1;
      renderizarMenu();
    });
    rotuloTipo.appendChild(tituloTipo);
    rotuloTipo.appendChild(seletor);
    linha2.appendChild(rotuloTipo);

    linha2.appendChild(
      campoTexto(
        'Cortesias (itens inclusos)',
        Number(categoria.gratis) || 0,
        (v) => {
          categoria.gratis = Math.max(0, Number(v) || 0);
        },
        { tipo: 'number', min: 0 }
      )
    );

    if (categoria.tipo === 'multiplo') {
      linha2.appendChild(
        campoTexto(
          'Máximo de escolhas',
          Number(categoria.max) || categoria.opcoes.length,
          (v) => {
            categoria.max = Math.max(1, Number(v) || 1);
          },
          { tipo: 'number', min: 1 }
        )
      );
    }
    corpo.appendChild(linha2);

    corpo.appendChild(
      interruptor('Obrigatório — o cliente precisa escolher', !!categoria.obrigatorio, (v) => {
        categoria.obrigatorio = v;
      })
    );

    /* --- Opções --- */
    const tituloOpcoes = document.createElement('p');
    tituloOpcoes.className = 'rotulo-secao';
    tituloOpcoes.style.marginTop = '8px';
    tituloOpcoes.textContent = 'Opções';
    corpo.appendChild(tituloOpcoes);

    categoria.opcoes.forEach((opcao, posicao) => {
      const linhaOpcao = document.createElement('div');
      linhaOpcao.className = 'opcao-editor';

      const entradaNome = document.createElement('input');
      entradaNome.type = 'text';
      entradaNome.value = opcao.nome;
      entradaNome.placeholder = 'Nome da opção';
      entradaNome.addEventListener('input', () => {
        opcao.nome = entradaNome.value;
      });

      const entradaPreco = document.createElement('input');
      entradaPreco.type = 'number';
      entradaPreco.min = '0';
      entradaPreco.step = '0.5';
      entradaPreco.value = Number(opcao.preco) || 0;
      entradaPreco.setAttribute('aria-label', 'Preço em reais');
      entradaPreco.addEventListener('input', () => {
        opcao.preco = Math.max(0, Number(entradaPreco.value) || 0);
      });

      linhaOpcao.appendChild(entradaNome);
      linhaOpcao.appendChild(entradaPreco);
      linhaOpcao.appendChild(
        interruptor('Ativa', opcao.ativo !== false, (v) => {
          opcao.ativo = v;
        })
      );
      linhaOpcao.appendChild(
        botao('✕', 'botao--fantasma', () => {
          categoria.opcoes.splice(posicao, 1);
          renderizarMenu();
        })
      );

      corpo.appendChild(linhaOpcao);
    });

    corpo.appendChild(
      botao('+ Opção', 'botao--contorno', () => {
        categoria.opcoes.push({ id: identificador('op'), nome: 'Nova opção', preco: 0, ativo: true });
        renderizarMenu();
      })
    );

    bloco.appendChild(corpo);
    return bloco;
  }

  function moverCategoria(indice, direcao) {
    const destino = indice + direcao;
    if (destino < 0 || destino >= estado.menu.categorias.length) return;
    const lista = estado.menu.categorias;
    [lista[indice], lista[destino]] = [lista[destino], lista[indice]];
    renderizarMenu();
  }

  /**
   * Liga os campos da loja ao estado na hora da digitação. Sem isso, qualquer
   * re-render do editor de cardápio apagaria o que foi digitado aqui.
   */
  function ligarCamposDaLoja() {
    const ligacoes = [
      ['lojaNome', 'nome'],
      ['lojaSlogan', 'slogan'],
      ['lojaMensagem', 'mensagemFinal'],
    ];
    ligacoes.forEach(([id, chave]) => {
      $(id).addEventListener('input', () => {
        estado.menu.loja[chave] = $(id).value;
      });
    });
  }

  async function salvarMenu() {
    estado.menu.loja.nome = $('lojaNome').value.trim() || 'Açaí Demo';
    estado.menu.loja.slogan = $('lojaSlogan').value.trim();
    estado.menu.loja.mensagemFinal = $('lojaMensagem').value.trim();

    // Limpezas antes de enviar: sem nome não vai.
    estado.menu.categorias.forEach((c) => {
      c.nome = String(c.nome || '').trim() || 'Categoria';
      c.opcoes = c.opcoes.filter((o) => String(o.nome || '').trim().length > 0);
      c.opcoes.forEach((o) => {
        o.nome = o.nome.trim();
        o.preco = Number(o.preco) || 0;
      });
    });

    try {
      await api('/api/painel/menu', { method: 'PUT', corpo: estado.menu });
      aviso('avisoMenu', 'Cardápio salvo. Os próximos clientes já verão a nova versão.', 'ok');
      notificar('Cardápio salvo!');
      renderizarMenu();
    } catch (erro) {
      aviso('avisoMenu', erro.message, 'erro');
      notificar(erro.message, 'erro');
    }
  }

  /* ---------------- Mesas e QR ---------------- */

  /**
   * Base usada nos QR Codes.
   *
   * A ordem importa: o endereço configurado à mão manda, mas se não houver um,
   * usamos o IP da máquina na rede em vez de `location.origin`. Abrir a
   * administração por "localhost" gerava QR Codes apontando para localhost —
   * que só abrem no próprio computador, nunca no celular do cliente.
   */
  function baseAtual() {
    if (estado.baseUrl) return estado.baseUrl;
    if (estado.baseDeRede && ehLocal(location.hostname)) return estado.baseDeRede;
    return location.origin;
  }

  function ehLocal(host) {
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  }

  /** Explica de onde saiu a base dos QR Codes, para não haver surpresa. */
  function textoDaDica() {
    if (estado.baseUrl) {
      return `Os QR Codes usam o endereço fixado acima: ${estado.baseUrl}`;
    }
    if (estado.baseDeRede && ehLocal(location.hostname)) {
      return (
        `Você abriu esta página por "${location.hostname}", mas os QR Codes estão usando ` +
        `${estado.baseDeRede} — o IP desta máquina na rede, que é o que o celular do cliente ` +
        `consegue abrir. Para fixar outro endereço, preencha o campo acima.`
      );
    }
    if (!estado.baseDeRede) {
      return (
        'Nenhum IP de rede foi encontrado nesta máquina, então os QR Codes usam ' +
        `${location.origin}. Conecte-se a uma rede ou preencha o endereço acima.`
      );
    }
    return `Os QR Codes usam ${location.origin}, o mesmo endereço desta página.`;
  }

  /**
   * Mostra os endereços de rede do caixa e da administração. Abrindo o painel
   * por localhost não havia como descobrir por onde acessá-lo de outro
   * aparelho — e as rotas são secretas, não aparecem em nenhum link público.
   */
  function renderizarEnderecosDoPainel() {
    const alvo = $('enderecosPainel');
    if (!alvo) return;
    alvo.innerHTML = '';

    const base = estado.baseUrl || estado.baseDeRede || location.origin;
    const linhas = [
      ['Caixa', `${base}/${estado.rotaCaixa}`],
      ['Administração', `${base}/${estado.rotaAdmin}`],
    ];

    linhas.forEach(([rotulo, url]) => {
      const linha = document.createElement('div');
      linha.className = 'endereco-painel';

      const nome = document.createElement('span');
      nome.className = 'endereco-painel__rotulo';
      nome.textContent = rotulo;

      const valor = document.createElement('code');
      valor.className = 'endereco-painel__url';
      valor.textContent = url;

      const copiar = botao('Copiar', 'botao--contorno', async () => {
        try {
          await navigator.clipboard.writeText(url);
          notificar('Endereço copiado.');
        } catch (e) {
          // Sem permissão de área de transferência: seleciona para copiar à mão.
          const faixa = document.createRange();
          faixa.selectNodeContents(valor);
          const selecao = window.getSelection();
          selecao.removeAllRanges();
          selecao.addRange(faixa);
          notificar('Selecionado — use Ctrl+C para copiar.');
        }
      });

      linha.appendChild(nome);
      linha.appendChild(valor);
      linha.appendChild(copiar);
      alvo.appendChild(linha);
    });
  }

  function urlDaMesa(mesa) {
    return `${baseAtual()}/?m=${mesa.numero}&t=${encodeURIComponent(mesa.token)}`;
  }

  function renderizarMesas() {
    $('campoBaseUrl').value = estado.baseUrl || '';
    $('dicaBaseUrl').textContent = textoDaDica();
    renderizarEnderecosDoPainel();

    const grade = $('grademesas');
    grade.innerHTML = '';

    estado.mesas.forEach((mesa) => {
      const cartao = document.createElement('div');
      cartao.className = 'cartao-mesa' + (mesa.ativa ? '' : ' cartao-mesa--inativa');

      const numero = document.createElement('div');
      numero.className = 'cartao-mesa__numero';
      numero.textContent = `Mesa ${mesa.numero}` + (mesa.ativa ? '' : ' (inativa)');
      cartao.appendChild(numero);

      const caixaQr = document.createElement('div');
      caixaQr.className = 'cartao-mesa__qr';
      try {
        caixaQr.innerHTML = window.QRCode.gerarSVG(urlDaMesa(mesa), { tamanho: 150 });
      } catch (erro) {
        caixaQr.textContent = 'Endereço longo demais para o QR.';
      }
      cartao.appendChild(caixaQr);

      const link = document.createElement('div');
      link.className = 'link-mesa';
      link.textContent = urlDaMesa(mesa);
      cartao.appendChild(link);

      const acoes = document.createElement('div');
      acoes.className = 'cartao-mesa__acoes';
      acoes.appendChild(
        botao('Abrir', 'botao--contorno', () => window.open(urlDaMesa(mesa), '_blank', 'noopener'))
      );
      acoes.appendChild(
        botao(mesa.ativa ? 'Desativar' : 'Ativar', 'botao--fantasma', () =>
          acaoMesa({ acao: 'alternar', numero: mesa.numero })
        )
      );
      acoes.appendChild(
        botao('Novo código', 'botao--fantasma', () => {
          if (
            !window.confirm(
              `Gerar um código novo para a mesa ${mesa.numero}? O QR Code antigo deixa de funcionar.`
            )
          )
            return;
          acaoMesa({ acao: 'regerar', numero: mesa.numero });
        })
      );
      acoes.appendChild(
        botao('Remover', 'botao--fantasma', () => {
          if (!window.confirm(`Remover a mesa ${mesa.numero}?`)) return;
          acaoMesa({ acao: 'remover', numero: mesa.numero });
        })
      );
      cartao.appendChild(acoes);

      grade.appendChild(cartao);
    });

    montarFolhaImpressao();
  }

  function montarFolhaImpressao() {
    const folha = $('folhaQr');
    folha.innerHTML = '';

    estado.mesas
      .filter((m) => m.ativa)
      .forEach((mesa) => {
        const cartao = document.createElement('div');
        cartao.className = 'folha-qr__cartao';

        const marca = document.createElement('div');
        marca.style.fontWeight = '900';
        marca.style.color = '#2b0d4f';
        marca.style.letterSpacing = '-0.03em';
        marca.style.fontSize = '14pt';
        marca.textContent = estado.menu.loja.nome || 'Açaí Demo';
        cartao.appendChild(marca);

        const titulo = document.createElement('h3');
        titulo.textContent = `Mesa ${mesa.numero}`;
        cartao.appendChild(titulo);

        const caixaQr = document.createElement('div');
        caixaQr.style.display = 'flex';
        caixaQr.style.justifyContent = 'center';
        try {
          caixaQr.innerHTML = window.QRCode.gerarSVG(urlDaMesa(mesa), { tamanho: 190 });
        } catch (erro) {
          caixaQr.textContent = 'Endereço longo demais.';
        }
        cartao.appendChild(caixaQr);

        const instrucao = document.createElement('p');
        instrucao.textContent = 'Aponte a câmera do celular e faça seu pedido';
        cartao.appendChild(instrucao);

        folha.appendChild(cartao);
      });
  }

  async function acaoMesa(corpo) {
    try {
      const dados = await api('/api/painel/mesas', { corpo });
      estado.mesas = dados.mesas;
      if (dados.baseUrl !== undefined) estado.baseUrl = dados.baseUrl;
      renderizarMesas();
      notificar('Mesas atualizadas.');
    } catch (erro) {
      notificar(erro.message, 'erro');
    }
  }

  /* ---------------- Acesso do cliente ---------------- */

  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  function renderizarAcesso() {
    const a = estado.acesso;
    if (!a) return;

    $('horarioAtivo').checked = !!(a.horario && a.horario.ativo);
    $('horarioAbre').value = (a.horario && a.horario.abre) || '10:00';
    $('horarioFecha').value = (a.horario && a.horario.fecha) || '22:00';
    $('exigirLiberacao').checked = !!a.exigirLiberacao;
    $('liberacaoMinutos').value = a.liberacaoMinutos;
    $('maxPedidosMesaHora').value = a.maxPedidosMesaHora;

    const dias = (a.horario && a.horario.dias) || [];
    const grade = $('diasSemana');
    grade.innerHTML = '';
    DIAS.forEach((nome, indice) => {
      const marcado = dias.includes(indice);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'etiqueta-filtro' + (marcado ? ' etiqueta-filtro--ligada' : '');
      el.dataset.dia = indice;
      el.setAttribute('aria-pressed', marcado ? 'true' : 'false');
      el.textContent = nome;
      el.addEventListener('click', () => {
        const ligado = el.classList.toggle('etiqueta-filtro--ligada');
        el.setAttribute('aria-pressed', ligado ? 'true' : 'false');
      });
      grade.appendChild(el);
    });
  }

  async function salvarAcesso() {
    const dias = [...document.querySelectorAll('#diasSemana .etiqueta-filtro--ligada')].map((el) =>
      Number(el.dataset.dia)
    );

    try {
      await api('/api/painel/acesso', {
        method: 'PUT',
        corpo: {
          horario: {
            ativo: $('horarioAtivo').checked,
            abre: $('horarioAbre').value,
            fecha: $('horarioFecha').value,
            dias,
          },
          exigirLiberacao: $('exigirLiberacao').checked,
          liberacaoMinutos: Number($('liberacaoMinutos').value),
          maxPedidosMesaHora: Number($('maxPedidosMesaHora').value),
        },
      });
      estado.acesso = await api('/api/painel/acesso');
      renderizarAcesso();
      aviso('avisoAcesso', 'Regras de acesso salvas.', 'ok');
      notificar('Regras salvas.');
    } catch (erro) {
      aviso('avisoAcesso', erro.message, 'erro');
      notificar(erro.message, 'erro');
    }
  }

  /* ---------------- Segurança ---------------- */

  async function trocarPin() {
    const atual = $('pinAtual').value;
    const novo = $('pinNovo').value;
    if (novo.length < 6 || novo.length > 64) {
      aviso('avisoPin', 'A nova senha precisa ter de 6 a 64 caracteres.', 'erro');
      return;
    }
    if (/^\d+$/.test(novo) && novo.length < 8) {
      aviso(
        'avisoPin',
        'Só com números, use no mínimo 8 dígitos — ou misture letras para poder usar menos.',
        'erro'
      );
      return;
    }
    try {
      await api('/api/painel/pin', { corpo: { atual, novo } });
      aviso('avisoPin', 'PIN alterado com sucesso.', 'ok');
      $('pinAtual').value = '';
      $('pinNovo').value = '';
      notificar('PIN alterado.');
    } catch (erro) {
      aviso('avisoPin', erro.message, 'erro');
    }
  }

  /* ---------------- Início ---------------- */

  async function carregar() {
    estado.menu = await api('/api/painel/menu');
    const dadosMesas = await api('/api/painel/mesas');
    estado.mesas = dadosMesas.mesas;
    estado.baseUrl = dadosMesas.baseUrl || '';
    estado.sugestoes = dadosMesas.sugestoes || [];
    estado.baseDeRede = dadosMesas.baseDeRede || null;
    estado.rotaCaixa = dadosMesas.rotaCaixa || '';
    estado.rotaAdmin = dadosMesas.rotaAdmin || '';
    estado.acesso = await api('/api/painel/acesso');
    renderizarAcesso();
    renderizarMenu();
    ligarCamposDaLoja();
    renderizarMesas();
  }

  function ligarEventos() {
    $('botaoSair').addEventListener('click', sair);
    $('botaoSalvarMenu').addEventListener('click', salvarMenu);
    $('botaoTrocarPin').addEventListener('click', trocarPin);
    $('botaoSalvarAcesso').addEventListener('click', salvarAcesso);
    $('botaoImprimirQr').addEventListener('click', () => window.print());

    let esperaBusca = null;
    $('buscaCardapio').addEventListener('input', (evento) => {
      clearTimeout(esperaBusca);
      const valor = evento.target.value.trim();
      esperaBusca = setTimeout(() => {
        estado.buscaCardapio = valor;
        renderizarMenu();
      }, 180);
    });

    $('buscaCardapio').addEventListener('keydown', (evento) => {
      if (evento.key === 'Escape') {
        evento.target.value = '';
        estado.buscaCardapio = '';
        renderizarMenu();
      }
    });

    $('botaoRecolherTudo').addEventListener('click', () => {
      const todasRecolhidas = estado.menu.categorias.every((c) => estado.recolhidas.has(c.id));
      if (todasRecolhidas) {
        estado.recolhidas.clear();
      } else {
        estado.menu.categorias.forEach((c) => estado.recolhidas.add(c.id));
      }
      $('botaoRecolherTudo').textContent = todasRecolhidas ? 'Recolher tudo' : 'Expandir tudo';
      renderizarMenu();
    });

    $('botaoNovaCategoria').addEventListener('click', () => {
      estado.menu.categorias.push({
        id: identificador('cat'),
        nome: 'Nova categoria',
        descricao: '',
        tipo: 'multiplo',
        obrigatorio: false,
        gratis: 0,
        max: 3,
        opcoes: [{ id: identificador('op'), nome: 'Nova opção', preco: 0, ativo: true }],
      });
      renderizarMenu();
    });

    $('botaoNovaMesa').addEventListener('click', () => {
      const proxima = estado.mesas.reduce((maior, m) => Math.max(maior, m.numero), 0) + 1;
      const entrada = window.prompt('Número da nova mesa:', String(proxima));
      if (entrada === null) return;
      const numero = Number(entrada);
      if (!Number.isInteger(numero) || numero < 1) {
        notificar('Número de mesa inválido.', 'erro');
        return;
      }
      acaoMesa({ acao: 'adicionar', numero });
    });

    $('botaoSalvarBase').addEventListener('click', () => {
      acaoMesa({ acao: 'baseUrl', baseUrl: $('campoBaseUrl').value.trim() });
    });
  }

  function iniciar() {
    $('painel').classList.remove('oculto');
    carregarSecao();
    ligarEventos();
    carregar()
      .then(aplicarFiltroSecoes)
      .catch((erro) => notificar(erro.message, 'erro'));
  }

  comSessao(iniciar);
})();
