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

const withoutMongoId = (account) => {
  if (!account) return null
  const { _id, passwordHash, ...cleanAccount } = account
  return cleanAccount
}

export const normalizeUsername = (value) => String(value || '').trim().toLowerCase()

export const storageMode = mongoUri ? 'mongodb' : 'file'

export async function getAccount(username) {
  const collection = await getMongoCollection()
  if (collection) return withoutMongoId(await collection.findOne({ username: normalizeUsername(username) }))

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
  return withoutMongoId(user)
}

export async function authenticateUser(identifier, password) {
  const key = normalizeUsername(identifier)
  if (!key || !password) return null
  const collection = await getMongoCollection()
  if (!collection) throw new Error('MongoDB is required for login.')
  const user = await collection.findOne({ $or: [{ username: key }, { email: String(identifier).trim().toLowerCase() }] })
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return null
  return withoutMongoId(user)
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
  createdAt: user.createdAt || null,
  updatedAt: user.updatedAt || null,
})

export async function listAdminUsers() {
  const collection = await getMongoCollection()
  if (!collection) throw new Error('MongoDB is required for the admin dashboard.')
  const users = await collection.find({}, {
    projection: { username: 1, email: 1, profile: 1, subjects: 1, schedule: 1, createdAt: 1, updatedAt: 1 },
  }).sort({ createdAt: -1, username: 1 }).toArray()
  return users.map(adminAccountSummary)
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
    schedule: Array.isArray(user.schedule) ? user.schedule : [],
    constraints: user.constraints || {},
    lockedSections: Array.isArray(user.lockedSections) ? user.lockedSections : [],
  }
}

export async function savePlannerState(username, state) {
  const key = normalizeUsername(username)
  if (!key) throw new Error('Username is required.')

  const collection = await getMongoCollection()
  if (collection) {
    const current = await collection.findOne({ username: key })
    const account = {
      ...(current || {}),
      username: key,
      profile: { ...(current?.profile || {}), ...(state.profile || {}), reg_username: key },
      subjects: Array.isArray(state.subjects) ? state.subjects : current?.subjects || [],
      schedule: Array.isArray(state.schedule) ? state.schedule : current?.schedule || [],
      constraints: state.constraints || current?.constraints || {},
      lockedSections: Array.isArray(state.lockedSections) ? state.lockedSections : current?.lockedSections || [],
      updatedAt: new Date(),
    }
    await collection.replaceOne({ username: key }, account, { upsert: true })
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
