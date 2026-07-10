import { Router } from 'express';
import { ObjectId } from 'mongodb';

const STATUSES = ['pendente', 'concluida'];
const PRIORITIES = ['baixa', 'media', 'alta'];

function toObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

// Normaliza o prazo: null/vazio/ausente = sem prazo; data inválida = erro.
function parseDueDate(value) {
  if (value === null || value === '' || value === undefined) return { ok: true, value: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false };
  return { ok: true, value: date.toISOString() };
}

export function itemsRouter(db) {
  const router = Router();
  const items = db.collection('items');

  // LISTAR — membro vê só as próprias tarefas; admin vê todas.
  router.get('/', async (req, res, next) => {
    try {
      const filter = req.user.role === 'admin' ? {} : { userId: String(req.user._id) };
      res.json(await items.find(filter).toArray());
    } catch (err) {
      next(err);
    }
  });

  // BUSCAR POR ID
  router.get('/:id', async (req, res, next) => {
    try {
      const _id = toObjectId(req.params.id);
      const item = _id && (await items.findOne({ _id }));
      if (!item) return res.status(404).json({ error: 'Tarefa não encontrada' });
      if (req.user.role !== 'admin' && item.userId !== String(req.user._id)) {
        return res.status(403).json({ error: 'Essa tarefa não é sua' });
      }
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  // CRIAR — a tarefa nasce pertencendo a quem a criou.
  router.post('/', async (req, res, next) => {
    try {
      const { name, description, status, priority, dueDate } = req.body ?? {};
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'O campo "name" é obrigatório e deve ser texto' });
      }
      if (status !== undefined && !STATUSES.includes(status)) {
        return res.status(400).json({ error: `O campo "status" deve ser um de: ${STATUSES.join(', ')}` });
      }
      if (priority !== undefined && !PRIORITIES.includes(priority)) {
        return res.status(400).json({ error: `O campo "priority" deve ser um de: ${PRIORITIES.join(', ')}` });
      }
      const due = parseDueDate(dueDate);
      if (!due.ok) {
        return res.status(400).json({ error: 'O campo "dueDate" deve ser uma data válida (ISO) ou null' });
      }

      const now = new Date().toISOString();
      const item = {
        name: name.trim(),
        description: description ?? null,
        status: status ?? 'pendente',
        priority: priority ?? 'media',
        dueDate: due.value,
        userId: String(req.user._id),
        completedAt: status === 'concluida' ? now : null,
        createdAt: now,
        updatedAt: now,
      };
      const { insertedId } = await items.insertOne(item);
      res.status(201).json({ _id: insertedId, ...item });
    } catch (err) {
      next(err);
    }
  });

  // ATUALIZAR (parcial) — membro só a própria tarefa; admin qualquer uma.
  router.put('/:id', async (req, res, next) => {
    try {
      const _id = toObjectId(req.params.id);
      const current = _id && (await items.findOne({ _id }));
      if (!current) return res.status(404).json({ error: 'Tarefa não encontrada' });
      if (req.user.role !== 'admin' && current.userId !== String(req.user._id)) {
        return res.status(403).json({ error: 'Essa tarefa não é sua' });
      }

      const { name, description, status, priority, dueDate } = req.body ?? {};
      if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
        return res.status(400).json({ error: 'O campo "name" deve ser um texto não vazio' });
      }
      if (status !== undefined && !STATUSES.includes(status)) {
        return res.status(400).json({ error: `O campo "status" deve ser um de: ${STATUSES.join(', ')}` });
      }
      if (priority !== undefined && !PRIORITIES.includes(priority)) {
        return res.status(400).json({ error: `O campo "priority" deve ser um de: ${PRIORITIES.join(', ')}` });
      }

      const now = new Date().toISOString();
      const changes = { updatedAt: now };
      if (name !== undefined) changes.name = name.trim();
      if (description !== undefined) changes.description = description;
      if (priority !== undefined) changes.priority = priority;
      if (status !== undefined && status !== current.status) {
        changes.status = status;
        // Registra QUANDO concluiu — base da métrica de tempo médio do dashboard.
        changes.completedAt = status === 'concluida' ? now : null;
      }
      if (dueDate !== undefined) {
        const due = parseDueDate(dueDate);
        if (!due.ok) {
          return res.status(400).json({ error: 'O campo "dueDate" deve ser uma data válida (ISO) ou null' });
        }
        changes.dueDate = due.value;
      }

      const item = await items.findOneAndUpdate({ _id }, { $set: changes }, { returnDocument: 'after' });
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  // REMOVER — mesma regra de posse.
  router.delete('/:id', async (req, res, next) => {
    try {
      const _id = toObjectId(req.params.id);
      const current = _id && (await items.findOne({ _id }));
      if (!current) return res.status(404).json({ error: 'Tarefa não encontrada' });
      if (req.user.role !== 'admin' && current.userId !== String(req.user._id)) {
        return res.status(403).json({ error: 'Essa tarefa não é sua' });
      }
      await items.deleteOne({ _id });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
