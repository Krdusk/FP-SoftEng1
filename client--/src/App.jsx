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
  theme_pref: 'dark',
}

const emptyConstraints = {
  break_pref: 'Compact',
  minimize_school_days: false,
  study_shift: 'morning-afternoon',
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

const optimizeScheduleImage = async (file) => {
  const targetBytes = 3_700_000
  if (file.size <= targetBytes) return file
  if (typeof createImageBitmap !== 'function') throw new Error('This image is larger than the online upload limit. Crop or resize it, then try again.')

  const bitmap = await createImageBitmap(file)
  try {
    let scale = Math.min(1, 2800 / Math.max(bitmap.width, bitmap.height))
    for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('This browser could not prepare the schedule image for upload.')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

      for (const quality of [0.88, 0.82, 0.76, 0.7]) {
        const compressed = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
        if (compressed && compressed.size <= targetBytes) {
          const filename = file.name.replace(/\.[^.]+$/, '') || 'schedule'
          return new File([compressed], `${filename}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
        }
      }
      scale *= 0.82
    }
  } finally {
    bitmap.close?.()
  }

  throw new Error('This image is still too large after compression. Crop it to the schedule table and try again.')
}

const downloadSchedulePdf = (schedule, profile) => {
  const safeText = (value, maxLength = 28) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/·/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .slice(0, maxLength)
    .replace(/[\\()]/g, '\\$&')
  const entries = schedule
    .filter((entry) => DAYS.includes(entry.day) && /^\d{2}:\d{2}$/.test(entry.time_start || '') && /^\d{2}:\d{2}$/.test(entry.time_end || ''))
    .map((entry) => ({ ...entry, start: toMinutes(entry.time_start), end: toMinutes(entry.time_end) }))
  if (!entries.length) return

  const pageWidth = 842
  const pageHeight = 595
  const left = 28
  const tableWidth = pageWidth - left * 2
  const timeWidth = 62
  const dayWidth = (tableWidth - timeWidth) / DAYS.length
  const tableTop = 506
  const headerHeight = 24
  const bottom = 28
  const firstSlot = Math.floor(Math.min(...entries.map((entry) => entry.start)) / 30) * 30
  const lastSlot = Math.ceil(Math.max(...entries.map((entry) => entry.end)) / 30) * 30
  const rowCount = Math.max(1, (lastSlot - firstSlot) / 30)
  const rowHeight = Math.min(30, (tableTop - headerHeight - bottom) / rowCount)
  const commands = []
  const addText = (text, x, y, size, bold = false, color = '0.12 0.16 0.22') => {
    commands.push(`${color} rg BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${safeText(text, 120)}) Tj ET`)
  }
  const addCell = (x, y, width, height, fill = '1 1 1') => {
    commands.push(`${fill} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`)
    commands.push('0.67 0.71 0.77 RG 0.55 w')
    commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`)
  }

  addText('MyTerm', left, 558, 20, true, '0.08 0.16 0.28')
  addText('May the Schedule, be with you.', left, 544, 8, false, '0.34 0.39 0.46')
  addText('WEEKLY CLASS SCHEDULE', 570, 558, 14, true, '0.08 0.16 0.28')
  if (profile.profile_name) addText(profile.profile_name, 570, 543, 9, false, '0.28 0.33 0.40')

  let y = tableTop - headerHeight
  addCell(left, y, timeWidth, headerHeight, '0.89 0.92 0.96')
  addText('TIME', left + 7, y + 8, 8, true, '0.10 0.16 0.25')
  DAYS.forEach((day, index) => {
    const x = left + timeWidth + index * dayWidth
    addCell(x, y, dayWidth, headerHeight, '0.89 0.92 0.96')
    addText(day, x + 5, y + 8, 8, true, '0.10 0.16 0.25')
  })

  for (let row = 0; row < rowCount; row += 1) {
    const slot = firstSlot + row * 30
    y = tableTop - headerHeight - (row + 1) * rowHeight
    const hours = Math.floor(slot / 60)
    const minutes = slot % 60
    addCell(left, y, timeWidth, rowHeight, '0.95 0.96 0.97')
    addText(fmtTime(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`), left + 5, y + rowHeight / 2 - 2, 7, false, '0.25 0.30 0.38')
    DAYS.forEach((day, index) => {
      const x = left + timeWidth + index * dayWidth
      addCell(x, y, dayWidth, rowHeight)
      entries.filter((entry) => entry.day === day && Math.floor(entry.start / 30) * 30 === slot).forEach((entry) => {
        const cardX = x + 2
        const cardY = y + 1
        const cardWidth = dayWidth - 4
        const cardHeight = Math.max(1, rowHeight - 2)
        commands.push(`0.96 0.94 0.88 rg ${cardX.toFixed(2)} ${cardY.toFixed(2)} ${cardWidth.toFixed(2)} ${cardHeight.toFixed(2)} re f`)
        commands.push(`0.72 0.55 0.18 RG 1.6 w ${cardX.toFixed(2)} ${cardY.toFixed(2)} m ${cardX.toFixed(2)} ${(cardY + cardHeight).toFixed(2)} l S`)
        const name = entry.subject_code || entry.subject_name || 'Class'
        addText(`${name} ${entry.section_code || ''}`, cardX + 4, y + rowHeight - 8, 6.5, true)
        const room = entry.room ? ` - ${entry.room}` : ''
        addText(`${fmtTime(entry.time_start)}-${fmtTime(entry.time_end)}${room}`, cardX + 4, y + 4, 5.7)
      })
    })
  }

  const stream = commands.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n` })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'MyTerm-Weekly-Schedule.pdf'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const startOfWeek = (value) => {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - date.getDay())
  return date
}

const dateKey = (value) => {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const availableSections = (subject) => (subject.sections || []).filter((section) =>
  section.available !== false && section.unavailable !== true && getMeetingSlots(section).length > 0,
)

const dayFromDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  return DAYS[date.getDay()]
}

const calendarEntriesFor = (subject, selectedIds) => availableSections(subject)
  .filter((section) => selectedIds.includes(section.id))
  .flatMap((section) => toScheduleEntries(subject, section))

const overlaps = (a, b) =>
  (!a.meeting_date || !b.meeting_date || a.meeting_date === b.meeting_date) &&
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
  day: dayFromDate(meeting.meeting_date) || meeting.day,
  time_start: meeting.time_start,
  time_end: meeting.time_end,
  ...(meeting.meeting_date ? { meeting_date: meeting.meeting_date } : {}),
  room: meeting.room || '',
  instructor: meeting.instructor || '',
}))

const getSelectedSectionId = (subject, lockedSections = []) => {
  if (Object.prototype.hasOwnProperty.call(subject, 'selectedSectionId')) return subject.selectedSectionId
  const locked = lockedSections.find((section) => section.subject_id === subject.id)
  return locked?.id || null
}

const restoreCalendarSelections = (subjects) => subjects.map((subject) => ({
  ...subject,
  calendarSectionIds: Array.isArray(subject.calendarSectionIds)
    ? subject.calendarSectionIds.filter((id) => availableSections(subject).some((section) => section.id === id))
    : availableSections(subject).map((section) => section.id),
}))

function Icon({ name, size = 18, className }) {
  const Component = Icons[name] || Icons.CalendarDays
  return <Component size={size} className={className} />
}

