const tokenKey = 'planner-admin-token'
let token = sessionStorage.getItem(tokenKey) || ''
let selectedUsername = ''
let users = []
let analytics = { subjectCounts: [], dayCounts: [] }

const loginPanel = document.querySelector('#login-panel')
const dashboard = document.querySelector('#dashboard')
const loginError = document.querySelector('#login-error')
const dashboardError = document.querySelector('#dashboard-error')
const userList = document.querySelector('#user-list')
const detail = document.querySelector('#user-detail')
const loginButton = document.querySelector('#admin-signin')
const themeKey = 'myterm-admin-theme'
const themeButtons = [document.querySelector('#theme-toggle'), document.querySelector('#dashboard-theme-toggle')]
function applyTheme() {
  const dark = localStorage.getItem(themeKey) !== 'light'
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  themeButtons.forEach((button) => {
    if (!button) return
    button.textContent = dark ? 'Light mode' : 'Dark mode'
    button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode')
  })
}
themeButtons.forEach((button) => button?.addEventListener('click', () => {
  localStorage.setItem(themeKey, localStorage.getItem(themeKey) === 'dark' ? 'light' : 'dark')
  applyTheme()
}))
applyTheme()
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
  analytics = { subjectCounts: [], dayCounts: [] }
  selectedUsername = ''
  showLogin()
}

function renderUsers() {
  document.querySelector('#user-count').textContent = users.length
  document.querySelector('#subject-count').textContent = users.reduce((sum, user) => sum + user.subjectCount, 0)
  document.querySelector('#class-count').textContent = users.reduce((sum, user) => sum + user.scheduleCount, 0)
  const total = users.length
  const subjectsUsers = users.filter((user) => user.hasSubjects).length
  const scheduleUsers = users.filter((user) => user.hasSchedule).length
  const setProgress = (prefix, count) => {
    const percent = total ? Math.round(count / total * 100) : 0
    document.querySelector(`#${prefix}-progress-label`).textContent = `${count} / ${total} users · ${percent}%`
    const bar = document.querySelector(`#${prefix}-progress-bar`)
    bar.style.width = `${percent}%`
    bar.parentElement.setAttribute('role', 'progressbar')
    bar.parentElement.setAttribute('aria-valuemin', '0')
    bar.parentElement.setAttribute('aria-valuemax', '100')
    bar.parentElement.setAttribute('aria-valuenow', String(percent))
  }
  setProgress('subjects', subjectsUsers)
  setProgress('schedule', scheduleUsers)
  renderBarChart('#subject-chart', analytics.subjectCounts, 'No saved subjects yet.')
  renderBarChart('#day-chart', analytics.dayCounts, 'No saved classes yet.')
  userList.innerHTML = users.length ? users.map((user) => {
    const active = user.username === selectedUsername ? ' selected' : ''
    const title = user.profile.profile_name || user.username
    const initials = title.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    return `<button type="button" class="user-row${active}" data-user="${escapeHtml(user.username)}"><span class="user-initial">${escapeHtml(initials)}</span><span class="user-main"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(user.email)} · @${escapeHtml(user.username)}</small><small>${user.subjectCount} subjects · ${user.scheduleCount} classes · Saved ${escapeHtml(dateLabel(user.updatedAt))}</small></span><span class="user-initial">›</span></button>`
  }).join('') : '<p class="empty-note">No registered accounts were found in MongoDB.</p>'
}

function renderBarChart(selector, rows = [], emptyMessage) {
  const chart = document.querySelector(selector)
  const visibleRows = rows.filter((row) => Number(row.count) > 0)
  if (!visibleRows.length) {
    chart.innerHTML = `<p class="empty-note">${escapeHtml(emptyMessage)}</p>`
    return
  }
  const max = Math.max(...visibleRows.map((row) => Number(row.count)))
  chart.innerHTML = visibleRows.map((row) => {
    const count = Number(row.count)
    const percent = Math.max(5, Math.round(count / max * 100))
    return `<div class="analytics-row"><div><span>${escapeHtml(row.label)}</span><strong>${count}</strong></div><div class="data-bar-track"><i style="width:${percent}%"></i></div></div>`
  }).join('')
}

