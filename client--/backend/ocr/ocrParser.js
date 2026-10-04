import { createWorker } from 'tesseract.js'
import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let workerPromise = null
let recognitionQueue = Promise.resolve()

const getWorker = async () => {
  if (!workerPromise) {
    const languageDataPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../')
    workerPromise = createWorker('eng', undefined, {
      langPath: languageDataPath,
      gzip: false,
      cacheMethod: 'none',
    }).catch((error) => {
      workerPromise = null
      throw error
    })
  }
  return workerPromise
}

const prepareImages = async (imagePath) => {
  // Gumagawa ng ilang malinaw na crop at contrast variant para may maikumpara ang local OCR.
  const source = sharp(imagePath, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' })
  const metadata = await source.metadata()
  if (!metadata.width || !metadata.height) throw new Error('The uploaded image could not be read.')

  const width = Math.min(3600, Math.max(2000, metadata.width * 2.5))
  const normalized = await source
    .resize({ width, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer()
  const imageInfo = await sharp(normalized).metadata()
  const unnormalized = await sharp(imagePath, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width, withoutEnlargement: false })
    .grayscale()
    .sharpen()
    .png()
    .toBuffer()
  const thresholds = await Promise.all([140, 170, 200].map((level) => sharp(normalized).threshold(level).png().toBuffer()))
  const inverted = await sharp(normalized).negate().png().toBuffer()
  const color = await sharp(imagePath, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width, withoutEnlargement: false })
    .sharpen()
    .png()
    .toBuffer()
  const tileHeight = Math.min(imageInfo.height, Math.ceil(imageInfo.height * 0.54))
  const bottomStart = Math.max(0, imageInfo.height - tileHeight)
  const topTile = await sharp(normalized)
    .extract({ left: 0, top: 0, width: imageInfo.width, height: tileHeight })
    .png()
    .toBuffer()
  const bottomTile = await sharp(normalized)
    .extract({ left: 0, top: bottomStart, width: imageInfo.width, height: tileHeight })
    .png()
    .toBuffer()
  const columnWidth = Math.ceil(imageInfo.width * 0.58)
  const rightStart = Math.max(0, imageInfo.width - columnWidth)
  const leftColumn = await sharp(normalized)
    .extract({ left: 0, top: 0, width: columnWidth, height: imageInfo.height })
    .png()
    .toBuffer()
  const rightColumn = await sharp(normalized)
    .extract({ left: rightStart, top: 0, width: columnWidth, height: imageInfo.height })
    .png()
    .toBuffer()
  return [
    { image: normalized, mode: '3' },
    { image: normalized, mode: '4' },
    { image: normalized, mode: '6' },
    { image: normalized, mode: '11' },
    { image: unnormalized, mode: '6' },
    ...thresholds.map((image) => ({ image, mode: '11' })),
    { image: inverted, mode: '11' },
    { image: color, mode: '6' },
    { image: topTile, mode: '6' },
    { image: bottomTile, mode: '6' },
    { image: leftColumn, mode: '6' },
    { image: rightColumn, mode: '6' },
  ]
}

const recognitionScore = (text, confidence) => {
  // Mas pinipili ang OCR text na may kumpletong araw at oras, hindi confidence lang.
  const parsed = parseScheduleText(text)
  const meetingCount = parsed.sections.reduce((count, section) => count + section.meetings.length, 0)
  const completeMeetings = parsed.sections.reduce((count, section) => count + section.meetings.filter((meeting) => meeting.day && meeting.time_start && meeting.time_end).length, 0)
  return confidence * 0.8 + Math.min(completeMeetings, 8) * 2 - parsed.warnings.length * 1.5 - Math.max(0, meetingCount - completeMeetings) * 5
}

const getLayoutText = (blocks) => {
  const lines = []
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const text = (line.words || []).map((word) => word.text).filter(Boolean).join(' ').trim() || line.text?.trim()
        if (text) lines.push({ text, y: line.bbox?.y0 ?? 0, x: line.bbox?.x0 ?? 0 })
      }
    }
  }
  return lines.sort((first, second) => first.y - second.y || first.x - second.x).map((line) => line.text).join('\n')
}

