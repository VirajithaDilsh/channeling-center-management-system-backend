# ClinicConnect — Channeling Center Management System (Backend)

Express + MongoDB API for the ClinicConnect channeling center management system. Pairs with the frontend in the sibling `channeling-center-management-system` repo.

## Tech Stack

- **Express 5**
- **Mongoose** / **MongoDB** (Atlas)
- **CORS**, **dotenv**

## Getting Started

```bash
npm install
```

Create a `.env` file in the project root:

```
MONGO_URI=<your MongoDB connection string>
PORT=5000
```

Run the server:

```bash
npm run dev
```

This starts `nodemon server.js` on `http://localhost:5000` (or `PORT` if set). The frontend expects the API at `http://localhost:5000`.

> **Note:** `config/db.js` uses a 10s `serverSelectionTimeoutMS` for the initial MongoDB connection — some networks/Atlas regions need more than a couple seconds to establish the connection, so if you see connection timeouts, check your Atlas IP allowlist first before assuming it's a timeout issue.

## API Routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/login` | Login (see [Authentication](#authentication) below) |
| `POST` | `/api/reset-password` | Reset the mock admin password |
| `GET/POST` | `/api/admin` | List / create admins |
| `GET/PUT/DELETE` | `/api/admin/:id` | Get / update / delete an admin |
| `GET/POST` | `/api/doctors` | List / create doctors |
| `GET/PUT/DELETE` | `/api/doctors/:id` | Get / update / delete a doctor |
| `GET/POST` | `/api/doctors/schedules`, `/api/doctors/:doctorId/schedules` | Doctor schedule CRUD |
| `GET/POST` | `/api/medicines` | List / create medicines |
| `PUT/DELETE` | `/api/medicines/:id` | Update / delete a medicine |
| `GET/POST` | `/patient` | List / create patients (**note:** mounted at `/patient`, not `/api/patient` — matches the frontend's `PatientApi.js`) |
| `GET/PUT/DELETE` | `/patient/:id` | Get / update / delete a patient |

## Data Models (`models/`)

- **Admin** — `adminId`, `name`, `email` (unique), `role`, `contact`, `password` (plaintext — no hashing yet)
- **Doctor**, **Schedule**, **Patient**, **Medicine** — standard CRUD resources for the respective frontend pages

## Authentication

`POST /api/login` currently checks a **hardcoded mock admin** in `controllers/authController.js`, not the `Admin` collection:

| Email | Password |
|---|---|
| `admin@clinicconnect.com` | `ChangeMe123!` |

This is a known simplification — the Admin Management feature (`/api/admin`) manages real database records, but login doesn't check them yet. To support real per-user login, `authController.login` needs to query the `Admin` model (and passwords should be hashed, e.g. with bcrypt, rather than stored/compared in plaintext).

## Seeding Test Data

`seed/seedAdmins.js` seeds a default admin plus one test user per role (`admin`, `reception`, `billing`, `patient_manager`), all with password `ChangeMe123!`. It upserts by email, so it's safe to re-run:

```bash
node seed/seedAdmins.js
```