function ActivityIndicator({ label }) {
  return <span className="activity-indicator" role="status"><span className="activity-orbit" aria-hidden="true"><i /></span><span>{label}</span><span className="activity-track" aria-hidden="true"><i /></span></span>
}

const trailerScenes = [
  { kicker: 'A NEW TERM BEGINS', title: 'Your week is wide open.', copy: 'Seven days. Dozens of class sections. One schedule that needs to fit your life.' },
  { kicker: 'BRING IT ALL TOGETHER', title: 'Every subject. Every meeting.', copy: 'Add the available sections, days, times, and rooms you are considering.' },
  { kicker: 'FIND YOUR ALIGNMENT', title: 'Make room for what matters.', copy: 'MyTerm compares combinations and checks for time conflicts as it builds your options.' },
  { kicker: 'YOUR CHOICE, YOUR PLAN', title: 'Choose the week that fits.', copy: 'Compare the alternatives, confirm your favorite, and keep your final calendar.' },
]

function TrailerOverlay({ onClose }) {
  const [scene, setScene] = useState(0)
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  useEffect(() => {
    if (scene >= trailerScenes.length) return undefined
    const timer = window.setTimeout(() => setScene((current) => current + 1), 4300)
    return () => window.clearTimeout(timer)
  }, [scene])

  const isEndCard = scene >= trailerScenes.length
  const currentScene = trailerScenes[Math.min(scene, trailerScenes.length - 1)]

  return (
    <div className="trailer-backdrop" role="presentation" onClick={onClose}>
      <section className="trailer-stage" role="dialog" aria-modal="true" aria-label="MyTerm motion trailer" onClick={(event) => event.stopPropagation()}>
        <div className="trailer-stars" aria-hidden="true">{warpStars.map((star, index) => <i key={index} style={{ '--star-x': star.x, '--star-y': star.y, '--star-size': star.size, '--star-duration': star.duration, '--star-delay': star.delay }} />)}</div>
        <div className="trailer-planet" aria-hidden="true" />
        <div className="trailer-calendar" aria-hidden="true">
          <div className="trailer-calendar-head"><span>TIME</span>{['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((day) => <span key={day}>{day}</span>)}</div>
          {['09:00', '11:00', '01:00', '03:00'].map((time, row) => <div className="trailer-calendar-row" key={time}><span>{time}</span>{Array.from({ length: 7 }, (_, column) => <span className={(row * 2 + column) % 5 === 1 ? 'trailer-class' : ''} key={column}>{(row * 2 + column) % 5 === 1 ? <i /> : null}</span>)}</div>)}
        </div>
        <div className="trailer-topline"><span><Icon name="Orbit" size={16} /> MYTERM · A WEEKLY PLANNER</span><button type="button" className="trailer-close" onClick={onClose}><Icon name="X" size={18} /><span>Skip</span></button></div>
        {!isEndCard ? (
          <div className="trailer-copy" key={scene}>
            <p>{currentScene.kicker}</p><h2>{currentScene.title}</h2><span>{currentScene.copy}</span>
          </div>
        ) : (
          <div className="trailer-endcard"><span className="trailer-logo"><Icon name="CalendarDays" size={24} /></span><p>MYTERM</p><h2>May the Schedule,<br />be with you.</h2><button type="button" className="btn primary" onClick={onClose}>Start planning <Icon name="ArrowRight" size={16} /></button></div>
        )}
        <div className="trailer-progress" aria-hidden="true"><i key={scene} className={isEndCard ? 'complete' : ''} /></div>
        <p className="trailer-caption">A clearer path through your class schedule.</p>
      </section>
    </div>
  )
}

function App() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [accountToken, setAccountToken] = useState('')
  const [loginDarkMode, setLoginDarkMode] = useState(true)
  const [trailerOpen, setTrailerOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [authMode, setAuthMode] = useState('login')
  const [accountForm, setAccountForm] = useState({ name: '', username: '', email: '', password: '', course: '', year: 'First year' })
  const [view, setView] = useState('schedule')
  const [mode, setMode] = useState('week')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
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
  const [confirmedOption, setConfirmedOption] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [toast, setToast] = useState('')
  const saveQueueRef = useRef(Promise.resolve())
  const saveRevisionRef = useRef(0)
  const isGuest = loggedIn && !accountToken

  const openSettings = () => {
    setProfileMenuOpen(false)
    if (isGuest) {
      setToast('Settings need a free account. Log out, then choose Create account to customize your planner.')
      return
    }
    setView('settings')
  }

  useEffect(() => {
    setLoginDarkMode(window.localStorage.getItem('myterm-user-theme') !== 'light')
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(''), toast.length > 70 ? 5000 : 2600)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!loggedIn || !accountToken || !profile.reg_username?.trim()) return undefined
    const revision = ++saveRevisionRef.current
    const identifier = profile.reg_username.trim()
    const state = { profile, subjects, schedule, constraints, lockedSections }
    setSaveStatus('saving')
    const timer = setTimeout(() => {
      savePlannerSnapshot(identifier, accountToken, state)
        .then(() => { if (revision === saveRevisionRef.current) setSaveStatus('saved') })
        .catch((error) => { if (revision === saveRevisionRef.current) { setSaveStatus('error'); setToast(`Could not save to MongoDB: ${error.message}`) } })
    }, 650)
    return () => clearTimeout(timer)
  }, [loggedIn, accountToken, profile, subjects, schedule, constraints, lockedSections])

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
    newSubject.calendarSectionIds = availableSections(newSubject).map((section) => section.id)
    setSubjects((current) => [...current, newSubject])
    if (newSubject.calendarSectionIds.length) {
      setSchedule((current) => [...current, ...calendarEntriesFor(newSubject, newSubject.calendarSectionIds)])
    }
    return newSubject.id
  }

  const saveSubject = (subject) => {
    const existing = subjects.find((item) => item.id === subject.id)
    const availableIds = availableSections(subject).map((section) => section.id)
    const priorIds = Array.isArray(existing?.calendarSectionIds)
      ? existing.calendarSectionIds
      : availableSections(existing || subject).map((section) => section.id)
    const newSectionIds = (subject.sections || []).filter((section) =>
      !existing?.sections?.some((oldSection) => oldSection.id === section.id) && availableIds.includes(section.id),
    ).map((section) => section.id)
    const calendarSectionIds = [...new Set([...priorIds.filter((id) => availableIds.includes(id)), ...newSectionIds])]
    const savedSubject = { ...subject, calendarSectionIds }
    setSubjects((current) => {
      const exists = current.some((item) => item.id === subject.id)
      if (exists) {
        return current.map((item) => (item.id === subject.id ? savedSubject : item))
      }
      return [...current, { ...savedSubject, id: subject.id || uid('sub') }]
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
      ...calendarEntriesFor(savedSubject, calendarSectionIds),
    ])
  }

  const selectSubjectSection = (subjectId, sectionId, selected) => {
    const subject = subjects.find((item) => item.id === subjectId)
    const section = subject?.sections?.find((item) => item.id === sectionId)
    if (!subject || !section) return
    const selectedIds = Array.isArray(subject.calendarSectionIds)
      ? subject.calendarSectionIds
      : availableSections(subject).map((item) => item.id)
    const nextIds = selected
      ? [...new Set([...selectedIds, sectionId])]
      : selectedIds.filter((id) => id !== sectionId)
    setSubjects((current) => current.map((item) => item.id === subjectId ? { ...item, calendarSectionIds: nextIds } : item))
    setSchedule((current) => [
      ...current.filter((entry) => entry.subject_id !== subjectId),
      ...calendarEntriesFor(subject, nextIds),
    ])
  }

  const selectAllSubjectsInCalendar = () => {
    const selections = subjects.map((subject) => ({ subject, ids: availableSections(subject).map((section) => section.id) }))
    const selectedCount = selections.reduce((count, item) => count + item.ids.length, 0)
    setSubjects((current) => current.map((subject) => ({ ...subject, calendarSectionIds: availableSections(subject).map((section) => section.id) })))
    setSchedule((current) => [
      ...current.filter((entry) => !entry.subject_id),
      ...selections.flatMap(({ subject, ids }) => calendarEntriesFor(subject, ids)),
    ])
    setToast(selectedCount
      ? `Added all ${selectedCount} available sections across ${selections.filter((item) => item.ids.length).length} subjects. Overlapping classes remain visible.`
      : 'No subjects with available meeting days to add.')
  }

  const setSectionUnavailable = (subjectId, sectionId, unavailable) => {
    const subject = subjects.find((item) => item.id === subjectId)
    const wasSelected = subject && (subject.calendarSectionIds || availableSections(subject).map((section) => section.id)).includes(sectionId)
    setSubjects((current) => current.map((item) => item.id !== subjectId ? item : {
      ...item,
      sections: item.sections.map((section) => section.id === sectionId ? { ...section, unavailable, available: !unavailable } : section),
      calendarSectionIds: unavailable
        ? (item.calendarSectionIds || []).filter((id) => id !== sectionId)
        : [...new Set([...(item.calendarSectionIds || []), sectionId])],
    }))
    const section = subject?.sections.find((item) => item.id === sectionId)
    setSchedule((current) => [
      ...current.filter((entry) => !(entry.subject_id === subjectId && entry.section_id === sectionId)),
      ...(!unavailable && subject && section ? toScheduleEntries(subject, { ...section, available: true, unavailable: false }) : []),
    ])
    setLockedSections((current) => current.filter((entry) => entry.id !== sectionId))
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
      day: dayFromDate(editing.meeting_date) || editing.day,
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
    const includedSubjects = subjects
    const hasIncompleteSubject = includedSubjects.some((subject) => {
      const sections = availableSections(subject)
      return !subject.subject_name?.trim() ||
        !subject.subject_code?.trim() ||
        !sections.length ||
        sections.every((section) => !section.section_code?.trim() || getMeetingSlots(section).some((meeting) =>
          !DAYS.includes(meeting.day) ||
          !/^\d{2}:\d{2}$/.test(meeting.time_start || '') ||
          !/^\d{2}:\d{2}$/.test(meeting.time_end || '') ||
          toMinutes(meeting.time_end) <= toMinutes(meeting.time_start),
        ))
    })
    if (hasIncompleteSubject) {
      setGeneratedOptions([])
      setGenerationIssues(['Each included subject needs at least one available section with a code, meeting day, and valid start and end times.'])
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

  const useGeneratedSchedule = (option, closeReview = true) => {
    const acceptedSchedule = option.schedule || []
    setSchedule(acceptedSchedule)
    const selectedBySubject = new Map()
    acceptedSchedule.forEach((entry) => {
      if (!entry.subject_id || !entry.section_id) return
      selectedBySubject.set(entry.subject_id, [...(selectedBySubject.get(entry.subject_id) || []), entry.section_id])
    })
    setSubjects((current) => current.map((subject) => ({
      ...subject,
      calendarSectionIds: [...new Set(selectedBySubject.get(subject.id) || [])],
      selectedSectionId: [...new Set(selectedBySubject.get(subject.id) || [])][0] || null,
    })))
    const firstDatedMeeting = acceptedSchedule.find((entry) => entry.meeting_date)?.meeting_date
    if (firstDatedMeeting) setWeekStart(startOfWeek(`${firstDatedMeeting}T00:00:00`))
    setMode('week')
    if (closeReview) setModal(null)
    setToast(`${selectedOption === 0 ? 'Best-fit schedule' : `Option ${selectedOption + 1}`} accepted and added to your final calendar.`)
  }

  const confirmSelectedOption = () => {
    const option = generatedOptions[selectedOption]
    if (!option) return
    setConfirmedOption(selectedOption)
    useGeneratedSchedule(option, false)
  }

  const downloadConfirmedSchedule = () => {
    const option = generatedOptions[confirmedOption]
    if (!option?.schedule?.length) return
    downloadSchedulePdf(option.schedule, profile)
    setModal(null)
    setToast('Confirmed schedule downloaded as a PDF.')
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
      if (Array.isArray(state.subjects)) {
        const restoredSubjects = restoreCalendarSelections(state.subjects)
        setSubjects(restoredSubjects)
        const manualEntries = (state.schedule || []).filter((entry) => !entry.subject_id)
        setSchedule([...manualEntries, ...restoredSubjects.flatMap((subject) => calendarEntriesFor(subject, subject.calendarSectionIds))])
      } else if (Array.isArray(state.schedule)) setSchedule(state.schedule)
      if (state.constraints) setConstraints((current) => ({ ...current, ...state.constraints }))
      if (Array.isArray(state.lockedSections)) setLockedSections(state.lockedSections)
      return true
    } catch {
      return false
    }
  }

  const savePlannerSnapshot = (identifier, token, state) => {
    const queuedSave = saveQueueRef.current.catch(() => {}).then(async () => {
      const response = await fetch(`/api/accounts/${encodeURIComponent(identifier)}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(state),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || `Save failed (${response.status}).`)
    })
    saveQueueRef.current = queuedSave
    return queuedSave
  }

  const savePlannerStateToBackend = async () => {
    if (!accountToken) throw new Error('Sign in to an account to save your planner online.')
    const identifier = profile.reg_username?.trim()
    if (!identifier) throw new Error('Add a username in Settings before saving online.')
    await savePlannerSnapshot(identifier, accountToken, { profile, subjects, schedule, constraints, lockedSections })
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
    setSaveStatus('saving')
    try {
      await savePlannerStateToBackend()
      setSaveStatus('saved')
      setToast('Planner saved to the backend.')
    } catch (error) {
      setSaveStatus('error')
      setToast(`Could not save to MongoDB: ${error.message}`)
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
    setSubjects((current) => current.map((subject) => ({ ...subject, calendarSectionIds: [] })))
    setToast('Calendar cleared. Subject generation preferences are unchanged.')
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
    setIsAuthenticating(true)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cleanUsername, password: loginPassword }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Login failed.')
      setAccountToken(result.token)
      setProfile({ ...emptyProfile, ...result.user.profile, theme_pref: result.user.profile.theme_pref ?? (loginDarkMode ? 'dark' : 'light') })
      const restoredSubjects = restoreCalendarSelections(result.user.subjects || [])
      setSubjects(restoredSubjects)
      setSchedule([...(result.user.schedule || []).filter((entry) => !entry.subject_id), ...restoredSubjects.flatMap((subject) => calendarEntriesFor(subject, subject.calendarSectionIds))])
      setConstraints((current) => ({ ...current, ...(result.user.constraints || {}) }))
      setLockedSections(result.user.lockedSections || [])
      setLoggedIn(true)
      setLoginPassword('')
      setToast('Welcome back.')
    } catch (error) {
      setToast(error.message)
    } finally {
      setIsAuthenticating(false)
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
    setIsAuthenticating(true)
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
      setProfile({ ...emptyProfile, ...result.user.profile, theme_pref: result.user.profile.theme_pref ?? (loginDarkMode ? 'dark' : 'light') })
      setSubjects([])
      setSchedule([])
      setLockedSections([])
      setUsername(cleanUsername)
      setLoggedIn(true)
      setAccountForm({ name: '', username: '', email: '', password: '', course: '', year: 'First year' })
      setToast(`Welcome, ${cleanName}.`)
    } catch (error) {
      setToast(error.message)
    } finally {
      setIsAuthenticating(false)
    }
  }

  const continueAsGuest = () => {
    setProfile((current) => ({ ...current, profile_name: current.profile_name || 'Guest Planner', reg_username: current.reg_username || 'guest' }))
    setView('schedule')
    setLoggedIn(true)
    setToast('Guest planner ready.')
  }

  const handleLogout = async () => {
    let saveFailed = false
    if (accountToken) {
      try {
        await savePlannerStateToBackend()
      } catch {
        saveFailed = true
      }
      await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${accountToken}` } }).catch(() => {})
    }
    setAccountToken('')
    setLoggedIn(false)
    setView('schedule')
    setProfile(emptyProfile)
    setSubjects([])
    setSchedule([])
    setLockedSections([])
    setConstraints(emptyConstraints)
    setProfileMenuOpen(false)
    setSaveStatus('idle')
    setToast(saveFailed ? 'Signed out, but the latest changes could not be saved. Check your connection and save before signing out next time.' : 'You have been signed out. Your planner is saved to your account.')
  }

  return (
    <div className={loggedIn ? (profile.theme_pref === 'light' ? 'app-shell' : 'app-shell dark-theme') : (loginDarkMode ? 'app-shell dark-theme' : 'app-shell')}>
      {!loggedIn ? (
        <div className="login-screen">
          <button type="button" className="login-theme-toggle" onClick={() => setLoginDarkMode((dark) => {
            const next = !dark
            window.localStorage.setItem('myterm-user-theme', next ? 'dark' : 'light')
            return next
          })}>{loginDarkMode ? 'Light mode' : 'Dark mode'}</button>
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
              <button type="button" className="trailer-launch" onClick={() => setTrailerOpen(true)}><span><Icon name="Play" size={15} /></span> Watch the MyTerm trailer <Icon name="ArrowUpRight" size={14} /></button>
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
                  <button type="submit" className="btn primary full" disabled={isAuthenticating}>{isAuthenticating ? <><Icon name="LoaderCircle" size={16} className="icon-spin" /> Signing in…</> : 'Continue'}</button>
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
                  <button type="submit" className="btn primary full" disabled={isAuthenticating}>{isAuthenticating ? <><Icon name="LoaderCircle" size={16} className="icon-spin" /> Creating account…</> : 'Create account'}</button>
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
                {['schedule', 'subjects', 'settings', 'about'].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`nav${view === tab ? ' active' : ''}${tab === 'settings' && isGuest ? ' restricted' : ''}`}
                    aria-label={tab === 'settings' && isGuest ? 'Settings, free account required' : undefined}
                    title={tab === 'settings' && isGuest ? 'Create a free account to customize planner settings' : undefined}
                    onClick={() => {
                      if (tab === 'settings' && isGuest) {
                        setProfileMenuOpen(false)
                        setToast('Settings need a free account. Log out, then choose Create account to customize your planner.')
                        return
                      }
                      setView(tab)
                      setProfileMenuOpen(false)
                    }}
                  >
                    {tab === 'schedule' ? 'My Schedule' : tab === 'subjects' ? 'Subjects' : tab === 'settings' ? (isGuest ? 'Settings 🔒' : 'Settings') : 'About'}
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
                  <button type="button" onClick={openSettings}><Icon name="UserRound" size={16} /> Account</button>
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
                onSelectAll={selectAllSubjectsInCalendar}
                onManageSubjects={() => setView('subjects')}
              />
            )}
            <main className="content card">
              {view === 'schedule' && (
                <ScheduleView
                  schedule={schedule}
                  mode={mode}
                  setMode={setMode}
                  weekStart={weekStart}
                  setWeekStart={setWeekStart}
                  conflicts={conflicts}
                  suggestions={suggestions}
                  applySuggestion={applySuggestion}
                  openClassModal={openClassModal}
                  removeClass={removeClass}
                  setEditing={setEditing}
                  onSave={savePlannerState}
                  onClear={clearCalendar}
                  isSaving={isSaving}
                  saveStatus={saveStatus}
                  hasAccount={Boolean(accountToken)}
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
                  isGuest={isGuest}
                />
              )}

              {view === 'settings' && !isGuest && (
                <SettingsPanel profile={profile} setProfile={setProfile} resetSemester={resetSemester} onSave={savePlannerState} isSaving={isSaving} />
              )}

              {view === 'about' && <AboutPanel onPlayTrailer={() => setTrailerOpen(true)} />}
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
                  Specific date <span className="optional-label">optional, for one-time meetings</span>
                  <input type="date" value={editing.meeting_date || ''} onChange={(event) => setEditing({ ...editing, meeting_date: event.target.value })} />
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
                {editing.id && <button type="button" className="btn danger" onClick={() => { removeClass(editing.id); setModal(null); setToast('Class removed.') }}>Delete class</button>}
                <button type="button" className="btn secondary" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="btn primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal === 'review' && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-card schedule-review-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Choose your schedule</h3>
              <button type="button" className="icon-btn" onClick={() => setModal(null)}><Icon name="X" size={16} /></button>
            </div>
            {generatedOptions.length > 0 && <p className="form-hint">Select an option, confirm it as your final calendar, then download that selected schedule as a PDF.</p>}

            {generationIssues.length > 0 && (
              <div className="warning-banner generation-message">
                <Icon name="TriangleAlert" size={15} />
                <div>{generationIssues.map((issue) => <p key={issue}>{issue}</p>)}</div>
              </div>
            )}
            {!generationWasComplete && <p className="form-hint">There were many combinations, so generation stopped after checking a large set of conflict-free options. These are the best options found in that search.</p>}

            <div className="review-list">
              {generatedOptions.length > 0 ? (
                generatedOptions.map((option, index) => {
                  const chosenSections = [...new Map(option.schedule.filter((entry) => entry.subject_id && entry.section_id).map((entry) => [`${entry.subject_id}:${entry.section_id}`, { subject_id: entry.subject_id, section_id: entry.section_id, entries: [] }])).values()]
                  chosenSections.forEach((choice) => { choice.entries = option.schedule.filter((entry) => entry.subject_id === choice.subject_id && entry.section_id === choice.section_id) })
                  return (
                  <button
                    key={index}
                    type="button"
                    className={selectedOption === index ? 'review-item selected' : 'review-item'}
                    onClick={() => { setSelectedOption(index); setConfirmedOption(null) }}
                  >
                    <span className="review-option-heading"><strong>{index === 0 ? 'Best fit for your preferences' : `Option ${index + 1}`}</strong>{index === 0 && <span className="recommendation-badge">RECOMMENDED</span>}</span>
                    <span>{new Set(option.schedule.filter((entry) => entry.subject_id).map((entry) => entry.subject_id)).size} of {subjects.length} subjects · Break fit {option.metrics.score}/100</span>
                    <span className="review-subject-options">{chosenSections.map((choice) => <span key={`${choice.subject_id}:${choice.section_id}`}><strong>{choice.entries[0]?.subject_code}</strong> · {choice.entries[0]?.section_code} · {choice.entries.map((entry) => `${entry.meeting_date || entry.day} ${fmtTime(entry.time_start)}–${fmtTime(entry.time_end)}${entry.room ? ` ${entry.room}` : ''}`).join(' / ')}</span>)}</span>
                    <small>{option.metrics.conflicts} conflicts · {option.metrics.outside_shift_meetings || 0} classes outside shift · {option.metrics.school_days} days · {option.metrics.gaps}h gaps · longest run {option.metrics.longest_consecutive_hours}h</small>
                  </button>
                )})
              ) : (
                <p>No complete conflict-free schedule fits every included subject and the selected shift. Try another break preference, unlock a section, or check for overlapping section times.</p>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => { setModal(null); setToast('Schedule declined. Your current calendar was kept.') }}>Decline · Keep current calendar</button>
              {generatedOptions.length > 0 && confirmedOption === selectedOption
                ? <button type="button" className="btn primary" onClick={downloadConfirmedSchedule}><Icon name="Download" size={15} /> Download confirmed schedule PDF</button>
                : generatedOptions.length > 0 && <button type="button" className="btn primary" onClick={confirmSelectedOption}><Icon name="Check" size={15} /> Confirm selected schedule</button>}
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
      {trailerOpen && <TrailerOverlay onClose={() => setTrailerOpen(false)} />}
    </div>
  )
}

