/**
 * Gerador de QR Code — implementação local, sem dependências externas.
 *
 * Suporta modo byte, nível de correção M e versões 1 a 10 (até 271 bytes),
 * o suficiente para as URLs das mesas. Exporta `window.QRCode`.
 */
(function (global) {
  'use strict';

  /* ---------------- Campo de Galois GF(256) ---------------- */

  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);

  (function montarTabelas() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function multiplicar(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function polinomioGerador(grau) {
    let poly = [1];
    for (let i = 0; i < grau; i++) {
      const novo = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        novo[j] ^= poly[j];
        novo[j + 1] ^= multiplicar(poly[j], EXP[i]);
      }
      poly = novo;
    }
    return poly;
  }

  function calcularCorrecao(dados, quantidade) {
    const gerador = polinomioGerador(quantidade);
    const resto = new Array(dados.length + quantidade).fill(0);
    for (let i = 0; i < dados.length; i++) resto[i] = dados[i];
    for (let i = 0; i < dados.length; i++) {
      const coeficiente = resto[i];
      if (coeficiente === 0) continue;
      for (let j = 0; j < gerador.length; j++) {
        resto[i + j] ^= multiplicar(gerador[j], coeficiente);
      }
    }
    return resto.slice(dados.length);
  }

  /* ---------------- Tabelas por versão (nível M) ---------------- */

  // [correção por bloco, blocos grupo 1, dados grupo 1, blocos grupo 2, dados grupo 2]
  const BLOCOS = [
    [10, 1, 16],
    [16, 1, 28],
    [26, 1, 44],
    [18, 2, 32],
    [24, 2, 43],
    [16, 4, 27],
    [18, 4, 31],
    [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44],
  ];

  const ALINHAMENTO = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
  ];

  function bitsRestantes(versao) {
    if (versao === 1) return 0;
    if (versao <= 6) return 7;
    return 0; // versões 7 a 13
  }

  function indicadorContagem(versao) {
    return versao < 10 ? 8 : 16;
  }

  function totalDados(versao) {
    const b = BLOCOS[versao - 1];
    return b[1] * b[2] + (b[3] ? b[3] * b[4] : 0);
  }

  function capacidadeBytes(versao) {
    return Math.floor((totalDados(versao) * 8 - 4 - indicadorContagem(versao)) / 8);
  }

  function escolherVersao(quantidadeBytes) {
    for (let v = 1; v <= 10; v++) {
      if (quantidadeBytes <= capacidadeBytes(v)) return v;
    }
    throw new Error('Texto longo demais para o QR Code (máximo ' + capacidadeBytes(10) + ' bytes).');
  }

  /* ---------------- Codificação dos dados ---------------- */

  function paraBytes(texto) {
    if (global.TextEncoder) return Array.from(new TextEncoder().encode(texto));
    const saida = [];
    const escapado = unescape(encodeURIComponent(texto));
    for (let i = 0; i < escapado.length; i++) saida.push(escapado.charCodeAt(i));
    return saida;
  }

  function montarCodewords(bytes, versao) {
    const bits = [];
    const empurrar = (valor, tamanho) => {
      for (let i = tamanho - 1; i >= 0; i--) bits.push((valor >> i) & 1);
    };

    empurrar(0b0100, 4); // modo byte
    empurrar(bytes.length, indicadorContagem(versao));
    bytes.forEach((b) => empurrar(b, 8));

    const capacidadeBits = totalDados(versao) * 8;
    const terminador = Math.min(4, capacidadeBits - bits.length);
    for (let i = 0; i < terminador; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let valor = 0;
      for (let j = 0; j < 8; j++) valor = (valor << 1) | bits[i + j];
      codewords.push(valor);
    }

    const preenchimento = [0xec, 0x11];
    let k = 0;
    while (codewords.length < totalDados(versao)) {
      codewords.push(preenchimento[k++ % 2]);
    }
    return codewords;
  }

  function intercalar(codewords, versao) {
    const [correcaoPorBloco, blocos1, dados1, blocos2, dados2] = BLOCOS[versao - 1];
    const blocosDados = [];
    const blocosCorrecao = [];
    let posicao = 0;

    const adicionar = (quantidade, tamanho) => {
      for (let i = 0; i < quantidade; i++) {
        const pedaco = codewords.slice(posicao, posicao + tamanho);
        posicao += tamanho;
        blocosDados.push(pedaco);
        blocosCorrecao.push(calcularCorrecao(pedaco, correcaoPorBloco));
      }
    };

    adicionar(blocos1, dados1);
    if (blocos2) adicionar(blocos2, dados2);

    const saida = [];
    const maiorDados = Math.max(dados1, dados2 || 0);
    for (let i = 0; i < maiorDados; i++) {
      blocosDados.forEach((bloco) => {
        if (i < bloco.length) saida.push(bloco[i]);
      });
    }
    for (let i = 0; i < correcaoPorBloco; i++) {
      blocosCorrecao.forEach((bloco) => saida.push(bloco[i]));
    }
    return saida;
  }

  /* ---------------- Construção da matriz ---------------- */

  function criarMatriz(tamanho) {
    const m = [];
    for (let i = 0; i < tamanho; i++) m.push(new Array(tamanho).fill(false));
    return m;
  }

  function desenharPadroes(modulos, funcoes, versao) {
    const tamanho = modulos.length;

    const definir = (linha, coluna, escuro) => {
      modulos[linha][coluna] = escuro;
      funcoes[linha][coluna] = true;
    };

    // Localizadores + separadores
    const localizador = (linhaBase, colunaBase) => {
      for (let dl = -1; dl <= 7; dl++) {
        for (let dc = -1; dc <= 7; dc++) {
          const l = linhaBase + dl;
          const c = colunaBase + dc;
          if (l < 0 || l >= tamanho || c < 0 || c >= tamanho) continue;
          const distancia = Math.max(Math.abs(dl - 3), Math.abs(dc - 3));
          definir(l, c, distancia !== 2 && distancia !== 4);
        }
      }
    };
    localizador(0, 0);
    localizador(0, tamanho - 7);
    localizador(tamanho - 7, 0);

    // Padrões de tempo
    for (let i = 0; i < tamanho; i++) {
      if (!funcoes[6][i]) definir(6, i, i % 2 === 0);
      if (!funcoes[i][6]) definir(i, 6, i % 2 === 0);
    }

    // Alinhamento
    const centros = ALINHAMENTO[versao - 1];
    for (let a = 0; a < centros.length; a++) {
      for (let b = 0; b < centros.length; b++) {
        const cantoLocalizador =
          (a === 0 && b === 0) ||
          (a === 0 && b === centros.length - 1) ||
          (a === centros.length - 1 && b === 0);
        if (cantoLocalizador) continue;
        const linha = centros[a];
        const coluna = centros[b];
        for (let dl = -2; dl <= 2; dl++) {
          for (let dc = -2; dc <= 2; dc++) {
            const distancia = Math.max(Math.abs(dl), Math.abs(dc));
            definir(linha + dl, coluna + dc, distancia !== 1);
          }
        }
      }
    }

    // Áreas reservadas do formato
    for (let i = 0; i <= 8; i++) {
      if (i !== 6) {
        funcoes[8][i] = true;
        funcoes[i][8] = true;
      }
    }
    for (let i = 0; i < 8; i++) funcoes[8][tamanho - 1 - i] = true;
    for (let i = 0; i < 7; i++) funcoes[tamanho - 1 - i][8] = true;
    definir(tamanho - 8, 8, true); // módulo sempre escuro

    // Informação de versão (a partir da versão 7)
    if (versao >= 7) {
      let resto = versao << 12;
      for (let i = 17; i >= 12; i--) {
        if ((resto >> i) & 1) resto ^= 0x1f25 << (i - 12);
      }
      const info = (versao << 12) | (resto & 0xfff);
      for (let i = 0; i < 18; i++) {
        const bit = ((info >> i) & 1) === 1;
        const a = tamanho - 11 + (i % 3);
        const b = Math.floor(i / 3);
        definir(b, a, bit);
        definir(a, b, bit);
      }
    }
  }

  function preencherDados(modulos, funcoes, dados) {
    const tamanho = modulos.length;
    let indice = 0;
    const totalBits = dados.length * 8;

    for (let direita = tamanho - 1; direita >= 1; direita -= 2) {
      if (direita === 6) direita = 5;
      for (let vertical = 0; vertical < tamanho; vertical++) {
        for (let j = 0; j < 2; j++) {
          const coluna = direita - j;
          const subindo = ((direita + 1) & 2) === 0;
          const linha = subindo ? tamanho - 1 - vertical : vertical;
          if (funcoes[linha][coluna] || indice >= totalBits) continue;
          const bit = (dados[indice >>> 3] >> (7 - (indice & 7))) & 1;
          modulos[linha][coluna] = bit === 1;
          indice++;
        }
      }
    }
  }

  function aplicarMascara(modulos, funcoes, mascara) {
    const tamanho = modulos.length;
    for (let linha = 0; linha < tamanho; linha++) {
      for (let coluna = 0; coluna < tamanho; coluna++) {
        if (funcoes[linha][coluna]) continue;
        let inverter = false;
        const l = linha;
        const c = coluna;
        switch (mascara) {
          case 0: inverter = (l + c) % 2 === 0; break;
          case 1: inverter = l % 2 === 0; break;
          case 2: inverter = c % 3 === 0; break;
          case 3: inverter = (l + c) % 3 === 0; break;
          case 4: inverter = (Math.floor(l / 2) + Math.floor(c / 3)) % 2 === 0; break;
          case 5: inverter = ((l * c) % 2) + ((l * c) % 3) === 0; break;
          case 6: inverter = (((l * c) % 2) + ((l * c) % 3)) % 2 === 0; break;
          case 7: inverter = (((l + c) % 2) + ((l * c) % 3)) % 2 === 0; break;
        }
        if (inverter) modulos[linha][coluna] = !modulos[linha][coluna];
      }
    }
  }

  function gravarFormato(modulos, funcoes, mascara) {
    const tamanho = modulos.length;
    const dados = (0b00 << 3) | mascara; // nível M
    let resto = dados << 10;
    for (let i = 14; i >= 10; i--) {
      if ((resto >> i) & 1) resto ^= 0x537 << (i - 10);
    }
    const formato = (((dados << 10) | (resto & 0x3ff)) ^ 0x5412) & 0x7fff;
    const bit = (i) => ((formato >> i) & 1) === 1;

    for (let i = 0; i <= 5; i++) modulos[i][8] = bit(i);
    modulos[7][8] = bit(6);
    modulos[8][8] = bit(7);
    modulos[8][7] = bit(8);
    for (let i = 9; i < 15; i++) modulos[8][14 - i] = bit(i);

    for (let i = 0; i < 8; i++) modulos[8][tamanho - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) modulos[tamanho - 15 + i][8] = bit(i);

    modulos[tamanho - 8][8] = true;
    funcoes[tamanho - 8][8] = true;
  }

  /* ---------------- Penalidades ---------------- */

  function penalidade(modulos) {
    const tamanho = modulos.length;
    let total = 0;

    // Regra 1 — sequências de 5 ou mais módulos iguais
    const avaliarLinha = (obter) => {
      let cor = obter(0);
      let sequencia = 1;
      for (let i = 1; i < tamanho; i++) {
        const atual = obter(i);
        if (atual === cor) {
          sequencia++;
        } else {
          if (sequencia >= 5) total += 3 + (sequencia - 5);
          cor = atual;
          sequencia = 1;
        }
      }
      if (sequencia >= 5) total += 3 + (sequencia - 5);
    };

    for (let l = 0; l < tamanho; l++) avaliarLinha((i) => modulos[l][i]);
    for (let c = 0; c < tamanho; c++) avaliarLinha((i) => modulos[i][c]);

    // Regra 2 — blocos 2x2 da mesma cor
    for (let l = 0; l < tamanho - 1; l++) {
      for (let c = 0; c < tamanho - 1; c++) {
        const v = modulos[l][c];
        if (v === modulos[l][c + 1] && v === modulos[l + 1][c] && v === modulos[l + 1][c + 1]) {
          total += 3;
        }
      }
    }

    // Regra 3 — padrão parecido com o localizador
    const alvoA = [true, false, true, true, true, false, true, false, false, false, false];
    const alvoB = [false, false, false, false, true, false, true, true, true, false, true];
    const combina = (obter, inicio, alvo) => {
      for (let i = 0; i < alvo.length; i++) {
        if (obter(inicio + i) !== alvo[i]) return false;
      }
      return true;
    };
    for (let l = 0; l < tamanho; l++) {
      for (let c = 0; c + 11 <= tamanho; c++) {
        const obter = (i) => modulos[l][i];
        if (combina(obter, c, alvoA) || combina(obter, c, alvoB)) total += 40;
      }
    }
    for (let c = 0; c < tamanho; c++) {
      for (let l = 0; l + 11 <= tamanho; l++) {
        const obter = (i) => modulos[i][c];
        if (combina(obter, l, alvoA) || combina(obter, l, alvoB)) total += 40;
      }
    }

    // Regra 4 — equilíbrio entre claros e escuros
    let escuros = 0;
    for (let l = 0; l < tamanho; l++) {
      for (let c = 0; c < tamanho; c++) if (modulos[l][c]) escuros++;
    }
    const proporcao = (escuros * 100) / (tamanho * tamanho);
    total += Math.ceil(Math.abs(proporcao - 50) / 5) * 10;

    return total;
  }

  function copiar(matriz) {
    return matriz.map((linha) => linha.slice());
  }

  /* ---------------- API ---------------- */

  function gerarMatriz(texto) {
    const bytes = paraBytes(String(texto));
    const versao = escolherVersao(bytes.length);
    const codewords = montarCodewords(bytes, versao);
    const finais = intercalar(codewords, versao);

    // Os bits restantes (bitsRestantes) da versão ficam em zero: os módulos não
    // preenchidos já nascem claros, então não há nada a acrescentar aqui.
    const tamanho = versao * 4 + 17;
    const base = criarMatriz(tamanho);
    const funcoes = criarMatriz(tamanho);
    desenharPadroes(base, funcoes, versao);
    preencherDados(base, funcoes, finais);

    let melhor = null;
    let melhorNota = Infinity;
    for (let mascara = 0; mascara < 8; mascara++) {
      const tentativa = copiar(base);
      const funcoesTentativa = copiar(funcoes);
      aplicarMascara(tentativa, funcoesTentativa, mascara);
      gravarFormato(tentativa, funcoesTentativa, mascara);
      const nota = penalidade(tentativa);
      if (nota < melhorNota) {
        melhorNota = nota;
        melhor = tentativa;
      }
    }
    return melhor;
  }

  /**
   * Devolve o QR Code como string SVG pronta para inserir no HTML.
   * opcoes: { tamanho, corEscura, corClara, margem }
   */
  function gerarSVG(texto, opcoes) {
    const cfg = Object.assign(
      { tamanho: 220, corEscura: '#1c0733', corClara: '#ffffff', margem: 4 },
      opcoes || {}
    );
    const modulos = gerarMatriz(texto);
    const lado = modulos.length;
    const total = lado + cfg.margem * 2;

    let caminho = '';
    for (let l = 0; l < lado; l++) {
      for (let c = 0; c < lado; c++) {
        if (modulos[l][c]) {
          caminho += `M${c + cfg.margem} ${l + cfg.margem}h1v1h-1z`;
        }
      }
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
      `width="${cfg.tamanho}" height="${cfg.tamanho}" shape-rendering="crispEdges" role="img" ` +
      `aria-label="QR Code">` +
      `<rect width="${total}" height="${total}" fill="${cfg.corClara}"/>` +
      `<path d="${caminho}" fill="${cfg.corEscura}"/>` +
      `</svg>`
    );
  }

  global.QRCode = { gerarMatriz, gerarSVG, capacidadeBytes };
})(window);