async function loadUsers() {
  dashboardError.textContent = ''
  userList.innerHTML = '<div class="loading-state" role="status"><span class="orbit-loader" aria-hidden="true"></span><span>Loading student accounts</span><span class="loading-scan" aria-hidden="true"><i></i></span></div>'
  try {
    const result = await request('/api/admin/users')
    users = result.users || []
    analytics = result.analytics || { subjectCounts: [], dayCounts: [] }
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
  detail.innerHTML = '<div class="loading-state" role="status"><span class="orbit-loader" aria-hidden="true"></span><span>Loading planner details</span><span class="loading-scan" aria-hidden="true"><i></i></span></div>'
  try {
    const { user } = await request(`/api/admin/users/${encodeURIComponent(username)}`)
    const subjectRows = user.subjects.length ? user.subjects.map((subject) => {
      const sections = (subject.sections || []).map((section) => {
        const meetings = section.meetings || (section.day ? [section] : [])
        const meetingLabel = meetings.map((meeting) => `${meeting.meeting_date ? `${meeting.meeting_date} ` : ''}${meeting.day || ''} ${meeting.time_start || ''}–${meeting.time_end || ''}${meeting.room ? ` · ${meeting.room}` : ''}`).join(' / ')
        return `<span>${escapeHtml(section.section_code || 'Section')}${section.unavailable ? ' · unavailable' : ''}${meetingLabel ? ` · ${escapeHtml(meetingLabel)}` : ''}</span>`
      }).join('')
      return `<div class="subject-row"><strong>${escapeHtml(subject.subject_code)} · ${escapeHtml(subject.subject_name)}</strong><span>${subject.sections?.length || 0} sections${subject.calendarSectionIds?.length ? ` · ${subject.calendarSectionIds.length} on calendar` : ''}</span></div>${sections ? `<div class="section-data-list">${sections}</div>` : ''}`
    }).join('') : '<p class="empty-note">No subjects entered yet.</p>'
    const scheduleRows = user.schedule.length ? user.schedule.map((entry) => `<div class="schedule-row"><strong>${escapeHtml(entry.subject_code)} · ${escapeHtml(entry.section_code)}</strong><span>${entry.meeting_date ? `${escapeHtml(entry.meeting_date)} · ` : ''}${escapeHtml(entry.day)} · ${escapeHtml(entry.time_start)}–${escapeHtml(entry.time_end)}${entry.room ? ` · ${escapeHtml(entry.room)}` : ''}</span></div>`).join('') : '<p class="empty-note">No schedule has been saved yet.</p>'
    detail.innerHTML = `<p class="eyebrow">Account details</p><h2>${escapeHtml(user.profile.profile_name || user.username)}</h2><p class="muted">@${escapeHtml(user.username)} · ${escapeHtml(user.email)}</p><div class="profile-strip"><span class="pill">${escapeHtml(user.profile.profile_course || 'Course not set')}</span><span class="pill">${escapeHtml(user.profile.profile_year || 'Year not set')}</span><span class="pill">Joined ${escapeHtml(dateLabel(user.createdAt))}</span></div><form id="edit-user-form" class="profile-edit-form" data-user="${escapeHtml(user.username)}"><label>Full name<input name="profile_name" value="${escapeHtml(user.profile.profile_name || '')}" required /></label><label>Course<input name="profile_course" value="${escapeHtml(user.profile.profile_course || '')}" /></label><label>Year level<input name="profile_year" value="${escapeHtml(user.profile.profile_year || '')}" /></label><div class="account-actions"><button class="primary" type="submit">Save profile</button></div></form><section class="detail-section"><h3>Subjects (${user.subjects.length})</h3>${subjectRows}</section><section class="detail-section"><h3>Saved schedule (${user.schedule.length})</h3>${scheduleRows}</section><div class="detail-danger-zone"><button type="button" class="danger-button" data-delete-user="${escapeHtml(user.username)}">Delete user account</button></div>`
  } catch (error) {
    dashboardError.textContent = error.message
  }
}

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const formElement = event.currentTarget
  loginError.textContent = ''
  loginButton.disabled = true
  loginButton.classList.add('is-loading')
  loginButton.querySelector('.button-label').textContent = 'Signing in…'
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
  } finally {
    loginButton.disabled = false
    loginButton.classList.remove('is-loading')
    loginButton.querySelector('.button-label').textContent = 'Sign in to admin'
  }
})

userList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-user]')
  if (button) loadUserDetail(button.dataset.user)
})

const createUserForm = document.querySelector('#create-user-form')
document.querySelector('#add-user-button').addEventListener('click', () => { createUserForm.hidden = !createUserForm.hidden })
document.querySelector('#cancel-create-user').addEventListener('click', () => { createUserForm.reset(); createUserForm.hidden = true })
createUserForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const data = Object.fromEntries(new FormData(createUserForm))
  try {
    const result = await request('/api/admin/users', { method: 'POST', body: JSON.stringify(data) })
    createUserForm.reset()
    createUserForm.hidden = true
    await loadUsers()
    await loadUserDetail(result.user.username)
  } catch (error) {
    dashboardError.textContent = error.message
  }
})

detail.addEventListener('submit', async (event) => {
  const form = event.target.closest('#edit-user-form')
  if (!form) return
  event.preventDefault()
  dashboardError.textContent = ''
  try {
    const data = Object.fromEntries(new FormData(form))
    await request(`/api/admin/users/${encodeURIComponent(form.dataset.user)}`, { method: 'PATCH', body: JSON.stringify(data) })
    await loadUsers()
    await loadUserDetail(form.dataset.user)
  } catch (error) {
    dashboardError.textContent = error.message
  }
})

detail.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete-user]')
  if (!button) return
  const username = button.dataset.deleteUser
  if (!confirm(`Delete the account @${username} and its saved planner data? This cannot be undone.`)) return
  try {
    await request(`/api/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' })
    selectedUsername = ''
    await loadUsers()
  } catch (error) {
    dashboardError.textContent = error.message
  }
})

document.querySelector('#refresh-button').addEventListener('click', loadUsers)
document.querySelector('#logout-button').addEventListener('click', () => signOut())

if (token) {
  showDashboard()
  loadUsers()
}
