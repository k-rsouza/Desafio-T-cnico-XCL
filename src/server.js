import express from 'express';
import { randomUUID } from 'node:crypto';

const app = express();
app.use(express.json());

// "Banco de dados" em memória. Troque por um banco real quando o desafio exigir.
const items = new Map();

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// LISTAR
app.get('/items', (req, res) => {
  res.json([...items.values()]);
});

// BUSCAR POR ID
app.get('/items/:id', (req, res) => {
  const item = items.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado' });
  res.json(item);
});

// CRIAR
app.post('/items', (req, res) => {
  const { name, description } = req.body ?? {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'O campo "name" é obrigatório e deve ser texto' });
  }
  const now = new Date().toISOString();
  const item = {
    id: randomUUID(),
    name: name.trim(),
    description: description ?? null,
    createdAt: now,
    updatedAt: now,
  };
  items.set(item.id, item);
  res.status(201).json(item);
});

// ATUALIZAR
app.put('/items/:id', (req, res) => {
  const item = items.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado' });

  const { name, description } = req.body ?? {};
  if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
    return res.status(400).json({ error: 'O campo "name" deve ser um texto não vazio' });
  }

  if (name !== undefined) item.name = name.trim();
  if (description !== undefined) item.description = description;
  item.updatedAt = new Date().toISOString();

  res.json(item);
});

// REMOVER
app.delete('/items/:id', (req, res) => {
  if (!items.has(req.params.id)) {
    return res.status(404).json({ error: 'Item não encontrado' });
  }
  items.delete(req.params.id);
  res.status(204).send();
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
