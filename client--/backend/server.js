import multer from 'multer'
import os from 'node:os'
import { recognizeImage, parseScheduleText } from './ocr/ocrParser.js'
import { readScheduleWithVision } from './ocr/visionScheduleReader.js'
import fs from 'node:fs/promises'
import express from 'express'
import { Transform } from 'node:stream'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import bcrypt from 'bcryptjs'
import { buildSchedulePlan } from '../src/scheduler.js'
import { authenticateUser, checkMongoConnection, createSession, deleteAdminUser, deleteSession, deleteUserSessions, getAccount, getAdminAnalytics, getAdminUser, getSession, listAdminUsers, normalizeUsername, registerUser, savePlannerState, storageMode, updateAdminUser } from './data/store.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isVercel = Boolean(process.env.VERCEL)
const isProduction = process.env.NODE_ENV === 'production' || isVercel
const port = process.env.PORT || 5173
const base = process.env.BASE || '/'
const adminEnabled = process.env.ADMIN_ENABLED !== 'false'
const ABORT_DELAY = 10000
const ADMIN_SESSION_LIFETIME = 2 * 60 * 60 * 1000
const USER_SESSION_LIFETIME = 12 * 60 * 60 * 1000

const templateHtml = isProduction
  ? await fs.readFile(path.join(projectRoot, 'dist/client/index.html'), 'utf-8')
  : ''

const app = express()
app.use(express.json())

const upload = multer({
  dest: path.join(os.tmpdir(), 'class-schedule-ocr'),
  limits: {
    fileSize: isVercel ? 3_800_000 : 10 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif',
      'image/gif',
      'image/tiff',
      'image/bmp',
      'image/heic',
      'image/heif',
    ]

    if (!allowedTypes.includes(file.mimetype)) {
      return callback(new Error('Please upload a JPG, PNG, WebP, AVIF, GIF, TIFF, or BMP image.'))
    }

    callback(null, true)
  },
})

// Dito nililimitahan ang image upload para ligtas at maayos itong ma-process.
const uploadScheduleImage = (req, res, next) => {
  upload.single('scheduleImage')(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || 'Unable to upload image.',
      })
    }

    next()
  })
}

const requireUser = async (req, res, next) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  let session
  try {
    session = token ? await getSession(token, 'user') : null
  } catch (error) {
    console.error(error)
    return res.status(503).json({ ok: false, error: 'Session storage is unavailable. Check the MongoDB connection.' })
  }
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Your session expired. Please sign in again.' })
  }
  req.userSession = { token, username: session.username }
  next()
}

app.use('/admin', (req, res, next) => adminEnabled ? next() : res.sendStatus(404))
app.get('/admin', (_req, res) => res.sendFile(path.join(projectRoot, 'backend/admin/index.html')))
app.use('/admin', express.static(path.join(projectRoot, 'backend/admin'), { index: false }))

app.post('/api/admin/login', async (req, res) => {
  if (!adminEnabled) return res.sendStatus(404)
  const { username, password } = req.body || {}
  const expectedUsername = process.env.ADMIN_USERNAME
  const passwordHash = process.env.ADMIN_PASSWORD_HASH
  if (!expectedUsername || !passwordHash) {
    return res.status(503).json({ error: 'Admin access is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH in client--/.env.' })
  }
  try {
    if (String(username || '').trim() !== expectedUsername || !password || !(await bcrypt.compare(password, passwordHash))) {
      return res.status(401).json({ error: 'Invalid admin username or password.' })
    }
    const token = await createSession(expectedUsername, 'admin', ADMIN_SESSION_LIFETIME)
    res.json({ ok: true, token, expiresIn: ADMIN_SESSION_LIFETIME })
  } catch (error) {
    console.error(error)
    res.status(503).json({ error: 'Admin authentication is unavailable.' })
  }
})

const requireAdmin = async (req, res, next) => {
  if (!adminEnabled) return res.sendStatus(404)
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  let session
  try {
    session = token ? await getSession(token, 'admin') : null
  } catch (error) {
    console.error(error)
    return res.status(503).json({ error: 'Admin session storage is unavailable. Check the MongoDB connection.' })
  }
  if (!session) {
    return res.status(401).json({ error: 'Admin session expired. Sign in again.' })
  }
  req.adminSession = { token, username: session.username }
  next()
}

app.post('/api/admin/logout', requireAdmin, async (req, res) => {
  await deleteSession(req.adminSession.token)
  res.json({ ok: true })
})

app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  try {
    const [users, analytics] = await Promise.all([listAdminUsers(), getAdminAnalytics()])
    res.json({ users, analytics })
  } catch (error) {
    console.error(error)
    res.status(503).json({ error: 'Could not load users. Check the MongoDB connection.' })
  }
})

