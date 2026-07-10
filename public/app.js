// ===== Estado =====
let me = null;            // usuário logado
let team = [];            // equipe (apenas admin)
let tasks = [];
let stats = null;
let view = 'dashboard';   // dashboard | tasks
let filter = 'todas';
let priorityFilter = 'todas';
let memberFilter = 'todos';
let editingId = null;

const PRIORITY_LABELS = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

// ===== Helpers =====
const $ = (id) => document.getElementById(id);

const icon = (name, size = 16) =>
  `<svg width="${size}" height="${size}"><use href="#i-${name}"/></svg>`;

async function api(path, options = {}) {
  // Token da sessão vai no header Authorization — funciona em iframe/webview,
  // onde o cookie pode ser bloqueado pelo navegador.
  const token = localStorage.getItem('sid');
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('sid');
    location.href = '/login.html';
    throw new Error('Sessão expirada');
  }
  if (res.status === 204) return null;
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
  return body;
}

function initials(name) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function avatarEl(user, small = false) {
  const span = document.createElement('span');
  span.className = `avatar${small ? ' sm' : ''}`;
  span.style.background = user.color || 'var(--accent)';
  span.textContent = initials(user.name);
  span.title = user.name;
  return span;
}

function inputToIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function isoToInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDue(iso) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function formatHours(h) {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} dias`;
}

// Tempo relativo curto (ex.: "há 2 h", "há 3 dias") para a atividade recente.
function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} dia(s)`;
}

// ===== Toast (substitui alert) =====
function toast(message, type = 'error') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ===== Modal de confirmação (substitui confirm) =====
function confirmDialog(message, title = 'Excluir tarefa') {
  return new Promise((resolve) => {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = message;
    $('confirm-modal').hidden = false;

    const close = (answer) => {
      $('confirm-modal').hidden = true;
      $('confirm-ok').onclick = null;
      $('confirm-cancel').onclick = null;
      $('confirm-modal').onclick = null;
      resolve(answer);
    };

    $('confirm-ok').onclick = () => close(true);
    $('confirm-cancel').onclick = () => close(false);
    $('confirm-modal').onclick = (e) => {
      if (e.target === $('confirm-modal')) close(false);
    };
  });
}

// ===== Skeletons =====
function showSkeletons() {
  if (view === 'dashboard') {
    $('stats-grid').innerHTML = '<div class="skeleton skeleton-tile"></div>'.repeat(4);
    $('chart').innerHTML = '<div class="skeleton skeleton-block"></div>';
  } else {
    $('task-list').innerHTML = '<li class="skeleton skeleton-task"></li>'.repeat(3);
  }
}

// ===== Inicialização =====
async function init() {
  try {
    me = await api('/auth/me');
  } catch {
    return; // já redirecionou pro login
  }

  // Cabeçalho do usuário logado
  $('me-avatar').replaceWith(Object.assign(avatarEl(me), { id: 'me-avatar' }));
  $('me-name').textContent = me.name;
  $('me-role').textContent = me.role === 'admin' ? 'Administrador' : 'Membro';

  if (me.role === 'admin') {
    $('team-block').hidden = false;
    $('member-filter-wrap').hidden = false;
    await loadTeam();
    switchView('dashboard');
  } else {
    // Membro não tem dashboard de equipe — vai direto para as tarefas.
    $('nav-dashboard').style.display = 'none';
    switchView('tasks');
  }

  await loadTasks();
}

// ===== Navegação entre views =====
function switchView(next) {
  view = next;
  const dash = $('view-dashboard');
  const tsk = $('view-tasks');
  dash.hidden = view !== 'dashboard';
  tsk.hidden = view !== 'tasks';
  // Reinicia a animação fadeUp da view que entrou
  const active = view === 'dashboard' ? dash : tsk;
  active.style.animation = 'none';
  void active.offsetHeight; // força reflow
  active.style.animation = '';
  $('view-title').textContent = view === 'dashboard' ? 'Dashboard' : 'Tarefas';
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  closeSidebar();
  if (view === 'dashboard' && me?.role === 'admin') loadStats();
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ===== Sidebar mobile =====
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-backdrop').classList.remove('show');
}

