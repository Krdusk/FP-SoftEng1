# MyTerm

**May the Schedule, be with you.**

MyTerm is a student schedule planner that helps students organize subject sections into a weekly timetable. Users can enter sections manually or read them from a schedule image, compare options against their preferences, confirm a schedule, and save their planner to an account. A separate admin dashboard provides account and planner-data management.

## Features

• Manage subjects, sections, availability, meeting days, times, and rooms.
• Generate conflict-free schedule options using a constraint-based search that considers study shifts, locked sections, preferred breaks, and school-day count.
• Import schedule images with local OCR and optional Gemini vision assistance. Review and edit detected details before saving.
• Save profiles and planner data in MongoDB; passwords are stored as bcrypt hashes.
• Confirm a schedule and download it as a date-free calendar PDF.
• View registered accounts, subjects, schedules, and usage summaries in the separate `/admin` dashboard.

Schedule generation uses the app's own algorithm. Gemini is optional and is used only for assistance reading uploaded images.

## Technology

• **Frontend:** React, Vite, and CSS.
• **Backend:** Node.js and Express.
• **Database:** MongoDB.
• **Authentication:** bcryptjs password hashing and server-issued sessions.
• **Image reading:** Tesseract.js local OCR and optional Gemini vision.

## Project structure

```text
FP-SoftEng1/
├── client--/
│   ├── backend/
│   │   ├── admin/                 Admin sign-in and dashboard
│   │   ├── data/store.js          MongoDB storage and account operations
│   │   ├── ocr/                   Image reader and schedule parser
│   │   └── server.js              Express API and web server
│   ├── database/                  MongoDB schema and presentation guide
│   ├── public/                    Icons and static assets
│   ├── src/
│   │   ├── App.jsx                User interface and planner flows
│   │   └── scheduler.js           Schedule search and scoring logic
│   ├── .env.example               Environment-variable template
│   └── package.json               App dependencies and scripts
├── package.json                   Optional root-level command shortcuts
└── README.md
```

## Run locally

Requirements: Node.js `20.19+` or `22.12+`, npm, and a running MongoDB server.

1. Open a terminal in the app folder and install dependencies:

   ```sh
   cd client--
   npm ci
   ```

2. Create `client--/.env` from `client--/.env.example` (PowerShell: `Copy-Item .env.example .env`; macOS/Linux: `cp .env.example .env`). Set the local database:

   ```dotenv
   MONGODB_URI=mongodb://127.0.0.1:27017
   MONGODB_DB=student_planner
   PORT=5173
   ```

   Account registration, login, and the admin dashboard require MongoDB. Confirm `/api/health` reports `mongodb` storage.

3. Configure admin credentials in `client--/.env`. Generate a password hash with:

   ```sh
   node --input-type=module -e "import bcrypt from 'bcryptjs'; console.log(await bcrypt.hash('replace-with-a-strong-password', 12))"
   ```

   Set `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` to the chosen username and generated hash.

4. For AI-assisted image reading, optionally set `GEMINI_API_KEY` in `client--/.env`. Local OCR works without it.

5. Start MyTerm:

   ```sh
   npm run dev
   ```

   Open `http://localhost:5173` for the planner and `http://localhost:5173/admin` for the admin dashboard. To inspect local data, connect MongoDB Compass to `mongodb://127.0.0.1:27017`, then open the `student_planner` database.

## Deploy

Deploy the app as a **Node.js web service**. It cannot run as a static-only frontend because the same server provides the API, authentication, image reader, and admin dashboard.

1. In the hosting service settings, set the service's **Root Directory** to `client--`.
2. Use the following commands:

   ```text
   Install: npm ci
   Build:   npm run build
   Start:   npm run preview
   ```

3. Add environment variables in the hosting provider's secret settings:

   ```dotenv
   MONGODB_URI=<hosted MongoDB connection string>
   MONGODB_DB=student_planner
   ADMIN_USERNAME=<admin username>
   ADMIN_PASSWORD_HASH=<bcrypt hash>
   GEMINI_API_KEY=<optional Gemini API key>
   ```

   Use a MongoDB instance reachable from the app host. The local address `127.0.0.1` only works if MongoDB runs on that same server. Do not commit `.env`, passwords, database credentials, or API keys.

4. Open the service's public URL. The planner is at `/`, the admin dashboard is at `/admin`, and `/api/health` reports server/storage status.

The current app stores login sessions in server memory. Restarts will log users out; deploy one app instance unless shared session storage is added.

## Database

The default database is `student_planner`.

• `users` stores account credentials (bcrypt hash only), profile, subjects, constraints, and planner schedule.
• `schedules` stores a schedule mirror keyed by username for convenient inspection in Compass.

See [`client--/database/README.md`](client--/database/README.md) for the schema and presentation demo account instructions.

## Developers

• Senopera
• Santos
• Recio
• Geronimo
• Cinco