app.get('/api/admin/users/:username', requireAdmin, async (req, res) => {
  try {
    const user = await getAdminUser(req.params.username)
    if (!user) return res.status(404).json({ error: 'User not found.' })
    res.json({ user })
  } catch (error) {
    console.error(error)
    res.status(503).json({ error: 'Could not load this planner. Check the MongoDB connection.' })
  }
})

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { name, username, email, password, course = '', year = 'First year' } = req.body || {}
    const user = await registerUser({ name, username, email, password, course, year })
    res.status(201).json({ ok: true, user: await getAdminUser(user.username) })
  } catch (error) {
    const status = /already registered/i.test(error.message) ? 409 : /required|Password must/i.test(error.message) ? 400 : 503
    res.status(status).json({ error: error.message || 'Could not create user.' })
  }
})

app.patch('/api/admin/users/:username', requireAdmin, async (req, res) => {
  try {
    const user = await updateAdminUser(req.params.username, req.body || {})
    if (!user) return res.status(404).json({ error: 'User not found.' })
    res.json({ ok: true, user })
  } catch (error) {
    res.status(/Name is required/i.test(error.message) ? 400 : 503).json({ error: error.message || 'Could not update user.' })
  }
})

app.delete('/api/admin/users/:username', requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteAdminUser(req.params.username)
    if (!deleted) return res.status(404).json({ error: 'User not found.' })
    await deleteUserSessions(req.params.username)
    res.json({ ok: true })
  } catch (error) {
    console.error(error)
    res.status(503).json({ error: 'Could not delete user. Check the MongoDB connection.' })
  }
})

app.get('/api/health', async (_req, res) => {
  try {
    const connected = await checkMongoConnection()
    if (!connected) return res.status(503).json({ ok: false, storage: storageMode })
    res.json({ ok: true, storage: storageMode })
  } catch (error) {
    console.error('MongoDB health check failed:', error)
    res.status(503).json({ ok: false, storage: storageMode })
  }
})