function SubjectPoolPanel({ subjects, onSelectSection, onSelectAll, onManageSubjects }) {
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
        <div className="pool-tools">
          <button type="button" className="pool-expand-all" onClick={toggleAll}>
            <Icon name={allExpanded ? 'ChevronsUp' : 'ChevronsDown'} size={15} />
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
          <button type="button" className="pool-select-all" onClick={onSelectAll} title="Add every available section for every subject to the calendar, including overlaps.">
            <Icon name="ListChecks" size={15} /> Select all sections
          </button>
        </div>
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
            const selectedSectionIds = Array.isArray(subject.calendarSectionIds)
              ? subject.calendarSectionIds
              : availableSections(subject).map((section) => section.id)
            const selectedCount = sections.filter((section) => selectedSectionIds.includes(section.id)).length
            return (
              <article key={subject.id} className="subject-pool-group">
                <div className="subject-pool-group-head">
                  <button
                    type="button"
                    className="pool-subject-toggle"
                    aria-expanded={Boolean(expandedSubjects[subject.id])}
                    onClick={() => setExpandedSubjects((current) => ({ ...current, [subject.id]: !current[subject.id] }))}
                  >
                  <span className="subject-pool-title">
                    <strong>{subject.subject_code || 'New subject'}</strong>
                    <small>{subject.subject_name || 'Add a subject name'} · Required for generation</small>
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
                        checked={selectedSectionIds.includes(section.id)}
                        disabled={unavailable}
                        onChange={(event) => onSelectSection(subject.id, section.id, event.target.checked)}
                      />
                      <span>
                        <strong>{section.section_code || 'Section'}{unavailable ? ' · Unavailable' : ''}</strong>
                        <small>{meetings.length ? meetings.map((meeting) => `${(dayFromDate(meeting.meeting_date) || meeting.day).slice(0, 3)}${meeting.meeting_date ? ` ${meeting.meeting_date}` : ''} ${fmtTime(meeting.time_start)}–${fmtTime(meeting.time_end)}`).join(' · ') : 'No meeting times added'}</small>
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

function ScheduleView({ schedule, mode, setMode, weekStart, setWeekStart, conflicts, suggestions, applySuggestion, openClassModal, removeClass, onSave, onClear, isSaving, saveStatus, hasAccount }) {
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
          {hasAccount && <span className={`sync-status ${saveStatus}`} role="status" aria-live="polite">{saveStatus === 'saving' ? 'Saving to MongoDB…' : saveStatus === 'saved' ? 'Saved to MongoDB' : saveStatus === 'error' ? 'Save failed · retry with Save' : ''}</span>}
          <button type="button" className="btn secondary" onClick={onSave} disabled={isSaving}><Icon name={isSaving ? 'LoaderCircle' : 'CloudUpload'} size={15} className={isSaving ? 'icon-spin' : undefined} /> {isSaving ? 'Saving...' : 'Save'}</button>
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
        <WeekGrid schedule={schedule} weekStart={weekStart} setWeekStart={setWeekStart} openClassModal={openClassModal} />
      ) : (
        <ListView schedule={schedule} openClassModal={openClassModal} removeClass={removeClass} />
      )}
    </section>
  )
}

