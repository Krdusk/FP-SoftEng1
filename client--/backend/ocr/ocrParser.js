import { createWorker } from 'tesseract.js'
import sharp from 'sharp'

let workerPromise = null

const getWorker = async () => {
  if (!workerPromise) {
    workerPromise = createWorker('eng')
  }

  return workerPromise
}

// Prepare the image for OCR by resizing, grayscaling, and normalizing.
const preprocessImage = async (imagePath) => {
  return sharp(imagePath)
    .resize({ width: 2000, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .toBuffer()
}

export async function recognizeImage(imagePath) {
  const worker = await getWorker()

  const processedImage = await preprocessImage(imagePath)

  const {
    data: { text },
  } = await worker.recognize(processedImage)

  return text
}

// Convert NUIS day abbreviations to full day names.
const DAY_MAP = {
  SUN: 'Sunday',
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
}

// Calculate how similar two strings are.
const editDistance = (a, b) => {
  const rows = a.length + 1
  const cols = b.length + 1
  const table = Array.from({ length: rows }, () => new Array(cols).fill(0))

  for (let i = 0; i < rows; i++) table[i][0] = i
  for (let j = 0; j < cols; j++) table[0][j] = j

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) {
        table[i][j] = table[i - 1][j - 1]
      } else {
        table[i][j] = 1 + Math.min(
          table[i - 1][j],
          table[i][j - 1],
          table[i - 1][j - 1],
        )
      }
    }
  }

  return table[rows - 1][cols - 1]
}

// Group similar OCR room spellings and choose one canonical spelling.

// Used only for comparing room spellings.
// Common OCR lookalikes are treated as the same character.
const foldLookalikes = (value) =>
  String(value || '')
    .toUpperCase()
    .replace(/[ILT]/g, '1')
    .replace(/O/g, '0')
    .replace(/B/g, '8')

// Count characters that may be OCR misreads.
const countSuspiciousChars = (value) =>
  (String(value || '').match(/[ILTO]/g) || []).length

const buildRoomCorrectionMap = (rawRoomValues) => {
  // Count how often each room spelling appears.
  const freq = new Map()

  for (const value of rawRoomValues) {
    const key = String(value || '').toUpperCase().trim()
    if (!key) continue
    freq.set(key, (freq.get(key) || 0) + 1)
  }

  // Group similar room spellings.
  const spellings = [...freq.keys()].sort((a, b) => freq.get(b) - freq.get(a))
  const groups = []

  for (const spelling of spellings) {
    const folded = foldLookalikes(spelling)
    const group = groups.find((g) => editDistance(g.folded, folded) <= 1)

    if (group) {
      group.members.push(spelling)
    } else {
      groups.push({ folded, members: [spelling] })
    }
  }

  // Choose the cleanest spelling for each group.
  const correctionMap = new Map()

  for (const group of groups) {
    const canonical = [...group.members].sort((a, b) => {
      const diff = countSuspiciousChars(a) - countSuspiciousChars(b)
      if (diff !== 0) return diff
      return freq.get(b) - freq.get(a)
    })[0]

    for (const member of group.members) {
      correctionMap.set(member, canonical)
    }
  }

  return correctionMap
}

// Clean common OCR formatting and character errors.
const cleanOCRText = (text) => {
  let cleaned = String(text || '')
    .replace(/\r/g, '')
    .replace(/[“”‘’]/g, '"')
    .replace(/\u00A0/g, ' ')

  // Fix OCR errors in time values.
  cleaned = cleaned.replace(
    /\b([O0-9]{1,2})[:.]?([O0-9]{2})\s?(AM|PM)\b/gi,
    (_, h, m, period) => {
      const hours = h.replace(/O/gi, '0')
      const minutes = m.replace(/O/gi, '0')
      return `${hours}:${minutes}${period.toUpperCase()}`
    },
  )

  return cleaned
}

