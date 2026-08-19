# Açaí Demo — QR Code ordering

**[Versão em português](README.pt.md)**

An ordering system for açaí shops. The customer scans the QR Code on their table, builds the
order on their own phone, and it shows up instantly on the cashier's computer — replacing
the paper order slip.

Built with **plain Node.js and browser JavaScript, with zero external dependencies**. No
`npm install`: install Node and run.

> Açaí is a Brazilian frozen berry dessert, served in a cup and customised with toppings —
> think frozen yoghurt, but purple.

---

> ### About this version
>
> This is a **demo build**, published as a work sample. It is the same software running the
> same code, but with a **generic brand, password, table codes and panel routes** in place
> of any real shop's data.
>
> Everything genuinely works: ordering, live updates, QR Code generation, menu editing.
> Only the starting values were swapped for predictable ones, so anyone can open and
> evaluate the system in a minute with no setup.
>
> The differences are listed under [Differences from the production build](#differences-from-the-production-build),
> and each one is commented in the source itself.

---

## Running it in a minute

Only requirement: **Node.js 18 or newer**.

```bash
node server.js
```

The terminal prints the three addresses. Open them in this order:

| Screen | Address | Access |
| --- | --- | --- |
| Customer (table 1) | `http://localhost:3000/?m=1&t=demo-mesa-1` | via the QR Code link |
| Cashier | `http://localhost:3000/caixa` | password `demo1234` |
| Admin | `http://localhost:3000/admin` | password `demo1234` |

Tables 1 to 12 exist, with codes `demo-mesa-1` through `demo-mesa-12`.

> The interface is in Brazilian Portuguese, since it was built for a Brazilian shop. The
> flow is visual enough to follow without the language: *Quantos açaís?* = "How many?",
> *Avançar* = "Next", *Enviar pedido* = "Send order", *Iniciar preparo* = "Start preparing",
> *Marcar pronto* = "Mark as ready".

### Suggested walkthrough

1. Open the **cashier** in one window and the **customer** page in another, side by side.
2. On the customer page, pick 2 açaís and build each one.
3. Send it. The order lands on the cashier board **instantly**, with a sound alert and no
   page reload.
4. On the cashier board, click *Iniciar preparo*, then *Marcar pronto*. The customer screen
   follows along live.
5. In **admin**, change a price or disable an option, save, then reload the customer form to
   see it applied.

### Testing on a phone

The terminal prints two sets of addresses: the `localhost` ones, for use on this computer,
and the network ones (something like `http://192.168.15.6:3000`), which work from any device
on the same Wi‑Fi — including opening the cashier board on another machine.

The **QR Codes already carry the network address**, even when you open the admin page through
`localhost`. That is deliberate: a QR Code pointing at `localhost` would only open on the
computer itself, never on a customer's phone. The admin page states which address is in use,
and the *Acesso ao painel pela rede* ("Panel access over the network") section lists the
cashier and admin links ready to copy.

To pin a different address — a domain, for instance — fill in the **endereço usado nos QR
Codes** ("address used in the QR Codes") field; it takes precedence over auto-detection.

---

## What the system does

### Customer — `/?m=<table>&t=<code>`

The form only opens with a valid table + code pair, which the QR Code carries. Typing the
address by hand lands on an access-denied screen.

1. **Quantity** — the customer picks how many açaís before starting.
2. **Building** — one açaí at a time, as checkbox groups, with navigation between them.
   Shows the running price and a free-text note for the kitchen.
3. **Review** — item-by-item summary with an edit option, customer name, and submit.

After sending, the screen tracks the status: received → preparing → ready → delivered. The
draft survives an accidental page reload.

### Cashier

A four-column board — new, preparing, ready, finished. Each new order drops in on its own
with a sound alert. Buttons move orders between columns, and the customer's phone reflects
the change immediately.

The top row shows the day's figures: orders waiting, total orders, total açaís and revenue.
The tab title carries the pending count, for staff who keep the window in the background.

### Admin

- **Shop identity** — name, cover headline and thank-you message.
- **Menu** — the customer form is generated from here. Create and remove categories,
  reorder them, switch between *single choice* (radio) and *multiple* (checkbox), set
  whether a category is required, the selection limit, and how many items are included free.
  Per option: name, price, and active state.
- **Tables and QR Codes** — add, remove or disable tables, regenerate a code, and print a
  sheet with one card per table, ready to cut out.
- **Security** — change the access password.

---

## Technical decisions

**Zero dependencies.** A shop cannot depend on `npm install` working, or on having internet
on installation day. The whole server uses only Node's built-in modules.

**Hand-written QR Code generator.** Implemented from scratch against ISO/IEC 18004
([`public/js/qrcode.js`](public/js/qrcode.js)): GF(256) Galois field arithmetic,
Reed–Solomon error correction, automatic version selection (1–10), all 8 masks with penalty
scoring, and BCH format-information computation. Validated against the specification's
figures and by an independent decoder that reads the matrix back.

**Live updates over SSE, not WebSocket.** Server-Sent Events fit the problem — the stream
only flows server-to-browser — and are native on both ends, with no library. They reconnect
on their own and pass through ordinary HTTP proxies.

**Prices never come from the browser.** The client sends only the identifiers of the
selected options; the server recomputes everything from the menu. Tampering with the page
does not change what gets charged.

**JSON persistence.** For a shop with a dozen tables, a database would be dead weight.
Writes are atomic (temp file + `rename`).

### Layout

```
acai-demo/
├── server.js              server (plain Node, no dependencies)
├── data/                  JSON data, created on first run
├── privado/               pages served only through the panel routes
│   ├── caixa.html         cashier
│   └── admin.html         admin
└── public/
    ├── index.html         customer form
    ├── css/estilos.css
    └── js/
        ├── pedido.js      customer flow
        ├── caixa.js       order board
        ├── admin.js       menu and table editor
        ├── painel-comum.js  login, API and live updates
        └── qrcode.js      QR Code generator
```

---

## Security

These protections are **active in this demo**, running the same code as the production
build:

- **Per-table token access.** Each table has its own code; without the table + code pair the
  menu will not open, and one table's code does not work on another.
- **Server-side pricing**, never taken from the client.
- **Password hashed with `scrypt` and a salt**, never stored in plain text.
- **Lockout on failed attempts** — 15 minutes after 5 wrong passwords, per IP.
- **Submission rate limiting** per IP, against floods of fake orders.
- **`HttpOnly` + `SameSite=Strict` cookie**, with `Secure` added automatically over HTTPS.
- **Restrictive CSP**, `nosniff`, `Referrer-Policy: no-referrer`, and HSTS over HTTPS.
- **Panel pages live outside `public/`**, served only through the configured routes — there
  is no second path such as `/caixa.html`.
- **Directory-traversal protection** in the static file server.

### Differences from the production build

Three starting values were swapped for predictable ones, **purely to make evaluation
easy**. Each is commented in the source, with a note on what production should use.

| Item | In this demo | In production |
| --- | --- | --- |
| Table codes | `demo-mesa-1`, `demo-mesa-2`… | random 72-bit values (`novoToken(9)`) |
| Panel password | `demo1234`, published here | chosen by the owner, minimum 6 characters |
| Panel routes | `/caixa` and `/admin` | randomised on first run, or pinned via `ROTA_CAIXA` / `ROTA_ADMIN` |

Why each one:

- **Predictable codes** let anyone open the customer form straight from the README link. In
  real use, the random value is exactly what stops someone guessing a table's URL.
- **A published password** is what lets a reviewer into the panel.
- **`/caixa` and `/admin`** are the first paths automated scanners try. In production the
  address is unguessable, as an extra layer — the real protection remains the password with
  its lockout.

To turn this copy into a real installation: change the password in admin, regenerate every
table code with the **Novo código** button, and set `ROTA_CAIXA` and `ROTA_ADMIN` in the
environment.

---

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | Server port (default 3000). |
| `DATA_DIR` | Where the JSON files are written. Point this at a persistent disk when hosting. |
| `TRUST_PROXY` | `1` when an HTTPS proxy sits in front. |
| `ROTA_CAIXA` | Cashier route, no slashes. |
| `ROTA_ADMIN` | Admin route. |

> **Only enable `TRUST_PROXY` if a proxy is genuinely in front.** With it on, the server
> trusts the `X-Forwarded-For` header to identify clients; exposed directly, anyone could
> forge their own IP and slip past the rate limit.

### Going live

The QR Code only works from anywhere if the server is reachable over the internet. Two
routes:

**Tunnel** (Cloudflare Tunnel) — the shop's computer keeps serving but gains a fixed domain
and HTTPS. Nothing changes in the code and the data stays on a real disk. Requires the
machine to stay on.

**Hosting** (Render, Railway, Fly.io, a VPS) — the shop's machine need not stay on.
Requires a **persistent disk** pointed at by `DATA_DIR`: without one, every deploy recreates
the data folder, generates new table codes, and **every QR Code already printed stops
working**.

Either way, set `TRUST_PROXY=1` and put the domain into the *QR Code address* field in admin
before printing the cards.

---

## Where the data lives

JSON files under `data/`, created automatically on first run:

| File | Contents |
| --- | --- |
| `menu.json` | menu and shop identity |
| `mesas.json` | tables and their codes |
| `pedidos.json` | order history (numbering resets daily) |
| `config.json` | password (salted), QR Code address and panel routes |

`data/` is in `.gitignore` — in a real installation it holds the table codes and the
password hash, and must never reach a repository. To reset everything, delete the files and
restart: they come back in their initial state.

---

## Troubleshooting

**I opened it with Live Server and the page has no styling.** Live Server is a static file
server; this project has a backend. Paths are absolute (`/css/estilos.css`) and resolve from
the root that `server.js` publishes. Run `node server.js` instead.

**My phone won't open the QR Code.** Check that it is on the same Wi‑Fi, and that the QR
Code address uses the machine's IP rather than `localhost`.

**No sound on new orders.** Some browsers only allow audio after a click on the page. Click
once on the cashier board after opening it.

**I forgot the password.** Delete `data/config.json` and restart: it goes back to
`demo1234`.

---

## Licence

MIT.
