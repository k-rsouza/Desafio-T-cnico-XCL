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
docker-compose.yml   # serviço do MongoDB
.env.example         # modelo de variáveis de ambiente
```

> Persistência via **MongoDB** (driver nativo `mongodb`, sem ODM). Os dados
> sobrevivem a reinícios do servidor, guardados no volume Docker `mongo-data`.

## Endpoints

Recurso de exemplo: `items`. Campos enviados: `name` (obrigatório) e
`description` (opcional). O banco adiciona automaticamente `_id`, `createdAt`
e `updatedAt`.

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
