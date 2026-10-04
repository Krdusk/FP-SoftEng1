import fs from 'node:fs/promises'
import sharp from 'sharp'

const weekdayAliases = new Map([
  ['monday', 'Monday'], ['mon', 'Monday'], ['m', 'Monday'], ['lunes', 'Monday'], ['lun', 'Monday'], ['lundi', 'Monday'],
  ['tuesday', 'Tuesday'], ['tue', 'Tuesday'], ['tues', 'Tuesday'], ['martes', 'Tuesday'], ['mar', 'Tuesday'], ['mardi', 'Tuesday'],
  ['wednesday', 'Wednesday'], ['wed', 'Wednesday'], ['w', 'Wednesday'], ['miércoles', 'Wednesday'], ['miercoles', 'Wednesday'], ['mié', 'Wednesday'], ['mercredi', 'Wednesday'], ['miyerkules', 'Wednesday'],
  ['thursday', 'Thursday'], ['thu', 'Thursday'], ['thurs', 'Thursday'], ['r', 'Thursday'], ['jueves', 'Thursday'], ['jue', 'Thursday'], ['jeudi', 'Thursday'], ['huwebes', 'Thursday'],
  ['friday', 'Friday'], ['fri', 'Friday'], ['f', 'Friday'], ['viernes', 'Friday'], ['vie', 'Friday'], ['vendredi', 'Friday'], ['biyernes', 'Friday'],
  ['saturday', 'Saturday'], ['sat', 'Saturday'], ['sábado', 'Saturday'], ['sabado', 'Saturday'], ['sab', 'Saturday'], ['samedi', 'Saturday'],
  ['sunday', 'Sunday'], ['sun', 'Sunday'], ['domingo', 'Sunday'], ['dimanche', 'Sunday'], ['linggo', 'Sunday'],
])

const normalizeDay = (value) => weekdayAliases.get(String(value || '').trim().toLocaleLowerCase()) || ''

const normalizeComparable = (value) => String(value || '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

const containsEvidence = (source, evidence) => {
  const normalizedSource = normalizeComparable(source)
  const normalizedEvidence = normalizeComparable(evidence)
  return Boolean(normalizedEvidence && normalizedSource.includes(normalizedEvidence))
}

const normalizeEvidenceTime = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i)
  if (!match) return ''
  let hours = Number(match[1])
  const minutes = Number(match[2] || 0)
  const period = String(match[3] || '').replace(/\./g, '').toLowerCase()
  if (minutes > 59 || (period && (hours < 1 || hours > 12)) || hours > 23) return ''
  if (period === 'am' && hours === 12) hours = 0
  if (period === 'pm' && hours !== 12) hours += 12
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

// Tumatanggap ito ng AM o PM na hinuha mula sa ayos ng schedule kahit walang nakasulat na period.
const evidenceSupportsTime = (rawText, evidence, expectedTime) => {
  const cleanEvidence = String(evidence || '').trim()
  if (!cleanEvidence || !containsEvidence(rawText, cleanEvidence)) return false
  if (normalizeEvidenceTime(cleanEvidence) === expectedTime) return true
  const expected = String(expectedTime || '').match(/^(\d{2}):(\d{2})$/)
  if (!expected) return false
  const expectedHour = Number(expected[1])
  const expectedMinute = Number(expected[2])
  const visibleTimes = [...cleanEvidence.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/gi)]
  return visibleTimes.some((match) => {
    const hour = Number(match[1])
    const minute = Number(match[2] || 0)
    const period = String(match[3] || '').replace(/\./g, '').toLowerCase()
    if (minute > 59 || hour > 23) return false
    if (period) return normalizeEvidenceTime(`${hour}:${String(minute).padStart(2, '0')} ${period}`) === expectedTime
    if (hour > 12) return hour === expectedHour && minute === expectedMinute
    const possibleHours = hour === 12 ? [0, 12] : [hour, hour + 12]
    return minute === expectedMinute && possibleHours.includes(expectedHour)
  })
}

