import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoClient } from 'mongodb'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'

const dataPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'planner-state.json')
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') })
const mongoUri = process.env.MONGODB_URI
const mongoDbName = process.env.MONGODB_DB || 'student_planner'
let mongoClientPromise

const defaultStore = () => ({ accounts: {} })

const readStore = async () => {
  try {
    return JSON.parse(await fs.readFile(dataPath, 'utf-8'))
  } catch {
    const store = defaultStore()
    await writeStore(store)
    return store
  }
}

const writeStore = async (store) => {
  await fs.mkdir(path.dirname(dataPath), { recursive: true })
  await fs.writeFile(dataPath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8')
}

const getMongoCollection = async () => {
  if (!mongoUri) return null
  if (!mongoClientPromise) {
    const client = new MongoClient(mongoUri)
    mongoClientPromise = client.connect()
  }
  const client = await mongoClientPromise
  const collection = client.db(mongoDbName).collection('users')
  await collection.createIndex({ username: 1 }, { unique: true })
  await collection.createIndex({ email: 1 }, { unique: true, sparse: true })
  return collection
}

const getMongoSchedulesCollection = async () => {
  if (!mongoUri) return null
  if (!mongoClientPromise) {
    const client = new MongoClient(mongoUri)
    mongoClientPromise = client.connect()
  }
  const client = await mongoClientPromise
  const collection = client.db(mongoDbName).collection('schedules')
  await collection.createIndex({ username: 1 }, { unique: true })
  return collection
}

// Dito kinokopya ang schedule sa collection nito para madaling makita sa Compass.
const readPlannerSchedule = async (username, fallback = []) => {
  const collection = await getMongoSchedulesCollection()
  if (!collection) return Array.isArray(fallback) ? fallback : []
  const key = normalizeUsername(username)
  const saved = await collection.findOne({ username: key })
  const schedule = Array.isArray(fallback) ? fallback : null
  // Ang schedule sa user record ang pangunahing kopya; dito rin inaayos ang mirror kapag luma ito.
  if (schedule && (!saved || JSON.stringify(saved.schedule) !== JSON.stringify(schedule))) {
    await collection.replaceOne(
      { username: key },
      { username: key, schedule, updatedAt: new Date() },
      { upsert: true },
    )
  }
  return schedule || (Array.isArray(saved?.schedule) ? saved.schedule : [])
}

const withoutMongoId = (account) => {
  if (!account) return null
  const { _id, passwordHash, ...cleanAccount } = account
  return cleanAccount
}

export const normalizeUsername = (value) => String(value || '').trim().toLowerCase()

export const storageMode = mongoUri ? 'mongodb' : 'file'

export async function getAccount(username) {
  const collection = await getMongoCollection()
  if (collection) {
    const account = await collection.findOne({ username: normalizeUsername(username) })
    if (!account) return null
    return withoutMongoId({ ...account, schedule: await readPlannerSchedule(account.username, account.schedule) })
  }

  const store = await readStore()
  return store.accounts[normalizeUsername(username)] || null
}

export async function saveAccount(username, profile) {
  const key = normalizeUsername(username)
  if (!key) throw new Error('Username is required.')

  const collection = await getMongoCollection()
  if (collection) {
    const current = await collection.findOne({ username: key })
    const account = {
      ...(current || { subjects: [], schedule: [], constraints: {}, lockedSections: [] }),
      username: key,
      profile: { ...(current?.profile || {}), ...profile, reg_username: key },
      updatedAt: new Date(),
    }
    await collection.replaceOne({ username: key }, account, { upsert: true })
    return withoutMongoId(account)
  }

  const store = await readStore()
  const current = store.accounts[key] || { subjects: [], schedule: [], constraints: {}, lockedSections: [] }
  store.accounts[key] = {
    ...current,
    profile: { ...current.profile, ...profile, reg_username: key },
    updatedAt: new Date().toISOString(),
  }
  await writeStore(store)
  return store.accounts[key]
}

export async function registerUser({ name, username, email, password, course = '', year = 'First year' }) {
  const key = normalizeUsername(username)
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!name?.trim() || !key || !normalizedEmail || !password) throw new Error('Name, username, email, and password are required.')
  if (password.length < 6) throw new Error('Password must be at least 6 characters.')

  const passwordHash = await bcrypt.hash(password, 12)
  const profile = {
    profile_name: name.trim(),
    reg_username: key,
    profile_email: normalizedEmail,
    profile_course: String(course || '').trim(),
    profile_year: year,
  }
  const collection = await getMongoCollection()
  if (!collection) throw new Error('MongoDB is required for registration.')

  const user = {
    username: key,
    email: normalizedEmail,
    passwordHash,
    profile,
    subjects: [],
    schedule: [],
    constraints: {},
    lockedSections: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  try {
    await collection.insertOne(user)
  } catch (error) {
    if (error?.code === 11000) throw new Error('Username or email is already registered.')
    throw error
  }
  try {
    const schedules = await getMongoSchedulesCollection()
    await schedules.replaceOne({ username: key }, { username: key, schedule: [], updatedAt: user.updatedAt }, { upsert: true })
  } catch (error) {
    console.warn('Schedule mirror will be created on the next account load:', error.message)
  }
  return withoutMongoId(user)
}

export async function authenticateUser(identifier, password) {
  const key = normalizeUsername(identifier)
  if (!key || !password) return null
  const collection = await getMongoCollection()
  if (!collection) throw new Error('MongoDB is required for login.')
  const user = await collection.findOne({ $or: [{ username: key }, { email: String(identifier).trim().toLowerCase() }] })
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return null
  return withoutMongoId({ ...user, schedule: await readPlannerSchedule(user.username, user.schedule) })
}

const adminProfile = (profile = {}) => ({
  profile_name: profile.profile_name || '',
  profile_course: profile.profile_course || '',
  profile_year: profile.profile_year || '',
})

const adminAccountSummary = (user) => ({
  username: user.username,
  email: user.email || user.profile?.profile_email || '',
  profile: adminProfile(user.profile),
  subjectCount: Array.isArray(user.subjects) ? user.subjects.length : 0,
  scheduleCount: Array.isArray(user.schedule) ? user.schedule.length : 0,
  hasSubjects: Array.isArray(user.subjects) && user.subjects.length > 0,
  hasSchedule: Array.isArray(user.schedule) && user.schedule.length > 0,
  createdAt: user.createdAt || null,
  updatedAt: user.updatedAt || null,
})

export async function listAdminUsers() {
  const collection = await getMongoCollection()
  if (!collection) throw new Error('MongoDB is required for the admin dashboard.')
  const users = await collection.find({}, {
    projection: { username: 1, email: 1, profile: 1, subjects: 1, schedule: 1, createdAt: 1, updatedAt: 1 },
  }).sort({ createdAt: -1, username: 1 }).toArray()
  await Promise.all(users.map((user) => readPlannerSchedule(user.username, user.schedule)))
  return users.map(adminAccountSummary)
}

export async function getAdminAnalytics() {
  const collection = await getMongoCollection()
  if (!collection) throw new Error('MongoDB is required for the admin dashboard.')
  const users = await collection.find({}, { projection: { subjects: 1, schedule: 1 } }).toArray()
  const subjectCounts = new Map()
  const dayCounts = new Map()
  for (const user of users) {
    for (const subject of Array.isArray(user.subjects) ? user.subjects : []) {
      const code = String(subject.subject_code || 'Uncoded subject').trim()
      subjectCounts.set(code, (subjectCounts.get(code) || 0) + 1)
    }
    for (const entry of Array.isArray(user.schedule) ? user.schedule : []) {
      const day = String(entry.day || 'Unspecified day')
      dayCounts.set(day, (dayCounts.get(day) || 0) + 1)
    }
  }
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return {
    subjectCounts: [...subjectCounts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 8),
    dayCounts: weekdays.map((label) => ({ label, count: dayCounts.get(label) || 0 })),
  }
}

export async function getAdminUser(username) {
  const collection = await getMongoCollection()
  if (!collection) throw new Error('MongoDB is required for the admin dashboard.')
  const user = await collection.findOne({ username: normalizeUsername(username) }, {
    projection: { username: 1, email: 1, profile: 1, subjects: 1, schedule: 1, constraints: 1, lockedSections: 1, createdAt: 1, updatedAt: 1 },
  })
  if (!user) return null
  return {
    ...adminAccountSummary(user),
    subjects: Array.isArray(user.subjects) ? user.subjects : [],
    schedule: await readPlannerSchedule(user.username, user.schedule),
    constraints: user.constraints || {},
    lockedSections: Array.isArray(user.lockedSections) ? user.lockedSections : [],
  }
}

export async function updateAdminUser(username, changes = {}) {
  const collection = await getMongoCollection()
  if (!collection) throw new Error('MongoDB is required for the admin dashboard.')
  const key = normalizeUsername(username)
  const user = await collection.findOne({ username: key })
  if (!user) return null
  const profile = {
    ...user.profile,
    profile_name: String(changes.profile_name ?? user.profile?.profile_name ?? '').trim(),
    profile_course: String(changes.profile_course ?? user.profile?.profile_course ?? '').trim(),
    profile_year: String(changes.profile_year ?? user.profile?.profile_year ?? '').trim(),
  }
  if (!profile.profile_name) throw new Error('Name is required.')
  await collection.updateOne({ username: key }, { $set: { profile, updatedAt: new Date() } })
  return getAdminUser(key)
}

export async function deleteAdminUser(username) {
  const collection = await getMongoCollection()
  if (!collection) throw new Error('MongoDB is required for the admin dashboard.')
  const key = normalizeUsername(username)
  const result = await collection.deleteOne({ username: key })
  if (result.deletedCount) await (await getMongoSchedulesCollection()).deleteOne({ username: key })
  return result.deletedCount > 0
}

export async function savePlannerState(username, state) {
  const key = normalizeUsername(username)
  if (!key) throw new Error('Username is required.')

  const collection = await getMongoCollection()
  if (collection) {
    const current = await collection.findOne({ username: key })
    if (!current) throw new Error('Account not found; sign in again before saving your planner.')
    const account = {
      ...current,
      username: key,
      profile: { ...(current?.profile || {}), ...(state.profile || {}), reg_username: key },
      subjects: Array.isArray(state.subjects) ? state.subjects : current?.subjects || [],
      schedule: Array.isArray(state.schedule) ? state.schedule : current?.schedule || [],
      constraints: state.constraints || current?.constraints || {},
      lockedSections: Array.isArray(state.lockedSections) ? state.lockedSections : current?.lockedSections || [],
      updatedAt: new Date(),
    }
    await collection.replaceOne({ username: key }, account)
    const scheduleCollection = await getMongoSchedulesCollection()
    // Parehong ina-update ang user document at schedules collection para walang nawawalang kopya.
    await scheduleCollection.replaceOne(
      { username: key },
      { username: key, schedule: account.schedule, updatedAt: account.updatedAt },
      { upsert: true },
    )
    return withoutMongoId(account)
  }

  const store = await readStore()
  const current = store.accounts[key] || {}
  store.accounts[key] = {
    ...current,
    profile: { ...current.profile, ...(state.profile || {}), reg_username: key },
    subjects: Array.isArray(state.subjects) ? state.subjects : current.subjects || [],
    schedule: Array.isArray(state.schedule) ? state.schedule : current.schedule || [],
    constraints: state.constraints || current.constraints || {},
    lockedSections: Array.isArray(state.lockedSections) ? state.lockedSections : current.lockedSections || [],
    updatedAt: new Date().toISOString(),
  }
  await writeStore(store)
  return store.accounts[key]
}