function WeekGrid({ schedule, weekStart, setWeekStart, openClassModal }) {
  const weekDates = DAYS.map((_, index) => {
    const date = new Date(weekStart)
    date.setDate(date.getDate() + index)
    return date
  })
  const todayKey = dateKey(new Date())
  const weekLabel = `${weekDates[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekDates[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <>
    <div className="week-navigation">
      <button type="button" className="icon-btn" aria-label="Previous week" onClick={() => setWeekStart((current) => { const next = new Date(current); next.setDate(next.getDate() - 7); return next })}><Icon name="ChevronLeft" size={17} /></button>
      <strong>{weekLabel}</strong>
      <button type="button" className="icon-btn" aria-label="Next week" onClick={() => setWeekStart((current) => { const next = new Date(current); next.setDate(next.getDate() + 7); return next })}><Icon name="ChevronRight" size={17} /></button>
      <button type="button" className="btn secondary compact" onClick={() => setWeekStart(startOfWeek(new Date()))}>Today</button>
    </div>
    <div className="week-board">
      <div className="week-head">
        <div className="time-heading">Time</div>
        {DAYS.map((day, index) => (
          <div key={day} className={dateKey(weekDates[index]) === todayKey ? 'day-heading today' : 'day-heading'}><span>{day.slice(0, 3)}</span><small>{weekDates[index].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>
        ))}
      </div>

      {HOURS.map((hour) => (
        <div key={hour} className="week-row">
          <div className="time-cell">{fmtTime(`${String(hour).padStart(2, '0')}:00`)}</div>
          {DAYS.map((day) => {
            const dayDate = dateKey(weekDates[DAYS.indexOf(day)])
            const items = schedule.filter((entry) => entry.day === day && (!entry.meeting_date || entry.meeting_date === dayDate) && Number(entry.time_start.slice(0, 2)) === hour)
            return (
              <div
                key={`${day}-${hour}`}
                className={dayDate === todayKey ? 'slot today-slot' : 'slot'}
                onDoubleClick={() => openClassModal({ day, time_start: `${String(hour).padStart(2, '0')}:00`, time_end: `${String(hour + 1).padStart(2, '0')}:00` })}
              >
                {items.map((entry) => (
                  <button type="button" key={entry.id} className="event-card" onClick={() => openClassModal(entry)}>
                    <strong>{entry.subject_code}</strong>
                    <span>{fmtTime(entry.time_start)}–{fmtTime(entry.time_end)}</span>
                    <small>{entry.meeting_date ? `${entry.meeting_date} · ` : ''}{entry.section_code}{entry.room ? ` · ${entry.room}` : ''}</small>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      ))}
    </div>
    </>
  )
}

function AboutPanel({ onPlayTrailer }) {
  const developers = [
    { name: 'Senopera', emoji: '🦉', alt: 'Owl emoji placeholder for the developer photo' },
    { name: 'Santos', emoji: '🐢', alt: 'Turtle emoji placeholder for the developer photo' },
    { name: 'Recio', emoji: '🐱', alt: 'Cat emoji placeholder for the developer photo' },
    { name: 'Geronimo', emoji: '🐝', alt: 'Bee emoji placeholder for the developer photo' },
    { name: 'Cinco', emoji: '🦊', alt: 'Fox emoji placeholder for the developer photo' },
  ]

  return (
    <section className="page-panel about-page">
      <div className="page-head"><div><p className="eyebrow">About MyTerm</p><h1>Plan your week with confidence.</h1></div><button type="button" className="btn secondary" onClick={onPlayTrailer}><Icon name="Play" size={15} /> Watch trailer</button></div>
      <p className="about-intro">MyTerm helps students turn available class sections into clear, conflict-free weekly schedules.</p>
      <div className="about-pillars">
        <article className="card about-pillar"><span className="about-icon"><Icon name="Target" size={19} /></span><h2>Our Mission</h2><p>Make class planning easier by helping students compare sections, respect their preferences, and avoid schedule conflicts.</p></article>
        <article className="card about-pillar"><span className="about-icon"><Icon name="Eye" size={19} /></span><h2>Our Vision</h2><p>Help every student build a balanced school week with a schedule they understand and can confidently follow.</p></article>
        <article className="card about-pillar"><span className="about-icon"><Icon name="Compass" size={19} /></span><h2>Our Purpose</h2><p>Bring subject sections, meeting days, times, and break preferences together so students can choose a practical weekly plan.</p></article>
      </div>
      <section className="developers-section">
        <div><p className="eyebrow">The team behind MyTerm</p><h2>Meet the Developers</h2><p>Emoji portraits are placeholders for future profile photos.</p></div>
        <div className="developer-grid">{developers.map((developer) => <article className="card developer-card" key={developer.name}><span className="developer-avatar" role="img" aria-label={developer.alt}>{developer.emoji}</span><h3>{developer.name}</h3><p>MyTerm Developer</p></article>)}</div>
      </section>
    </section>
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
              <p>{entry.section_code} · {entry.day}{entry.meeting_date ? ` · ${entry.meeting_date}` : ''} · {fmtTime(entry.time_start)}–{fmtTime(entry.time_end)}{entry.room ? ` · ${entry.room}` : ''}</p>
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

function SubjectsPanel({ subjects, onAddSubject, onSave, onRemove, isSectionLocked, onToggleLock, onToggleUnavailable, isGuest }) {
  const [query, setQuery] = useState('')
  const [selectedSubjectId, setSelectedSubjectId] = useState(() => subjects[0]?.id || '')
  const [subjectDraft, setSubjectDraft] = useState({ subject_name: '', subject_code: '' })
  const [editingSectionId, setEditingSectionId] = useState('')
  const [sectionDraft, setSectionDraft] = useState(null)
  const [sectionError, setSectionError] = useState('')
  const [importDraft, setImportDraft] = useState(null)
  const [importMessage, setImportMessage] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [importPreviewUrl, setImportPreviewUrl] = useState('')
  const [importConfirmed, setImportConfirmed] = useState(false)
  const [guestUploads, setGuestUploads] = useState(() => {
    if (typeof window === 'undefined') return 0
    const stored = Number(window.localStorage.getItem('myterm-guest-image-uploads') || 0)
    return Number.isFinite(stored) ? Math.min(3, Math.max(0, stored)) : 0
  })
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

  useEffect(() => () => {
    if (importPreviewUrl) URL.revokeObjectURL(importPreviewUrl)
  }, [importPreviewUrl])

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

    if (isGuest && guestUploads >= 3) {
      setImportMessage('You have used all 3 guest image uploads. Creating an account is totally free and lets you continue importing schedules and customize your planner.')
      return
    }

    if (isGuest) {
      const nextCount = guestUploads + 1
      window.localStorage.setItem('myterm-guest-image-uploads', String(nextCount))
      setGuestUploads(nextCount)
    }

    const previewUrl = URL.createObjectURL(file)
    setImportPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return previewUrl
    })
    setImportMessage('Recognizing text in the image…')
    setIsImporting(true)
    try {
      // Ipinapadala sa backend ang image para mabasa ng Gemini at ma-cross-check ng local OCR.
      const formData = new FormData()
      formData.append('scheduleImage', await optimizeScheduleImage(file))
      const response = await fetch('/api/ocr/upload', { method: 'POST', body: formData })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `Image recognition failed (${response.status}).`)
      if (!result.rawText?.trim()) {
        setImportMessage(result.warnings?.join(' ') || 'No text was detected. Try a clearer screenshot or enter the subject manually.')
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
        subject_name_evidence: result.subject_name_evidence || '',
        subject_code: result.subject_code || '',
        subject_code_evidence: result.subject_code_evidence || '',
        sections,
        recognizedText: result.rawText,
        localRawText: result.localRawText || '',
        recognitionProvider: result.recognitionProvider || 'Local OCR',
        recognitionConfidence: result.recognitionConfidence,
        warnings: result.warnings || [],
      })
      setImportConfirmed(false)
      const meetingCount = sections.reduce((count, section) => count + section.meetings.length, 0)
      setImportMessage(result.warnings?.length
        ? result.warnings.join(' ')
        : meetingCount
        ? `Recognized ${sections.length} section(s) and ${meetingCount} meeting day(s). Review the imported subject after saving.`
        : 'Text was recognized, but no section meeting times were confidently detected. Review the subject details and add section times manually.')
    } catch (error) {
      const message = String(error.message || '')
      setImportMessage(/failed to fetch|networkerror|load failed/i.test(message)
        ? 'MyTerm could not reach its image-reading server. Make sure the backend is running at localhost:5173, then try the image again.'
        : message || 'Image recognition failed. Try a different screenshot or enter the subject manually.')
    } finally {
      setIsImporting(false)
    }
  }

  const saveImportedSubject = () => {
    if (!importDraft?.subject_name.trim() || !importDraft?.subject_code.trim()) {
      setImportMessage('Enter a subject name and code before adding it to the pool.')
      return
    }
    const sections = importDraft.sections || []
    const hasIncompleteSection = sections.some((section) =>
      !section.section_code?.trim() || !section.meetings?.length || section.meetings.some((meeting) =>
        !DAYS.includes(meeting.day) || !/^\d{2}:\d{2}$/.test(meeting.time_start || '') || !/^\d{2}:\d{2}$/.test(meeting.time_end || '') || toMinutes(meeting.time_end) <= toMinutes(meeting.time_start),
      ),
    )
    if (!sections.length || hasIncompleteSection) {
      setImportMessage('Review each section and add its code, day, start time, and end time before saving.')
      return
    }
    if (!importConfirmed) {
      setImportMessage('Compare every detected value with the image and confirm the details before saving.')
      return
    }
    const id = onAddSubject({ subject_name: importDraft.subject_name, subject_code: importDraft.subject_code, sections: importDraft.sections })
    setSelectedSubjectId(id)
    clearImportReview()
    setImportMessage('Imported subject added. Review its sections for accuracy.')
  }

  const updateImportedSection = (sectionId, changes) => setImportDraft((current) => ({
    ...current,
    sections: current.sections.map((section) => section.id === sectionId ? { ...section, ...changes } : section),
  }))

  const updateImportedMeeting = (sectionId, meetingId, changes) => setImportDraft((current) => ({
    ...current,
    sections: current.sections.map((section) => section.id !== sectionId ? section : {
      ...section,
      meetings: section.meetings.map((meeting) => meeting.id === meetingId ? { ...meeting, ...changes } : meeting),
    }),
  }))

  const addImportedSection = () => setImportDraft((current) => ({
    ...current,
    sections: [...current.sections, { id: uid('section'), section_code: '', meetings: [], available: true }],
  }))

  const clearImportReview = () => {
    setImportDraft(null)
    setImportConfirmed(false)
    setImportPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return ''
    })
  }

  const requestImageImport = () => {
    if (isGuest && guestUploads >= 3) {
      setImportMessage('You have used all 3 guest image uploads. Creating an account is totally free and lets you continue importing schedules and customize your planner.')
      return
    }
    imageInput.current?.click()
  }

  return (
    <section className="page-panel subjects-page">
      <div className="page-head">
        <div><p className="eyebrow">Course data</p><h1>Subjects</h1></div>
        <div className="subject-page-actions">
          <input ref={imageInput} className="visually-hidden" type="file" accept="image/*" onChange={importImage} />
          <button type="button" className="btn secondary" onClick={requestImageImport} disabled={isImporting}><Icon name={isImporting ? 'LoaderCircle' : 'ImageUp'} size={16} className={isImporting ? 'icon-spin' : undefined} /> {isImporting ? 'Reading image…' : 'Import from image'}</button>
          <button type="button" className="btn primary" onClick={handleAddSubject}><Icon name="Plus" size={16} /> Add new subject</button>
        </div>
      </div>
      <p className="image-crop-tip"><Icon name="ScanLine" size={16} /> For best results, crop the image so the subject code, subject name, class days, and times are clearly visible.</p>
      {isGuest && <p className="guest-limit-note" role="status">Guests get 3 free image-reading attempts. Remaining: {Math.max(0, 3 - guestUploads)} of 3. Creating an account is free and lets you keep importing schedules and customize your planner.</p>}
      {importMessage && <p className="form-hint import-message" role="status">{isImporting && <span className="import-wait"><ActivityIndicator label="Reading your schedule image" /></span>}{importMessage}</p>}

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

            <div className="section-list-heading"><div><h3>Sections</h3><p>If a section is full, mark it unavailable so generation can try another. Delete it if it is no longer offered.</p></div>
              <button type="button" className="btn secondary" onClick={addSection}><Icon name="Plus" size={15} /> Add section</button>
            </div>
            <div className="subject-section-list">
              {(selectedSubject.sections || []).map((section) => {
                const meetings = getMeetingSlots(section)
                const unavailable = section.unavailable === true || section.available === false
                return <article key={section.id} className={unavailable ? 'subject-section-card unavailable' : 'subject-section-card'}>
                  <div className="subject-section-card-head">
                    <div><strong>{section.section_code || 'Untitled section'}</strong><small>{meetings.length} meeting day(s){unavailable ? ' · Unavailable' : ''}</small></div>
                    <div className="section-actions">
                      <button type="button" className="btn secondary compact" onClick={() => editSection(section)}><Icon name="Pencil" size={14} /> Edit</button>
                      <button type="button" className="btn secondary compact" onClick={() => onToggleUnavailable(selectedSubject.id, section.id, !unavailable)}>{unavailable ? 'Mark available' : 'Mark unavailable'}</button>
                      {!unavailable && <button type="button" className={isSectionLocked(selectedSubject, section) ? 'icon-btn locked' : 'icon-btn'} title={isSectionLocked(selectedSubject, section) ? 'Unlock section' : 'Lock section'} onClick={() => onToggleLock(selectedSubject, section, !isSectionLocked(selectedSubject, section))}><Icon name="LockKeyhole" size={14} /></button>}
                      <button type="button" className="icon-btn danger" title="Delete section" aria-label="Delete section" onClick={() => deleteSection(section.id)}><Icon name="Trash2" size={14} /></button>
                    </div>
                  </div>
                  <div className="section-meeting-summary">{meetings.map((meeting) => <span key={meeting.id}>{meeting.day}{meeting.meeting_date ? ` · ${meeting.meeting_date}` : ''} · {fmtTime(meeting.time_start)}–{fmtTime(meeting.time_end)}{meeting.room ? ` · ${meeting.room}` : ''}</span>)}</div>
                </article>
              })}
              {!selectedSubject.sections?.length && <p className="subject-pool-empty">No sections yet. Add a section to enter its meeting days and times.</p>}
            </div>

            {sectionDraft && <form className="section-edit-form" onSubmit={saveSection}>
              <div className="section-list-heading"><div><h3>{selectedSubject.sections?.some((section) => section.id === editingSectionId) ? 'Edit section' : 'New section'}</h3><p>Set section details and its meeting days.</p></div></div>
              <label>Section code<input value={sectionDraft.section_code} onChange={(event) => setSectionDraft({ ...sectionDraft, section_code: event.target.value })} placeholder="e.g. A1" /></label>
              {sectionDraft.meetings.map((meeting) => <div key={meeting.id} className="meeting-slot-editor">
                <label>Day<select value={meeting.day} onChange={(event) => updateMeeting(meeting.id, { day: event.target.value })}>{DAYS.map((day) => <option key={day} value={day}>{day}</option>)}</select></label>
                <label>Start<input type="time" value={meeting.time_start} onChange={(event) => updateMeeting(meeting.id, { time_start: event.target.value })} /></label>
                <label>End<input type="time" value={meeting.time_end} onChange={(event) => updateMeeting(meeting.id, { time_end: event.target.value })} /></label>
                <label>Room<input value={meeting.room || ''} onChange={(event) => updateMeeting(meeting.id, { room: event.target.value })} placeholder="e.g. 415MB" /></label>
                <button type="button" className="icon-btn danger" title="Delete meeting day" aria-label="Delete meeting day" onClick={() => setSectionDraft((current) => ({ ...current, meetings: current.meetings.filter((item) => item.id !== meeting.id) }))}><Icon name="Trash2" size={14} /></button>
              </div>)}
              <button type="button" className="btn secondary" onClick={addMeeting}><Icon name="Plus" size={15} /> Add meeting day</button>
              {sectionError && <p className="form-hint" role="status">{sectionError}</p>}
              <div className="modal-actions"><button type="button" className="btn secondary" onClick={cancelSectionEdit}>Cancel</button><button type="submit" className="btn primary">Save section</button></div>
            </form>}
          </> : <div className="empty-state subject-empty-state"><Icon name="BookOpen" size={40} /><h2>Select or add a subject</h2><p>Subject details and sections will appear here.</p><button type="button" className="btn primary" onClick={handleAddSubject}>Add new subject</button></div>}
        </div>
      </div>

      {importDraft && <div className="modal-backdrop" onClick={clearImportReview}><div className="modal-card import-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><p className="eyebrow">Image scan review</p><h3>Check the schedule details</h3></div><button type="button" className="icon-btn" aria-label="Close image review" onClick={clearImportReview}><Icon name="X" size={16} /></button></div>
        <p className="import-provider"><Icon name="ScanSearch" size={16} /> Read by {importDraft.recognitionProvider}. Compare every value with the original before saving.</p>
        {importDraft.warnings?.length > 0 && <ul className="ocr-warnings">{importDraft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        <div className="import-review-grid">
          <figure className="import-source-preview">
            {importPreviewUrl ? <img src={importPreviewUrl} alt="Original uploaded schedule for comparison" /> : <div className="import-preview-empty">Original image preview unavailable</div>}
            <figcaption>Original image · confirm days, dates, and time periods here</figcaption>
          </figure>
          <div className="import-review-fields">
            <label>Subject name<input value={importDraft.subject_name} onChange={(event) => setImportDraft({ ...importDraft, subject_name: event.target.value })} />{importDraft.subject_name_evidence && <small className="field-evidence">Image text: “{importDraft.subject_name_evidence}”</small>}</label>
            <label>Subject code<input value={importDraft.subject_code} onChange={(event) => setImportDraft({ ...importDraft, subject_code: event.target.value })} />{importDraft.subject_code_evidence && <small className="field-evidence">Image text: “{importDraft.subject_code_evidence}”</small>}</label>
            <div className="import-section-heading"><div><h4>Sections and meeting days</h4><p>Edit any uncertain value before importing.</p></div><button type="button" className="btn secondary compact" onClick={addImportedSection}><Icon name="Plus" size={14} /> Add section</button></div>
            <div className="import-section-list">
              {importDraft.sections.map((section) => <article className="import-section-card" key={section.id}>
                <div className="import-section-card-head"><label>Section code<input value={section.section_code} onChange={(event) => updateImportedSection(section.id, { section_code: event.target.value })} /></label><button type="button" className="icon-btn danger" aria-label={`Remove section ${section.section_code || ''}`} onClick={() => setImportDraft((current) => ({ ...current, sections: current.sections.filter((item) => item.id !== section.id) }))}><Icon name="Trash2" size={14} /></button></div>
                {section.section_code_evidence && <small className="field-evidence">Image text: “{section.section_code_evidence}”</small>}
                {section.meetings.map((meeting) => <div className="import-meeting-card" key={meeting.id}>
                  <div className="import-meeting-fields">
                    <label>Day<select value={meeting.day || ''} onChange={(event) => updateImportedMeeting(section.id, meeting.id, { day: event.target.value })}><option value="" disabled>Choose day</option>{DAYS.map((day) => <option key={day} value={day}>{day}</option>)}</select>{meeting.day_evidence && <small className="field-evidence">Image text: “{meeting.day_evidence}”</small>}</label>
                    <label>Date <span className="optional-label">optional</span><input type="date" value={meeting.meeting_date || ''} onChange={(event) => updateImportedMeeting(section.id, meeting.id, { meeting_date: event.target.value })} /></label>
                    <label>Start<input type="time" value={meeting.time_start || ''} onChange={(event) => updateImportedMeeting(section.id, meeting.id, { time_start: event.target.value })} />{meeting.start_evidence && <small className="field-evidence">Image text: “{meeting.start_evidence}”</small>}</label>
                    <label>End<input type="time" value={meeting.time_end || ''} onChange={(event) => updateImportedMeeting(section.id, meeting.id, { time_end: event.target.value })} />{meeting.end_evidence && <small className="field-evidence">Image text: “{meeting.end_evidence}”</small>}</label>
                    <label>Room<input value={meeting.room || ''} onChange={(event) => updateImportedMeeting(section.id, meeting.id, { room: event.target.value })} placeholder="e.g. 415MB" />{meeting.room_evidence && <small className="field-evidence">Image text: “{meeting.room_evidence}”</small>}</label>
                    <button type="button" className="icon-btn danger" aria-label="Remove meeting" onClick={() => updateImportedSection(section.id, { meetings: section.meetings.filter((item) => item.id !== meeting.id) })}><Icon name="Trash2" size={14} /></button>
                  </div>
                </div>)}
                <button type="button" className="btn secondary compact" onClick={() => updateImportedSection(section.id, { meetings: [...section.meetings, { id: uid('meeting'), day: '', meeting_date: '', time_start: '', time_end: '', room: '' }] })}><Icon name="Plus" size={14} /> Add meeting day</button>
              </article>)}
              {!importDraft.sections.length && <p className="form-hint">No sections detected yet. Add a section and enter its visible details to continue.</p>}
            </div>
          </div>
        </div>
        <details className="ocr-text-details"><summary>Compare recognized text</summary><h4>AI image reading</h4><pre>{importDraft.recognizedText || 'No text transcript was returned.'}</pre>{importDraft.localRawText && <><h4>Local OCR cross-check</h4><pre>{importDraft.localRawText}</pre></>}</details>
        <label className="import-confirmation"><input type="checkbox" checked={importConfirmed} onChange={(event) => setImportConfirmed(event.target.checked)} /><span>I compared the subject, sections, days, dates, and times with the original image.</span></label>
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={clearImportReview}>Cancel</button><button type="button" className="btn primary" onClick={saveImportedSubject} disabled={!importConfirmed}>Save reviewed subject</button></div>
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
          <button type="button" className="btn primary" onClick={onSave} disabled={isSaving}><Icon name={isSaving ? 'LoaderCircle' : 'Save'} size={15} className={isSaving ? 'icon-spin' : undefined} /> {isSaving ? 'Saving...' : 'Save account'}</button>
        </article>

        <article className="settings-card card">
          <h2>Preferences</h2>
          <div className="toggle-list">
            <label className="theme-choice">
              <span>Dark mode</span>
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
        <h2>Schedule preferences</h2>
        <button type="button" className="btn primary" onClick={onGenerate} disabled={isGenerating}>
          <Icon name={isGenerating ? 'LoaderCircle' : 'Sparkles'} size={15} className={isGenerating ? 'icon-spin' : undefined} /> {isGenerating ? 'Generating…' : 'Generate'}
        </button>
        {isGenerating && <ActivityIndicator label="Checking section combinations" />}
        <button type="button" className="btn secondary full" onClick={onReset}>Reset preferences</button>
      </div>

      <fieldset>
        <legend>Study shift</legend>
        <div className="break-pref-options">
          {[
            { value: 'morning-afternoon', title: 'Morning to afternoon', description: 'Focus classes between 7:00 AM and 5:00 PM' },
            { value: 'afternoon-evening', title: 'Afternoon to Evening', description: 'Only classes between 1:00 PM and 9:00 PM' },
            { value: 'balanced', title: 'Balanced (Conflict-Free)', description: 'Use 7:00 AM–9:00 PM and your break preferences' },
          ].map((option) => (
            <label key={option.value} className={constraints.study_shift === option.value ? 'break-pref-option selected' : 'break-pref-option'}>
              <input type="radio" name="study-shift" value={option.value} checked={constraints.study_shift === option.value} onChange={(event) => setConstraints({ ...constraints, study_shift: event.target.value })} />
              <span><strong>{option.title}</strong><small>{option.description}</small></span>
            </label>
          ))}
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
                type="radio"
                name="break-preference"
                value={option.value}
                checked={constraints.break_pref === option.value}
                onChange={(event) => setConstraints({ ...constraints, break_pref: event.target.value })}
              />
              <span>
                <strong>{option.value}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="constraint-toggle">
        Minimize school days
        <input type="checkbox" checked={constraints.minimize_school_days} onChange={(event) => setConstraints({ ...constraints, minimize_school_days: event.target.checked })} />
      </label>

    </aside>
  )
}

export default App
