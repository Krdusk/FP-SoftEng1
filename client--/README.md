# MyTerm

**May the Schedule, be with you.**

MyTerm is a student schedule planner. Students can enter or import available subject sections, compare conflict-free weekly schedules, choose a preferred option, and save their planner to an account. A separate admin dashboard lets administrators review registered accounts and their saved planner data.

## What it does

• Manages subjects, sections, availability, meeting days, times, and rooms.
• Generates schedule options using a constraint-based search. It checks meeting overlaps, selected study shifts, locked sections, preferred breaks, and school-day count; it does not use an external AI API to generate schedules.
• Reads schedule images using local OCR, with optional Gemini vision assistance. Imported details are reviewed and editable before saving.
• Saves account profiles and planner data in MongoDB. Passwords are stored as bcrypt hashes.
• Provides a separate administrator dashboard at `/admin` for account and planner-data management.
• Exports a confirmed schedule as a date-free weekly calendar PDF.

## Technology

• **Frontend:** React 19, Vite, and CSS.
• **Backend:** Node.js and Express.
• **Database:** MongoDB, using the official MongoDB Node.js driver.
• **Authentication:** bcryptjs password hashing and server-issued sessions.
• **Schedule generation:** deterministic constraint search and overlap checks in `src/scheduler.js`.
• **Image reading:** Tesseract.js local OCR; optional Gemini vision fallback.

## Project structure

```text
client--/
├── backend/
│   ├── admin/                 Separate admin sign-in and dashboard UI
│   ├── data/store.js          MongoDB connection, accounts, and planner persistence
│   ├── ocr/                   Local parser and optional Gemini image reader
│   └── server.js              Express API and app server
├── database/
│   ├── users.schema.json      MongoDB user-document schema reference
│   ├── presentation-user.json Demo account fixture for Compass import
│   └── README.md              Database and demo-account instructions
├── public/                    Static icons and public assets
├── src/
│   ├── App.jsx                Main user interface and planner interactions
│   ├── App.css, index.css     User-interface styles
│   ├── scheduler.js           Schedule option generation and scoring
│   └── entry-client.jsx       Browser entry point
├── .env.example               Environment-variable template
├── package.json               Commands and dependencies
└── README.md
```

## Run locally

Requirements: Node.js `20.19+` or `22.12+`, npm, and a MongoDB server. For a local presentation, MongoDB Compass can connect to the local MongoDB service; Compass is a viewer and does not start the database server itself.

1. Install dependencies from the project root:

   ```sh
   npm ci
   ```

2. Create `.env` from `.env.example` (PowerShell: `Copy-Item .env.example .env`; macOS/Linux: `cp .env.example .env`). Set the MongoDB values:

   ```dotenv
   MONGODB_URI=mongodb://127.0.0.1:27017
   MONGODB_DB=student_planner
   PORT=5173
   ```

   Account registration, login, and the admin dashboard require MongoDB. `/api/health` checks the MongoDB connection and returns HTTP 503 if MongoDB is missing or unreachable.

3. Configure the separate admin sign-in. Choose an admin password and generate its bcrypt hash:

   ```sh
   node --input-type=module -e "import bcrypt from 'bcryptjs'; console.log(await bcrypt.hash('replace-with-a-strong-password', 12))"
   ```

   Put the resulting hash in `.env` alongside an admin username:

   ```dotenv
   ADMIN_USERNAME=your-admin-username
   ADMIN_PASSWORD_HASH=paste-the-generated-hash-here
   ```

4. To enable AI-assisted schedule-image reading, set `GEMINI_API_KEY` in `.env`. This is optional; local OCR is included. `GEMINI_VISION_MODEL` can be set to select the vision model.

5. Start the app:

   ```sh
   npm run dev
   ```

   Open `http://localhost:5173` for the planner and `http://localhost:5173/admin` for the admin dashboard. The Express server serves the user interface and API from the same origin. Check `http://localhost:5173/api/health` for server status and its selected storage mode.

## Deploy

Deploy MyTerm as a **Node.js web service**, not as a static-only site. The Express server serves the built React app, API, and admin dashboard together.

1. Push the project to a Git host and create a Node.js service with the project root as its working directory.
2. Use these commands in the hosting service:

   ```text
   Install: npm ci
   Build:   npm run build
   Start:   npm run preview
   ```

   The service should use Node.js `20.19+` or `22.12+`. The server reads the hosting platform's `PORT` value automatically.

3. Add environment variables in the host's service settings. Use a MongoDB deployment reachable from the host; a local URI such as `mongodb://127.0.0.1:27017` only works when MongoDB runs on the same machine as the app.

   ```dotenv
   MONGODB_URI=<hosted MongoDB connection string>
   MONGODB_DB=student_planner
   ADMIN_USERNAME=<admin username>
   ADMIN_PASSWORD_HASH=<bcrypt hash>
   GEMINI_API_KEY=<optional key for AI-assisted image reading>
   ```

   Keep `.env` and production secrets in the host's secret/environment-variable settings. Never commit API keys, database credentials, or real passwords. `.env` is ignored by Git; `.env.example` contains placeholders only.

4. After deployment, open the host-provided URL. The user planner is at `/`, the admin dashboard is at `/admin`, and the health endpoint is `/api/health`.

### Deployment notes

• MongoDB must accept network connections from the deployed service. Configure the database provider's network access and database user permissions accordingly. If `/api/health` returns HTTP 503, inspect the hosting provider's function logs for the MongoDB connection error, verify `MONGODB_URI` and `MONGODB_DB`, and confirm the database network access rules allow the deployment.
• Current sign-in sessions are held in the Node.js process memory. A server restart logs users out, and deployments should run as a single app instance unless session storage is moved to a shared store.
• Do not expose the MongoDB server directly to the public internet. Use a managed database connection with appropriate access controls.

## Database layout

The default database name is `student_planner`.

• `users`: account credentials (bcrypt hash only), profile, subjects, selected sections, constraints, and saved schedule.
• `schedules`: a schedule mirror keyed by username to make saved schedules easy to inspect separately in MongoDB Compass.

To inspect local data, connect Compass to `mongodb://127.0.0.1:27017`, open `student_planner`, then select `users` or `schedules`. For a presentation demo account and schema details, see [`database/README.md`](database/README.md).

## Main API routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check server and storage mode |
| `POST` | `/api/auth/register` | Create a user account |
| `POST` | `/api/auth/login` | Sign in to an account |
| `POST` | `/api/auth/logout` | End a user session |
| `GET`, `PUT` | `/api/accounts/:username/state` | Load or save the authenticated user's planner |
| `POST` | `/api/schedules/plan` | Generate schedule options |
| `POST` | `/api/ocr/upload` | Read an uploaded schedule image |

Admin routes are under `/api/admin` and require an admin session.

## Developers

• Senopera
• Santos
• Recio
• Geronimo
• Cinco
