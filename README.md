# Rollcall Attendance

A React and FastAPI attendance app for administrators and teachers. Admins manage students and classes, create teacher accounts, assign teachers, and enroll students. Teachers take attendance and review reports for their assigned classes. Archived records retain their history.# Rollcall Attendance

A React and FastAPI attendance app for administrators and teachers. Admins manage students and classes, create teacher accounts, assign teachers, and enroll students. Teachers take attendance and review reports for their assigned classes. Archived records retain their history.

## Live Demo

[View Rollcall](https://rollcall-attendance-9na3.onrender.com/)

## Run locally

Requires Node.js 22.12+ and Python 3.11+. SQLite is the local default. Set DATABASE_URL if you have a local PostgreSQL server.

## Run locally

Requires Node.js 22.12+ and Python 3.11+. SQLite is the local default. Set DATABASE_URL if you have a local PostgreSQL server.

```sh
npm ci
npm run build
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='choose-your-own-password' \
  .venv/bin/python -m uvicorn app:app --port 3200
```

Open http://127.0.0.1:3200 and sign in with the email and password you used at first startup. These variables create the initial account once. Changing the password variable does not reset an existing account.

1. In **Teachers**, create a demo teacher.
2. In **Students**, add three fictional students with distinct codes.
3. In **Classes**, add a class, assign the teacher, and choose **Enroll**.
4. Sign in as the teacher. Open **Attendance**, select the class and date, choose **Mark all present**, change one status, and save.
5. Reopen the date to make a correction. In **Reports**, select the class and date range, optionally filter by student, and download CSV.

## Deploy on Render with Neon PostgreSQL

1. Create a Neon database and copy its PostgreSQL connection string. Keep the credentials private.
2. Push this folder as a GitHub repository. Keep local database files, credentials, and virtual environments out of Git.
3. In Render, create a Blueprint from the repository. The included render.yaml points Render at the Dockerfile, which builds React and serves its files from FastAPI alongside the API.
4. Set DATABASE_URL, ADMIN_EMAIL, and ADMIN_PASSWORD when prompted. Use a strong password of 12–128 characters. The app creates its tables and initial admin at first startup.
5. Visit the Render URL. Check /api/health and use fictional records for the public demo.

See /docs for FastAPI's interactive API reference. Free Render services can take time to wake up after inactivity.
