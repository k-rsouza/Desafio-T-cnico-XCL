# Desafio XCL — Gerenciador de Tarefas

Aplicação completa de gerenciamento de tarefas: **API REST + frontend** em
Node.js, **MongoDB** para persistência e uma **automação no n8n** que envia
e-mail de lembrete das tarefas a vencer.

## Sumário

- [Arquitetura](#arquitetura)
- [Requisitos](#requisitos)
- [Configuração e execução](#configuração-e-execução)
- [Estrutura do projeto](#estrutura-do-projeto)
- [API REST](#api-rest)
- [Frontend](#frontend)
- [Banco de dados (MongoDB)](#banco-de-dados-mongodb)
- [Automação de lembretes (n8n)](#automação-de-lembretes-n8n)
- [Scripts úteis](#scripts-úteis)
- [Troubleshooting](#troubleshooting)

---

## Arquitetura

```
┌──────────────────────────────────────────────────┐
│  NAVEGADOR — frontend (public/)                    │
│  login · dashboard · tarefas                       │
└───────────────────────┬────────────────────────────┘
        requisições HTTP/JSON  (token no header Authorization)
                        │  ▲ respostas
                        ▼  │
┌──────────────────────────────────────────────────┐
│  API — Express / Node  ·  :3000 (host)             │
│  serve os estáticos de public/  +  rotas REST:     │
│  /auth · /items · /users · /stats                  │
└───────────────────────┬────────────────────────────┘
                driver mongodb
                        │  ▲
                        ▼  │
┌──────────────────────────────────────────────────┐
│  MongoDB  ·  :27017 (container) / :27018 (host)    │
│  coleções:  users · items · sessions               │
└───────────────────────▲────────────────────────────┘
                        │  lê direto (agregação)
┌───────────────────────┴────────────────────────────┐
│  n8n  ·  :5678 (container)                          │
│  Schedule diário → agrupa tarefas a vencer por      │──▶  E-mail
│  dono → envia um lembrete a cada pessoa             │    (Gmail SMTP)
└──────────────────────────────────────────────────┘
```

O fluxo de cima para baixo: o **navegador** faz requisições para a **API**, que
por sua vez fala com o **MongoDB**; as respostas voltam pelo mesmo caminho. Pontos
importantes:

- **A API serve o próprio frontend.** Os arquivos de `public/` são entregues como
  estáticos pelo Express, então UI e API vivem no mesmo servidor (`:3000`, mesma
  origem — sem CORS).
- **O MongoDB é a fonte única de dados.** Roda em container e é publicado no host
  na porta `27018` (dentro do container continua `27017`).
- **O n8n é um consumidor independente.** Não passa pela API: lê o Mongo
  diretamente (por agregação) e envia os e-mails de lembrete. Sobe junto no
  Docker Compose, na mesma rede, e acessa o banco pelo nome do serviço
  (`mongo:27017`).
- **Persistência**: driver nativo `mongodb` (sem ODM). Dados no volume `mongo-data`.

---

## Requisitos

- Node.js 18+ (testado na v25)
- Docker + Docker Compose

---

## Configuração e execução

```bash
npm install
cp .env.example .env    # ajuste se necessário

docker compose up -d    # 1) sobe MongoDB + n8n
npm start               # 2) inicia API + frontend
# npm run dev           #    (alternativa com reload automático via --watch)
```

Acessos:

| Serviço            | URL                       |
| ------------------ | ------------------------- |
| API + Frontend     | http://localhost:3000     |
| n8n (automações)   | http://localhost:5678     |
| MongoDB (do host)  | mongodb://localhost:27018 |

Parar os containers: `docker compose down` (dados preservados nos volumes
`mongo-data` e `n8n-data`; use `down -v` para apagá-los).

### Variáveis de ambiente (`.env`)

| Variável    | Padrão                      | Descrição              |
| ----------- | --------------------------- | ---------------------- |
| `PORT`      | `3000`                      | Porta do servidor HTTP |
| `MONGO_URL` | `mongodb://localhost:27018` | Conexão da API com o Mongo |
| `MONGO_DB`  | `desafio_xcl`               | Nome do banco          |

> **Por que a porta 27018?** O MongoDB é publicado no host na **27018** (e não na
> padrão 27017) para não conflitar com outros MongoDB locais. **Dentro** do
> container ele continua na 27017 — daí a diferença de porta entre quem acessa
> de fora (host → 27018) e de dentro do Docker (n8n → 27017).

---

## Estrutura do projeto

```
src/
├── server.js   # ponto de entrada da API (detalhado abaixo)
├── db.js       # abre a conexão com o MongoDB
├── auth.js     # autenticação: senhas, sessões, middlewares e rotas /auth
├── items.js    # CRUD de tarefas (rotas /items)
└── team.js     # equipe e dashboard (rotas /users e /stats)
public/         # frontend, servido como estático pela própria API
├── login.html  # login / criação do 1º admin
├── index.html  # app (sidebar, dashboard, tarefas)
├── styles.css  # tema dark responsivo (mobile-first)
└── app.js      # frontend: fetch com token, telas, gráfico SVG, CRUD, equipe
docker-compose.yml       # serviços mongo + n8n
.env.example             # modelo de variáveis de ambiente
postman_collection.json  # coleção do Postman para testar a API
```

### O que cada módulo do backend faz

**`server.js`** — ponto de entrada. Não é "só bootstrap": ele conecta no Mongo
(via `db.js`); roda uma **migração pontual** (tarefas concluídas antigas ganham
`completedAt`); configura os middlewares (`express.json` e
`express.static('public')`, que é o que serve o frontend); **monta os routers
aplicando os guards de autenticação** — `/auth` é público, enquanto `/items` e as
rotas de equipe (`/users`, `/stats`) passam pelo `requireAuth`; define o
`/health`, o 404 e o handler central de erros; sobe o servidor e fecha a conexão
no `Ctrl+C`.

**`db.js`** — lê o `.env`, abre o `MongoClient` e devolve `{ client, db }`.

**`auth.js`** — tudo de autenticação:
- `hashPassword` / `verifyPassword` (scrypt nativo)
- criação/validação de sessão e `getToken` (lê o token do header `Authorization`
  ou, como fallback, do cookie)
- middlewares `requireAuth` e `requireAdmin`
- rotas `/auth`: `bootstrap`, `dev-admin`, `register`, `login`, `logout`, `me`

**`items.js`** — o CRUD de tarefas. Traz os helpers de validação (`toObjectId`,
`parseDueDate`, listas `STATUSES` e `PRIORITIES`) e **5 rotas**, cada uma
aplicando a regra de posse (membro só mexe nas próprias; admin em qualquer uma):

| Rota                | O que faz                                                    |
| ------------------- | ------------------------------------------------------------ |
| GET `/items`        | lista (membro: só as suas; admin: todas)                     |
| GET `/items/:id`    | busca uma tarefa (checa posse)                               |
| POST `/items`       | cria — nasce do usuário logado, `completedAt = null`         |
| PUT `/items/:id`    | atualização **parcial**; ao concluir, grava `completedAt`    |
| DELETE `/items/:id` | remove (checa posse)                                         |

**`team.js`** — rotas exclusivas de admin: `GET /users` (lista a equipe),
`POST /users` (cadastra membro), `DELETE /users/:id` (remove, com as travas de
segurança) e `GET /stats` (monta as métricas do dashboard por agregação).

### Onde mora cada rota

| Prefixo                            | Arquivo      |
| ---------------------------------- | ------------ |
| `/health`                          | `server.js`  |
| `/auth/*`                          | `auth.js`    |
| `/items`, `/items/:id`             | `items.js`   |
| `/users`, `/users/:id`, `/stats`   | `team.js`    |

---

## Autenticação e papéis

A aplicação é multiusuário, com dois papéis:

- **admin** — vê o dashboard da equipe, todas as tarefas (com o dono de cada
  uma), cadastra membros pela interface e edita qualquer tarefa.
- **member** — cria, edita, conclui e exclui **apenas as próprias** tarefas.

Fluxo: na **primeira execução** (banco sem usuários), a tela de login vira
"Criar conta do administrador" — o primeiro usuário registrado é o admin e
herda as tarefas criadas antes do multiusuário. Depois disso o registro fecha
e só o admin cadastra novos usuários (botão **+** na sidebar, ou `POST /users`).

Sessões: token aleatório guardado na coleção `sessions` (7 dias). O login
devolve o token no corpo da resposta; o frontend guarda no `localStorage` e o
envia em **`Authorization: Bearer <token>`**. Um cookie httpOnly `sid` também é
setado como fallback (usado pelo Postman). O header é o caminho principal
porque funciona onde o cookie é bloqueado — dentro de iframes/webviews (ex.:
o preview mobile do VS Code, que renderiza a página num iframe de outra origem).
Senhas: hash com `scrypt` (nativo do Node, sem dependência).

| Método | Rota              | Descrição                              | Acesso  |
| ------ | ----------------- | -------------------------------------- | ------- |
| GET    | `/auth/bootstrap` | Diz se é a 1ª execução (sem usuários)  | público |
| POST   | `/auth/register`  | Cria o 1º usuário (admin) e loga       | público (só 1ª vez) |
| POST   | `/auth/dev-admin` | **Dev only.** Autentica qualquer e-mail passado como admin — cria ou promove, não importa o estado do banco | público |
| POST   | `/auth/login`     | Login com e-mail e senha               | público |
| POST   | `/auth/logout`    | Encerra a sessão                       | logado  |
| GET    | `/auth/me`        | Usuário da sessão atual                | logado  |
| GET    | `/users`          | Lista a equipe                         | admin   |
| POST   | `/users`          | Cadastra membro (`name`, `email`, `password`, `role`) | admin |
| DELETE | `/users/:id`      | Remove um membro                       | admin   |
| GET    | `/stats`          | Métricas do dashboard                  | admin   |

`DELETE /users/:id` recusa (400) remover a própria conta ou o único
administrador restante — evita a equipe ficar sem admin.

> **`/auth/dev-admin`:** atalho para testar pelo Postman sem precisar do banco
> vazio (o `/register` normal só funciona na 1ª execução). Passe
> `{ name, email, password }` — se o e-mail já existir, promove a admin e
> atualiza a senha; se não existir, cria. Sempre autentica na hora. Existe só
> para agilizar testes locais; não deixe exposta se este projeto sair do
> ambiente local (é um caminho de auto-promoção a admin sem nenhuma trava).

`GET /stats` retorna: totais (tarefas, concluídas, pendentes, vencidas, taxa
de conclusão, **tempo médio de conclusão** em horas), atividade dos últimos 7
dias (criadas × concluídas por dia) e a situação por membro.

## API REST

Recurso: `items` (tarefas). **Todas as rotas exigem sessão.** Membro opera só
as próprias tarefas; admin, todas. Campos aceitos no corpo (JSON):

| Campo         | Obrigatório | Valores / formato                                | Padrão     |
| ------------- | ----------- | ------------------------------------------------ | ---------- |
| `name`        | sim         | texto                                            | —          |
| `description` | não         | texto ou `null`                                  | `null`     |
| `status`      | não         | `pendente` \| `concluida`                        | `pendente` |
| `priority`    | não         | `baixa` \| `media` \| `alta`                     | `media`    |
| `dueDate`     | não         | data ISO (ex.: `2026-07-15T14:30:00Z`) ou `null` | `null`     |

O banco adiciona automaticamente `_id`, `userId` (dono), `createdAt`,
`updatedAt` e `completedAt` (preenchido ao concluir — base da métrica de tempo
médio). Valores inválidos em `status`, `priority` ou `dueDate` retornam **400**;
tarefa de outro dono, **403**.

### Rotas

| Método | Rota          | Descrição              | Sucesso |
| ------ | ------------- | ---------------------- | ------- |
| GET    | `/health`     | Healthcheck            | 200     |
| GET    | `/items`      | Lista todas as tarefas | 200     |
| GET    | `/items/:id`  | Busca uma por id       | 200     |
| POST   | `/items`      | Cria uma tarefa        | 201     |
| PUT    | `/items/:id`  | Atualiza (parcial)     | 200     |
| DELETE | `/items/:id`  | Remove                 | 204     |

> O `PUT` é uma atualização **parcial**: envie só os campos que quer mudar
> (ex.: `{"status":"concluida"}` marca como concluída sem tocar no resto).

### Exemplos

```bash
# Criar (com prioridade e prazo)
curl -X POST http://localhost:3000/items \
  -H "Content-Type: application/json" \
  -d '{"name":"Enviar proposta","priority":"alta","dueDate":"2026-07-15T14:30:00.000Z"}'

# Listar
curl http://localhost:3000/items

# Marcar como concluída
curl -X PUT http://localhost:3000/items/<id> \
  -H "Content-Type: application/json" \
  -d '{"status":"concluida"}'

# Remover
curl -X DELETE http://localhost:3000/items/<id>
```

Para testar no Postman, importe [`postman_collection.json`](postman_collection.json).

---

## Frontend

Interface web em HTML/CSS/JS puro (sem framework), servida pelo próprio Express
em `http://localhost:3000`. Tema **dark** de dashboard, com sidebar fixa
(gaveta no mobile).

**Dashboard (admin):**
- Stat tiles: concluídas, taxa de conclusão, pendentes/vencidas e tempo médio
  de conclusão
- Gráfico de barras (SVG feito à mão, sem biblioteca): criadas × concluídas
  nos últimos 7 dias
- Painel "Desempenho da equipe": avatar, progresso de conclusão e vencidas
  por membro
- Sidebar com a equipe e botão **+** para cadastrar membro (modal)

**Tarefas:**
- Criar, editar, concluir (checkbox) e excluir
- Prioridade (dropdown) e prazo (data + hora) na criação e na edição
- Filtros por status, prioridade e (admin) por **membro**
- Badges de prioridade, prazo (⚠️ quando vencido) e dono da tarefa (admin)

O campo de prazo usa `datetime-local` e a hora local é convertida para **ISO
UTC** no navegador antes de enviar — assim o horário fica sem ambiguidade de fuso.

---

## Banco de dados (MongoDB)

- **Banco:** `desafio_xcl` · **Coleção:** `items`
- Sem autenticação (uso local).
- Acesso visual pelo **MongoDB Compass**: conecte em `mongodb://localhost:27018`,
  abra o banco `desafio_xcl` → coleção `items`.

Exemplo de documento:

```json
{
  "_id": "6a50549a7e9408d786c41413",
  "name": "Enviar proposta ao cliente",
  "description": "Fechar contrato",
  "status": "pendente",
  "priority": "media",
  "dueDate": "2026-07-10T20:00:00.000Z",
  "createdAt": "2026-07-10T05:13:51.239Z",
  "updatedAt": "2026-07-10T05:13:51.239Z"
}
```

---

## Automação de lembretes (n8n)

Um workflow no n8n roda diariamente e envia um **lembrete pessoal**: cada
usuário recebe um e-mail só com **as próprias** tarefas **pendentes que já
venceram ou vencem nas próximas 24h**. O agrupamento por dono e o e-mail de
cada um saem de uma única agregação no Mongo (`$group` + `$lookup`).

### Fluxo do workflow

```
Schedule Trigger  →  MongoDB (Aggregate)  →  Code (1 e-mail por dono)  →  Send Email (SMTP)
  (todo dia 08h)      (agrupa por usuário)    (return [] se vazio)        (1 envio por pessoa)
```

O n8n sobe junto no `docker-compose.yml`, então não precisa de nenhuma
alteração no código da aplicação — a integração é feita lendo o Mongo direto.

### 1. Credencial do MongoDB

Na credencial MongoDB do n8n, use **Configuration Type: `Connection String`**
(o modo "Values" **não** funciona com Mongo sem senha — veja
[Troubleshooting](#troubleshooting)):

| Campo             | Valor                                 |
| ----------------- | ------------------------------------- |
| Configuration Type| `Connection String`                   |
| Connection String | `mongodb://mongo:27017/desafio_xcl`   |
| Database          | `desafio_xcl`                         |
| Use TLS           | desligado                             |

> **Importante:** dentro do n8n use `mongo:27017` (nome do serviço + porta
> interna), **não** `localhost:27018`. A string não pode ter `@` (não há
> usuário/senha).

### 2. Nó MongoDB (Aggregate)

- **Operation:** `Aggregate`
- **Collection:** `items`
- **Query (JSON Format)** — pipeline que filtra as pendentes vencendo, agrupa
  por dono e junta com `users` para pegar nome/e-mail (campo em **modo
  expressão**, por causa da data dinâmica):

```json
[
  { "$match": { "status": "pendente", "dueDate": { "$ne": null, "$lte": "{{ $now.plus({ hours: 24 }).toUTC().toISO() }}" } } },
  { "$group": { "_id": "$userId", "tasks": { "$push": { "name": "$name", "priority": "$priority", "dueDate": "$dueDate" } } } },
  { "$addFields": { "userObjId": { "$toObjectId": "$_id" } } },
  { "$lookup": { "from": "users", "localField": "userObjId", "foreignField": "_id", "as": "user" } },
  { "$unwind": "$user" },
  { "$project": { "_id": 0, "email": "$user.email", "name": "$user.name", "tasks": 1 } }
]
```

Como funciona: `$now.plus({ hours: 24 }).toUTC().toISO()` gera a data de "agora +
24h" em ISO UTC — **mesmo formato** em que o `dueDate` é salvo, então o `$lte`
compara certo (pega o vencido e o que vence em 24h). O `$group` junta as tarefas
por `userId`; o `$toObjectId` + `$lookup` traz nome e e-mail do dono. Saída: um
documento **por pessoa**, no formato `{ email, name, tasks: [...] }`.

### 3. Nó Code (um e-mail por pessoa)

Linguagem JavaScript, modo **"Run Once for All Items"**. Recebe um grupo por
pessoa e devolve um item por pessoa (com o HTML personalizado). O `return []`
garante que **nenhum e-mail é enviado quando não há ninguém com tarefa vencendo**:

```javascript
const grupos = $input.all().map((i) => i.json);
if (grupos.length === 0) return []; // ninguém com tarefa vencendo -> nenhum e-mail

const prioridade = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const agora = new Date();
const fmt = (iso) => new Date(iso).toLocaleString('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

return grupos.map((g) => {
  const linhas = g.tasks.map((t) => {
    const vencida = new Date(t.dueDate) < agora;
    const marca = vencida ? '⚠️ <strong>VENCIDA</strong>' : '📅';
    return `<li><strong>${t.name}</strong> — prioridade ${prioridade[t.priority] || t.priority} — ${marca} ${fmt(t.dueDate)}</li>`;
  }).join('');
  const html = `<h2>⏰ Olá, ${g.name}!</h2><p>Estas tarefas suas já venceram ou vencem nas próximas 24h:</p><ul>${linhas}</ul>`;
  return { json: { email: g.email, name: g.name, html, total: g.tasks.length } };
});
```

Cada item de saída vira um e-mail — o Send Email roda uma vez por item, então
sai **um e-mail por pessoa**.

### 4. Nó Send Email (SMTP)

Optamos pelo nó **Send Email** (SMTP) em vez do nó Gmail (OAuth2) por ser bem
mais simples de configurar. Com Gmail, gere uma **senha de app**
([myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords),
requer verificação em 2 etapas ativa).

Credencial SMTP:

| Campo    | Valor              |
| -------- | ------------------ |
| Host     | `smtp.gmail.com`   |
| Port     | `465`              |
| User     | seu-email@gmail.com|
| Password | senha de app (16 letras) |
| SSL/TLS  | ligado             |

Campos do nó:

| Campo        | Valor                          |
| ------------ | ------------------------------ |
| From Email   | seu-email@gmail.com (= User)   |
| To Email     | `={{ $json.email }}` (dinâmico — cada pessoa recebe o seu) |
| Subject      | `⏰ Você tem tarefas a vencer`  |
| Email Format | HTML                           |
| HTML         | `={{ $json.html }}`            |

> O **From** precisa ser a mesma conta do SMTP — o Gmail não deixa enviar em
> nome de outro endereço.

### Por que não precisa de nó de código na aplicação (sem webhook)

O lembrete é disparado pela **passagem do tempo** (prazo se aproximando), não por
uma ação na aplicação. Por isso o gatilho certo é o **Schedule** do n8n lendo o
banco — não um webhook/hook no código. Um webhook só faria sentido para reações
**imediatas a eventos** (ex.: "notificar assim que uma tarefa é criada").

---

## Scripts úteis

Comandos `mongosh` executados no container (`docker exec desafio-xcl-mongo
mongosh ...`) durante o desenvolvimento.

**Migração — preencher campos novos em documentos antigos.** Ao introduzir
`status`, `priority` e `dueDate`, as tarefas criadas antes ficaram sem esses
campos (não apareciam nos filtros). Backfill:

```javascript
const db = db.getSiblingDB("desafio_xcl");
db.items.updateMany({ status:   { $exists: false } }, { $set: { status: "pendente" } });
db.items.updateMany({ priority: { $exists: false } }, { $set: { priority: "media" } });
db.items.updateMany({ dueDate:  { $exists: false } }, { $set: { dueDate: null } });
```

**Inserir tarefas de teste** (uma vencida, uma vencendo em 24h, uma distante):

```javascript
const db = db.getSiblingDB("desafio_xcl");
const now = new Date().toISOString();
db.items.insertMany([
  { name: "Pagar fornecedor", status: "pendente", priority: "alta",  dueDate: "2026-07-08T12:00:00.000Z", createdAt: now, updatedAt: now },
  { name: "Enviar proposta",  status: "pendente", priority: "media", dueDate: "2026-07-10T20:00:00.000Z", createdAt: now, updatedAt: now },
  { name: "Planejar Q4",      status: "pendente", priority: "baixa", dueDate: "2026-09-01T12:00:00.000Z", createdAt: now, updatedAt: now }
]);
```

**Simular a query do lembrete** (a mesma que o n8n roda):

```javascript
const db = db.getSiblingDB("desafio_xcl");
const limite = new Date(Date.now() + 24*60*60*1000).toISOString();
db.items.find(
  { status: "pendente", dueDate: { $ne: null, $lte: limite } }
).sort({ dueDate: 1 }).toArray();
```

---

## Troubleshooting

Erros reais que enfrentamos configurando o n8n e como resolvê-los.

| Erro no n8n | Causa | Solução |
| ----------- | ----- | ------- |
| `URI contained empty userinfo section` | Modo "Values" (ou string com `@`) gera `mongodb://:@host` com usuário/senha vazios | Use **Connection String** `mongodb://mongo:27017/desafio_xcl`, sem `@`, User/Password vazios |
| `getaddrinfo ENOTFOUND host.docker.internal` | n8n em container não resolve o host quando não há host-gateway | Rode o n8n no **mesmo compose** do Mongo e use o nome do serviço `mongo` |
| `getaddrinfo ENOTFOUND desafio-xcl-mongo` | n8n estava em outra rede Docker / cache de DNS do processo antigo | Colocar ambos no mesmo compose resolve por construção |
| TLS handshake / erro ao conectar | "Use TLS" ligado, mas o Mongo local não usa TLS | **Desligue** o Use TLS |

**Regra de ouro da conexão:**

- **De fora do Docker** (Compass, API no host): `mongodb://localhost:27018`
- **De dentro do Docker** (n8n): `mongodb://mongo:27017`

Nunca use `localhost` dentro de um container — ali `localhost` é o próprio
container, não a máquina.
