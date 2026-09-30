import { useEffect, useMemo, useState } from 'react'
import { useRef } from 'react'
import * as Icons from 'lucide-react'
import './App.css'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const HOURS = Array.from({ length: 15 }, (_, index) => index + 7)
const warpStars = Array.from({ length: 72 }, (_, index) => ({
  x: `${((index * 37) % 241) - 120}px`,
  y: `${((index * 53) % 321) - 160}px`,
  size: `${index % 7 === 0 ? 2 : 1}px`,
  duration: `${3.2 + (index % 9) * 0.48}s`,
  delay: `${-((index * 19) % 780) / 100}s`,
}))

const emptyProfile = {
  profile_name: '',
  reg_username: '',
  profile_email: '',
  profile_course: '',
  profile_year: 'First year',
  notify_email: true,
  notify_push: true,
  theme_pref: 'light',
}

const emptyConstraints = {
  constraint_start: '07:00',
  constraint_end: '21:00',
  preferred_days: [],
  break_pref: 'Compact',
  max_consecutive: 4,
  minimize_school_days: false,
}

const fmtTime = (value) => {
  const [hours, minutes] = (value || '09:00').split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const formattedHour = ((hours + 11) % 12) + 1
  return `${formattedHour}:${String(minutes).padStart(2, '0')} ${period}`
}

const toMinutes = (value) => {
  const [hours, minutes] = (value || '00:00').split(':').map(Number)
  return hours * 60 + minutes
}

const overlaps = (a, b) =>
  a.day === b.day &&
  toMinutes(a.time_start) < toMinutes(b.time_end) &&
  toMinutes(a.time_end) > toMinutes(b.time_start)

const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

const getMeetingSlots = (section) => {
  if (Array.isArray(section.meetings)) return section.meetings
  if (section.day && section.time_start && section.time_end) {
    return [{ id: `${section.id}-meeting`, day: section.day, time_start: section.time_start, time_end: section.time_end, room: section.room || '', instructor: section.instructor || '' }]
  }
  return []
}

const toScheduleEntries = (subject, section) => getMeetingSlots(section).map((meeting) => ({
  id: uid('class'),
  subject_id: subject.id,
  section_id: section.id,
  meeting_id: meeting.id,
  subject_name: subject.subject_name,
  subject_code: subject.subject_code,
  section_code: section.section_code,
  day: meeting.day,
  time_start: meeting.time_start,
  time_end: meeting.time_end,
  room: meeting.room || '',
  instructor: meeting.instructor || '',
}))

const getSelectedSectionId = (subject, lockedSections = []) => {
  if (Object.prototype.hasOwnProperty.call(subject, 'selectedSectionId')) return subject.selectedSectionId
  const sections = Array.isArray(subject.sections) ? subject.sections : []
  const locked = lockedSections.find((section) => section.subject_id === subject.id)
  return locked?.id || (sections.find((section) => section.available !== false && section.unavailable !== true) || sections[0])?.id || null
}

function Icon({ name, size = 18 }) {
  const Component = Icons[name] || Icons.CalendarDays
  return <Component size={size} />
}