$('menu-btn').addEventListener('click', () => {
  $('sidebar').classList.add('open');
  $('sidebar-backdrop').classList.add('show');
});
$('sidebar-backdrop').addEventListener('click', closeSidebar);

$('logout-btn').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  localStorage.removeItem('sid');
  location.href = '/login.html';
});

// ===== Equipe (sidebar) =====
async function loadTeam() {
  team = await api('/users');
  const list = $('team-list');
  list.replaceChildren(
    ...team.map((u) => {
      const li = document.createElement('li');
      li.append(avatarEl(u, true), document.createTextNode(u.name));
      return li;
    }),
  );

  // Filtro de membro (view de tarefas)
  const sel = $('member-filter');
  sel.replaceChildren(new Option('Todos', 'todos'));
  team.forEach((u) => sel.append(new Option(u.name, String(u._id))));
  sel.value = memberFilter;
}

// ===== Dashboard =====
async function loadStats() {
  showSkeletons();
  stats = await api('/stats');
  renderStatTiles();
  renderChart();
  renderCapacity();
  renderActivity();
}

// Tendência do dia calculada no cliente a partir do last7days já retornado.
function todayTrend() {
  const days = stats.last7days;
  const today = days[days.length - 1] ?? { created: 0, completed: 0 };
  return { createdToday: today.created, completedToday: today.completed };
}

function renderStatTiles() {
  const t = stats.totals;
  const { createdToday, completedToday } = todayTrend();

  const tiles = [
    {
      label: 'Tarefas concluídas', value: t.completed, iconName: 'check', iconCls: 'green',
      sub: completedToday > 0 ? `▲ ${completedToday} concluída(s) hoje` : `de ${t.tasks} no total`,
      cls: completedToday > 0 ? 'good' : '',
    },
    {
      label: 'Taxa de conclusão', value: `${t.completionRate}%`, iconName: 'trend', iconCls: '',
      sub: 'de todas as tarefas', cls: t.completionRate >= 50 ? 'good' : '',
    },
    {
      label: 'Pendentes', value: t.pending, iconName: 'clock', iconCls: t.overdue ? 'red' : 'amber',
      sub: t.overdue ? `⚠ ${t.overdue} vencida(s)` : 'nenhuma vencida',
      cls: t.overdue ? 'bad' : 'good',
    },
    {
      label: 'Tempo médio de conclusão', value: formatHours(t.avgCompletionHours), iconName: 'timer', iconCls: '',
      sub: createdToday > 0 ? `▲ ${createdToday} criada(s) hoje` : 'da criação à conclusão',
      cls: '',
    },
  ];

  $('stats-grid').replaceChildren(
    ...tiles.map(({ label, value, sub, cls, iconName, iconCls }) => {
      const div = document.createElement('div');
      div.className = 'card stat-tile';
      div.innerHTML = `
        <div class="stat-top">
          <span class="stat-icon ${iconCls}">${icon(iconName, 17)}</span>
          <span class="stat-label">${label}</span>
        </div>
        <span class="stat-value">${value}</span>
        <span class="stat-sub ${cls}">${sub}</span>`;
      return div;
    }),
  );
}

