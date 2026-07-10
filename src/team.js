import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { requireAdmin, hashPassword, publicUser, validateNewUser, AVATAR_COLORS } from './auth.js';

export function teamRouter(db) {
  const router = Router();
  const users = db.collection('users');
  const items = db.collection('items');

  // LISTAR EQUIPE (admin)
  router.get('/users', requireAdmin, async (req, res, next) => {
    try {
      const all = await users.find().toArray();
      res.json(all.map(publicUser));
    } catch (err) {
      next(err);
    }
  });

  // ADICIONAR MEMBRO (admin) — cadastrado pela interface, cai na coleção `users`.
  router.post('/users', requireAdmin, async (req, res, next) => {
    try {
      const error = validateNewUser(req.body ?? {});
      if (error) return res.status(400).json({ error });

      const { name, email, password, role } = req.body;
      if (role !== undefined && !['admin', 'member'].includes(role)) {
        return res.status(400).json({ error: 'O campo "role" deve ser "admin" ou "member"' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (await users.findOne({ email: normalizedEmail })) {
        return res.status(409).json({ error: 'Já existe um usuário com esse e-mail' });
      }

      const count = await users.countDocuments();
      const user = {
        name: name.trim(),
        email: normalizedEmail,
        password: hashPassword(password),
        role: role ?? 'member',
        color: AVATAR_COLORS[count % AVATAR_COLORS.length],
        createdAt: new Date().toISOString(),
      };
      const { insertedId } = await users.insertOne(user);
      res.status(201).json(publicUser({ _id: insertedId, ...user }));
    } catch (err) {
      next(err);
    }
  });

  // REMOVER MEMBRO (admin) — não pode se autodeletar nem remover o último admin.
  router.delete('/users/:id', requireAdmin, async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }
      const _id = new ObjectId(req.params.id);

      if (_id.equals(req.user._id)) {
        return res.status(400).json({ error: 'Você não pode remover a própria conta' });
      }

      const target = await users.findOne({ _id });
      if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });

      if (target.role === 'admin') {
        const adminCount = await users.countDocuments({ role: 'admin' });
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Não é possível remover o único administrador' });
        }
      }

      await users.deleteOne({ _id });
      await db.collection('sessions').deleteMany({ userId: String(_id) });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // ESTATÍSTICAS DO DASHBOARD (admin)
  router.get('/stats', requireAdmin, async (req, res, next) => {
    try {
      const [allUsers, allItems] = await Promise.all([
        users.find().toArray(),
        items.find().toArray(),
      ]);

      const now = new Date();
      const nowIso = now.toISOString();
      const completed = allItems.filter((t) => t.status === 'concluida');
      const pending = allItems.filter((t) => t.status === 'pendente');
      const overdue = pending.filter((t) => t.dueDate && t.dueDate < nowIso);

      // Tempo médio de conclusão (criação -> conclusão), em horas.
      const durations = completed
        .filter((t) => t.completedAt && t.createdAt)
        .map((t) => new Date(t.completedAt) - new Date(t.createdAt))
        .filter((ms) => ms >= 0);
      const avgCompletionHours = durations.length
        ? durations.reduce((a, b) => a + b, 0) / durations.length / 3_600_000
        : null;

      // Últimos 7 dias: tarefas criadas e concluídas por dia (datas em UTC).
      const last7days = [];
      for (let i = 6; i >= 0; i--) {
        const day = new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        last7days.push({
          date: day,
          created: allItems.filter((t) => t.createdAt?.slice(0, 10) === day).length,
          completed: completed.filter((t) => t.completedAt?.slice(0, 10) === day).length,
        });
      }

      // Situação por membro da equipe.
      const members = allUsers.map((u) => {
        const mine = allItems.filter((t) => t.userId === String(u._id));
        const mineDone = mine.filter((t) => t.status === 'concluida');
        return {
          _id: u._id,
          name: u.name,
          role: u.role,
          color: u.color,
          total: mine.length,
          completed: mineDone.length,
          pending: mine.length - mineDone.length,
          overdue: mine.filter((t) => t.status === 'pendente' && t.dueDate && t.dueDate < nowIso).length,
        };
      });

      res.json({
        totals: {
          tasks: allItems.length,
          completed: completed.length,
          pending: pending.length,
          overdue: overdue.length,
          completionRate: allItems.length ? Math.round((completed.length / allItems.length) * 100) : 0,
          avgCompletionHours,
        },
        last7days,
        members,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
