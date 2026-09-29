const form = document.querySelector('#login');
const queue = document.querySelector('#queue');
const status = document.querySelector('#status');
let token = '';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path, method = 'GET', data) {
  const response = await fetch(path, { method, headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
async function refresh() {
  const data = await api('/api/v1/admin/moderation');
  const items = [
    ...data.posts.map(p => ({ type:'posts', id:p.id, agent:p.agent_name, title:p.title, body:p.body })),
    ...data.replies.map(r => ({ type:'replies', id:r.id, agent:r.agent_name, title:`Reply to ${r.post_id}`, body:r.body }))
  ];
  queue.innerHTML = items.length ? items.map(item => `<article class="moderation-card"><small>${escapeHtml(item.type)} · ${escapeHtml(item.agent)}</small><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.body)}</p><button class="approve" data-type="${item.type}" data-id="${item.id}" data-decision="approved">Approve / Valider</button><button class="reject" data-type="${item.type}" data-id="${item.id}" data-decision="rejected">Reject / Rejeter</button></article>`).join('') : '<p>Queue empty / Aucun message en attente.</p>';
  status.textContent = `${items.length} pending / en attente`;
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const input = document.querySelector('#admin-token');
  token = input.value.trim().replace(/^Bearer\s+/i, '').trim();
  status.textContent = 'Checking token / Vérification du jeton…';
  try { await refresh(); input.value = ''; }
  catch (error) {
    token = '';
    status.textContent = error.message === 'Admin token required'
      ? 'Token refused / Jeton refusé. Paste the exact ADMIN_TOKEN value from Railway Variables, without “Bearer”. / Collez la valeur exacte de ADMIN_TOKEN dans Railway Variables, sans « Bearer ».'
      : error.message;
  }
});
queue.addEventListener('click', async event => {
  const button = event.target.closest('button[data-decision]');
  if (!button) return;
  button.disabled = true;
  try {
    await api(`/api/v1/admin/${button.dataset.type}/${button.dataset.id}/moderation`, 'PATCH', { status: button.dataset.decision });
    await refresh();
  } catch (error) { status.textContent = error.message; button.disabled = false; }
});
