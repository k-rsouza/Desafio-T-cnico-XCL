import express from 'express';
import { connect } from './db.js';
import { authRouter, requireAuth } from './auth.js';
import { itemsRouter } from './items.js';
import { teamRouter } from './team.js';

const PORT = process.env.PORT || 3000;

const { client, db } = await connect();

// Migração: tarefas concluídas antes do campo completedAt existir
// passam a usar o updatedAt como data de conclusão (aproximação razoável).
await db.collection('items').updateMany(
  { status: 'concluida', completedAt: { $exists: false } },
  [{ $set: { completedAt: '$updatedAt' } }],
);

const app = express();
app.use(express.json());
// Serve o frontend (pasta public/) — http://localhost:3000 abre a interface.
app.use(express.static('public'));

// Healthcheck (público)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Autenticação (registro do 1º admin, login, logout, sessão atual)
app.use('/auth', authRouter(db));

// Rotas protegidas — exigem sessão válida.
app.use('/items', requireAuth(db), itemsRouter(db));
app.use('/', requireAuth(db), teamRouter(db)); // /users e /stats (admin)

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
