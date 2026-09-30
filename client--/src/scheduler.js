const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DEFAULTS = {
  constraint_start: '07:00',
  constraint_end: '21:00',
  preferred_days: [],
  minimize_school_days: false,
  break_pref: 'Compact',
  max_consecutive: 12,
}

const toMinutes = (value) => {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return NaN
  const [hours, minutes] = value.split(':').map(Number)
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : NaN
}

const overlaps = (first, second) =>
  first.day === second.day &&
  toMinutes(first.time_start) < toMinutes(second.time_end) &&
  toMinutes(first.time_end) > toMinutes(second.time_start)

const exceedsConsecutiveLimit = (schedule, maximumHours) => {
  if (!Number.isFinite(Number(maximumHours)) || Number(maximumHours) <= 0) return false
  const byDay = new Map()
  for (const entry of schedule) byDay.set(entry.day, [...(byDay.get(entry.day) || []), entry])
  for (const entries of byDay.values()) {
    entries.sort((a, b) => toMinutes(a.time_start) - toMinutes(b.time_start))
    let runStart = NaN
    let runEnd = NaN
    for (const entry of entries) {
      const start = toMinutes(entry.time_start)
      const end = toMinutes(entry.time_end)
      if (runEnd === start) runEnd = end
      else { runStart = start; runEnd = end }
      if (runEnd - runStart > Number(maximumHours) * 60) return true
    }
  }
  return false
}

const isValidSection = (section) => {
  const start = toMinutes(section.time_start)
  const end = toMinutes(section.time_end)
  return DAYS.includes(section.day) && Number.isFinite(start) && Number.isFinite(end) && end > start
}

const sectionMeetings = (section) => {
  if (Array.isArray(section.meetings)) return section.meetings
  return section.day && section.time_start && section.time_end ? [section] : []
}

const makeClasses = (subject, section) => sectionMeetings(section).map((meeting, index) => ({
  id: `${subject.id}-${section.id}-${meeting.id || index}`,
  subject_id: subject.id,
  section_id: section.id,
  meeting_id: meeting.id || `${section.id}-meeting-${index + 1}`,
  subject_name: subject.subject_name,
  subject_code: subject.subject_code,
  section_code: section.section_code,
  day: meeting.day,
  time_start: meeting.time_start,
  time_end: meeting.time_end,
  room: meeting.room || '',
  instructor: meeting.instructor || '',
}))

const getMetrics = (schedule, constraints, lockedSections) => {
  const days = new Set(schedule.map((entry) => entry.day))
  let conflictCount = 0
  for (let index = 0; index < schedule.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < schedule.length; otherIndex += 1) {
      if (overlaps(schedule[index], schedule[otherIndex])) conflictCount += 1
    }
  }
  const hours = schedule.reduce((sum, entry) => sum + (toMinutes(entry.time_end) - toMinutes(entry.time_start)) / 60, 0)
  const dayStats = [...days].map((day) => {
    const entries = schedule.filter((entry) => entry.day === day).sort((a, b) => toMinutes(a.time_start) - toMinutes(b.time_start))
    const gapLengths = entries.slice(1).map((entry, index) => Math.max(0, toMinutes(entry.time_start) - toMinutes(entries[index].time_end)))
    const gaps = gapLengths.reduce((sum, gap) => sum + gap, 0)
    let longestRun = 0
    let runStart = 0
    let runEnd = 0
    for (const entry of entries) {
      const start = toMinutes(entry.time_start)
      const end = toMinutes(entry.time_end)
      if (runEnd === start) runEnd = end
      else { longestRun = Math.max(longestRun, runEnd - runStart); runStart = start; runEnd = end }
    }
    longestRun = Math.max(longestRun, runEnd - runStart)
    return { gaps, gapLengths, longestRun }
  })
  const gapHours = dayStats.reduce((sum, stat) => sum + stat.gaps / 60, 0)
  const preferredBreakMinutes = { Compact: 0, Spaced: 45, 'Long Break': 90 }[constraints.break_pref]
  const breakPreferencePenalty = Number.isFinite(preferredBreakMinutes)
    ? dayStats.flatMap((stat) => stat.gapLengths)
      .reduce((penalty, gap) => penalty + Math.abs(gap - preferredBreakMinutes) / 60 * 1.5, 0)
    : 0
  const preferredDayMisses = constraints.preferred_days.length
    ? schedule.filter((entry) => !constraints.preferred_days.includes(entry.day)).length
    : 0
  const maxRun = Math.max(0, ...dayStats.map((stat) => stat.longestRun)) / 60
  const lockedMisses = lockedSections.filter((locked) => !schedule.some((entry) => entry.section_id === locked.id)).length
  const score = Math.max(0, Math.min(100,
    100 -
    preferredDayMisses * 7 -
    days.size * (constraints.minimize_school_days ? 2.5 : 0.5) -
    breakPreferencePenalty -
    maxRun * 0.35,
  ))
  return {
    score: Math.round(score),
    complete: true,
    conflicts: conflictCount,
    school_days: days.size,
    class_hours: Math.round(hours * 10) / 10,
    gaps: Math.round(gapHours * 10) / 10,
    preferred_day_misses: preferredDayMisses,
    longest_consecutive_hours: Math.round(maxRun * 10) / 10,
    locked_misses: lockedMisses,
    locked_ids: lockedSections.map((section) => section.id),
  }
}