const evidenceMentionsDay = (evidence, expectedDay) => {
  const source = ` ${String(evidence || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  return [...weekdayAliases].some(([alias, day]) => day === expectedDay && source.includes(` ${alias} `))
}

const parseCalendarDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const [, year, month, day] = match.map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return { value: `${match[1]}-${match[2]}-${match[3]}`, day: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()] }
}

const dateFromEvidence = (evidence) => {
  const text = String(evidence || '').trim()
  const ymd = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
  if (ymd) return parseCalendarDate(`${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`)
  const numeric = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/)
  if (numeric) {
    const [, first, second, year] = numeric
    const candidates = [
      parseCalendarDate(`${year}-${first.padStart(2, '0')}-${second.padStart(2, '0')}`),
      parseCalendarDate(`${year}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`),
    ].filter(Boolean)
    const unique = [...new Map(candidates.map((candidate) => [candidate.value, candidate])).values()]
    return unique.length === 1 ? unique[0] : null
  }
  return null
}

const cleanTime = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return ''
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return ''
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

const normalizeResult = (value) => {
  // Dito sinusuri kung may katapat sa aktuwal na transcript ang bawat AI result.
  const rawText = String(value.rawText || '').trim()
  const warnings = Array.isArray(value.warnings) ? value.warnings.filter((item) => typeof item === 'string').slice(0, 12) : []
  const addWarning = (message) => { if (!warnings.includes(message)) warnings.push(message) }
  const verifyField = (fieldValue, evidence, label) => {
    const cleanValue = String(fieldValue || '').trim()
    const cleanEvidence = String(evidence || '').trim()
    if (!cleanValue) return ''
    if (!cleanEvidence || !containsEvidence(rawText, cleanEvidence) || !containsEvidence(cleanEvidence, cleanValue)) {
      addWarning(`${label} could not be matched to its quoted text. Check it against the image.`)
      return ''
    }
    return cleanValue
  }
  const sections = (Array.isArray(value.sections) ? value.sections : []).flatMap((section) => {
    const sectionCode = verifyField(section.section_code, section.section_code_evidence, 'Section code').replace(/\s+/g, ' ')
    if (!sectionCode || sectionCode.length > 60 || !/[\p{L}\p{N}]/u.test(sectionCode)) return []
    const meetings = (Array.isArray(section.meetings) ? section.meetings : []).flatMap((meeting) => {
      const day = normalizeDay(meeting.day)
      const timeStart = cleanTime(meeting.time_start)
      const timeEnd = cleanTime(meeting.time_end)
      const dayEvidence = String(meeting.day_evidence || '').trim()
      const startEvidence = String(meeting.start_evidence || '').trim()
      const endEvidence = String(meeting.end_evidence || '').trim()
      const startSupported = evidenceSupportsTime(rawText, startEvidence, timeStart)
      const endSupported = evidenceSupportsTime(rawText, endEvidence, timeEnd)
      const daySupported = day && evidenceMentionsDay(dayEvidence, day) && containsEvidence(rawText, dayEvidence)
      if (!daySupported || !startSupported || !endSupported || !day || !timeStart || !timeEnd || timeEnd <= timeStart) {
        addWarning(`A meeting in section ${sectionCode} could not be fully matched to quoted day and time text. Correct it in the review.`)
        return []
      }
      const parsedDate = parseCalendarDate(meeting.meeting_date)
      const dateEvidence = String(meeting.date_evidence || '').trim()
      const evidenceDate = dateFromEvidence(dateEvidence)
      const date = parsedDate && evidenceDate?.value === parsedDate.value && containsEvidence(rawText, dateEvidence) ? parsedDate.value : ''
      const room = String(meeting.room || '').trim().slice(0, 40)
      const roomEvidence = String(meeting.room_evidence || '').trim()
      const verifiedRoom = room && roomEvidence && containsEvidence(rawText, roomEvidence) && containsEvidence(roomEvidence, room) ? room : ''
      if (room && !verifiedRoom) addWarning(`The room for section ${sectionCode} could not be matched to visible image text. Check it against the image.`)
      if (meeting.meeting_date && !date) addWarning(`A date in section ${sectionCode} could not be verified from the visible text.`)
      if (date && parsedDate.day !== day) {
        addWarning(`The weekday and date in section ${sectionCode} disagree. Correct them in the review.`)
        return []
      }
      if (normalizeEvidenceTime(startEvidence) !== timeStart || normalizeEvidenceTime(endEvidence) !== timeEnd) {
        addWarning(`The time period for a meeting in section ${sectionCode} was inferred from the image layout. Confirm whether it is AM or PM.`)
      }
      return [{
        day,
        time_start: timeStart,
        time_end: timeEnd,
        day_evidence: dayEvidence,
        start_evidence: startEvidence,
        end_evidence: endEvidence,
        room: verifiedRoom,
        room_evidence: verifiedRoom ? roomEvidence : '',
        instructor: '',
        ...(date ? { meeting_date: date, date_evidence: dateEvidence } : {}),
      }]
    })
    return [{ section_code: sectionCode, section_code_evidence: String(section.section_code_evidence || '').trim(), available: true, meetings }]
  })
  const subjectCode = verifyField(value.subject_code, value.subject_code_evidence, 'Subject code')
  const subjectName = verifyField(value.subject_name, value.subject_name_evidence, 'Subject name')
  return {
    rawText,
    language: String(value.language || '').trim().slice(0, 60),
    subject_code: subjectCode.replace(/\s+/g, ' ').slice(0, 60),
    subject_code_evidence: String(value.subject_code_evidence || '').trim(),
    subject_name: subjectName.slice(0, 120),
    subject_name_evidence: String(value.subject_name_evidence || '').trim(),
    sections,
    warnings: warnings.slice(0, 20),
  }
}

const visionResponseSchema = {
  type: 'object',
  properties: {
    rawText: { type: 'string', description: 'A faithful transcription of visible schedule labels, headings, and entries. Preserve layout order and line breaks.' },
    language: { type: 'string' },
    subject_code: { type: 'string' },
    subject_code_evidence: { type: 'string', description: 'An exact short quotation from rawText containing the subject code.' },
    subject_name: { type: 'string' },
    subject_name_evidence: { type: 'string', description: 'An exact short quotation from rawText containing the subject name.' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section_code: { type: 'string' },
          section_code_evidence: { type: 'string', description: 'An exact short quotation from rawText containing this section identifier.' },
          meetings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: { type: 'string', description: 'Full English weekday, or empty if unresolved.' },
                day_evidence: { type: 'string', description: 'Exact weekday label or abbreviation visible in rawText.' },
                meeting_date: { type: 'string', description: 'Explicit full date in YYYY-MM-DD form, otherwise empty. Do not infer a missing year.' },
                date_evidence: { type: 'string', description: 'Exact visible date text, otherwise empty.' },
                time_start: { type: 'string', description: '24-hour HH:mm, otherwise empty.' },
                start_evidence: { type: 'string', description: 'Exact visible start-time token as printed.' },
                time_end: { type: 'string', description: '24-hour HH:mm, otherwise empty.' },
                end_evidence: { type: 'string', description: 'Exact visible end-time token as printed.' },
                room: { type: 'string' },
                room_evidence: { type: 'string', description: 'Exact room or location text, copied from rawText; empty only when no location is visible.' },
              },
              required: ['day', 'day_evidence', 'meeting_date', 'date_evidence', 'time_start', 'start_evidence', 'time_end', 'end_evidence', 'room', 'room_evidence'],
            },
          },
        },
        required: ['section_code', 'section_code_evidence', 'meetings'],
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['rawText', 'language', 'subject_code', 'subject_code_evidence', 'subject_name', 'subject_name_evidence', 'sections', 'warnings'],
}

export async function readScheduleWithVision(imagePath, mimeType = '') {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { configured: false }

  const model = process.env.GEMINI_VISION_MODEL || 'gemini-3.5-flash-lite'
  const isGemini3Model = /^gemini-3(?:[.-]|$)/i.test(model)
  const imagePreparationStartedAt = Date.now()
  let image
  let imageMime = mimeType
  try {
    image = await sharp(imagePath, { failOn: 'none' })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: 2600, height: 2600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer()
    imageMime = 'image/jpeg'
  } catch {
    const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
    if (!supportedTypes.has(imageMime)) throw new Error('This image format could not be prepared for AI vision. Save it as JPG or PNG and upload again.')
    image = await fs.readFile(imagePath)
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(imageMime)) {
    throw new Error('AI vision supports JPG, PNG, or WebP images. Save the schedule in one of those formats and upload it again.')
  }
  const imageData = image.toString('base64')
  console.info(`Schedule image prepared for Gemini in ${Date.now() - imagePreparationStartedAt} ms (${Math.round(image.length / 1024)} KB).`)
  // Gemini ang tumitingin sa buong layout; naka-JSON schema para ma-check ang mga field.
  let response
  const geminiStartedAt = Date.now()
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
      contents: [{
        parts: [
          {
            inline_data: {
              mime_type: imageMime,
              data: imageData,
            },
            ...(isGemini3Model ? { media_resolution: { level: 'MEDIA_RESOLUTION_HIGH' } } : {}),
          },
          {
            text: `Read this academic schedule image as a careful data-entry task. The image may have no column headings, may be a timetable/grid, a list, a screenshot with merged cells, or a mixture of labels and values. Do not assume fixed columns or a standard layout. Inspect the whole image and use visual grouping, alignment, row order, spacing, repeated values, and nearby text together to decide which subject, section, day, and time belong together.

First transcribe all visible subject labels, section identifiers, weekday labels, dates, time ranges, and room/location text into rawText in the original language. Preserve spelling, punctuation, accents, and order. Keep distinct rows on distinct lines. Do not translate rawText or subject_name.

Find the subject name and course/subject code from the title, labels, repeated row values, or the values associated with the section group. A subject code is institution-specific and can be any text token, letters, digits, punctuation, or a mixture; do not reject it for an unusual format. Distinguish the subject code from a section identifier by what it names and how it repeats or groups the entries, not by a fixed code pattern. Keep exact visible section identifiers even when they look like ordinary words or numbers. If a field cannot be distinguished from another value using visible context, leave it empty and explain the ambiguity.

Create one section for every visible section group that belongs to this subject. Capture every meeting slot for each section. Pair a day/date and time range to a section only when their visual group, row, or nearby text supports that pairing. A day can be written as a word, abbreviation, or a clear one-letter weekday marker. Resolve one-letter markers only if the rest of the schedule layout makes their meaning clear; a lone ambiguous T or S is not enough. Use the detected language to interpret weekday names. Return English weekday names.

Read afternoon and evening times carefully. When AM/PM is printed, use it exactly. When a 12-hour time omits AM/PM, inspect the schedule's time-axis position, nearby labels, row order, and neighboring times before converting it to 24-hour time; do not automatically treat it as morning. If the image does not resolve the period, include a warning so the user can confirm it.

Only return values visibly supported by the image. Find every room/location attached to a meeting, regardless of its format: numeric, letters, mixed codes, building plus room, named labs, or labels such as Room/Rm/Lab/Building/Location (examples include 415MB, Room 201, Lab C, ENG-12, Science 3, and A-104). Read the actual visible value, not just values matching these examples. Use nearby labels, rows, alignment, and grouping to associate each location with a meeting. Return the exact room/location text in room and an exact quotation copied from rawText in room_evidence. Leave it blank only when no location is visibly shown; never invent one from campus conventions.

Every non-empty subject_code, subject_name, and section_code needs a short exact quotation in its corresponding *_evidence field. Every meeting needs exact visible day_evidence, start_evidence, and end_evidence tokens copied from rawText; any non-empty room needs matching room_evidence. Use date_evidence only for a visible complete date. These evidence snippets must be text actually included in rawText, not paraphrases. This requirement lets the server reject unsupported guesses.

Return every field in the required JSON schema. Use empty strings/arrays when something is unreadable or ambiguous and add a concise warning naming what needs human review. Do not claim a high confidence just because the image resembles a schedule.`,
          },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: visionResponseSchema,
        maxOutputTokens: 9000,
        ...(isGemini3Model ? { thinkingConfig: { thinkingLevel: 'minimal' } } : {}),
      },
      }),
    })
    console.info(`Gemini schedule reading responded in ${Date.now() - geminiStartedAt} ms (HTTP ${response.status}).`)
  } catch (error) {
    console.warn(`Gemini schedule reading failed after ${Date.now() - geminiStartedAt} ms.`)
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('Gemini AI timed out while reading this image. Try a smaller or clearer screenshot.')
    }
    throw new Error(`Gemini AI could not connect to Google: ${error.message || 'network request failed'}. Check that the backend has internet access.`)
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload.error?.message || `Vision API request failed (${response.status}).`
    throw new Error(message)
  }
  const candidate = payload.candidates?.[0]
  const output = (candidate?.content?.parts || []).map((part) => part.text || '').join('\n')
  if (!output) {
    const reason = payload.promptFeedback?.blockReason || candidate?.finishReason
    throw new Error(reason ? `Gemini AI could not return the schedule (reason: ${reason}).` : 'Gemini AI returned an empty result.')
  }
  let parsed
  try {
    const cleanOutput = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try {
      parsed = JSON.parse(cleanOutput)
    } catch {
      const objectStart = cleanOutput.indexOf('{')
      const objectEnd = cleanOutput.lastIndexOf('}')
      if (objectStart < 0 || objectEnd <= objectStart) throw new Error('No JSON object was returned.')
      parsed = JSON.parse(cleanOutput.slice(objectStart, objectEnd + 1))
    }
  } catch {
    throw new Error('Vision AI returned invalid schedule data. Try the image again or use a tighter crop.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Vision AI returned invalid schedule data. Try the image again or use a tighter crop.')
  }
  return { configured: true, result: normalizeResult(parsed), model }
}
