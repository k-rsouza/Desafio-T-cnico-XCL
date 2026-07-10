import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';

// Carrega variáveis do .env se o arquivo existir (recurso nativo do Node, sem dependência).
try {
  process.loadEnvFile('.env');
} catch {
  // .env é opcional — segue com os valores padrão abaixo.
}

const PORT = process.env.PORT || 3000;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const MONGO_DB = process.env.MONGO_DB || 'desafio_xcl';

// Conecta no Mongo antes de subir o servidor.
const client = new MongoClient(MONGO_URL);
await client.connect();
const items = client.db(MONGO_DB).collection('items');
console.log(`Conectado ao MongoDB em ${MONGO_URL} (db: ${MONGO_DB})`);

const app = express();
app.use(express.json());

// Converte o :id da URL em ObjectId, ou null se o formato for inválido.
function toObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// LISTAR
app.get('/items', async (req, res, next) => {
  try {
    res.json(await items.find().toArray());
  } catch (err) {
    next(err);
  }
});

// BUSCAR POR ID
app.get('/items/:id', async (req, res, next) => {
  try {
    const _id = toObjectId(req.params.id);
    const item = _id && (await items.findOne({ _id }));
    if (!item) return res.status(404).json({ error: 'Item não encontrado' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// Status válidos para uma tarefa. Toda tarefa nova nasce como "pendente".
const STATUSES = ['pendente', 'concluida'];

// CRIAR
app.post('/items', async (req, res, next) => {
  try {
    const { name, description, status } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'O campo "name" é obrigatório e deve ser texto' });
    }
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ error: `O campo "status" deve ser um de: ${STATUSES.join(', ')}` });
    }
    const now = new Date().toISOString();
    const item = {
      name: name.trim(),
      description: description ?? null,
      status: status ?? 'pendente',
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await items.insertOne(item);
    res.status(201).json({ _id: insertedId, ...item });
  } catch (err) {
    next(err);
  }
});

// ATUALIZAR
app.put('/items/:id', async (req, res, next) => {
  try {
    const _id = toObjectId(req.params.id);
    if (!_id) return res.status(404).json({ error: 'Item não encontrado' });

    const { name, description, status } = req.body ?? {};
    if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
      return res.status(400).json({ error: 'O campo "name" deve ser um texto não vazio' });
    }
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ error: `O campo "status" deve ser um de: ${STATUSES.join(', ')}` });
    }

    const changes = { updatedAt: new Date().toISOString() };
    if (name !== undefined) changes.name = name.trim();
    if (description !== undefined) changes.description = description;
    if (status !== undefined) changes.status = status;

    const item = await items.findOneAndUpdate(
      { _id },
      { $set: changes },
      { returnDocument: 'after' },
    );
    if (!item) return res.status(404).json({ error: 'Item não encontrado' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// REMOVER
app.delete('/items/:id', async (req, res, next) => {
  try {
    const _id = toObjectId(req.params.id);
    const result = _id && (await items.deleteOne({ _id }));
    if (!result || result.deletedCount === 0) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Rota não encontrada
app.use((req, res) => {
  res.status(404).json({ error: 'Recurso não encontrado' });
});

// Tratamento de erro (ex.: JSON inválido no corpo)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido no corpo da requisição' });
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});

// Encerra a conexão com o Mongo ao parar o processo (Ctrl+C).
process.on('SIGINT', async () => {
  await client.close();
  process.exit(0);
});