const scheduleKey = (schedule) => schedule.map((entry) => entry.section_id).sort().join('|')

const withinConstraints = (section, constraints) => {
  if (!isValidSection(section)) return false
  const start = toMinutes(section.time_start)
  const end = toMinutes(section.time_end)
  if (start < toMinutes(constraints.constraint_start) || end > toMinutes(constraints.constraint_end)) return false
  return true
}

export function generateScheduleOptions({ subjects = [], schedule = [], constraints: rawConstraints = {}, lockedSections = [], limit = 6 }) {
  const constraints = { ...DEFAULTS, ...rawConstraints }
  const preferredDays = Array.isArray(constraints.preferred_days) ? constraints.preferred_days : []
  constraints.preferred_days = preferredDays
  const subjectIssues = []
  const lockedBySubject = new Map()
  const fixedSchedule = schedule.filter((entry) => !entry?.subject_id && isValidSection(entry))

  for (const locked of lockedSections) {
    if (!locked?.subject_id || !locked?.id) continue
    if (lockedBySubject.has(locked.subject_id)) {
      subjectIssues.push(`${locked.subject_code || 'A subject'} has more than one locked section.`)
    }
    lockedBySubject.set(locked.subject_id, locked)
  }

  const choices = subjects.filter((subject) => subject.included !== false).map((subject) => {
    const locked = lockedBySubject.get(subject.id)
    const allSections = Array.isArray(subject.sections) ? subject.sections : []
    const selectedSectionId = Object.prototype.hasOwnProperty.call(subject, 'selectedSectionId')
      ? subject.selectedSectionId
      : locked?.id || (allSections.find((section) => section.available !== false) || allSections[0])?.id
    const sections = allSections
      .filter((section) => section.id === selectedSectionId)
      .filter((section) => section.unavailable !== true && section.available !== false)
      .filter((section) => sectionMeetings(section).length > 0 && sectionMeetings(section).every((meeting) => withinConstraints(meeting, constraints)))
      .filter((section) => !locked || section.id === locked.id)
      .map((section) => ({ section, classes: makeClasses(subject, section) }))
    if (sections.length === 0) {
      const reason = locked
        ? 'its locked section is unavailable or outside your time limits'
        : 'no section is selected or the selected section is outside your time boundaries'
      subjectIssues.push(`${subject.subject_code || subject.subject_name || 'A subject'}: ${reason}.`)
    }
    return { subject, sections }
  }).sort((a, b) => a.sections.length - b.sections.length)

  if (choices.length === 0 && fixedSchedule.length === 0) return { options: [], issues: ['Include at least one subject or add a class to your schedule before generating.'], searchedAll: true }
  if (subjectIssues.length) return { options: [], issues: subjectIssues, searchedAll: true }

  const options = []
  const seen = new Set()
  const nodeLimit = 250000
  let nodes = 0
  let searchedAll = true
  const walk = (index, current) => {
    if (index === choices.length) {
      const key = scheduleKey(current)
      if (!seen.has(key)) {
        seen.add(key)
        options.push({ schedule: current, metrics: getMetrics(current, constraints, lockedSections) })
      }
      return
    }
    const choice = choices[index]
    for (const sectionChoice of choice.sections) {
      nodes += 1
      if (nodes > nodeLimit) { searchedAll = false; return }
      const classes = sectionChoice.classes
      const overlapsWithinSection = classes.some((entry, entryIndex) => classes.some((other, otherIndex) => otherIndex > entryIndex && overlaps(entry, other)))
      const overlapsCurrent = classes.some((entry) => current.some((existing) => overlaps(existing, entry)))
      const next = [...current, ...classes]
      if (!overlapsWithinSection && !overlapsCurrent && !exceedsConsecutiveLimit(next, constraints.max_consecutive)) {
        walk(index + 1, next)
      }
      if (!searchedAll) return
    }
  }
  walk(0, fixedSchedule)

  options.sort((a, b) => b.metrics.score - a.metrics.score || a.metrics.gaps - b.metrics.gaps || a.metrics.school_days - b.metrics.school_days)
  return {
    options: options.slice(0, Math.max(1, limit)),
    issues: options.length ? [] : ['No conflict-free combination satisfies the selected sections and constraints. Try unlocking a section or widening your time limits.'],
    searchedAll,
  }
}