const recognizeImageInternal = async (imagePath) => {
  const worker = await getWorker()
  const images = await prepareImages(imagePath)
  const candidates = []
  const passSummary = []

  for (const { image, mode } of images) {
    await worker.setParameters({ tessedit_pageseg_mode: mode, preserve_interword_spaces: '1', user_defined_dpi: '300' })
    let { data } = await worker.recognize(image, {}, { text: true, blocks: true })
    if (!String(data.text || '').trim()) {
      const fallback = await worker.recognize(image)
      if (String(fallback.data.text || '').trim()) data = fallback.data
    }
    const text = String(data.text || '').trim()
    const confidence = Number(data.confidence) || 0
    const layoutText = getLayoutText(data.blocks).trim()
    const blockText = (data.blocks || []).map((block) => block.text || '').filter(Boolean).join('\n').trim()
    passSummary.push({ mode, characters: text.length, confidence: Math.round(confidence) })
    if (text) candidates.push({ text, confidence })
    if (layoutText && layoutText !== text) candidates.push({ text: layoutText, confidence })
    if (blockText && blockText !== text && blockText !== layoutText) candidates.push({ text: blockText, confidence })
  }

  console.info('OCR recognition pass summary:', passSummary)
  if (!candidates.length) return { rawText: '', confidence: 0, passSummary }
  candidates.sort((first, second) =>
    recognitionScore(second.text, second.confidence) - recognitionScore(first.text, first.confidence),
  )
  return { rawText: candidates[0].text, confidence: candidates[0].confidence, passSummary }
}

export function recognizeImage(imagePath) {
  // Sunod-sunod ang OCR jobs para hindi mag-agawan sa iisang Tesseract worker.
  const result = recognitionQueue.then(() => recognizeImageInternal(imagePath))
  recognitionQueue = result.catch(() => undefined)
  return result
}

const DAY_MAP = {
  SUN: 'Sunday', SUNDAY: 'Sunday', SU: 'Sunday',
  MON: 'Monday', MONDAY: 'Monday', M: 'Monday',
  TUE: 'Tuesday', TUESDAY: 'Tuesday', TU: 'Tuesday', T: 'Tuesday',
  WED: 'Wednesday', WEDNESDAY: 'Wednesday', W: 'Wednesday',
  THU: 'Thursday', THURSDAY: 'Thursday', TH: 'Thursday', R: 'Thursday',
  FRI: 'Friday', FRIDAY: 'Friday', F: 'Friday',
  SAT: 'Saturday', SATURDAY: 'Saturday', SA: 'Saturday', S: 'Saturday',
}

const DAY_PATTERN = /\b(SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUN|MON|TUE|WED|THU|FRI|SAT|SU|TU|TH|SA|M|T|W|R|F|S)\b/gi
const MONTHS = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}

const cleanOCRText = (text) => String(text || '')
  .replace(/\r/g, '')
  .replace(/[“”‘’]/g, ' ')
  .replace(/\u00A0/g, ' ')
  .replace(/[‐‑‒–—]/g, '-')
  .replace(/[ \t]+/g, ' ')
  .trim()

const validCalendarDate = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return {
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    day: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()],
  }
}

const expandYear = (year) => {
  if (year == null) return new Date().getFullYear()
  if (year < 100) return year >= 70 ? 1900 + year : 2000 + year
  return year
}