// Gráfico de linhas suaves com área em gradiente (SVG feito à mão — sem biblioteca)
function renderChart() {
  const days = stats.last7days;
  const W = 560, H = 200, padTop = 14, padBottom = 28, padLeft = 28, padRight = 14;
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;

  // Teto múltiplo de 3 para as linhas da grade caírem em valores inteiros.
  const rawMax = Math.max(1, ...days.flatMap((d) => [d.created, d.completed]));
  const max = Math.ceil(rawMax / 3) * 3;

  const x = (i) => padLeft + (days.length === 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  const y = (v) => padTop + innerH - (v / max) * innerH;
  const pts = (key) => days.map((d, i) => [x(i), y(d[key])]);

  // Curva suave por Bézier cúbica (Catmull-Rom simplificado).
  const smooth = (p) => {
    let d = `M ${p[0][0]} ${p[0][1]}`;
    for (let i = 1; i < p.length; i++) {
      const p0 = p[i - 2] || p[i - 1];
      const p1 = p[i - 1];
      const p2 = p[i];
      const p3 = p[i + 1] || p[i];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
    }
    return d;
  };

  // Fecha a curva até a base para formar a área preenchida.
  const base = padTop + innerH;
  const area = (p) => `${smooth(p)} L ${p[p.length - 1][0]} ${base} L ${p[0][0]} ${base} Z`;

  const created = pts('created');
  const completed = pts('completed');

  let svg = `<defs>
    <linearGradient id="area-created" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="area-completed" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#22c55e" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#22c55e" stop-opacity="0"/>
    </linearGradient>
  </defs>`;

  // Grade horizontal + rótulos do eixo Y
  for (let i = 0; i <= 3; i++) {
    const gy = padTop + (innerH / 3) * i;
    const val = Math.round(max * (1 - i / 3));
    svg += `<line class="chart-grid" x1="${padLeft}" y1="${gy}" x2="${W - padRight}" y2="${gy}"/>`;
    svg += `<text class="chart-label" x="${padLeft - 8}" y="${gy + 3}" text-anchor="end">${val}</text>`;
  }

  // Áreas em gradiente por baixo, depois as linhas por cima
  svg += `<path class="area-created" d="${area(created)}"/>`;
  svg += `<path class="area-completed" d="${area(completed)}"/>`;
  svg += `<path class="line-created" d="${smooth(created)}"/>`;
  svg += `<path class="line-completed" d="${smooth(completed)}"/>`;

  // Pontos com tooltip + rótulos do eixo X
  days.forEach((d, i) => {
    const [, m, day] = d.date.split('-');
    const label = `${day}/${m}`;
    svg += `<circle class="chart-dot dot-c1" cx="${x(i)}" cy="${y(d.created)}" r="3.5"><title>${label}: ${d.created} criada(s)</title></circle>`;
    svg += `<circle class="chart-dot dot-c2" cx="${x(i)}" cy="${y(d.completed)}" r="3.5"><title>${label}: ${d.completed} concluída(s)</title></circle>`;
    svg += `<text class="chart-label" x="${x(i)}" y="${H - 8}" text-anchor="middle">${label}</text>`;
  });

  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
}

function renderCapacity() {
  $('capacity-list').replaceChildren(
    ...stats.members.map((m) => {
      const li = document.createElement('li');
      li.className = 'capacity-item';

      const info = document.createElement('div');
      info.className = 'capacity-info';
      const pct = m.total ? Math.round((m.completed / m.total) * 100) : 0;
      info.innerHTML = `
        <div class="capacity-top">
          <span class="capacity-name">${m.name}</span>
          <span>
            <span class="capacity-count">${m.completed}/${m.total}${m.overdue ? ` · <span class="late">${m.overdue} vencida(s)</span>` : ''}</span>
            <span class="capacity-pct">${pct}%</span>
          </span>
        </div>
        <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>`;

      li.append(avatarEl(m), info);
      return li;
    }),
  );
}

// Atividade recente — derivada das tarefas já carregadas (sem endpoint novo).
function renderActivity() {
  const list = $('activity-list');
  if (!list) return;

  const events = [];
  for (const t of tasks) {
    const owner = team.find((u) => String(u._id) === t.userId);
    const who = owner ? owner.name : 'Alguém';
    if (t.createdAt) events.push({ at: t.createdAt, who, what: t.name, verb: 'criou', done: false });
    if (t.completedAt) events.push({ at: t.completedAt, who, what: t.name, verb: 'concluiu', done: true });
  }
  events.sort((a, b) => (a.at < b.at ? 1 : -1));

  const top = events.slice(0, 5);
  if (top.length === 0) {
    list.innerHTML = '<li class="activity-item"><span class="activity-text">Nenhuma atividade ainda.</span></li>';
    return;
  }

  list.replaceChildren(
    ...top.map((e) => {
      const li = document.createElement('li');
      li.className = 'activity-item';
      li.innerHTML = `
        <span class="activity-dot${e.done ? ' green' : ''}"></span>
        <span class="activity-text"><strong>${e.who}</strong> ${e.verb} <strong>${e.what}</strong></span>
        <span class="activity-when">${timeAgo(e.at)}</span>`;
      return li;
    }),
  );
}

// ===== Tarefas =====
async function loadTasks() {
  try {
    if (view === 'tasks') showSkeletons();
    tasks = await api('/items');
    $('error-state').hidden = true;
    renderTasks();
    if (me?.role === 'admin' && stats) renderActivity();
  } catch (err) {
    $('task-list').replaceChildren();
    $('error-state').textContent = `Não foi possível carregar as tarefas: ${err.message}`;
    $('error-state').hidden = false;
  }
}

function renderTasks() {
  const visible = tasks.filter((t) => {
    const statusOk = filter === 'todas' || t.status === filter;
    const priorityOk = priorityFilter === 'todas' || t.priority === priorityFilter;
    const memberOk = memberFilter === 'todos' || t.userId === memberFilter;
    return statusOk && priorityOk && memberOk;
  });

  $('empty-state').hidden = visible.length > 0;
  $('task-list').replaceChildren(...visible.map(renderTask));
}

function renderTask(task) {
  const li = document.createElement('li');
  const prio = task.priority ?? 'media';
  li.className = `task prio-${prio}${task.status === 'concluida' ? ' done' : ''}`;

  if (editingId === task._id) {
    li.appendChild(renderEditForm(task));
    return li;
  }

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'task-toggle';
  toggle.checked = task.status === 'concluida';
  toggle.title = toggle.checked ? 'Marcar como pendente' : 'Marcar como concluída';
  toggle.addEventListener('change', () => toggleStatus(task));

  const body = document.createElement('div');
  body.className = 'task-body';

  const name = document.createElement('div');
  name.className = 'task-name';
  name.textContent = task.name;
  body.appendChild(name);

  if (task.description) {
    const desc = document.createElement('div');
    desc.className = 'task-description';
    desc.textContent = task.description;
    body.appendChild(desc);
  }

  body.appendChild(renderMeta(task));

  const actions = document.createElement('div');
  actions.className = 'task-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn';
  editBtn.innerHTML = icon('edit', 15);
  editBtn.title = 'Editar';
  editBtn.addEventListener('click', () => {
    editingId = task._id;
    renderTasks();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn delete';
  deleteBtn.innerHTML = icon('trash', 15);
  deleteBtn.title = 'Excluir';
  deleteBtn.addEventListener('click', () => removeTask(task));

  actions.append(editBtn, deleteBtn);
  li.append(toggle, body, actions);
  return li;
}

function renderMeta(task) {
  const meta = document.createElement('div');
  meta.className = 'task-meta';

  const priority = task.priority ?? 'media';
  const prio = document.createElement('span');
  prio.className = `badge badge-priority ${priority}`;
  prio.textContent = PRIORITY_LABELS[priority] ?? priority;
  meta.appendChild(prio);

  if (task.dueDate) {
    const overdue = task.status === 'pendente' && new Date(task.dueDate) < new Date();
    const due = document.createElement('span');
    due.className = `badge badge-due${overdue ? ' overdue' : ''}`;
    due.textContent = `${overdue ? '⚠️' : '📅'} ${formatDue(task.dueDate)}`;
    meta.appendChild(due);
  }

  // Admin vê de quem é cada tarefa.
  if (me.role === 'admin') {
    const owner = team.find((u) => String(u._id) === task.userId);
    if (owner) {
      const chip = document.createElement('span');
      chip.className = 'badge badge-owner';
      chip.append(avatarEl(owner, true), document.createTextNode(owner.name));
      meta.appendChild(chip);
    }
  }

  return meta;
}

function renderEditForm(task) {
  const editForm = document.createElement('form');
  editForm.className = 'task-edit-form';

  const nameField = document.createElement('input');
  nameField.type = 'text';
  nameField.value = task.name;
  nameField.maxLength = 120;
  nameField.required = true;

  const descField = document.createElement('input');
  descField.type = 'text';
  descField.value = task.description ?? '';
  descField.maxLength = 300;
  descField.placeholder = 'Descrição (opcional)';

  const row = document.createElement('div');
  row.className = 'edit-fields';

  const prioField = document.createElement('select');
  for (const value of ['baixa', 'media', 'alta']) {
    const opt = new Option(PRIORITY_LABELS[value], value, false, (task.priority ?? 'media') === value);
    prioField.appendChild(opt);
  }

  const dueField = document.createElement('input');
  dueField.type = 'datetime-local';
  dueField.value = isoToInputValue(task.dueDate);

  row.append(prioField, dueField);

  const actions = document.createElement('div');
  actions.className = 'edit-actions';

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn-primary btn-small';
  save.textContent = 'Salvar';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-ghost btn-small';
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => {
    editingId = null;
    renderTasks();
  });

  actions.append(save, cancel);
  editForm.append(nameField, descField, row, actions);

  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const updated = await api(`/items/${task._id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: nameField.value.trim(),
          description: descField.value.trim() || null,
          priority: prioField.value,
          dueDate: inputToIso(dueField.value),
        }),
      });
      tasks = tasks.map((t) => (t._id === task._id ? updated : t));
      editingId = null;
      renderTasks();
      toast('Tarefa atualizada', 'success');
    } catch (err) {
      toast(err.message);
    }
  });

  requestAnimationFrame(() => nameField.focus());
  return editForm;
}

async function toggleStatus(task) {
  const status = task.status === 'concluida' ? 'pendente' : 'concluida';
  try {
    const updated = await api(`/items/${task._id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    tasks = tasks.map((t) => (t._id === task._id ? updated : t));
    renderTasks();
  } catch (err) {
    toast(err.message);
    renderTasks();
  }
}

async function removeTask(task) {
  const ok = await confirmDialog(`Excluir a tarefa "${task.name}"? Essa ação não pode ser desfeita.`);
  if (!ok) return;
  try {
    await api(`/items/${task._id}`, { method: 'DELETE' });
    tasks = tasks.filter((t) => t._id !== task._id);
    renderTasks();
    toast('Tarefa excluída', 'success');
  } catch (err) {
    toast(err.message);
  }
}

$('new-task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const created = await api('/items', {
      method: 'POST',
      body: JSON.stringify({
        name: $('new-name').value.trim(),
        description: $('new-description').value.trim() || null,
        priority: $('new-priority').value,
        dueDate: inputToIso($('new-due-date').value),
      }),
    });
    tasks.push(created);
    e.target.reset();
    $('new-name').focus();
    renderTasks();
    toast('Tarefa criada', 'success');
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
  }
});

