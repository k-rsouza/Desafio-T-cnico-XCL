# Desafio XCL

CRUD básico em Node.js com Express. Base inicial do projeto — a
implementação será estendida conforme as especificações do desafio.

## Requisitos

- Node.js 18+ (testado na v25)

## Instalação

```bash
npm install
```

## Execução

```bash
npm start      # inicia o servidor
npm run dev    # inicia com reload automático (--watch)
```

O servidor sobe em `http://localhost:3000` (porta configurável via variável
de ambiente `PORT`).

## Estrutura

```
src/
└── server.js   # servidor Express + rotas do CRUD (tudo em um arquivo)
```

> O armazenamento é **em memória** por enquanto (os dados são perdidos ao
> reiniciar). Quando o desafio exigir um banco de dados, dá pra separar em
> camadas — por ora, um arquivo só mantém o projeto simples de ler.

## Endpoints

Recurso de exemplo: `items` (campos: `name`, `description`).

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