const extractDates = (line) => {
  const matches = []
  const patterns = [
    { regex: /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g, order: 'ymd' },
    { regex: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g, order: 'mdy' },
    { regex: /\b(\d{1,2})\/(\d{1,2})\b/g, order: 'md-short' },
    { regex: /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{2,4}))?\b/gi, order: 'mon-day' },
    { regex: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\.?(?:,?\s+(\d{2,4}))?\b/gi, order: 'day-mon' },
  ]

  for (const { regex, order } of patterns) {
    for (const match of line.matchAll(regex)) {
      let year
      let month
      let day
      let alternateDate = null
      if (order === 'ymd') [, year, month, day] = match
      if (order === 'mdy') {
        [, month, day, year] = match
        if (Number(month) > 12 && Number(day) <= 12) [month, day] = [day, month]
        else if (Number(month) <= 12 && Number(day) <= 12) {
          alternateDate = validCalendarDate(expandYear(Number(year)), Number(day), Number(month))
        }
      }
      if (order === 'md-short') {
        [, month, day] = match
        if (Number(month) > 12 && Number(day) <= 12) [month, day] = [day, month]
      }
      if (order === 'mon-day') [, month, day, year] = match
      if (order === 'day-mon') [, day, month, year] = match
      if (order === 'mon-day' || order === 'day-mon') month = MONTHS[String(month).slice(0, 3).toUpperCase()]
      const date = validCalendarDate(expandYear(year == null ? null : Number(year)), Number(month), Number(day))
      if (date) matches.push({ ...date, ambiguous: Boolean(alternateDate), alternate: alternateDate, index: match.index, length: match[0].length })
    }
  }

  const unique = new Map()
  for (const match of matches.sort((a, b) => a.index - b.index)) {
    if (!unique.has(match.date)) unique.set(match.date, match)
  }
  return [...unique.values()]
}

const extractDays = (line) => {
  const found = []
  const dateRanges = extractDates(line)
  for (const match of line.matchAll(DAY_PATTERN)) {
    if (dateRanges.some((date) => match.index >= date.index && match.index < date.index + date.length)) continue
    const day = DAY_MAP[match[1].toUpperCase()]
    if (day && !found.some((item) => item.day === day)) found.push({ day, index: match.index })
  }

  const compounds = [
    { regex: /\bMWF\b/gi, days: ['Monday', 'Wednesday', 'Friday'] },
    { regex: /\bMW\b/gi, days: ['Monday', 'Wednesday'] },
    { regex: /\bTTH\b/gi, days: ['Tuesday', 'Thursday'] },
    { regex: /\bTR\b/gi, days: ['Tuesday', 'Thursday'] },
  ]
  for (const compound of compounds) {
    for (const match of line.matchAll(compound.regex)) {
      if (dateRanges.some((date) => match.index >= date.index && match.index < date.index + date.length)) continue
      for (const day of compound.days) {
        if (!found.some((item) => item.day === day)) found.push({ day, index: match.index })
      }
    }
  }

  return found.sort((a, b) => a.index - b.index)
}

const timePattern = String.raw`(?<![A-Z0-9])([0-9OIL]{1,2}(?:(?::|\.)[0-9OIL]{2}|[0-9OIL]{2})?)\s*(A\.?M\.?|P\.?M\.?)?`
const timeRangePattern = new RegExp(String.raw`${timePattern}\s*(?:-|TO|UNTIL|THROUGH|~)\s*${timePattern}`, 'gi')
const singleTimePattern = new RegExp(timePattern, 'gi')