// Convert 12-hour time to 24-hour format.
const normalizeTime = (value) => {
  const match = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .match(/^(\d{1,2}):(\d{2})(AM|PM)$/)

  if (!match) return null

  let hours = Number(match[1])
  const minutes = Number(match[2])
  const period = match[3]

  if (hours < 1 || hours > 12 || minutes > 59) {
    return null
  }

  if (period === 'AM' && hours === 12) {
    hours = 0
  }

  if (period === 'PM' && hours !== 12) {
    hours += 12
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

// Extract meeting details such as day, time, and room.
const extractMeetings = (text) => {
  const meetings = []

  const normalizedText = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()

  const meetingPattern =
    /\b(SUN|MON|TUE|WED|THU|FRI|SAT)\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))\s+([A-Z0-9][A-Z0-9/-]*)\b/gi

  let match

  while ((match = meetingPattern.exec(normalizedText)) !== null) {
    const day = DAY_MAP[match[1].toUpperCase()]
    const timeStart = normalizeTime(match[2])
    const timeEnd = normalizeTime(match[3])
    const room = match[4].trim().toUpperCase()

    if (!day || !timeStart || !timeEnd || !room) {
      continue
    }

    meetings.push({
      day,
      time_start: timeStart,
      time_end: timeEnd,
      room,
      instructor: '',
    })
  }

  return meetings
}

// Match subject or section codes from OCR text.
const SECTION_PATTERN = /\b[A-Z]{2,10}\d{2,5}[A-Z]?\b/gi

const isSectionCode = (value) => {
  return /^[A-Z]{2,10}\d{2,5}[A-Z]?$/i.test(value)
}

// Extract the subject code and subject name.
const extractSubject = (lines) => {
  for (const line of lines) {
    const codePattern = /\b([A-Z][A-Z0-9_-]{2,})\s*:\s*/gi
    const starts = [...line.matchAll(codePattern)]

    // Require two code matches to avoid unrelated text.
    if (starts.length < 2) continue

    const last = starts[starts.length - 1]
    const code = last[1].trim()
    const afterText = line.slice(last.index + last[0].length)

    const name = afterText
      .replace(/\s*x\s*\.?\s*$/i, '')
      .trim()

    if (code && name) {
      return {
        subject_code: code.toUpperCase(),
        subject_name: name,
      }
    }
  }

  return {
    subject_code: '',
    subject_name: '',
  }
}

// Extract section codes from OCR lines.
const extractSectionCodes = (lines) => {
  const sections = []

  for (const line of lines) {
    const cleaned = line
      .replace(/[|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const matches = cleaned.match(SECTION_PATTERN) || []

    for (const value of matches) {
      const sectionCode = value.toUpperCase()

      // Skip values that do not match the section format.
      if (!isSectionCode(sectionCode)) {
        continue
      }

      if (!sections.includes(sectionCode)) {
        sections.push(sectionCode)
      }
    }
  }

  return sections
}

// Assign meeting details to their corresponding section.
const buildSections = (lines, sectionCodes) => {
  const sections = sectionCodes.map((sectionCode) => ({
    section_code: sectionCode,
    available: true,
    meetings: [],
  }))

  let currentSectionIndex = -1

  for (const line of lines) {
    const cleaned = line
      .replace(/[|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // Find the section mentioned in the current line.
    const sectionMatches = cleaned.match(SECTION_PATTERN) || []

    for (const value of sectionMatches) {
      const sectionCode = value.toUpperCase()

      const sectionIndex = sections.findIndex(
        (section) => section.section_code === sectionCode,
      )

      if (sectionIndex !== -1) {
        currentSectionIndex = sectionIndex
        break
      }
    }

    if (currentSectionIndex === -1) {
      continue
    }

    const meetings = extractMeetings(cleaned)

    if (meetings.length) {
      sections[currentSectionIndex].meetings.push(...meetings)
    }
  }

  // Remove duplicate meetings.
  for (const section of sections) {
    const uniqueMeetings = []
    const seen = new Set()

    for (const meeting of section.meetings) {
      const key = [
        meeting.day,
        meeting.time_start,
        meeting.time_end,
        meeting.room,
      ].join('|')

      if (!seen.has(key)) {
        seen.add(key)
        uniqueMeetings.push(meeting)
      }
    }

    section.meetings = uniqueMeetings
  }

  return sections
}

export function parseScheduleText(text) {
  const cleanedText = cleanOCRText(text)

  const lines = cleanedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const subject = extractSubject(lines)
  const sectionCodes = extractSectionCodes(lines)
  const sections = buildSections(lines, sectionCodes)

  // Correct OCR variations of the same room.
  const allRoomValues = sections.flatMap((section) =>
    section.meetings.map((meeting) => meeting.room),
  )

  const roomCorrectionMap = buildRoomCorrectionMap(allRoomValues)

  for (const section of sections) {
    for (const meeting of section.meetings) {
      meeting.room = roomCorrectionMap.get(meeting.room) || meeting.room
    }
  }

  return {
    subject_code: subject.subject_code,
    subject_name: subject.subject_name,
    sections,
  }
}