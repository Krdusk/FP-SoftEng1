# Presentation database files

The running app stores data in MongoDB. Connect Compass to `mongodb://127.0.0.1:27017`, open the `student_planner` database, and inspect the `users` collection.

## Import a ready-to-use demo user

In Compass, open `student_planner.users`, choose **Add Data → Import JSON or CSV**, and select `presentation-user.json`. Sign in through the app with:

- Username: `presentation_demo`
- Password: `PlannerDemo123!`

The file contains only a bcrypt password hash. It is a presentation fixture; new user registrations are still saved by the backend to MongoDB.

## Schema reference

`users.schema.json` documents the collection's MongoDB JSON Schema. The application creates unique indexes for usernames and emails when it accesses the collection.

The separate, read-only admin dashboard is at `http://localhost:5173/admin`. Configure its independent credentials using `ADMIN_USERNAME` and a bcrypt `ADMIN_PASSWORD_HASH` in `client--/.env`; setup steps are in the repository root README. It shows an empty account list until students register and save data.
