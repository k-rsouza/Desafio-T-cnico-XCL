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
  $('view-dashboard').hidden = view !== 'dashboard';
  $('view-tasks').hidden = view !== 'tasks';
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
  stats = await api('/stats');
  renderStatTiles();
  renderChart();
  renderCapacity();
}

function renderStatTiles() {
  const t = stats.totals;
  const tiles = [
    { label: 'Tarefas concluídas', value: t.completed, sub: `de ${t.tasks} no total`, cls: '' },
    { label: 'Taxa de conclusão', value: `${t.completionRate}%`, sub: 'de todas as tarefas', cls: t.completionRate >= 50 ? 'good' : '' },
    { label: 'Pendentes', value: t.pending, sub: t.overdue ? `⚠️ ${t.overdue} vencida(s)` : 'nenhuma vencida', cls: t.overdue ? 'bad' : 'good' },
    { label: 'Tempo médio de conclusão', value: formatHours(t.avgCompletionHours), sub: 'da criação à conclusão', cls: '' },
  ];
  $('stats-grid').replaceChildren(
    ...tiles.map(({ label, value, sub, cls }) => {
      const div = document.createElement('div');
      div.className = 'card stat-tile';
      div.innerHTML = `
        <span class="stat-label">${label}</span>
        <span class="stat-value">${value}</span>
        <span class="stat-sub ${cls}">${sub}</span>`;
      return div;
    }),
  );
}

// Gráfico de barras (SVG feito à mão — sem biblioteca)
function renderChart() {
  const days = stats.last7days;
  const W = 560, H = 190, padX = 10, padTop = 12, padBottom = 26;
  const innerH = H - padTop - padBottom;
  const max = Math.max(1, ...days.flatMap((d) => [d.created, d.completed]));
  const groupW = (W - padX * 2) / days.length;
  const barW = Math.min(16, groupW / 3.2);

  let svg = '';
  // linhas de grade horizontais
  for (let i = 0; i <= 3; i++) {
    const y = padTop + (innerH / 3) * i;
    svg += `<line class="chart-grid" x1="${padX}" y1="${y}" x2="${W - padX}" y2="${y}"/>`;
  }
  days.forEach((d, i) => {
    const cx = padX + i * groupW + groupW / 2;
    const h1 = (d.created / max) * innerH;
    const h2 = (d.completed / max) * innerH;
    svg += `<rect class="bar-created" x="${cx - barW - 1.5}" y="${padTop + innerH - h1}" width="${barW}" height="${Math.max(h1, 2)}" rx="3"/>`;
    svg += `<rect class="bar-completed" x="${cx + 1.5}" y="${padTop + innerH - h2}" width="${barW}" height="${Math.max(h2, 2)}" rx="3"/>`;
    const [, m, day] = d.date.split('-');
    svg += `<text class="chart-label" x="${cx}" y="${H - 8}" text-anchor="middle">${day}/${m}</text>`;
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
          <span class="capacity-count">${m.completed}/${m.total} concluídas${m.overdue ? ` · <span class="late">${m.overdue} vencida(s)</span>` : ''}</span>
        </div>
        <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>`;

      li.append(avatarEl(m), info);
      return li;
    }),
  );
}

// ===== Tarefas =====
async function loadTasks() {
  try {
    tasks = await api('/items');
    $('error-state').hidden = true;
    renderTasks();
  } catch (err) {
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
  li.className = `task${task.status === 'concluida' ? ' done' : ''}`;

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
  editBtn.textContent = '✏️';
  editBtn.title = 'Editar';
  editBtn.addEventListener('click', () => {
    editingId = task._id;
    renderTasks();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn delete';
  deleteBtn.textContent = '🗑️';
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
    } catch (err) {
      alert(err.message);
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
    alert(err.message);
    renderTasks();
  }
}

async function removeTask(task) {
  if (!confirm(`Excluir a tarefa "${task.name}"?`)) return;
  try {
    await api(`/items/${task._id}`, { method: 'DELETE' });
    tasks = tasks.filter((t) => t._id !== task._id);
    renderTasks();
  } catch (err) {
    alert(err.message);
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
  } catch (err) {
    alert(err.message);
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
    await loadTeam();
    if (view === 'dashboard') await loadStats();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

init();