const normalizeTimeToken = (value, period = '') => {
  const cleaned = String(value || '').toUpperCase().replace(/[O]/g, '0').replace(/[IL]/g, '1')
  const digits = cleaned.replace(/[:.]/g, '')
  let hours
  let minutes
  if (/^\d{3,4}$/.test(digits) && !/[:.]/.test(cleaned)) {
    hours = Number(digits.slice(0, -2))
    minutes = Number(digits.slice(-2))
  } else {
    const match = cleaned.match(/^(\d{1,2})(?:[:.](\d{2}))?$/)
    if (!match) return null
    hours = Number(match[1])
    minutes = Number(match[2] || 0)
  }

  const meridiem = String(period || '').toUpperCase().replace(/\./g, '')
  if (minutes > 59) return null
  if (meridiem) {
    if (hours < 1 || hours > 12) return null
    if (meridiem === 'AM' && hours === 12) hours = 0
    if (meridiem === 'PM' && hours !== 12) hours += 12
  } else if (hours > 23) {
    return null
  }
  return { value: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`, hour: hours, period: meridiem || '' }
}

const resolveTimeRange = (startToken, startPeriod, endToken, endPeriod) => {
  const normalizedStart = String(startToken || '').toUpperCase().replace(/[O]/g, '0').replace(/[IL]/g, '1')
  const normalizedEnd = String(endToken || '').toUpperCase().replace(/[O]/g, '0').replace(/[IL]/g, '1')
  const startHas24Hour = /^\d{3,4}$/.test(normalizedStart.replace(/[:.]/g, '')) && Number(normalizedStart.replace(/\D/g, '').slice(0, -2)) > 12
  const endHas24Hour = /^\d{3,4}$/.test(normalizedEnd.replace(/[:.]/g, '')) && Number(normalizedEnd.replace(/\D/g, '').slice(0, -2)) > 12
  const startClockHour = Number(normalizedStart.match(/^\d{1,2}/)?.[0] || 0)
  const endClockHour = Number(normalizedEnd.match(/^\d{1,2}/)?.[0] || 0)
  const cleanPeriod = (period) => String(period || '').toUpperCase().replace(/\./g, '')
  const startMarker = cleanPeriod(startPeriod)
  const endMarker = cleanPeriod(endPeriod)
  const oppositePeriod = (period) => cleanPeriod(period) === 'PM' ? 'AM' : 'PM'
  // Inaayos ang AM/PM ng katabing oras para mabasa pati hapon at gabi sa magkakaibang format.
  let inheritedStartPeriod = startPeriod || (!startHas24Hour ? endPeriod : '')
  let inheritedEndPeriod = endPeriod || (!endHas24Hour ? startPeriod : '')
  if (!startMarker && endMarker && startClockHour > endClockHour && startClockHour <= 12) {
    inheritedStartPeriod = oppositePeriod(endMarker)
  }
  if (startMarker && !endMarker && endClockHour < startClockHour && endClockHour <= 12) {
    inheritedEndPeriod = oppositePeriod(startMarker)
  }
  if (!startMarker && endMarker === 'PM' && endClockHour === 12 && startClockHour < 12) {
    inheritedStartPeriod = 'AM'
  }
  const start = normalizeTimeToken(startToken, inheritedStartPeriod)
  const end = normalizeTimeToken(endToken, inheritedEndPeriod)
  if (!start || !end || end.value <= start.value) return null
  return { time_start: start.value, time_end: end.value, ambiguous: !startPeriod && !endPeriod && !startHas24Hour && !endHas24Hour }
}

const extractTimeRanges = (line, dates) => {
  let dateFreeLine = line
  for (const date of [...dates].sort((a, b) => b.index - a.index)) {
    dateFreeLine = `${dateFreeLine.slice(0, date.index)} ${' '.repeat(date.length)} ${dateFreeLine.slice(date.index + date.length)}`
  }

  const ranges = []
  const usedSpans = []
  for (const match of dateFreeLine.matchAll(timeRangePattern)) {
    const resolved = resolveTimeRange(match[1], match[2], match[3], match[4])
    if (!resolved) continue
    ranges.push({ ...resolved, index: match.index, length: match[0].length })
    usedSpans.push([match.index, match.index + match[0].length])
  }

  if (ranges.length) return ranges

  const tokens = [...dateFreeLine.matchAll(singleTimePattern)]
    .filter((match) => !usedSpans.some(([start, end]) => match.index >= start && match.index < end))
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const first = tokens[index]
    const second = tokens[index + 1]
    const resolved = resolveTimeRange(first[1], first[2], second[1], second[2])
    if (resolved) ranges.push({ ...resolved, index: first.index, length: second.index + second[0].length - first.index })
  }
  return ranges
}

// Iniuugnay ang oras sa araw at section gamit ang line layout at katabing text.
const extractMeetings = (line, warnings, context = {}) => {
  const explicitDates = extractDates(line)
  const explicitDays = extractDays(line)
  let dates = explicitDates.length ? explicitDates : context.dates || []
  const days = explicitDays.length ? explicitDays : context.days || []
  if (dates.length === 1 && dates[0].alternate && explicitDays.length === 1) {
    if (dates[0].day !== explicitDays[0].day && dates[0].alternate.day === explicitDays[0].day) {
      dates = [{ ...dates[0].alternate, index: dates[0].index, length: dates[0].length }]
    }
  }
  const timeRanges = extractTimeRanges(line, explicitDates)
  if (!timeRanges.length) return []

  const uniqueDays = days.length
    ? days
    : dates.length === 1
      ? [{ day: dates[0].day, index: dates[0].index }]
      : []

  if (!uniqueDays.length) {
    warnings.add('Some time ranges had no clear weekday or single calendar date.')
    return []
  }

  const meetings = []
  const getRoom = (range) => {
    let tail = line.slice(range.index + range.length)
    for (const date of extractDates(tail).sort((a, b) => b.index - a.index)) {
      tail = `${tail.slice(0, date.index)} ${tail.slice(date.index + date.length)}`
    }
    tail = tail.replace(/[.,;|]+$/g, '').trim()
    const delimitedLocation = tail.match(/\|\s*(.+)$/)
    if (delimitedLocation?.[1]) {
      return delimitedLocation[1].trim().replace(/^(?:ROOM|RM)\s*[:#-]?\s*/i, '').toUpperCase()
    }
    const labeled = tail.match(/\b(?:ROOM|RM|LAB(?:ORATORY)?|BLDG|BUILDING|LOCATION|LOC)\s*[:#-]?\s*([\p{L}\p{N}][\p{L}\p{N}/_-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}/_-]*){0,2}?)(?=\s+(?:INSTRUCTOR|TEACHER|PROFESSOR|LECTURER)\b|\s*[,;|]|\s*$)/iu)
    const trailingRoom = tail.match(/\b((?:[A-Z]{1,8}[- ]?)?\d{1,5}[A-Z]{0,8}|[A-Z]{1,8}[- ]\d{1,5}[A-Z]{0,4})\s*$/i)
    if (!labeled) return (trailingRoom?.[1] || '').toUpperCase()
    if (/^(?:LAB|LABORATORY)\b/i.test(labeled[0])) return labeled[0].trim().toUpperCase()
    return (labeled[1] || '').toUpperCase()
  }
  if (dates.some((date) => date.ambiguous)) warnings.add('A numeric date could use month/day or day/month order; verify it against the image.')
  if (timeRanges.some((range) => range.ambiguous)) warnings.add('Some times had no AM/PM marker; those were interpreted as 24-hour times.')
  if (dates.length > 1) warnings.add('A row contained multiple dates; its date association needs manual review.')

  if (timeRanges.length === 1) {
    for (const dayRef of uniqueDays) {
      const date = dates.length === 1 && dates[0].day === dayRef.day ? dates[0].date : ''
      meetings.push({ day: dayRef.day, time_start: timeRanges[0].time_start, time_end: timeRanges[0].time_end, room: getRoom(timeRanges[0]), instructor: '', ...(date ? { meeting_date: date } : {}) })
    }
  } else if (timeRanges.length === uniqueDays.length) {
    timeRanges.forEach((range, index) => {
      const date = dates.length === 1 && dates[0].day === uniqueDays[index].day ? dates[0].date : ''
      meetings.push({ day: uniqueDays[index].day, time_start: range.time_start, time_end: range.time_end, room: getRoom(range), instructor: '', ...(date ? { meeting_date: date } : {}) })
    })
  } else {
    warnings.add('A row had several weekdays and time ranges that could not be paired confidently.')
  }
  return meetings
}

const SECTION_PATTERN = /\b[A-Z]{2,10}\d{2,5}[A-Z]?\b/gi
const explicitSectionPattern = /\b(?:SEC(?:TION)?|CLASS)\s*(?:CODE)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9 /_-]{0,35}?)(?=\s+(?:SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUN|MON|TUE|WED|THU|FRI|SAT)\b|\s+\d{1,2}(?::|\.)\d{2}|[,;|]|$)/gi

const getSectionCodesFromLine = (line) => {
  const explicit = [...line.matchAll(explicitSectionPattern)].map((match) => match[1].toUpperCase())
  return [...new Set([...explicit, ...(line.match(SECTION_PATTERN) || []).map((code) => code.toUpperCase())])]
}

const extractSubject = (lines) => {
  let subjectCode = ''
  let subjectName = ''
  for (const line of lines) {
    const labeledCode = line.match(/\b(?:SUBJECT|COURSE)\s*(?:CODE|NO\.?|NUMBER)\s*[:#-]?\s*(.{1,80})/i)
    const labeledName = line.match(/\b(?:SUBJECT|COURSE)\s*NAME\s*[:#-]?\s*(.+)$/i)
    if (!subjectCode && labeledCode) subjectCode = labeledCode[1].trim().replace(/[|,;]+$/, '')
    if (!subjectName && labeledName) subjectName = labeledName[1].trim()
  }
  if (subjectCode || subjectName) return { subject_code: subjectCode, subject_name: subjectName }

  for (const line of lines) {
    const starts = [...line.matchAll(/\b([A-Z][A-Z0-9_-]{2,})\s*:\s*/gi)]
    if (starts.length < 2) continue
    const last = starts[starts.length - 1]
    const name = line.slice(last.index + last[0].length).replace(/\s*x\s*\.?\s*$/i, '').trim()
    if (name) return { subject_code: last[1].toUpperCase(), subject_name: name }
  }

  return { subject_code: '', subject_name: '' }
}

const getSectionCodes = (lines, subjectCode) => {
  const codes = []
  const normalizedSubjectCode = subjectCode.toUpperCase()
  for (const line of lines) {
    const explicit = [...line.matchAll(explicitSectionPattern)].map((match) => match[1])
    const candidates = [...explicit, ...(line.match(SECTION_PATTERN) || [])]
    for (const code of candidates) {
      const normalized = code.toUpperCase()
      if (normalized === normalizedSubjectCode || (!explicit.includes(code) && !/^[A-Z]{2,10}\d{2,5}[A-Z]?$/.test(normalized))) continue
      if (!codes.includes(normalized)) codes.push(normalized)
    }
  }
  return codes
}

const deduplicateMeetings = (meetings) => {
  const seen = new Set()
  return meetings.filter((meeting) => {
    const key = [meeting.day, meeting.meeting_date || '', meeting.time_start, meeting.time_end, meeting.room].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const buildSections = (lines, sectionCodes, warnings) => {
  const sections = sectionCodes.map((sectionCode) => ({ section_code: sectionCode, available: true, meetings: [] }))
  let currentSectionIndex = -1
  let pendingContext = {}

  for (const line of lines) {
    const codes = getSectionCodesFromLine(line)
    const mentionedIndex = codes.map((code) => sections.findIndex((section) => section.section_code === code)).find((index) => index >= 0)
    if (mentionedIndex != null) {
      currentSectionIndex = mentionedIndex
      pendingContext = {}
    }
    if (currentSectionIndex < 0) continue
    const dates = extractDates(line)
    const days = extractDays(line)
    const ranges = extractTimeRanges(line, dates)
    if (!ranges.length) {
      if (dates.length === 1 || days.length) pendingContext = { dates, days }
      continue
    }
    sections[currentSectionIndex].meetings.push(...extractMeetings(line, warnings, pendingContext))
    pendingContext = {}
  }

  for (const section of sections) section.meetings = deduplicateMeetings(section.meetings)
  return sections
}

// Ito ang fallback parser kapag walang AI result o may field na kailangang i-cross-check.
export function parseScheduleText(text) {
  const cleanedText = cleanOCRText(text)
  const lines = cleanedText.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const subject = extractSubject(lines)
  const sectionCodes = getSectionCodes(lines, subject.subject_code)
  const warnings = new Set()
  const sections = buildSections(lines, sectionCodes, warnings)

  if (!subject.subject_code) warnings.add('Subject code was not confidently detected.')
  if (!subject.subject_name) warnings.add('Subject name was not confidently detected.')
  if (!sections.length) warnings.add('No section codes were confidently detected.')
  if (!sections.some((section) => section.meetings.length)) warnings.add('No meeting times were confidently detected. Add or correct section times manually.')
  if (sections.some((section) => !section.meetings.length)) warnings.add('One or more sections have no recognized meeting slots.')

  return {
    subject_code: subject.subject_code,
    subject_name: subject.subject_name,
    sections,
    warnings: [...warnings],
  }
}
