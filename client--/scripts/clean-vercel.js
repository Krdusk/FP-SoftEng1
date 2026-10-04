import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = path.join(projectRoot, 'public')

await Promise.all([
  rm(path.join(publicRoot, 'assets'), { recursive: true, force: true }),
  rm(path.join(publicRoot, 'admin'), { recursive: true, force: true }),
])