function App() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [accountToken, setAccountToken] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [username, setUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [authMode, setAuthMode] = useState('login')
  const [accountForm, setAccountForm] = useState({ name: '', username: '', email: '', password: '', course: '', year: 'First year' })
  const [view, setView] = useState('schedule')
  const [mode, setMode] = useState('week')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [profile, setProfile] = useState(emptyProfile)
  const [subjects, setSubjects] = useState([])
  const [schedule, setSchedule] = useState([])
  const [lockedSections, setLockedSections] = useState([])
  const [constraints, setConstraints] = useState(emptyConstraints)
  const [editing, setEditing] = useState(null)
  const [modal, setModal] = useState(null)
  const [generatedOptions, setGeneratedOptions] = useState([])
  const [generationIssues, setGenerationIssues] = useState([])
  const [generationWasComplete, setGenerationWasComplete] = useState(true)
  const [selectedOption, setSelectedOption] = useState(0)
  const [suggestions, setSuggestions] = useState([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  const conflicts = useMemo(
    () =>
      schedule.filter((entry, index) =>
        schedule.some((other, otherIndex) => otherIndex !== index && overlaps(entry, other)),
      ),
    [schedule],
  )

  const initials = (profile.profile_name || 'Student Planner')
    .split(/[ ,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  const isSectionLocked = (subject, section) =>
    lockedSections.some((entry) => entry.subject_id === subject.id && entry.id === section.id)

  const toggleLock = (subject, section, locked) => {
    const lockedSection = { ...section, subject_id: subject.id, subject_name: subject.subject_name, subject_code: subject.subject_code }
    setLockedSections((current) => [
      ...current.filter((item) => item.subject_id !== subject.id),
      ...(locked ? [lockedSection] : []),
    ])

    if (locked) {
      setSubjects((current) => current.map((item) => item.id === subject.id ? { ...item, selectedSectionId: section.id } : item))
      setSchedule((current) => [
        ...current.filter((item) => item.subject_id !== subject.id && item.subject_code !== subject.subject_code),
        ...toScheduleEntries(subject, section),
      ])
      setToast(`${subject.subject_code} ${section.section_code} locked.`)
    } else {
      setToast(`${subject.subject_code} unlocked.`)
    }
  }

  const addSubject = (details = {}) => {
    const newSubject = {
      ...details,
      id: uid('sub'),
      subject_name: details.subject_name || '',
      subject_code: details.subject_code || '',
      sections: Array.isArray(details.sections) ? details.sections : [],
      included: details.included ?? true,
    }
    setSubjects((current) => [...current, newSubject])
    return newSubject.id
  }

  const saveSubject = (subject) => {
    setSubjects((current) => {
      const exists = current.some((item) => item.id === subject.id)
      if (exists) {
        return current.map((item) => (item.id === subject.id ? subject : item))
      }
      return [...current, { ...subject, id: subject.id || uid('sub') }]
    })
    const selectedSection = (subject.sections || []).find((section) => section.id === getSelectedSectionId(subject, lockedSections))
    setLockedSections((current) => current.flatMap((locked) => {
      if (locked.subject_id !== subject.id) return [locked]
      return selectedSection?.id === locked.id
        ? [{ ...selectedSection, subject_id: subject.id, subject_name: subject.subject_name, subject_code: subject.subject_code }]
        : []
    }))
    setSchedule((current) => [
      ...current.filter((entry) => entry.subject_id !== subject.id),
      ...(selectedSection ? toScheduleEntries(subject, selectedSection) : []),
    ])
  }

  const selectSubjectSection = (subjectId, sectionId, selected) => {
    const subject = subjects.find((item) => item.id === subjectId)
    const section = subject?.sections?.find((item) => item.id === sectionId)
    if (!subject || !section) return
    const selectedId = getSelectedSectionId(subject, lockedSections)
    const nextSelection = selected ? sectionId : selectedId === sectionId ? null : selectedId
    setSubjects((current) => current.map((item) => item.id === subjectId ? { ...item, selectedSectionId: nextSelection } : item))
    setLockedSections((current) => current.filter((section) => section.subject_id !== subjectId))
    setSchedule((current) => [
      ...current.filter((entry) => entry.subject_id !== subjectId),
      ...(selected ? toScheduleEntries(subject, section) : []),
    ])
  }

  const includeSubjectForGeneration = (subjectId, included) => {
    setSubjects((current) => current.map((subject) => subject.id === subjectId ? { ...subject, included } : subject))
  }

  const setSectionUnavailable = (subjectId, sectionId, unavailable) => {
    const subject = subjects.find((item) => item.id === subjectId)
    const wasSelected = subject && getSelectedSectionId(subject, lockedSections) === sectionId
    setSubjects((current) => current.map((item) => item.id !== subjectId ? item : {
      ...item,
      sections: item.sections.map((section) => section.id === sectionId ? { ...section, unavailable, available: !unavailable } : section),
      ...(unavailable && wasSelected ? { selectedSectionId: null } : {}),
    }))
    if (unavailable && wasSelected) {
      setSchedule((current) => current.filter((entry) => !(entry.subject_id === subjectId && entry.section_id === sectionId)))
      setLockedSections((current) => current.filter((entry) => entry.id !== sectionId))
    }
  }

  const removeSubject = (subjectId) => {
    setSubjects((current) => current.filter((subject) => subject.id !== subjectId))
    setSchedule((current) => current.filter((entry) => entry.subject_id !== subjectId))
    setLockedSections((current) => current.filter((section) => section.subject_id !== subjectId))
  }

  const openClassModal = (entry) => {
    setEditing(entry || {
      id: '',
      subject_name: '',
      subject_code: '',
      section_code: '',
      day: 'Monday',
      time_start: '09:00',
      time_end: '10:00',
      room: '',
      instructor: '',
    })
    setModal('class')
  }

  const saveClass = (event) => {
    event.preventDefault()
    if (!editing) return
    if (!DAYS.includes(editing.day) || toMinutes(editing.time_end) <= toMinutes(editing.time_start)) {
      setToast('Enter a valid day and an end time later than the start time.')
      return
    }

    const nextClass = {
      ...editing,
      id: editing.id || uid('class'),
      subject_code: editing.subject_code || 'GEN',
      section_code: editing.section_code || 'A',
    }

    setSchedule((current) => {
      if (editing.id) {
        return current.map((item) => (item.id === editing.id ? nextClass : item))
      }
      return [...current, nextClass]
    })

    setModal(null)
    setEditing(null)
    setToast('Class saved.')
  }

  const removeClass = (classId) => {
    setSchedule((current) => current.filter((item) => item.id !== classId))
    setToast('Class removed.')
  }

  const generateOptions = async () => {
    const includedSubjects = subjects.filter((subject) => subject.included !== false)
    const hasIncompleteSubject = includedSubjects.some((subject) => {
      const sections = Array.isArray(subject.sections) ? subject.sections : []
      const selectedSection = sections.find((section) => section.id === getSelectedSectionId(subject, lockedSections))
      return !subject.subject_name?.trim() ||
        !subject.subject_code?.trim() ||
        !selectedSection ||
        !selectedSection.section_code?.trim() ||
        getMeetingSlots(selectedSection).length === 0 ||
        getMeetingSlots(selectedSection).some((meeting) =>
          !DAYS.includes(meeting.day) ||
          !/^\d{2}:\d{2}$/.test(meeting.time_start || '') ||
          !/^\d{2}:\d{2}$/.test(meeting.time_end || '') ||
          toMinutes(meeting.time_end) <= toMinutes(meeting.time_start),
        )
    })
    if (hasIncompleteSubject) {
      setGeneratedOptions([])
      setGenerationIssues(['Choose one section for each subject and make sure it has a section code, day, and valid start and end times.'])
      setSuggestions([])
      setGenerationWasComplete(true)
      setModal('review')
      return
    }
    if (includedSubjects.length === 0 && schedule.every((entry) => entry.subject_id)) {
      setGeneratedOptions([])
      setGenerationIssues(['Add a subject with sections or add a class to your schedule before generating.'])
      setSuggestions([])
      setGenerationWasComplete(true)
      setModal('review')
      return
    }

    setIsGenerating(true)
    try {
      const response = await fetch('/api/schedules/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjects: includedSubjects, schedule, constraints, lockedSections }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `Schedule service returned an error (${response.status}).`)
      setGeneratedOptions(result.options || [])
      setGenerationIssues(result.issues || [])
      setGenerationWasComplete(result.searchedAll !== false)
      setSuggestions(result.suggestions || [])
      setSelectedOption(0)
      setModal('review')
      setToast(result.options?.length ? 'Schedule options generated.' : 'No schedule fits these sections and constraints.')
    } catch (error) {
      setGeneratedOptions([])
      setGenerationIssues([error.message || 'Unable to generate options right now. Check your connection and try again.'])
      setGenerationWasComplete(false)
      setModal('review')
      setToast('Could not generate schedules.')
    } finally {
      setIsGenerating(false)
    }
  }

  const useGeneratedSchedule = (option) => {
    setSchedule(option.schedule || [])
    setModal(null)
    setToast('Generated schedule applied.')
  }

  const applySuggestion = (suggestion) => {
    setSchedule((current) => [
      ...current.filter((entry) => entry.section_id !== suggestion.current.section_id),
      ...(suggestion.alternativeEntries || [suggestion.alternative]),
    ])
    setSuggestions((current) => current.filter((item) => item.current.id !== suggestion.current.id))
    setToast(`${suggestion.current.subject_code} moved to ${suggestion.alternative.day}.`)
  }

  const restoreAccountState = async (identifier) => {
    try {
      const response = await fetch(`/api/accounts/${encodeURIComponent(identifier)}/state`, {
        headers: { Authorization: `Bearer ${accountToken}` },
      })
      if (!response.ok) return false
      const state = await response.json()
      if (state.profile) setProfile((current) => ({ ...current, ...state.profile }))
      if (Array.isArray(state.subjects)) setSubjects(state.subjects)
      if (Array.isArray(state.schedule)) setSchedule(state.schedule)
      if (state.constraints) setConstraints((current) => ({ ...current, ...state.constraints }))
      if (Array.isArray(state.lockedSections)) setLockedSections(state.lockedSections)
      return true
    } catch {
      return false
    }
  }

  const savePlannerState = async () => {
    if (!accountToken) {
      setToast('Sign in to an account to save your planner online.')
      return
    }
    const identifier = profile.reg_username?.trim()
    if (!identifier) {
      setToast('Add a username in Settings before saving online.')
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(`/api/accounts/${encodeURIComponent(identifier)}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accountToken}` },
        body: JSON.stringify({ profile, subjects, schedule, constraints, lockedSections }),
      })
      if (!response.ok) throw new Error('Save failed')
      setToast('Planner saved to the backend.')
    } catch {
      setToast('Saved on this device; backend is unavailable.')
    } finally {
      setIsSaving(false)
    }
  }

  const resetSemester = () => {
    if (!window.confirm('Delete all subjects and classes to start a new semester? This cannot be undone.')) return
    setSchedule([])
    setSubjects([])
    setLockedSections([])
    setConstraints(emptyConstraints)
    setToast('All subjects and classes were cleared.')
  }

  const clearCalendar = () => {
    setSchedule([])
    setLockedSections([])
    setSubjects((current) => current.map((subject) => ({ ...subject, included: false, selectedSectionId: null })))
    setToast('Calendar cleared and subjects unselected.')
  }

  const resetConstraints = () => {
    setConstraints(emptyConstraints)
    setToast('Constraints reset.')
  }

  const handleLogin = async () => {
    const cleanUsername = username.trim()
    if (!cleanUsername || !loginPassword) {
      setToast('Enter your username/email and password.')
      return
    }
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cleanUsername, password: loginPassword }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Login failed.')
      setAccountToken(result.token)
      setProfile(result.user.profile)
      setSubjects(result.user.subjects || [])
      setSchedule(result.user.schedule || [])
      setConstraints((current) => ({ ...current, ...(result.user.constraints || {}) }))
      setLockedSections(result.user.lockedSections || [])
      setLoggedIn(true)
      setLoginPassword('')
      setToast('Welcome back.')
    } catch (error) {
      setToast(error.message)
    }
  }

  const handleCreateAccount = async (event) => {
    event.preventDefault()
    const cleanName = accountForm.name.trim()
    const cleanUsername = accountForm.username.trim()
    const cleanEmail = accountForm.email.trim()
    if (!cleanName || !cleanUsername || !cleanEmail || !accountForm.password) {
      setToast('Complete your name, username, email, and password.')
      return
    }
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          username: cleanUsername,
          email: cleanEmail,
          password: accountForm.password,
          course: accountForm.course.trim(),
          year: accountForm.year,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Registration failed.')
      setAccountToken(result.token)
      setProfile(result.user.profile)
      setSubjects([])
      setSchedule([])
      setLockedSections([])
      setUsername(cleanUsername)
      setLoggedIn(true)
      setAccountForm({ name: '', username: '', email: '', password: '', course: '', year: 'First year' })
      setToast(`Welcome, ${cleanName}.`)
    } catch (error) {
      setToast(error.message)
    }
  }

  const continueAsGuest = () => {
    setProfile((current) => ({ ...current, profile_name: current.profile_name || 'Guest Planner', reg_username: current.reg_username || 'guest' }))
    setLoggedIn(true)
    setToast('Guest planner ready.')
  }

  const handleLogout = () => {
    if (accountToken) {
      fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${accountToken}` } }).catch(() => {})
    }
    setAccountToken('')
    setLoggedIn(false)
    setProfile(emptyProfile)
    setSubjects([])
    setSchedule([])
    setLockedSections([])
    setConstraints(emptyConstraints)
    setProfileMenuOpen(false)
    setToast('You have been signed out.')
  }

  return (
    <div className={hydrated && profile.theme_pref === 'dark' ? 'app-shell dark-theme' : 'app-shell'}>
      {!loggedIn ? (
        <div className="login-screen">
          <div className="login-card">
            <div className="login-panel">
              <div className="space-warp" aria-hidden="true">
                {warpStars.map((star, index) => (
                  <i
                    key={index}
                    className={index % 7 === 0 ? 'warp-star gold-star' : 'warp-star'}
                    style={{
                      '--star-x': star.x,
                      '--star-y': star.y,
                      '--star-size': star.size,
                      '--star-duration': star.duration,
                      '--star-delay': star.delay,
                    }}
                  />
                ))}
              </div>
              <div className="brand-row">
                <div className="brand-pill"><Icon name="CalendarDays" size={18} /></div>
                <strong>MyTerm</strong>
              </div>
              <p className="brand-tagline">May the Schedule, be with you.</p>
              <h1>Shape your week with confidence.</h1>
              <p>Build a clean academic plan, compare sections, and stay ahead of conflicts.</p>
              <div className="feature-grid">
                <div className="feature-box">
                  <Icon name="ShieldCheck" size={24} />
                  <strong>Lock classes</strong>
                </div>
                <div className="feature-box">
                  <Icon name="BarChart3" size={24} />
                  <strong>Compare sections</strong>
                </div>
                <div className="feature-box wide">
                  <Icon name="Sparkles" size={24} />
                  <strong>Smart alternatives</strong>
                </div>
              </div>
            </div>

            <div className="login-form">
              <div className="auth-switcher" role="tablist" aria-label="Account access">
                <button type="button" className={authMode === 'login' ? 'auth-tab active' : 'auth-tab'} onClick={() => setAuthMode('login')}>Sign in</button>
                <button type="button" className={authMode === 'create' ? 'auth-tab active' : 'auth-tab'} onClick={() => setAuthMode('create')}>Create account</button>
              </div>

              {authMode === 'login' ? (
                <form onSubmit={(event) => { event.preventDefault(); handleLogin() }} className="auth-form">
                  <h2>Welcome back</h2>
                  <p className="form-hint">Use any username or email to open your planner.</p>
                  <label>
                    Username or email
                    <input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} />
                  </label>
                  <label>
                    Password
                    <input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} />
                  </label>
                  <button type="submit" className="btn primary full">Continue</button>
                  <button type="button" className="btn secondary full" onClick={continueAsGuest}>Continue as guest</button>
                </form>
              ) : (
                <form onSubmit={handleCreateAccount} className="auth-form">
                  <h2>Create your planner</h2>
                  <p className="form-hint">Create an account to save your planner securely.</p>
                  <label>
                    Full name
                    <input autoFocus value={accountForm.name} onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })} />
                  </label>
                  <label>
                    Username
                    <input value={accountForm.username} onChange={(event) => setAccountForm({ ...accountForm, username: event.target.value })} />
                  </label>
                  <label>
                    Email
                    <input type="email" value={accountForm.email} onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })} />
                  </label>
                  <label>
                    Password
                    <input type="password" minLength="6" value={accountForm.password} onChange={(event) => setAccountForm({ ...accountForm, password: event.target.value })} />
                  </label>
                  <div className="form-grid two">
                    <label>
                      Course
                      <input value={accountForm.course} onChange={(event) => setAccountForm({ ...accountForm, course: event.target.value })} />
                    </label>
                    <label>
                      Year level
                      <select value={accountForm.year} onChange={(event) => setAccountForm({ ...accountForm, year: event.target.value })}>
                        {['First year', 'Second year', 'Third year', 'Fourth year', 'Graduate'].map((level) => <option key={level} value={level}>{level}</option>)}
                      </select>
                    </label>
                  </div>
                  <button type="submit" className="btn primary full">Create account</button>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <header className="topbar">
            <div className="top-left">
              <div className="brand-pill"><Icon name="CalendarDays" size={18} /></div>
              <div className="top-brand"><strong>MyTerm</strong><span>May the Schedule, be with you.</span></div>
              <nav className="nav-list">
                {['schedule', 'subjects', 'settings'].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={view === tab ? 'nav active' : 'nav'}
                    onClick={() => { setView(tab); setProfileMenuOpen(false) }}
                  >
                    {tab === 'schedule' ? 'My Schedule' : tab === 'subjects' ? 'Subjects' : 'Settings'}
                  </button>
                ))}
              </nav>
            </div>

            <div className="top-actions">
              <div className="profile-menu-wrap">
                <button type="button" className="profile-badge profile-menu-button" onClick={() => setProfileMenuOpen((open) => !open)} aria-expanded={profileMenuOpen}>
                <span className="avatar">{initials}</span>
                <span>{profile.profile_name || 'Student Planner'}</span>
                  <Icon name="ChevronDown" size={15} />
                </button>
                {profileMenuOpen && <div className="profile-dropdown">
                  <button type="button" onClick={() => { setView('settings'); setProfileMenuOpen(false) }}><Icon name="UserRound" size={16} /> Account</button>
                  <button type="button" onClick={handleLogout}><Icon name="LogOut" size={16} /> Log out</button>
                </div>}
              </div>
            </div>
          </header>

          <div className={view === 'schedule' ? 'workspace schedule-workspace' : 'workspace single-workspace'}>
            {view === 'schedule' && (
              <SubjectPoolPanel
                subjects={subjects}
                lockedSections={lockedSections}
                onSelectSection={selectSubjectSection}
                onIncludeSubject={includeSubjectForGeneration}
                onManageSubjects={() => setView('subjects')}
              />
            )}
            <main className="content card">
              {view === 'schedule' && (
                <ScheduleView
                  schedule={schedule}
                  mode={mode}
                  setMode={setMode}
                  conflicts={conflicts}
                  suggestions={suggestions}
                  applySuggestion={applySuggestion}
                  openClassModal={openClassModal}
                  removeClass={removeClass}
                  setEditing={setEditing}
                  onSave={savePlannerState}
                  onClear={clearCalendar}
                  isSaving={isSaving}
                />
              )}

              {view === 'subjects' && (
                <SubjectsPanel
                  subjects={subjects}
                  onAddSubject={addSubject}
                  onSave={saveSubject}
                  onRemove={removeSubject}
                  isSectionLocked={isSectionLocked}
                  onToggleLock={toggleLock}
                  onToggleUnavailable={setSectionUnavailable}
                />
              )}

              {view === 'settings' && (
                <SettingsPanel profile={profile} setProfile={setProfile} resetSemester={resetSemester} onSave={savePlannerState} isSaving={isSaving} />
              )}
            </main>

            {view === 'schedule' && <ConstraintRail constraints={constraints} setConstraints={setConstraints} onGenerate={generateOptions} isGenerating={isGenerating} onReset={resetConstraints} />}
          </div>
        </>
      )}

      {modal === 'class' && editing && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing.id ? 'Edit class' : 'Add class'}</h3>
              <button type="button" className="icon-btn" onClick={() => setModal(null)}><Icon name="X" size={16} /></button>
            </div>

            <form onSubmit={saveClass} className="modal-form">
              <div className="form-grid">
                <label>
                  Subject name
                  <input value={editing.subject_name} onChange={(event) => setEditing({ ...editing, subject_name: event.target.value })} />
                </label>
                <label>
                  Subject code
                  <input value={editing.subject_code} onChange={(event) => setEditing({ ...editing, subject_code: event.target.value })} />
                </label>
                <label>
                  Section code
                  <input value={editing.section_code} onChange={(event) => setEditing({ ...editing, section_code: event.target.value })} />
                </label>
                <label>
                  Day
                  <select value={editing.day} onChange={(event) => setEditing({ ...editing, day: event.target.value })}>
                    {DAYS.map((day) => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Start time
                  <input type="time" value={editing.time_start} onChange={(event) => setEditing({ ...editing, time_start: event.target.value })} />
                </label>
                <label>
                  End time
                  <input type="time" value={editing.time_end} onChange={(event) => setEditing({ ...editing, time_end: event.target.value })} />
                </label>
                <label>
                  Room
                  <input value={editing.room} onChange={(event) => setEditing({ ...editing, room: event.target.value })} />
                </label>
                <label>
                  Instructor
                  <input value={editing.instructor} onChange={(event) => setEditing({ ...editing, instructor: event.target.value })} />
                </label>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn secondary" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="btn primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal === 'review' && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Review schedule</h3>
              <button type="button" className="icon-btn" onClick={() => setModal(null)}><Icon name="X" size={16} /></button>
            </div>

            {generationIssues.length > 0 && (
              <div className="warning-banner generation-message">
                <Icon name="TriangleAlert" size={15} />
                <div>{generationIssues.map((issue) => <p key={issue}>{issue}</p>)}</div>
              </div>
            )}
            {!generationWasComplete && <p className="form-hint">There were many combinations, so generation stopped after checking a large set of conflict-free options. These are the best options found in that search.</p>}

            <div className="review-list">
              {generatedOptions.length > 0 ? (
                generatedOptions.map((option, index) => (
                  <button
                    key={index}
                    type="button"
                    className={selectedOption === index ? 'review-item selected' : 'review-item'}
                    onClick={() => setSelectedOption(index)}
                  >
                    <strong>Option {index + 1}</strong>
                    <span>{new Set(option.schedule.filter((entry) => entry.subject_id).map((entry) => entry.subject_id)).size} of {subjects.filter((subject) => subject.included !== false).length} subjects · Preference score {option.metrics.score}/100</span>
                    <small>{option.metrics.conflicts} conflicts · {option.metrics.school_days} days · {option.metrics.gaps}h gaps · longest run {option.metrics.longest_consecutive_hours}h</small>
                  </button>
                ))
              ) : (
                <p>No valid schedule options.</p>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setModal(null)}>Keep current</button>
              {generatedOptions.length > 0 && <button type="button" className="btn primary" onClick={() => useGeneratedSchedule(generatedOptions[selectedOption])}>Use this plan</button>}
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function SubjectPoolPanel({ subjects, lockedSections, onSelectSection, onIncludeSubject, onManageSubjects }) {
  const [query, setQuery] = useState('')
  const [expandedSubjects, setExpandedSubjects] = useState({})
  const normalizedQuery = query.trim().toLowerCase()
  const visibleSubjects = subjects.filter((subject) =>
    `${subject.subject_code} ${subject.subject_name}`.toLowerCase().includes(normalizedQuery),
  )
  const allExpanded = visibleSubjects.length > 0 && visibleSubjects.every((subject) => expandedSubjects[subject.id])
  const toggleAll = () => setExpandedSubjects(Object.fromEntries(visibleSubjects.map((subject) => [subject.id, !allExpanded])))

  return (
    <aside className="subject-pool-panel card">
      <div className="subject-pool-heading">
        <div>
          <p className="eyebrow">Choose sections</p>
          <h2>Subject Pool</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onManageSubjects} title="Manage subjects" aria-label="Manage subjects"><Icon name="Settings2" size={16} /></button>
      </div>
      <label className="subject-pool-search">
        <Icon name="Search" size={16} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search subjects or codes"
          aria-label="Search subjects or codes"
        />
      </label>

      {subjects.length > 0 && (
        <button type="button" className="pool-expand-all" onClick={toggleAll}>
          <Icon name={allExpanded ? 'ChevronsUp' : 'ChevronsDown'} size={15} />
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      )}

      {subjects.length === 0 ? (
        <div className="subject-pool-empty">
          <p>Add subjects and their available sections to start building your schedule.</p>
          <button type="button" className="btn primary full" onClick={onManageSubjects}>Add subjects</button>
        </div>
      ) : visibleSubjects.length === 0 ? (
        <p className="subject-pool-empty">No subjects match “{query}”.</p>
      ) : (
        <div className="subject-pool-list">
          {visibleSubjects.map((subject) => {
            const sections = Array.isArray(subject.sections) ? subject.sections : []
            const selectedSectionId = getSelectedSectionId(subject, lockedSections)
            const selectedCount = sections.some((section) => section.id === selectedSectionId) ? 1 : 0
            return (
              <article key={subject.id} className="subject-pool-group">
                <div className="subject-pool-group-head">
                  <label className="pool-include-toggle" title="Include this subject in schedule generation">
                    <input type="checkbox" checked={subject.included !== false} onChange={(event) => onIncludeSubject(subject.id, event.target.checked)} />
                    <span>Include</span>
                  </label>
                  <button
                    type="button"
                    className="pool-subject-toggle"
                    aria-expanded={Boolean(expandedSubjects[subject.id])}
                    onClick={() => setExpandedSubjects((current) => ({ ...current, [subject.id]: !current[subject.id] }))}
                  >
                  <span className="subject-pool-title">
                    <strong>{subject.subject_code || 'New subject'}</strong>
                    <small>{subject.subject_name || 'Add a subject name'}</small>
                  </span>
                  <span className="subject-pool-count">{selectedCount} selected</span>
                    <Icon name={expandedSubjects[subject.id] ? 'ChevronUp' : 'ChevronDown'} size={16} />
                  </button>
                </div>
                {expandedSubjects[subject.id] && <div className="pool-section-list">
                  {sections.length === 0 ? <p className="pool-no-sections">No sections yet. Add them on the Subjects page.</p> : sections.map((section) => {
                    const meetings = getMeetingSlots(section)
                    const unavailable = section.unavailable === true || section.available === false
                    return (
                    <label key={section.id} className="pool-section-option">
                      <input
                        type="checkbox"
                        checked={selectedSectionId === section.id}
                        disabled={unavailable}
                        onChange={(event) => onSelectSection(subject.id, section.id, event.target.checked)}
                      />
                      <span>
                        <strong>{section.section_code || 'Section'}{unavailable ? ' · Unavailable' : ''}</strong>
                        <small>{meetings.length ? meetings.map((meeting) => `${meeting.day.slice(0, 3)} ${fmtTime(meeting.time_start)}–${fmtTime(meeting.time_end)}`).join(' · ') : 'No meeting times added'}</small>
                      </span>
                    </label>
                    )
                  })}
                </div>}
              </article>
            )
          })}
        </div>
      )}
    </aside>
  )
}

function ScheduleView({ schedule, mode, setMode, conflicts, suggestions, applySuggestion, openClassModal, removeClass, onSave, onClear, isSaving }) {
  return (
    <section className="page-panel">
      <div className="page-head">
        <div>
          <p className="eyebrow">Your study week</p>
          <h1>My Schedule</h1>
        </div>
        <div className="head-buttons">
          <button type="button" className={mode === 'week' ? 'btn primary' : 'btn secondary'} onClick={() => setMode('week')}>Week</button>
          <button type="button" className={mode === 'list' ? 'btn primary' : 'btn secondary'} onClick={() => setMode('list')}>List</button>
          <button type="button" className="btn secondary" onClick={onSave} disabled={isSaving}><Icon name="CloudUpload" size={15} /> {isSaving ? 'Saving...' : 'Save'}</button>
          <button type="button" className="btn secondary" onClick={onClear}><Icon name="RotateCcw" size={15} /> Clear</button>
        </div>
      </div>

      {conflicts.length > 0 && (
        <div className="warning-banner">
          <Icon name="TriangleAlert" size={15} />
          {conflicts.length} conflicting class{conflicts.length > 1 ? 'es' : ''} detected.
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="suggestion-panel">
          <div>
            <strong>Smart alternatives</strong>
            <span>Resolve conflicts without rebuilding your whole week.</span>
          </div>
          <div className="suggestion-list">
            {suggestions.slice(0, 3).map((suggestion) => (
              <button key={`${suggestion.current.id}-${suggestion.alternative.section_id}`} type="button" className="suggestion-item" onClick={() => applySuggestion(suggestion)}>
                <span>{suggestion.current.subject_code} → {suggestion.alternative.section_code}</span>
                <small>{suggestion.alternative.day} · {fmtTime(suggestion.alternative.time_start)}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      {schedule.length === 0 ? (
        <div className="empty-state">
          <Icon name="CalendarPlus" size={42} />
          <h2>Your week is ready.</h2>
          <p>Choose subject sections or add a class manually.</p>
          <button type="button" className="btn primary" onClick={() => openClassModal()}>Add class manually</button>
        </div>
      ) : mode === 'week' ? (
        <WeekGrid schedule={schedule} openClassModal={openClassModal} />
      ) : (
        <ListView schedule={schedule} openClassModal={openClassModal} removeClass={removeClass} />
      )}
    </section>
  )
}

function WeekGrid({ schedule, openClassModal }) {
  const today = DAYS[new Date().getDay()]

  return (
    <div className="week-board">
      <div className="week-head">
        <div className="time-heading">Time</div>
        {DAYS.map((day) => (
          <div key={day} className={day === today ? 'day-heading today' : 'day-heading'}>{day.slice(0, 3)}</div>
        ))}
      </div>

      {HOURS.map((hour) => (
        <div key={hour} className="week-row">
          <div className="time-cell">{fmtTime(`${String(hour).padStart(2, '0')}:00`)}</div>
          {DAYS.map((day) => {
            const items = schedule.filter((entry) => entry.day === day && Number(entry.time_start.slice(0, 2)) === hour)
            return (
              <div
                key={`${day}-${hour}`}
                className={day === today ? 'slot today-slot' : 'slot'}
                onDoubleClick={() => openClassModal({ day, time_start: `${String(hour).padStart(2, '0')}:00`, time_end: `${String(hour + 1).padStart(2, '0')}:00` })}
              >
                {items.map((entry) => (
                  <button type="button" key={entry.id} className="event-card" onClick={() => openClassModal(entry)}>
                    <strong>{entry.subject_code}</strong>
                    <span>{fmtTime(entry.time_start)}–{fmtTime(entry.time_end)}</span>
                    <small>{entry.section_code}</small>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function ListView({ schedule, openClassModal, removeClass }) {
  return (
    <div className="list-board">
      {[...schedule]
        .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.time_start.localeCompare(b.time_start))
        .map((entry) => (
          <article key={entry.id} className="list-item">
            <div>
              <strong>{entry.subject_code} · {entry.subject_name}</strong>
              <p>{entry.section_code} · {entry.day} · {fmtTime(entry.time_start)}–{fmtTime(entry.time_end)}</p>
            </div>
            <div className="list-actions">
              <button type="button" className="btn secondary" onClick={() => openClassModal(entry)}>Edit</button>
              <button type="button" className="icon-btn danger" onClick={() => removeClass(entry.id)}><Icon name="Trash2" size={15} /></button>
            </div>
          </article>
        ))}
    </div>
  )
}

function SubjectsPanel({ subjects, onAddSubject, onSave, onRemove, isSectionLocked, onToggleLock, onToggleUnavailable }) {
  const [query, setQuery] = useState('')
  const [selectedSubjectId, setSelectedSubjectId] = useState(() => subjects[0]?.id || '')
  const [subjectDraft, setSubjectDraft] = useState({ subject_name: '', subject_code: '' })
  const [editingSectionId, setEditingSectionId] = useState('')
  const [sectionDraft, setSectionDraft] = useState(null)
  const [sectionError, setSectionError] = useState('')
  const [importDraft, setImportDraft] = useState(null)
  const [importMessage, setImportMessage] = useState('')
  const imageInput = useRef(null)
  const selectedSubject = subjects.find((subject) => subject.id === selectedSubjectId)
  const visibleSubjects = subjects.filter((subject) => `${subject.subject_code} ${subject.subject_name}`.toLowerCase().includes(query.trim().toLowerCase()))

  useEffect(() => {
    if (selectedSubjectId && subjects.some((subject) => subject.id === selectedSubjectId)) return
    setSelectedSubjectId(subjects[0]?.id || '')
  }, [subjects, selectedSubjectId])

  useEffect(() => {
    setSubjectDraft(selectedSubject
      ? { subject_name: selectedSubject.subject_name || '', subject_code: selectedSubject.subject_code || '' }
      : { subject_name: '', subject_code: '' })
    setEditingSectionId('')
    setSectionDraft(null)
    setSectionError('')
  }, [selectedSubjectId])

  const handleAddSubject = () => {
    const id = onAddSubject()
    setSelectedSubjectId(id)
  }

  const saveSubjectDetails = () => {
    if (!selectedSubject) return
    if (!subjectDraft.subject_name.trim() || !subjectDraft.subject_code.trim()) {
      setSectionError('Enter both a subject name and subject code.')
      return
    }
    onSave({ ...selectedSubject, ...subjectDraft })
    setSectionError('Subject details saved.')
  }

  const cancelSubjectDetails = () => {
    setSubjectDraft({ subject_name: selectedSubject?.subject_name || '', subject_code: selectedSubject?.subject_code || '' })
    setSectionError('Changes discarded.')
  }

  const editSection = (section, isNew = false) => {
    setEditingSectionId(section.id)
    setSectionDraft({
      ...section,
      section_code: section.section_code || '',
      meetings: getMeetingSlots(section).map((meeting) => ({ ...meeting, id: meeting.id || uid('meeting') })),
    })
    setSectionError('')
    if (isNew) setSectionDraft({ ...section, section_code: '', meetings: [] })
  }

  const addSection = () => editSection({ id: uid('section'), section_code: '', meetings: [], unavailable: false }, true)

  const updateMeeting = (meetingId, changes) => setSectionDraft((current) => ({
    ...current,
    meetings: current.meetings.map((meeting) => meeting.id === meetingId ? { ...meeting, ...changes } : meeting),
  }))

  const addMeeting = () => setSectionDraft((current) => ({
    ...current,
    meetings: [...current.meetings, { id: uid('meeting'), day: 'Monday', time_start: '09:00', time_end: '10:00', room: '', instructor: '' }],
  }))

  const saveSection = (event) => {
    event.preventDefault()
    if (!selectedSubject || !sectionDraft) return
    const validMeetings = sectionDraft.meetings.length > 0 && sectionDraft.meetings.every((meeting) =>
      DAYS.includes(meeting.day) && /^\d{2}:\d{2}$/.test(meeting.time_start) && /^\d{2}:\d{2}$/.test(meeting.time_end) && toMinutes(meeting.time_end) > toMinutes(meeting.time_start),
    )
    if (!sectionDraft.section_code.trim() || !validMeetings) {
      setSectionError('Enter a section code and at least one valid meeting day and time.')
      return
    }
    const sections = selectedSubject.sections || []
    const nextSections = sections.some((section) => section.id === sectionDraft.id)
      ? sections.map((section) => section.id === sectionDraft.id ? sectionDraft : section)
      : [...sections, sectionDraft]
    onSave({ ...selectedSubject, sections: nextSections })
    setEditingSectionId('')
    setSectionDraft(null)
    setSectionError('Section saved.')
  }

  const cancelSectionEdit = () => {
    setEditingSectionId('')
    setSectionDraft(null)
    setSectionError('Section changes discarded.')
  }

  const deleteSection = (sectionId) => {
    if (!selectedSubject) return
    const nextSections = selectedSubject.sections.filter((section) => section.id !== sectionId)
    const updated = { ...selectedSubject, sections: nextSections }
    if (getSelectedSectionId(selectedSubject, []) === sectionId) updated.selectedSectionId = null
    onSave(updated)
    setSectionError('Section deleted.')
  }

  const importImage = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setImportMessage('Recognizing text in the image…')
    try {
      const formData = new FormData()
      formData.append('scheduleImage', file)
      const response = await fetch('/api/ocr/upload', { method: 'POST', body: formData })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `Image recognition failed (${response.status}).`)
      if (!result.rawText?.trim()) {
        setImportMessage('No text was detected. Try a clearer screenshot or enter the subject manually.')
        return
      }
      const sections = (result.sections || []).map((section) => ({
        ...section,
        id: uid('section'),
        available: section.available !== false,
        meetings: (section.meetings || []).map((meeting) => ({ ...meeting, id: uid('meeting') })),
      }))
      setImportDraft({
        subject_name: result.subject_name || '',
        subject_code: result.subject_code || '',
        sections,
        recognizedText: result.rawText,
      })
      const meetingCount = sections.reduce((count, section) => count + section.meetings.length, 0)
      setImportMessage(meetingCount
        ? `Recognized ${sections.length} section(s) and ${meetingCount} meeting slot(s). Review the imported subject after saving.`
        : 'Text was recognized, but no section meeting times were confidently detected. Review the subject details and add section times manually.')
    } catch (error) {
      setImportMessage(error.message || 'Image recognition failed. Try a different screenshot or enter the subject manually.')
    }
  }

  const saveImportedSubject = () => {
    if (!importDraft?.subject_name.trim() || !importDraft?.subject_code.trim()) {
      setImportMessage('Enter a subject name and code before adding it to the pool.')
      return
    }
    const id = onAddSubject({ subject_name: importDraft.subject_name, subject_code: importDraft.subject_code, sections: importDraft.sections })
    setSelectedSubjectId(id)
    setImportDraft(null)
    setImportMessage('Imported subject added. Review its sections for accuracy.')
  }

  return (
    <section className="page-panel subjects-page">
      <div className="page-head">
        <div><p className="eyebrow">Course data</p><h1>Subjects</h1></div>
        <div className="subject-page-actions">
          <input ref={imageInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={importImage} />
          <button type="button" className="btn secondary" onClick={() => imageInput.current?.click()}><Icon name="ImageUp" size={16} /> Import from image</button>
          <button type="button" className="btn primary" onClick={handleAddSubject}><Icon name="Plus" size={16} /> Add new subject</button>
        </div>
      </div>
      {importMessage && <p className="form-hint import-message" role="status">{importMessage}</p>}

      <div className="subject-manager-grid">
        <aside className="subject-library panel">
          <label className="subject-pool-search"><Icon name="Search" size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subject or code" aria-label="Search subject or code" /></label>
          <div className="subject-library-list">
            {visibleSubjects.map((subject) => (
              <button type="button" key={subject.id} className={subject.id === selectedSubjectId ? 'subject-library-item active' : 'subject-library-item'} onClick={() => setSelectedSubjectId(subject.id)}>
                <strong>{subject.subject_code || 'New subject'}</strong>
                <span>{subject.subject_name || 'Untitled subject'}</span>
                <small>{subject.sections?.length || 0} section(s)</small>
              </button>
            ))}
            {!visibleSubjects.length && <p className="subject-pool-empty">{subjects.length ? 'No subjects match your search.' : 'Your subject pool is empty.'}</p>}
          </div>
        </aside>

        <div className="subject-detail panel">
          {selectedSubject ? <>
            <div className="subject-detail-heading">
              <div><p className="eyebrow">Subject information</p><h2>{selectedSubject.subject_name || 'New subject'}</h2></div>
              <button type="button" className="icon-btn danger" title="Delete subject" aria-label="Delete subject" onClick={() => { onRemove(selectedSubject.id); setSelectedSubjectId('') }}><Icon name="Trash2" size={16} /></button>
            </div>
            <div className="form-grid two subject-detail-fields">
              <label>Subject name<input value={subjectDraft.subject_name} onChange={(event) => setSubjectDraft({ ...subjectDraft, subject_name: event.target.value })} placeholder="e.g. Software Engineering 1" /></label>
              <label>Subject code<input value={subjectDraft.subject_code} onChange={(event) => setSubjectDraft({ ...subjectDraft, subject_code: event.target.value })} placeholder="e.g. CCSFEN1L" /></label>
            </div>
            <div className="subject-detail-actions">
              <button type="button" className="btn primary" onClick={saveSubjectDetails}><Icon name="Save" size={15} /> Save changes</button>
              <button type="button" className="btn secondary" onClick={cancelSubjectDetails}>Cancel</button>
            </div>

            <div className="section-list-heading"><div><h3>Sections</h3><p>Each section can have multiple weekly meeting slots.</p></div>
              <button type="button" className="btn secondary" onClick={addSection}><Icon name="Plus" size={15} /> Add section</button>
            </div>
            <div className="subject-section-list">
              {(selectedSubject.sections || []).map((section) => {
                const meetings = getMeetingSlots(section)
                const unavailable = section.unavailable === true || section.available === false
                return <article key={section.id} className={unavailable ? 'subject-section-card unavailable' : 'subject-section-card'}>
                  <div className="subject-section-card-head">
                    <div><strong>{section.section_code || 'Untitled section'}</strong><small>{meetings.length} meeting slot(s){unavailable ? ' · Unavailable' : ''}</small></div>
                    <div className="section-actions">
                      <button type="button" className="btn secondary compact" onClick={() => editSection(section)}><Icon name="Pencil" size={14} /> Edit</button>
                      <button type="button" className="btn secondary compact" onClick={() => onToggleUnavailable(selectedSubject.id, section.id, !unavailable)}>{unavailable ? 'Mark available' : 'Mark unavailable'}</button>
                      {!unavailable && <button type="button" className={isSectionLocked(selectedSubject, section) ? 'icon-btn locked' : 'icon-btn'} title={isSectionLocked(selectedSubject, section) ? 'Unlock section' : 'Lock section'} onClick={() => onToggleLock(selectedSubject, section, !isSectionLocked(selectedSubject, section))}><Icon name="LockKeyhole" size={14} /></button>}
                      <button type="button" className="icon-btn danger" title="Delete section" aria-label="Delete section" onClick={() => deleteSection(section.id)}><Icon name="Trash2" size={14} /></button>
                    </div>
                  </div>
                  <div className="section-meeting-summary">{meetings.map((meeting) => <span key={meeting.id}>{meeting.day} · {fmtTime(meeting.time_start)}–{fmtTime(meeting.time_end)}{meeting.room ? ` · ${meeting.room}` : ''}</span>)}</div>
                </article>
              })}
              {!selectedSubject.sections?.length && <p className="subject-pool-empty">No sections yet. Add a section to enter its meeting days and times.</p>}
            </div>

            {sectionDraft && <form className="section-edit-form" onSubmit={saveSection}>
              <div className="section-list-heading"><div><h3>{selectedSubject.sections?.some((section) => section.id === editingSectionId) ? 'Edit section' : 'New section'}</h3><p>Set section details and one or more meeting slots.</p></div></div>
              <label>Section code<input value={sectionDraft.section_code} onChange={(event) => setSectionDraft({ ...sectionDraft, section_code: event.target.value })} placeholder="e.g. A1" /></label>
              {sectionDraft.meetings.map((meeting) => <div key={meeting.id} className="meeting-slot-editor">
                <label>Day<select value={meeting.day} onChange={(event) => updateMeeting(meeting.id, { day: event.target.value })}>{DAYS.map((day) => <option key={day} value={day}>{day}</option>)}</select></label>
                <label>Start<input type="time" value={meeting.time_start} onChange={(event) => updateMeeting(meeting.id, { time_start: event.target.value })} /></label>
                <label>End<input type="time" value={meeting.time_end} onChange={(event) => updateMeeting(meeting.id, { time_end: event.target.value })} /></label>
                <button type="button" className="icon-btn danger" title="Delete meeting slot" aria-label="Delete meeting slot" onClick={() => setSectionDraft((current) => ({ ...current, meetings: current.meetings.filter((item) => item.id !== meeting.id) }))}><Icon name="Trash2" size={14} /></button>
              </div>)}
              <button type="button" className="btn secondary" onClick={addMeeting}><Icon name="Plus" size={15} /> Add meeting slot</button>
              {sectionError && <p className="form-hint" role="status">{sectionError}</p>}
              <div className="modal-actions"><button type="button" className="btn secondary" onClick={cancelSectionEdit}>Cancel</button><button type="submit" className="btn primary">Save section</button></div>
            </form>}
          </> : <div className="empty-state subject-empty-state"><Icon name="BookOpen" size={40} /><h2>Select or add a subject</h2><p>Subject details and sections will appear here.</p><button type="button" className="btn primary" onClick={handleAddSubject}>Add new subject</button></div>}
        </div>
      </div>

      {importDraft && <div className="modal-backdrop" onClick={() => setImportDraft(null)}><div className="modal-card import-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><h3>Review imported subject</h3><button type="button" className="icon-btn" onClick={() => setImportDraft(null)}><Icon name="X" size={16} /></button></div>
        <p className="form-hint">OCR is experimental. Check the extracted information before adding it to your subject pool.</p>
        <label>Subject name<input value={importDraft.subject_name} onChange={(event) => setImportDraft({ ...importDraft, subject_name: event.target.value })} /></label>
        <label>Subject code<input value={importDraft.subject_code} onChange={(event) => setImportDraft({ ...importDraft, subject_code: event.target.value })} /></label>
        <p className="form-hint">Detected meeting slots: {importDraft.sections.reduce((sum, section) => sum + section.meetings.length, 0)}. You can correct all details after importing.</p>
        <details className="ocr-text-details"><summary>Show recognized text</summary><pre>{importDraft.recognizedText}</pre></details>
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setImportDraft(null)}>Cancel</button><button type="button" className="btn primary" onClick={saveImportedSubject}>Save to subject pool</button></div>
      </div></div>}
    </section>
  )
}

function SettingsPanel({ profile, setProfile, resetSemester, onSave, isSaving }) {
  return (
    <section className="page-panel">
      <div className="page-head">
        <div>
          <p className="eyebrow">Account</p>
          <h1>Settings</h1>
        </div>
      </div>

      <div className="settings-grid">
        <article className="settings-card card">
          <h2>Profile</h2>
          <div className="form-grid two">
            <label>
              Full name
              <input value={profile.profile_name} onChange={(event) => setProfile({ ...profile, profile_name: event.target.value })} />
            </label>
            <label>
              Username
              <input value={profile.reg_username} onChange={(event) => setProfile({ ...profile, reg_username: event.target.value })} />
            </label>
            <label>
              Email
              <input type="email" value={profile.profile_email} onChange={(event) => setProfile({ ...profile, profile_email: event.target.value })} />
            </label>
            <label>
              Course
              <input value={profile.profile_course} onChange={(event) => setProfile({ ...profile, profile_course: event.target.value })} />
            </label>
            <label>
              Year level
              <select value={profile.profile_year} onChange={(event) => setProfile({ ...profile, profile_year: event.target.value })}>
                {['First year', 'Second year', 'Third year', 'Fourth year', 'Graduate'].map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </label>
          </div>
          <button type="button" className="btn primary" onClick={onSave} disabled={isSaving}><Icon name="Save" size={15} /> {isSaving ? 'Saving...' : 'Save account'}</button>
        </article>

        <article className="settings-card card">
          <h2>Preferences</h2>
          <div className="toggle-list">
            <label>
              Email reminders
              <input type="checkbox" checked={profile.notify_email} onChange={(event) => setProfile({ ...profile, notify_email: event.target.checked })} />
            </label>
            <label>
              Push notifications
              <input type="checkbox" checked={profile.notify_push} onChange={(event) => setProfile({ ...profile, notify_push: event.target.checked })} />
            </label>
            <label>
              Dark mode
              <input type="checkbox" checked={profile.theme_pref === 'dark'} onChange={(event) => setProfile({ ...profile, theme_pref: event.target.checked ? 'dark' : 'light' })} />
            </label>
          </div>
          <div className="settings-danger-zone">
            <h3>New semester</h3>
            <p>Remove all subjects and classes so you can enter a new set of courses.</p>
            <button type="button" className="btn danger" onClick={resetSemester}>Delete all classes</button>
          </div>
        </article>
      </div>
    </section>
  )
}

function ConstraintRail({ constraints, setConstraints, onGenerate, isGenerating, onReset }) {
  return (
    <aside className="constraint-rail card">
      <div className="constraint-head">
        <h2>Constraints</h2>
        <button type="button" className="btn primary" onClick={onGenerate} disabled={isGenerating}>
          <Icon name="Sparkles" size={15} /> {isGenerating ? 'Generating…' : 'Generate'}
        </button>
        <button type="button" className="btn secondary full" onClick={onReset}>Reset constraints</button>
      </div>

      <fieldset>
        <legend>Time boundaries</legend>
        <div className="form-grid two">
          <label>
            Earliest
            <select value={constraints.constraint_start} onChange={(event) => setConstraints({ ...constraints, constraint_start: event.target.value })}>
              {HOURS.map((hour) => (
                <option key={hour} value={`${String(hour).padStart(2, '0')}:00`}>{`${String(hour).padStart(2, '0')}:00`}</option>
              ))}
            </select>
          </label>
          <label>
            Latest
            <select value={constraints.constraint_end} onChange={(event) => setConstraints({ ...constraints, constraint_end: event.target.value })}>
              {HOURS.map((hour) => (
                <option key={hour} value={`${String(hour).padStart(2, '0')}:00`}>{`${String(hour).padStart(2, '0')}:00`}</option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Breaks between classes</legend>
        <div className="break-pref-options">
          {[
            { value: 'Compact', description: 'Keep gaps as short as possible' },
            { value: 'Spaced', description: 'Prefer around 45 minutes between classes' },
            { value: 'Long Break', description: 'Prefer around 90 minutes between classes' },
          ].map((option) => (
            <label
              key={option.value}
              className={constraints.break_pref === option.value ? 'break-pref-option selected' : 'break-pref-option'}
            >
              <input
                type="checkbox"
                name="break-preference"
                value={option.value}
                checked={constraints.break_pref === option.value}
                onChange={(event) => setConstraints({
                  ...constraints,
                  break_pref: event.target.checked ? option.value : constraints.break_pref === option.value ? '' : constraints.break_pref,
                })}
              />
              <span>
                <strong>{option.value}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Preferred days</legend>
        <div className="day-picker">
          {DAYS.map((day) => (
            <label key={day}>
              <input
                type="checkbox"
                checked={constraints.preferred_days.includes(day)}
                onChange={(event) =>
                  setConstraints({
                    ...constraints,
                    preferred_days: event.target.checked
                      ? [...constraints.preferred_days, day]
                      : constraints.preferred_days.filter((entry) => entry !== day),
                  })
                }
              />
              {day.slice(0, 3)}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="constraint-toggle">
        Minimize school days
        <input type="checkbox" checked={constraints.minimize_school_days} onChange={(event) => setConstraints({ ...constraints, minimize_school_days: event.target.checked })} />
      </label>

      <label>
        Max consecutive hours
        <input type="number" min="1" max="12" value={constraints.max_consecutive} onChange={(event) => setConstraints({ ...constraints, max_consecutive: Number(event.target.value) || 1 })} />
      </label>

    </aside>
  )
}

export default App
