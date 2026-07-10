// ===== Estado =====
let tasks = [];              // todas as tarefas vindas da API
let filter = 'todas';        // filtro de status: todas | pendente | concluida
let priorityFilter = 'todas';// filtro de prioridade: todas | baixa | media | alta
let editingId = null;        // id da tarefa em edição (ou null)

const PRIORITY_LABELS = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

// ===== Elementos =====
const form = document.getElementById('new-task-form');
const nameInput = document.getElementById('new-name');
const descInput = document.getElementById('new-description');
const priorityInput = document.getElementById('new-priority');
const dueDateInput = document.getElementById('new-due-date');
const list = document.getElementById('task-list');
const emptyState = document.getElementById('empty-state');
const errorState = document.getElementById('error-state');
const summary = document.getElementById('summary');
const filterButtons = document.querySelectorAll('.filter');
const priorityFilterSelect = document.getElementById('priority-filter');

// ===== Helpers de data =====
// Converte o valor de um <input datetime-local> (hora local) para ISO UTC.
function inputToIso(value) {
  return value ? new Date(value).toISOString() : null;
}

// Converte uma data ISO (UTC) para o formato do <input datetime-local> (hora local).
function isoToInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Formata a data para exibição amigável (ex.: "15/07 14:30").
function formatDue(iso) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ===== Chamadas à API =====
// Mesma origem do servidor Express, então basta o caminho relativo.
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
  return body;
}

async function loadTasks() {
  try {
    tasks = await api('/items');
    errorState.hidden = true;
    render();
  } catch (err) {
    errorState.textContent = `Não foi possível carregar as tarefas: ${err.message}`;
    errorState.hidden = false;
  }
}

// ===== Renderização =====
function render() {
  const visible = tasks.filter((t) => {
    const statusOk = filter === 'todas' || t.status === filter;
    const priorityOk = priorityFilter === 'todas' || t.priority === priorityFilter;
    return statusOk && priorityOk;
  });

  const pending = tasks.filter((t) => t.status === 'pendente').length;
  summary.textContent =
    tasks.length === 0
      ? 'Nenhuma tarefa cadastrada'
      : `${tasks.length} tarefa(s) — ${pending} pendente(s)`;

  emptyState.hidden = visible.length > 0;
  list.replaceChildren(...visible.map(renderTask));
}

function renderTask(task) {
  const li = document.createElement('li');
  li.className = `task${task.status === 'concluida' ? ' done' : ''}`;

  if (editingId === task._id) {
    li.appendChild(renderEditForm(task));
    return li;
  }

  // Checkbox de concluir
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'task-toggle';
  toggle.checked = task.status === 'concluida';
  toggle.title = toggle.checked ? 'Marcar como pendente' : 'Marcar como concluída';
  toggle.addEventListener('change', () => toggleStatus(task));

  // Nome + descrição + metadados
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

  // Ações
  const actions = document.createElement('div');
  actions.className = 'task-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn';
  editBtn.textContent = '✏️';
  editBtn.title = 'Editar';
  editBtn.addEventListener('click', () => {
    editingId = task._id;
    render();
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

// Badges de prioridade e prazo
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
    if (overdue) due.title = 'Prazo vencido';
    meta.appendChild(due);
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

  // Prioridade + prazo lado a lado
  const row = document.createElement('div');
  row.className = 'edit-fields';

  const prioField = document.createElement('select');
  for (const value of ['baixa', 'media', 'alta']) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = PRIORITY_LABELS[value];
    if ((task.priority ?? 'media') === value) opt.selected = true;
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
    render();
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
      render();
    } catch (err) {
      alert(err.message);
    }
  });

  requestAnimationFrame(() => nameField.focus());
  return editForm;
}

// ===== Ações =====
async function toggleStatus(task) {
  const status = task.status === 'concluida' ? 'pendente' : 'concluida';
  try {
    const updated = await api(`/items/${task._id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    tasks = tasks.map((t) => (t._id === task._id ? updated : t));
    render();
  } catch (err) {
    alert(err.message);
    render(); // desfaz o checkbox visualmente
  }
}

async function removeTask(task) {
  if (!confirm(`Excluir a tarefa "${task.name}"?`)) return;
  try {
    await api(`/items/${task._id}`, { method: 'DELETE' });
    tasks = tasks.filter((t) => t._id !== task._id);
    render();
  } catch (err) {
    alert(err.message);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const created = await api('/items', {
      method: 'POST',
      body: JSON.stringify({
        name: nameInput.value.trim(),
        description: descInput.value.trim() || null,
        priority: priorityInput.value,
        dueDate: inputToIso(dueDateInput.value),
      }),
    });
    tasks.push(created);
    form.reset();
    nameInput.focus();
    render();
  } catch (err) {
    alert(err.message);
  } finally {
    button.disabled = false;
  }
});

filterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    filter = btn.dataset.filter;
    filterButtons.forEach((b) => b.classList.toggle('active', b === btn));
    render();
  });
});

priorityFilterSelect.addEventListener('change', () => {
  priorityFilter = priorityFilterSelect.value;
  render();
});

// ===== Inicialização =====
loadTasks();
