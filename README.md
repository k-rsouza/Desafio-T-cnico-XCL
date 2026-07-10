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
┌──────────────┐      ┌─────────────────────┐      ┌──────────────┐
│  Navegador   │─────▶│  API + Frontend     │─────▶│              │
│ (frontend)   │◀─────│  Node.js/Express    │◀─────│   MongoDB    │
└──────────────┘      │  :3000 (no host)    │      │   :27017     │
                      └─────────────────────┘      │  (container) │
                                                    │              │
┌──────────────┐      ┌─────────────────────┐      │  publicado   │
│    E-mail    │◀─────│  n8n (automação)    │─────▶│  em :27018   │
│  (lembrete)  │      │  :5678 (container)  │      │   no host    │
└──────────────┘      └─────────────────────┘      └──────────────┘
```

- **API + Frontend**: rodam no host via `npm start`, acessam o Mongo em `localhost:27018`.
- **MongoDB e n8n**: sobem via Docker Compose, na mesma rede. O n8n acessa o
  Mongo pelo nome do serviço (`mongo:27017`).
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
└── server.js            # servidor Express + rotas do CRUD (tudo em um arquivo)
public/                  # frontend (servido pelo próprio Express)
├── index.html           # estrutura da página
├── styles.css           # estilo responsivo (mobile-first, tema claro/escuro)
└── app.js               # lógica: chama a API via fetch e renderiza as tarefas
docker-compose.yml       # serviços mongo + n8n
.env.example             # modelo de variáveis de ambiente
postman_collection.json  # coleção do Postman para testar a API
```

---

## API REST

Recurso: `items` (tarefas). Campos aceitos no corpo (JSON):

| Campo         | Obrigatório | Valores / formato                                | Padrão     |
| ------------- | ----------- | ------------------------------------------------ | ---------- |
| `name`        | sim         | texto                                            | —          |
| `description` | não         | texto ou `null`                                  | `null`     |
| `status`      | não         | `pendente` \| `concluida`                        | `pendente` |
| `priority`    | não         | `baixa` \| `media` \| `alta`                     | `media`    |
| `dueDate`     | não         | data ISO (ex.: `2026-07-15T14:30:00Z`) ou `null` | `null`     |

O banco adiciona automaticamente `_id`, `createdAt` e `updatedAt`. Valores
inválidos em `status`, `priority` ou `dueDate` retornam **400**.

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
em `http://localhost:3000`.

- Criar, editar, concluir (checkbox) e excluir tarefas
- Definir **prioridade** (dropdown) e **prazo** (data + hora) na criação
- Filtrar por **status** (todas / pendentes / concluídas) e por **prioridade**
- Badge de prioridade colorido e badge de prazo (vira ⚠️ vermelho quando vencido)
- Responsiva (mobile e desktop) e com **tema claro/escuro** automático

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

Um workflow no n8n roda diariamente, busca as tarefas **pendentes que já
venceram ou vencem nas próximas 24h** e envia um **e-mail** com a lista.

### Fluxo do workflow

```
Schedule Trigger  →  MongoDB (Find)  →  Code (monta e-mail)  →  Send Email (SMTP)
  (todo dia 08h)      (query filtro)     (return [] se vazio)     (Gmail SMTP)
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

### 2. Nó MongoDB (Find)

- **Operation:** `Find`
- **Collection:** `items`
- **Query (JSON Format)** — a query final do lembrete (campo em **modo
  expressão**, por causa da data dinâmica):

```json
{
  "status": "pendente",
  "dueDate": {
    "$ne": null,
    "$lte": "{{ $now.plus({ hours: 24 }).toUTC().toISO() }}"
  }
}
```

Como funciona: `$now.plus({ hours: 24 }).toUTC().toISO()` gera a data de "agora +
24h" em ISO UTC (ex.: `2026-07-11T05:14:00.000Z`) — **mesmo formato** em que o
`dueDate` é salvo. O `$lte` (menor ou igual) pega tudo que vence até esse limite,
ou seja, o que **já venceu** e o que **vence nas próximas 24h**.

> Query mais simples para testar a conexão (retorna todas as pendentes com
> prazo): `{ "status": "pendente", "dueDate": { "$ne": null } }`

### 3. Nó Code (monta o corpo do e-mail)

Linguagem JavaScript, modo **"Run Once for All Items"**. Transforma as tarefas
em uma lista HTML única. A primeira linha (`return []`) garante que **nenhum
e-mail é enviado quando não há tarefas** — evita spam diário:

```javascript
const tarefas = $input.all().map(i => i.json);

// Sem tarefas vencendo? Não retorna nada -> Send Email é pulado (sem e-mail vazio).
if (tarefas.length === 0) return [];

const prioridade = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const agora = new Date();
const fmt = (iso) => new Date(iso).toLocaleString('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

const linhas = tarefas.map((t) => {
  const vencida = new Date(t.dueDate) < agora;
  const marca = vencida ? '⚠️ <strong>VENCIDA</strong>' : '📅';
  return `<li><strong>${t.name}</strong> — prioridade ${prioridade[t.priority] || t.priority} — ${marca} ${fmt(t.dueDate)}</li>`;
}).join('');

const html = `
  <h2>⏰ Tarefas a vencer</h2>
  <p>Você tem ${tarefas.length} tarefa(s) que já venceram ou vencem nas próximas 24h:</p>
  <ul>${linhas}</ul>
`;

return [{ json: { html, total: tarefas.length } }];
```

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
| To Email     | destinatário do lembrete       |
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