export function suggestAlternatives({ subjects = [], schedule = [], constraints: rawConstraints = {}, lockedSections = [] }) {
  const constraints = { ...DEFAULTS, ...rawConstraints }
  const lockedIds = new Set(lockedSections.map((section) => section.id))
  const suggestions = []
  const seen = new Set()
  for (const entry of schedule) {
    const subject = subjects.find((item) => item.id === entry.subject_id || item.subject_code === entry.subject_code)
    if (!subject || lockedIds.has(entry.section_id)) continue
    const currentSectionEntries = schedule.filter((item) => item.subject_id === subject.id && item.section_id === entry.section_id)
    const unaffectedSchedule = schedule.filter((item) => !currentSectionEntries.some((current) => current.id === item.id))
    for (const section of subject.sections || []) {
      const meetings = sectionMeetings(section)
      if (section.id === entry.section_id || section.unavailable === true || section.available === false || !meetings.length || !meetings.every((meeting) => withinConstraints(meeting, constraints))) continue
      const alternativeEntries = makeClasses(subject, section)
      if (!alternativeEntries.length || alternativeEntries.some((alternative) => unaffectedSchedule.some((other) => overlaps(alternative, other)))) continue
      if (alternativeEntries.some((alternative, index) => alternativeEntries.some((other, otherIndex) => otherIndex > index && overlaps(alternative, other)))) continue
      const key = `${subject.id}:${section.id}`
      if (seen.has(key)) continue
      seen.add(key)
      suggestions.push({
        current: entry,
        alternative: alternativeEntries[0],
        alternativeEntries,
        reason: `Move ${entry.subject_code} to ${alternativeEntries[0].day} ${alternativeEntries[0].time_start} to avoid a conflict.`,
      })
    }
  }
  return suggestions
}

export function buildSchedulePlan(input = {}) {
  const result = generateScheduleOptions(input)
  return {
    ...result,
    suggestions: suggestAlternatives({ ...input, schedule: input.schedule || [] }),
  }
}
