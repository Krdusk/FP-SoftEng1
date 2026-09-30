const tokenKey = 'planner-admin-token'
let token = sessionStorage.getItem(tokenKey) || ''
let selectedUsername = ''
let users = []

const loginPanel = document.querySelector('#login-panel')
const dashboard = document.querySelector('#dashboard')
const loginError = document.querySelector('#login-error')
const dashboardError = document.querySelector('#dashboard-error')
const userList = document.querySelector('#user-list')
const detail = document.querySelector('#user-detail')
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const dateLabel = (value) => value ? new Date(value).toLocaleString() : '—'

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 && token) signOut(false)
    throw new Error(result.error || 'Request failed.')
  }
  return result
}

function showDashboard() {
  loginPanel.hidden = true
  dashboard.hidden = false
}

function showLogin() {
  loginPanel.hidden = false
  dashboard.hidden = true
}

function signOut(sendRequest = true) {
  if (sendRequest && token) request('/api/admin/logout', { method: 'POST' }).catch(() => {})
  token = ''
  sessionStorage.removeItem(tokenKey)
  users = []
  selectedUsername = ''
  showLogin()
}

function renderUsers() {
  document.querySelector('#user-count').textContent = users.length
  document.querySelector('#subject-count').textContent = users.reduce((sum, user) => sum + user.subjectCount, 0)
  document.querySelector('#class-count').textContent = users.reduce((sum, user) => sum + user.scheduleCount, 0)
  userList.innerHTML = users.length ? users.map((user) => {
    const active = user.username === selectedUsername ? ' selected' : ''
    const title = user.profile.profile_name || user.username
    const initials = title.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    return `<button type="button" class="user-row${active}" data-user="${escapeHtml(user.username)}"><span class="user-initial">${escapeHtml(initials)}</span><span class="user-main"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(user.email)} · @${escapeHtml(user.username)}</small></span><span class="user-initial">›</span></button>`
  }).join('') : '<p class="empty-note">No registered accounts were found in MongoDB.</p>'
}

async function loadUsers() {
  dashboardError.textContent = ''
  userList.innerHTML = '<p class="empty-note">Loading accounts…</p>'
  try {
    const result = await request('/api/admin/users')
    users = result.users || []
    renderUsers()
    if (selectedUsername && users.some((user) => user.username === selectedUsername)) await loadUserDetail(selectedUsername)
    else {
      selectedUsername = ''
      detail.innerHTML = '<div class="empty-detail"><div class="detail-icon">↗</div><h2>Select an account</h2><p class="muted">Review its profile, entered subjects, and saved schedule.</p></div>'
    }
  } catch (error) {
    dashboardError.textContent = error.message
    userList.innerHTML = ''
  }
}

async function loadUserDetail(username) {
  selectedUsername = username
  renderUsers()
  detail.innerHTML = '<p class="empty-note">Loading planner…</p>'
  try {
    const { user } = await request(`/api/admin/users/${encodeURIComponent(username)}`)
    const subjectRows = user.subjects.length ? user.subjects.map((subject) => `<div class="subject-row"><strong>${escapeHtml(subject.subject_code)} · ${escapeHtml(subject.subject_name)}</strong><span>${subject.sections?.length || 0} sections</span></div>`).join('') : '<p class="empty-note">No subjects entered yet.</p>'
    const scheduleRows = user.schedule.length ? user.schedule.map((entry) => `<div class="schedule-row"><strong>${escapeHtml(entry.subject_code)} · ${escapeHtml(entry.section_code)}</strong><span>${escapeHtml(entry.day)} · ${escapeHtml(entry.time_start)}–${escapeHtml(entry.time_end)}</span></div>`).join('') : '<p class="empty-note">No schedule has been saved yet.</p>'
    detail.innerHTML = `<p class="eyebrow">Account details</p><h2>${escapeHtml(user.profile.profile_name || user.username)}</h2><p class="muted">@${escapeHtml(user.username)} · ${escapeHtml(user.email)}</p><div class="profile-strip"><span class="pill">${escapeHtml(user.profile.profile_course || 'Course not set')}</span><span class="pill">${escapeHtml(user.profile.profile_year || 'Year not set')}</span><span class="pill">Joined ${escapeHtml(dateLabel(user.createdAt))}</span></div><section class="detail-section"><h3>Subjects (${user.subjects.length})</h3>${subjectRows}</section><section class="detail-section"><h3>Saved schedule (${user.schedule.length})</h3>${scheduleRows}</section>`
  } catch (error) {
    dashboardError.textContent = error.message
  }
}

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const formElement = event.currentTarget
  loginError.textContent = ''
  const form = new FormData(formElement)
  try {
    const result = await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) })
    token = result.token
    sessionStorage.setItem(tokenKey, token)
    formElement.reset()
    showDashboard()
    await loadUsers()
  } catch (error) {
    loginError.textContent = error.message
  }
})

userList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-user]')
  if (button) loadUserDetail(button.dataset.user)
})
document.querySelector('#refresh-button').addEventListener('click', loadUsers)
document.querySelector('#logout-button').addEventListener('click', () => signOut())

if (token) {
  showDashboard()
  loadUsers()
}
