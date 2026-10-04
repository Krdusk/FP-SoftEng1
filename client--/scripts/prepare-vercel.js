import { cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = path.join(projectRoot, 'public')
const builtAssets = path.join(projectRoot, 'dist', 'client', 'assets')

// Kinokopya ang generated assets sa public para maihatid sila ng Vercel CDN.
await rm(path.join(publicRoot, 'assets'), { recursive: true, force: true })
await cp(builtAssets, path.join(publicRoot, 'assets'), { recursive: true })

const publicAdmin = path.join(publicRoot, 'admin')
await mkdir(publicAdmin, { recursive: true })
for (const file of ['index.html', 'admin.css', 'admin.js']) {
  await cp(path.join(projectRoot, 'backend', 'admin', file), path.join(publicAdmin, file))
}
