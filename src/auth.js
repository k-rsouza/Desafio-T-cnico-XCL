import { Router } from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// ===== Senhas (scrypt nativo do Node — sem dependência externa) =====
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = scryptSync(password, salt, 64);
  return timingSafeEqual(Buffer.from(hash, 'hex'), test);
}

// ===== Sessões (token aleatório guardado no Mongo, cookie httpOnly) =====
const SESSION_DAYS = 7;

function getCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

async function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.collection('sessions').insertOne({ token, userId: String(userId), expiresAt });
  return token;
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  );
}

// Lê o token da sessão: 1º do header Authorization (Bearer), depois do cookie.
// O header funciona em qualquer contexto (iframe do VS Code, webview, Postman);
// o cookie pode ser bloqueado pelo navegador dentro de iframe de outra origem.
function getToken(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return getCookie(req, 'sid');
}

// Cria a sessão, seta o cookie (fallback) e devolve o corpo já com o token,
// para o cliente guardar e mandar no header Authorization.
async function sessionResponse(db, res, user, status = 200) {
  const token = await createSession(db, user._id);
  setSessionCookie(res, token);
  return res.status(status).json({ ...publicUser(user), token });
}

// Remove o campo de senha antes de devolver um usuário ao cliente.
export function publicUser(user) {
  const { password, ...rest } = user;
  return rest;
}

// ===== Middlewares =====
// Anexa req.user se a sessão do cookie for válida; senão responde 401.
export function requireAuth(db) {
  return async (req, res, next) => {
    try {
      const token = getToken(req);
      if (!token) return res.status(401).json({ error: 'Não autenticado' });

      const session = await db.collection('sessions').findOne({ token });
      if (!session || session.expiresAt < new Date().toISOString()) {
        return res.status(401).json({ error: 'Sessão expirada' });
      }

      const { ObjectId } = await import('mongodb');
      const user = await db.collection('users').findOne({ _id: new ObjectId(session.userId) });
      if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });

      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas o administrador pode fazer isso' });
  }
  next();
}

// Cores para o avatar (iniciais) de cada usuário.
export const AVATAR_COLORS = ['#8b5cf6', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#f97316', '#3b82f6', '#a3e635'];

export function validateNewUser({ name, email, password }) {
  if (!name || typeof name !== 'string' || !name.trim()) return 'O campo "name" é obrigatório';
  if (!email || typeof email !== 'string' || !email.includes('@')) return 'E-mail inválido';
  if (!password || typeof password !== 'string' || password.length < 6) {
    return 'A senha deve ter pelo menos 6 caracteres';
  }
  return null;
}

// ===== Rotas =====
export function authRouter(db) {
  const router = Router();
  const users = db.collection('users');

  // Diz ao frontend se é a primeira execução (sem usuários -> criar conta admin).
  router.get('/bootstrap', async (req, res, next) => {
    try {
      res.json({ needsSetup: (await users.countDocuments()) === 0 });
    } catch (err) {
      next(err);
    }
  });

  // Atalho de desenvolvimento: autentica QUALQUER e-mail passado como admin,
  // não importa o estado do banco. Se o e-mail já existe, promove a admin e
  // atualiza a senha; se não existe, cria. Sempre loga (devolve o cookie).
  //
  // ⚠️ Existe só para agilizar testes locais pelo Postman — não tem a
  // restrição de "banco vazio" do /register. Não deixe essa rota exposta
  // se algum dia este projeto for além do ambiente local.
  router.post('/dev-admin', async (req, res, next) => {
    try {
      const error = validateNewUser(req.body ?? {});
      if (error) return res.status(400).json({ error });

      const { name, email, password } = req.body;
      const normalizedEmail = email.trim().toLowerCase();
      const now = new Date().toISOString();

      const existing = await users.findOne({ email: normalizedEmail });
      let userId;
      if (existing) {
        userId = existing._id;
        await users.updateOne(
          { _id: userId },
          { $set: { name: name.trim(), password: hashPassword(password), role: 'admin' } },
        );
      } else {
        const { insertedId } = await users.insertOne({
          name: name.trim(),
          email: normalizedEmail,
          password: hashPassword(password),
          role: 'admin',
          color: AVATAR_COLORS[(await users.countDocuments()) % AVATAR_COLORS.length],
          createdAt: now,
        });
        userId = insertedId;
      }

      // Tarefas órfãs (de antes do multiusuário) passam a pertencer a este admin.
      await db.collection('items').updateMany(
        { userId: { $exists: false } },
        { $set: { userId: String(userId) } },
      );

      const user = await users.findOne({ _id: userId });
      return sessionResponse(db, res, user, existing ? 200 : 201);
    } catch (err) {
      next(err);
    }
  });

  // Registro aberto APENAS para o primeiro usuário, que vira o admin.
  // Depois disso, só o admin cadastra membros (POST /users).
  router.post('/register', async (req, res, next) => {
    try {
      if ((await users.countDocuments()) > 0) {
        return res.status(403).json({ error: 'Registro fechado — peça ao administrador para criar sua conta' });
      }
      const error = validateNewUser(req.body ?? {});
      if (error) return res.status(400).json({ error });

      const { name, email, password } = req.body;
      const now = new Date().toISOString();
      const user = {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password: hashPassword(password),
        role: 'admin',
        color: AVATAR_COLORS[0],
        createdAt: now,
      };
      const { insertedId } = await users.insertOne(user);

      // Tarefas criadas antes do multiusuário passam a pertencer ao admin.
      await db.collection('items').updateMany(
        { userId: { $exists: false } },
        { $set: { userId: String(insertedId) } },
      );

      return sessionResponse(db, res, { _id: insertedId, ...user }, 201);
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const { email, password } = req.body ?? {};
      const user = email && (await users.findOne({ email: String(email).trim().toLowerCase() }));
      if (!user || !password || !verifyPassword(password, user.password)) {
        return res.status(401).json({ error: 'E-mail ou senha inválidos' });
      }
      return sessionResponse(db, res, user);
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = getToken(req);
      if (token) await db.collection('sessions').deleteOne({ token });
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireAuth(db), (req, res) => {
    res.json(publicUser(req.user));
  });

  return router;
}