// ===== Filtros =====
document.querySelectorAll('.filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    filter = btn.dataset.filter;
    document.querySelectorAll('.filter').forEach((b) => b.classList.toggle('active', b === btn));
    renderTasks();
  });
});

$('priority-filter').addEventListener('change', (e) => {
  priorityFilter = e.target.value;
  renderTasks();
});

$('member-filter').addEventListener('change', (e) => {
  memberFilter = e.target.value;
  renderTasks();
});

// ===== Modal: adicionar membro =====
$('open-add-user').addEventListener('click', () => {
  $('user-modal').hidden = false;
  $('user-name').focus();
});
$('close-add-user').addEventListener('click', () => ($('user-modal').hidden = true));
$('user-modal').addEventListener('click', (e) => {
  if (e.target === $('user-modal')) $('user-modal').hidden = true;
});

$('add-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('user-error');
  errEl.hidden = true;
  try {
    await api('/users', {
      method: 'POST',
      body: JSON.stringify({
        name: $('user-name').value.trim(),
        email: $('user-email').value.trim(),
        password: $('user-password').value,
        role: $('user-role').value,
      }),
    });
    e.target.reset();
    $('user-modal').hidden = true;
    toast('Membro adicionado', 'success');
    await loadTeam();
    if (view === 'dashboard') await loadStats();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

init();
