import multer from 'multer'
import os from 'node:os'
import { recognizeImage, parseScheduleText } from './ocr/ocrParser.js'
import fs from 'node:fs/promises'
import express from 'express'
import { Transform } from 'node:stream'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import bcrypt from 'bcryptjs'
import { buildSchedulePlan } from '../src/scheduler.js'
import { authenticateUser, getAccount, getAdminUser, listAdminUsers, normalizeUsername, registerUser, savePlannerState, storageMode } from './data/store.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isProduction = process.env.NODE_ENV === 'production'
const port = process.env.PORT || 5173
const base = process.env.BASE || '/'
const adminEnabled = process.env.ADMIN_ENABLED !== 'false'
const ABORT_DELAY = 10000
const adminSessions = new Map()
const ADMIN_SESSION_LIFETIME = 2 * 60 * 60 * 1000
const userSessions = new Map()
const USER_SESSION_LIFETIME = 12 * 60 * 60 * 1000

const templateHtml = isProduction
  ? await fs.readFile(path.join(projectRoot, 'dist/client/index.html'), 'utf-8')
  : ''

const app = express()
app.use(express.json())

const upload = multer({
  dest: path.join(os.tmpdir(), 'class-schedule-ocr'),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
    ]

    if (!allowedTypes.includes(file.mimetype)) {
      return callback(new Error('Only JPG, PNG, and WebP images are allowed.'))
    }

    callback(null, true)
  },
})

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

const issueUserSession = (username) => {
  const token = randomBytes(32).toString('hex')
  userSessions.set(token, { username: normalizeUsername(username), expiresAt: Date.now() + USER_SESSION_LIFETIME })
  return token
}

const requireUser = (req, res, next) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  const session = token ? userSessions.get(token) : null
  if (!session || session.expiresAt < Date.now()) {
    if (token) userSessions.delete(token)
    return res.status(401).json({ ok: false, error: 'Your session expired. Please sign in again.' })
  }
  req.userSession = { token, ...session }
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
    const token = randomBytes(32).toString('hex')
    adminSessions.set(token, Date.now() + ADMIN_SESSION_LIFETIME)
    res.json({ ok: true, token, expiresIn: ADMIN_SESSION_LIFETIME })
  } catch (error) {
    console.error(error)
    res.status(503).json({ error: 'Admin authentication is unavailable.' })
  }
})

const requireAdmin = (req, res, next) => {
  if (!adminEnabled) return res.sendStatus(404)
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '')
  const expiresAt = token ? adminSessions.get(token) : null
  if (!expiresAt || expiresAt < Date.now()) {
    if (token) adminSessions.delete(token)
    return res.status(401).json({ error: 'Admin session expired. Sign in again.' })
  }
  next()
}

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  adminSessions.delete(req.get('authorization').replace(/^Bearer\s+/i, ''))
  res.json({ ok: true })
})

app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  try {
    res.json({ users: await listAdminUsers() })
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

app.get('/api/health', (req, res) => {
  res.json({ ok: true, storage: storageMode })
})

app.post('/api/auth/register', async (req, res) => {
  try {
    const user = await registerUser(req.body || {})
    res.status(201).json({ ok: true, user, token: issueUserSession(user.username) })
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
    res.json({ ok: true, user, token: issueUserSession(user.username) })
  } catch (error) {
    console.error(error)
    res.status(503).json({ ok: false, error: 'Authentication service unavailable. Check the MongoDB connection and server configuration.' })
  }
})

app.post('/api/auth/logout', requireUser, (req, res) => {
  userSessions.delete(req.userSession.token)
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

    const rawText = await recognizeImage(uploadedFilePath)
    const parsed = parseScheduleText(rawText)

    res.json({
      ok: true,
      originalFileName: req.file.originalname,
      rawText,
      ...parsed,
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

app.listen(port, () => {
  console.log(`Server started at http://localhost:${port} (${storageMode} storage)`)
})
