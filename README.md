# Desafio XCL

CRUD básico em Node.js com Express. Base inicial do projeto — a
implementação será estendida conforme as especificações do desafio.

## Requisitos

- Node.js 18+ (testado na v25)
- Docker + Docker Compose (para subir o MongoDB)

## Configuração

```bash
npm install
cp .env.example .env   # ajuste as variáveis se necessário
```

Variáveis de ambiente (ver `.env.example`):

| Variável    | Padrão                       | Descrição              |
| ----------- | ---------------------------- | ---------------------- |
| `PORT`      | `3000`                       | Porta do servidor HTTP |
| `MONGO_URL` | `mongodb://localhost:27018`  | Conexão com o MongoDB  |
| `MONGO_DB`  | `desafio_xcl`                | Nome do banco          |

## Execução

```bash
docker compose up -d   # 1) sobe o MongoDB
npm start              # 2) inicia o servidor
# npm run dev          #    (alternativa com reload automático via --watch)
```

O servidor sobe em `http://localhost:3000`. Para parar o banco: `docker compose down`
(os dados ficam guardados no volume `mongo-data`; use `down -v` para apagá-los).

> **Sobre a porta 27018:** o MongoDB é exposto no host na porta **27018** (e não
> na padrão 27017) para não conflitar com outros MongoDB que você já tenha
> rodando localmente. Dentro do container, continua na 27017.

## Estrutura

```
src/
└── server.js        # servidor Express + rotas do CRUD (tudo em um arquivo)
public/              # frontend (servido pelo próprio Express)
├── index.html       # estrutura da página
├── styles.css       # estilo responsivo (mobile-first, tema claro/escuro)
└── app.js           # lógica: chama a API via fetch e renderiza as tarefas
docker-compose.yml   # serviço do MongoDB
.env.example         # modelo de variáveis de ambiente
```

## Frontend

Interface web em HTML/CSS/JS puro (sem framework), servida pelo próprio
Express — abra `http://localhost:3000` no navegador com o servidor rodando.

- Criar, editar, concluir e excluir tarefas
- Filtros: todas / pendentes / concluídas
- Responsiva (mobile e desktop) e com tema claro/escuro automático
  (segue a preferência do sistema)

> Persistência via **MongoDB** (driver nativo `mongodb`, sem ODM). Os dados
> sobrevivem a reinícios do servidor, guardados no volume Docker `mongo-data`.

## Endpoints

Recurso de exemplo: `items`. Campos enviados:

| Campo         | Obrigatório | Valores / formato                            | Padrão     |
| ------------- | ----------- | -------------------------------------------- | ---------- |
| `name`        | sim         | texto                                        | —          |
| `description` | não         | texto ou `null`                              | `null`     |
| `status`      | não         | `pendente` \| `concluida`                    | `pendente` |
| `priority`    | não         | `baixa` \| `media` \| `alta`                 | `media`    |
| `dueDate`     | não         | data ISO (ex.: `2026-07-15T14:30:00Z`) ou `null` | `null`     |

O banco adiciona automaticamente `_id`, `createdAt` e `updatedAt`.

> **Prazo (`dueDate`) e n8n:** a data é guardada em ISO UTC, formato que
> ordena e compara por intervalo. Uma automação no n8n pode buscar tarefas
> a vencer consultando o Mongo (`{ status: "pendente", dueDate: { $lte: <limite>, $ne: null } }`)
> ou a própria API. Se quiser, dá pra adicionar filtros por query na rota
> `GET /items` (ex.: `?status=pendente&dueBefore=...`) para facilitar isso.

| Método | Rota          | Descrição                  | Status |
| ------ | ------------- | -------------------------- | ------ |
| GET    | `/health`     | Healthcheck                | 200    |
| GET    | `/items`      | Lista todos os itens       | 200    |
| GET    | `/items/:id`  | Busca um item por id       | 200    |
| POST   | `/items`      | Cria um item               | 201    |
| PUT    | `/items/:id`  | Atualiza um item           | 200    |
| DELETE | `/items/:id`  | Remove um item             | 204    |

### Exemplos

```bash
# Criar
curl -X POST http://localhost:3000/items \
  -H "Content-Type: application/json" \
  -d '{"name":"Primeiro item","description":"Um exemplo"}'

# Listar
curl http://localhost:3000/items

# Buscar por id
curl http://localhost:3000/items/<id>

# Atualizar
curl -X PUT http://localhost:3000/items/<id> \
  -H "Content-Type: application/json" \
  -d '{"name":"Nome atualizado"}'

# Remover
curl -X DELETE http://localhost:3000/items/<id>
```
