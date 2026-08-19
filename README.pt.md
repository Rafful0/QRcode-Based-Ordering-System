# Açaí Demo — pedidos por QR Code

**[English version](README.en.md)**

Sistema de pedidos para lojas de açaí. O cliente escaneia o QR Code da mesa, monta o pedido
no próprio celular e o pedido aparece na hora no computador do caixa — substituindo a
comanda de papel.

Feito em **Node.js puro e JavaScript no navegador, sem uma única dependência externa**.
Nada de `npm install`: basta ter o Node instalado e rodar.

---

> ### Sobre esta versão
>
> Esta é uma **versão de demonstração**, publicada como amostra de trabalho. É o mesmo
> software, com o mesmo código, mas com **marca, senha, códigos de mesa e endereços de
> painel genéricos**, no lugar dos dados reais de qualquer loja.
>
> Tudo funciona de verdade: pedidos, tempo real, geração de QR Code, edição de cardápio.
> Só os valores de partida foram trocados por outros previsíveis, para que qualquer pessoa
> consiga abrir e avaliar o sistema em um minuto, sem configuração.
>
> As diferenças estão listadas em [Diferenças para a versão de produção](#diferenças-para-a-versão-de-produção),
> e cada uma delas está comentada no próprio código.

---

## Rodando em um minuto

Requisito único: **Node.js 18 ou superior**.

```bash
node server.js
```

O terminal imprime os três endereços. Abra na ordem:

| Tela | Endereço | Acesso |
| --- | --- | --- |
| Cliente (mesa 1) | `http://localhost:3000/?m=1&t=demo-mesa-1` | pelo link do QR Code |
| Caixa | `http://localhost:3000/caixa` | senha `demo1234` |
| Administração | `http://localhost:3000/admin` | senha `demo1234` |

As mesas 1 a 12 existem, com códigos de `demo-mesa-1` até `demo-mesa-12`.

### Roteiro sugerido para avaliar

1. Abra o **caixa** em uma janela e o **cliente** em outra, lado a lado.
2. No cliente, escolha 2 açaís e monte cada um.
3. Envie. O pedido aparece no caixa **na hora**, com aviso sonoro, sem recarregar a página.
4. No caixa, clique em *Iniciar preparo* e depois em *Marcar pronto*. A tela do cliente
   acompanha a mudança em tempo real.
5. Na **administração**, mude um preço ou desative uma opção, salve, e recarregue o
   formulário do cliente para ver a alteração.

### Testando no celular

O terminal imprime dois conjuntos de endereços: os de `localhost`, para usar neste
computador, e os de rede (algo como `http://192.168.15.6:3000`), que funcionam em qualquer
aparelho no mesmo Wi‑Fi — inclusive para abrir o caixa em outra máquina.

Os **QR Codes já saem com o endereço de rede**, mesmo que você abra a administração por
`localhost`. Isso é proposital: um QR Code apontando para `localhost` abriria apenas no
próprio computador, nunca no celular do cliente. A administração mostra qual endereço está
sendo usado, e a seção *Acesso ao painel pela rede* traz os links do caixa e da
administração prontos para copiar.

Para fixar outro endereço — um domínio, por exemplo — preencha o campo **endereço usado nos
QR Codes**; ele tem prioridade sobre a detecção automática.

---

## O que o sistema faz

### Cliente — `/?m=<mesa>&t=<código>`

O formulário só abre com o par mesa + código, que vem no QR Code. Quem digitar o endereço
na mão vê uma tela de acesso negado.

1. **Quantidade** — o cliente escolhe quantos açaís quer antes de começar.
2. **Montagem** — um açaí por vez, em caixinhas de seleção, com navegação entre eles.
   Mostra o preço parcial e um campo de observação para a cozinha.
3. **Revisão** — resumo item a item, com opção de editar, nome do cliente e envio.

Depois de enviar, a tela acompanha o status: recebido → preparando → pronto → entregue.
O rascunho sobrevive a um recarregamento acidental da página.

### Caixa

Quadro com quatro colunas — novos, em preparo, prontos, finalizados. Cada pedido novo cai
sozinho na tela com aviso sonoro. Os botões movem o pedido entre as colunas, e o cliente vê
a mudança no celular imediatamente.

No topo, os números do dia: pedidos aguardando, total de pedidos, total de açaís e
faturamento. O título da aba mostra a contagem de pendentes, para quem deixa a janela em
segundo plano.

### Administração

- **Identidade da loja** — nome, chamada da capa e mensagem de agradecimento.
- **Cardápio** — o formulário do cliente é gerado a partir daqui. Criar e remover
  categorias, reordená-las, alternar entre *escolha única* (bolinha) e *múltipla*
  (caixinha), definir obrigatoriedade, limite de escolhas e quantos itens são cortesia.
  Nas opções: nome, preço e se está ativa.
- **Mesas e QR Codes** — adicionar, remover, desativar mesas, gerar novo código e imprimir
  uma folha com um cartão por mesa, pronta para recortar.
- **Segurança** — troca da senha de acesso.

---

## Decisões técnicas

**Zero dependências.** Uma loja não pode depender de `npm install` funcionando, nem de
internet no dia da instalação. Todo o servidor usa só módulos nativos do Node.

**Gerador de QR Code próprio.** Implementado do zero seguindo a ISO/IEC 18004
([`public/js/qrcode.js`](public/js/qrcode.js)): campo de Galois GF(256), correção de erros
Reed–Solomon, seleção automática de versão (1 a 10), as 8 máscaras com avaliação de
penalidade e cálculo BCH da informação de formato. Validado contra os números da
especificação e por um decodificador independente que lê a matriz de volta.

**Tempo real por SSE, não WebSocket.** *Server-Sent Events* resolvem o caso — o fluxo é só
do servidor para o navegador — e são nativos dos dois lados, sem biblioteca. Reconectam
sozinhos e atravessam proxies HTTP comuns.

**O preço nunca vem do navegador.** O cliente envia apenas os identificadores das opções
escolhidas; o servidor recalcula tudo a partir do cardápio. Adulterar a página não muda o
valor cobrado.

**Persistência em JSON.** Para uma loja com uma dúzia de mesas, um banco seria peso morto.
A gravação é atômica (arquivo temporário + `rename`).

### Estrutura

```
acai-demo/
├── server.js              servidor (Node puro, sem dependências)
├── data/                  dados em JSON, criados no primeiro arranque
├── privado/               páginas servidas só pelas rotas do painel
│   ├── caixa.html
│   └── admin.html
└── public/
    ├── index.html         formulário do cliente
    ├── css/estilos.css
    └── js/
        ├── pedido.js      fluxo do cliente
        ├── caixa.js       quadro de pedidos
        ├── admin.js       editor de cardápio e mesas
        ├── painel-comum.js  login, API e tempo real
        └── qrcode.js      gerador de QR Code
```

---

## Segurança

Estas proteções estão **ativas nesta demo**, com o mesmo código da versão de produção:

- **Acesso por token de mesa.** Cada mesa tem um código próprio; sem o par mesa + código o
  cardápio não abre, e o código de uma mesa não funciona em outra.
- **Preço calculado no servidor**, nunca aceito do cliente.
- **Senha com `scrypt` e sal**, jamais guardada em texto puro.
- **Bloqueio por tentativas** — 15 minutos após 5 erros de senha, por IP.
- **Limite de envios** por IP, para evitar avalanche de pedidos falsos.
- **Cookie `HttpOnly` + `SameSite=Strict`**, com `Secure` acrescentado automaticamente sob
  HTTPS.
- **CSP restritiva**, `nosniff`, `Referrer-Policy: no-referrer` e HSTS sob HTTPS.
- **Páginas do painel fora de `public/`**, servidas apenas pelas rotas configuradas — não
  existe um segundo caminho tipo `/caixa.html`.
- **Proteção contra travessia de diretório** no servidor de arquivos.

### Diferenças para a versão de produção

Três valores de partida foram trocados por versões previsíveis, **só para facilitar a
avaliação**. Cada ponto está comentado no código, com a instrução do que usar em produção.

| Item | Nesta demo | Em produção |
| --- | --- | --- |
| Códigos de mesa | `demo-mesa-1`, `demo-mesa-2`… | aleatórios de 72 bits (`novoToken(9)`) |
| Senha do painel | `demo1234`, divulgada aqui | definida pelo dono, mínimo 6 caracteres |
| Endereços do painel | `/caixa` e `/admin` | sorteados no 1º arranque ou fixados em `ROTA_CAIXA` / `ROTA_ADMIN` |

O motivo de cada troca:

- **Códigos previsíveis** deixam qualquer pessoa abrir o formulário pelo link do README.
  Em uso real, é o valor aleatório que impede alguém de adivinhar a URL de uma mesa.
- **Senha divulgada** é necessária para o avaliador entrar no painel.
- **`/caixa` e `/admin`** são os primeiros caminhos que varredores automáticos tentam. Em
  produção o endereço é imprevisível, como camada extra — a proteção principal continua
  sendo a senha com bloqueio.

Para converter esta cópia em instalação real: troque a senha na administração, gere novos
códigos para todas as mesas pelo botão **Novo código**, e defina `ROTA_CAIXA` e
`ROTA_ADMIN` no ambiente.

---

## Configuração

| Variável | Para que serve |
| --- | --- |
| `PORT` | Porta do servidor (padrão 3000). |
| `DATA_DIR` | Onde gravar os JSON. Aponte para um disco persistente na hospedagem. |
| `TRUST_PROXY` | `1` quando houver um proxy HTTPS na frente. |
| `ROTA_CAIXA` | Endereço do caixa, sem barras. |
| `ROTA_ADMIN` | Endereço da administração. |

> **`TRUST_PROXY` só deve ser ligado se realmente houver um proxy.** Com ele ativo o
> servidor confia no cabeçalho `X-Forwarded-For` para identificar o cliente; exposto direto,
> qualquer um forjaria o próprio IP e escaparia do limite de envios.

### Colocar no ar

O QR Code só funciona de qualquer lugar se o servidor estiver acessível pela internet.
Dois caminhos:

**Túnel** (Cloudflare Tunnel) — o computador da loja continua servindo, mas ganha domínio
fixo e HTTPS. Nada muda no código e os dados seguem num disco de verdade. Exige o PC ligado.

**Hospedagem** (Render, Railway, Fly.io, VPS) — o PC não precisa ficar ligado. Exige um
**disco persistente** apontado por `DATA_DIR`: sem ele, cada publicação recria a pasta de
dados, sorteia novos códigos de mesa e **todos os QR Codes já impressos param de
funcionar**.

Em ambos os casos, ligue `TRUST_PROXY=1` e coloque o domínio no campo *endereço dos QR
Codes*, na administração, antes de imprimir os cartões.

---

## Onde ficam os dados

Arquivos JSON em `data/`, criados sozinhos no primeiro arranque:

| Arquivo | Conteúdo |
| --- | --- |
| `menu.json` | cardápio e identidade da loja |
| `mesas.json` | mesas e seus códigos |
| `pedidos.json` | histórico de pedidos (numeração reinicia a cada dia) |
| `config.json` | senha (com sal), endereço dos QR Codes e rotas do painel |

A pasta `data/` está no `.gitignore` — em uma instalação real ela contém os códigos das
mesas e o hash da senha, e nunca deve ir para um repositório. Para zerar tudo, apague os
arquivos e reinicie: eles voltam ao estado inicial.

---

## Problemas comuns

**Abri com o Live Server e o site aparece sem estilo.** O Live Server é um servidor de
arquivos estáticos; este projeto tem backend. Os caminhos são absolutos (`/css/estilos.css`)
e resolvem a partir da raiz que o `server.js` publica. Rode `node server.js`.

**O celular não abre o QR Code.** Confirme que ele está no mesmo Wi‑Fi e que o endereço dos
QR Codes usa o IP da máquina, não `localhost`.

**Não toca o som de pedido novo.** Alguns navegadores só liberam áudio após um clique na
página. Clique uma vez no caixa depois de abrir.

**Esqueci a senha.** Apague `data/config.json` e reinicie: ela volta para `demo1234`.

---

## Licença

MIT.