app.post('/api/auth/register', async (req, res) => {
  try {
    const user = await registerUser(req.body || {})
    const token = await createSession(user.username, 'user', USER_SESSION_LIFETIME)
    res.status(201).json({ ok: true, user, token })
  } catch (error) {
    const status = error.message.includes('already registered') ? 409
      : error.message.includes('Name, username') || error.message.includes('Password must') ? 400
        : 503
    console.error(error)
    res.status(status).json({ ok: false, error: error.message || 'Registration failed.' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body || {}
    const user = await authenticateUser(identifier, password)
    if (!user) return res.status(401).json({ ok: false, error: 'Invalid username/email or password.' })
    const token = await createSession(user.username, 'user', USER_SESSION_LIFETIME)
    res.json({ ok: true, user, token })
  } catch (error) {
    console.error(error)
    res.status(503).json({ ok: false, error: 'Authentication service unavailable. Check the MongoDB connection and server configuration.' })
  }
})

app.post('/api/auth/logout', requireUser, async (req, res) => {
  await deleteSession(req.userSession.token)
  res.json({ ok: true })
})

let vite
if (!isProduction) {
  const { createServer } = await import('vite')
  vite = await createServer({
    root: projectRoot,
    server: { middlewareMode: true },
    appType: 'custom',
    base,
  })
  app.use(vite.middlewares)
} else {
  const compression = (await import('compression')).default
  const sirv = (await import('sirv')).default
  app.use(compression())
  app.use(base, sirv(path.join(projectRoot, 'dist/client'), { extensions: [] }))
}

app.post('/api/schedules/plan', (req, res) => {
  try {
    const { subjects = [], schedule = [], constraints = {}, lockedSections = [] } = req.body || {}
    const result = buildSchedulePlan({ subjects, schedule, constraints, lockedSections })
    res.json(result)
  } catch (error) {
    console.error(error)
    res.status(400).json({ error: 'Unable to build a schedule plan.' })
  }
})

app.post('/api/ocr/upload', uploadScheduleImage, async (req, res) => {
  let uploadedFilePath = null

  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: 'Please upload a schedule image.',
      })
    }

    uploadedFilePath = req.file.path

    console.log('OCR image received:', req.file.originalname)

    const aiFirst = Boolean(process.env.GEMINI_API_KEY)
    const visionPromise = process.env.GEMINI_API_KEY
      ? readScheduleWithVision(uploadedFilePath, req.file.mimetype).then((value) => ({ value })).catch((error) => ({ error }))
      : Promise.resolve(null)

    let recognition = { rawText: '', confidence: 0 }
    let localOcrError = null
    if (!aiFirst) {
      try {
        recognition = await recognizeImage(uploadedFilePath)
      } catch (error) {
        localOcrError = error
        console.error('Local OCR error:', error)
      }
    }
    let rawText = String(recognition.rawText || '')
    let parsed = parseScheduleText(rawText)
    let recognitionConfidence = recognition.confidence
    let recognitionProvider = 'local OCR'
    let warnings = [...parsed.warnings]
    let localRawText = rawText
    const compactValue = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    const compactRoom = (value) => compactValue(String(value || '').replace(/^(?:ROOM|RM)\s*[:#-]?\s*/i, ''))
    const localMeetings = (sections) => sections.flatMap((section) => (section.meetings || []).map((meeting) => [compactValue(section.section_code), meeting.day, meeting.meeting_date || '', meeting.time_start, meeting.time_end, compactRoom(meeting.room)].join('|'))).sort().join(';')

    if (process.env.GEMINI_API_KEY || !rawText.trim() || recognitionConfidence < 70 || !parsed.subject_code || !parsed.subject_name || !parsed.sections.length || !parsed.sections.some((section) => section.meetings.length)) {
      try {
        const outcome = visionPromise ? await visionPromise : { value: await readScheduleWithVision(uploadedFilePath, req.file.mimetype) }
        if (outcome.error) throw outcome.error
        const vision = outcome.value
        if (vision.configured) {
          const visionResult = vision.result
          const textParsed = parseScheduleText(visionResult.rawText)
          const visionHasMeetings = visionResult.sections.some((section) => section.meetings.length)
          const localHasMeetings = parsed.sections.some((section) => section.meetings.length)
          const meetingsAgree = visionHasMeetings && localHasMeetings && localMeetings(visionResult.sections) === localMeetings(parsed.sections)
          const localConfidence = recognitionConfidence
          const visionIsUseful = visionResult.rawText || visionResult.subject_code || visionResult.subject_name || visionResult.sections.length > 0
          if (visionIsUseful) {
            const subjectCode = visionResult.subject_code || textParsed.subject_code || parsed.subject_code
            const subjectName = visionResult.subject_name || textParsed.subject_name || parsed.subject_name
            const visionWarnings = [...visionResult.warnings]
            // AI transcription muna ang pinanggagalingan; local parser backup lang kung kulang ang AI structure.
            const sections = visionResult.sections.length ? visionResult.sections : textParsed.sections.length ? textParsed.sections : parsed.sections
            if (visionResult.subject_code && parsed.subject_code && compactValue(visionResult.subject_code) !== compactValue(parsed.subject_code)) {
              visionWarnings.push(`AI vision and local OCR read different subject codes (“${visionResult.subject_code}” and “${parsed.subject_code}”). Compare the code to the image.`)
            }
            if (visionResult.subject_name && parsed.subject_name && compactValue(visionResult.subject_name) !== compactValue(parsed.subject_name)) {
              visionWarnings.push('AI vision and local OCR read different subject names. Compare the name to the image.')
            }
            if (visionHasMeetings && localHasMeetings && !meetingsAgree) {
              visionWarnings.push('AI vision and local OCR found different section, meeting, or room details. Review every section, day, time, and room against the image.')
            }
            if (!subjectCode) visionWarnings.push('Subject code was not confidently detected. Check the image and enter the code if needed.')
            if (!subjectName) visionWarnings.push('Subject name was not confidently detected. Check the image and enter the name if needed.')
            if (!sections.length) visionWarnings.push('No section identifiers were confidently detected. Add a section manually if needed.')
            if (!sections.some((section) => section.meetings.length)) visionWarnings.push('No meeting times were confidently detected. Review the recognized text and add times manually if needed.')
            if (!aiFirst && !meetingsAgree) {
              visionWarnings.push('The image reader could not independently confirm every meeting detail. Compare the editable results with the original image before saving.')
            }
            rawText = visionResult.rawText || rawText
            parsed = {
              ...visionResult,
              subject_code: subjectCode,
              subject_name: subjectName,
              sections,
              warnings: [...new Set(visionWarnings)],
            }
            warnings = [...parsed.warnings]
            const aiComplete = Boolean(subjectCode && subjectName && sections.length && sections.every((section) => section.section_code && section.meetings.length))
            recognitionConfidence = meetingsAgree && aiComplete ? 96 : aiComplete ? aiFirst ? 88 : 76 : visionHasMeetings ? 61 : localHasMeetings ? localConfidence : 40
            recognitionProvider = aiFirst ? `Gemini vision (${vision.model})` : `Gemini vision + local OCR (${vision.model})`
          }
        } else {
          warnings.unshift(rawText.trim()
            ? 'Local OCR found text but could not map it to schedule rows. Add GEMINI_API_KEY to the backend .env file to enable free-tier AI vision table reading.'
            : localOcrError
              ? `Local OCR could not read the image: ${localOcrError.message}. Add GEMINI_API_KEY to the backend .env file to enable AI vision fallback.`
              : 'Local OCR found no text. Add GEMINI_API_KEY to the backend .env file to enable the AI vision fallback.')
        }
      } catch (visionError) {
        console.error('AI vision fallback error:', visionError)
        if (aiFirst) {
          try {
            recognition = await recognizeImage(uploadedFilePath)
            rawText = String(recognition.rawText || '')
            localRawText = rawText
            parsed = parseScheduleText(rawText)
            recognitionConfidence = recognition.confidence
            recognitionProvider = 'Local OCR fallback'
            warnings = [...parsed.warnings]
          } catch (fallbackError) {
            localOcrError = fallbackError
            console.error('Local OCR fallback error:', fallbackError)
          }
        }
        warnings.unshift(rawText.trim()
          ? `Gemini AI reading failed; showing ${recognitionProvider}: ${visionError.message}`
          : localOcrError
            ? `AI reading failed and local OCR could not read the image: ${localOcrError.message}`
            : `Local OCR found no text and AI vision failed: ${visionError.message}`)
      }
    }

    if (recognitionConfidence < 60) warnings.unshift('Recognition confidence is low. Review every code, date, day, and time against the image.')

    res.json({
      ok: true,
      originalFileName: req.file.originalname,
      rawText,
      localRawText,
      recognitionConfidence: Math.round(recognitionConfidence),
      recognitionProvider,
      ...parsed,
      warnings,
    })
  } catch (error) {
    console.error('OCR error:', error)

    res.status(500).json({
      ok: false,
      error: error.message || 'Unable to process the schedule image.',
    })
  } finally {
    if (uploadedFilePath) {
      try {
        await fs.unlink(uploadedFilePath)
      } catch (cleanupError) {
        console.error('Could not delete temporary OCR file:', cleanupError)
      }
    }
  }
})

app.get('/api/accounts/:username/state', requireUser, async (req, res) => {
  if (req.userSession.username !== normalizeUsername(req.params.username)) {
    return res.status(403).json({ error: 'You can only access your own planner.' })
  }
  try {
    const account = await getAccount(req.params.username)
    if (!account) return res.status(404).json({ error: 'Account not found.' })
    res.json(account)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Unable to load planner state.' })
  }
})

app.put('/api/accounts/:username/state', requireUser, async (req, res) => {
  if (req.userSession.username !== normalizeUsername(req.params.username)) {
    return res.status(403).json({ error: 'You can only update your own planner.' })
  }
  try {
    const state = await savePlannerState(req.params.username, req.body || {})
    res.json(state)
  } catch (error) {
    console.error(error)
    res.status(400).json({ error: 'Unable to save planner state.' })
  }
})

app.use('*all', async (req, res) => {
  try {
    const url = req.originalUrl.replace(base, '')

    let template
    let render
    if (!isProduction) {
      template = await fs.readFile(path.join(projectRoot, 'index.html'), 'utf-8')
      template = await vite.transformIndexHtml(url, template)
      render = (await vite.ssrLoadModule('/src/entry-server.jsx')).render
    } else {
      template = templateHtml
      render = (await import(pathToFileURL(path.join(projectRoot, 'dist/server/entry-server.js')).href)).render
    }

    let didError = false

    const { pipe, abort } = render(url, {
      onShellError() {
        res.status(500)
        res.set({ 'Content-Type': 'text/html' })
        res.send('<h1>Something went wrong</h1>')
      },
      onShellReady() {
        res.status(didError ? 500 : 200)
        res.set({ 'Content-Type': 'text/html' })

        const [htmlStart, htmlEnd] = template.split(`<!--app-html-->`)

        const transformStream = new Transform({
          transform(chunk, encoding, callback) {
            res.write(chunk, encoding)
            callback()
          },
        })
        transformStream.on('finish', () => {
          res.write(htmlEnd)
          res.end()
        })

        res.write(htmlStart)
        pipe(transformStream)
      },
      onError(error) {
        didError = true
        console.error(error)
      },
    })

    setTimeout(() => abort(), ABORT_DELAY)
  } catch (e) {
    vite?.ssrFixStacktrace(e)
    console.log(e.stack)
    res.status(500).end(e.stack)
  }
})

if (!isVercel) {
  app.listen(port, () => {
    console.log(`Server started at http://localhost:${port} (${storageMode} storage)`)
  })
}

export default app
