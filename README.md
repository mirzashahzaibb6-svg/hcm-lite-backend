# HCM Lite — Backend Service

**AI-Assisted Human Capital Management System Backend**  
Built for the **Saylani Welfare Hackathon Challenge Brief**.

---

## 1. Technology & Architecture
- **Framework:** NestJS 10 (TypeScript) with Modular Controller-Service-Repository architecture
- **Database:** PostgreSQL (v18)
- **ORM:** Prisma Client with normalized schema, foreign keys, cascades, and indexes
- **Authentication:** JWT Bearer tokens with Passport strategy and bcrypt password hashing (10 salt rounds)
- **Validation:** Class-validator DTOs with strict input sanitization
- **API Documentation:** Swagger / OpenAPI 3.0 mounted at `/api/docs`
- **PDF Generation:** PDFKit with custom branding, earnings, deductions, and verification stamp
- **AI Engine:** Contextual tool-calling engine, natural language smart leave parser, policy Q&A, and dashboard summarization

---

## 2. Modules & Feature Breakdown

### M1 — Authentication & Authorization
- `POST /api/auth/login`: Email and password login. Returns JWT token and authenticated user profile.
- `POST /api/auth/change-password`: Self-service password change with current password verification.
- `POST /api/auth/first-login-reset`: Forces password reset on first employee login (`mustChangePassword: true`).
- `GET /api/auth/me`: Retrieves active authenticated user session.
- **Role Guards:** Strictly enforces `ADMIN`, `HR`, and `EMPLOYEE` role boundaries.
- **First-Run Bootstrap:** Automatically checks on startup; creates initial company settings, default departments, leave types, and seeds the initial Administrator (`admin@saylani.org` / `Password123!`).

### M2 — Organization Setup
- `GET /api/organization/profile`: Retrieves company profile, office working hours (`09:00 - 18:00`), grace period (`15 minutes`), half-day threshold (`5.0 hours`), weekend days (`Saturday,Sunday`), and office GPS coordinates + radius (`200 meters`).
- `PUT /api/organization/profile`: Admin-only configuration update.
- `GET /api/organization/departments` & `POST /api/organization/departments`: Department CRUD with live employee counts.
- `GET /api/organization/designations` & `POST /api/organization/designations`: Job titles with department link and salary bands.
- `GET /api/organization/leave-types` & `PUT /api/organization/leave-types/:id`: Leave quota configuration.
- `GET /api/organization/holidays` & `POST /api/organization/holidays`: Public holiday calendar.
- `GET /api/organization/hr-accounts`, `POST /api/organization/hr-accounts`, `PATCH /api/organization/hr-accounts/:id/toggle`: HR account management and status toggle.

### M3 — Employee Management
- `GET /api/employees`: Directory with server-side search (`search`), department filter (`department`), status filter (`status`), and pagination (`page`, `limit`).
- `GET /api/employees/:id/360`: Full 360 profile (employee details, 30-day attendance history, attendance stats %, leave balance breakdown, leave history, recent payslips). Role-restricted: Employees can only view their own 360 profile.
- `POST /api/employees`: Register employee. Auto-generates code `EMP-xxx`, provisions user login with temporary password, creates 40% HRA / 10% Medical / 1.5x Gross `SalaryStructure`, and initializes yearly leave balances.
- `PUT /api/employees/:id`: Updates profile. Employees can **only** edit their phone and address.
- `POST /api/employees/import-validate`: CSV dry-run validator with line-by-line syntax, existence, and quota validation.
- `POST /api/employees/import-commit`: Batch commit valid CSV rows into database.
- `GET /api/employees/export`: Full CSV export.

### M4 — Attendance & Biometric Geofencing
- `POST /api/attendance/check-in`: Web check-in with GPS geofence validation (`isWithinRadius` via Haversine distance), biometric face score validation, server-side timestamping, and automatic `LATE` status evaluation after 09:15 AM grace cutoff.
- **Rule:** One punch per employee per day. Duplicate punches return **HTTP 409 Conflict**.
- `POST /api/attendance/check-out`: Checks out, calculates `totalWorkingHours`. If hours < 5.0, automatically marks **`HALF_DAY`**.
- `GET /api/attendance/daily-board`: Live daily board with status computation (present, late, half-day, on-leave, absent).
- `GET /api/attendance/my-history`: Personal attendance log.
- `POST /api/attendance/correction`: Submit correction request with original vs requested times and reason.
- `GET /api/attendance/corrections` & `PATCH /api/attendance/corrections/:id/review`: HR approval inbox. Approving a request updates the attendance record.

### M5 — Leave Management
- `GET /api/leaves/balances`: Personal leave balance cards (`allocated`, `used`, `pending`, `remaining`).
- `GET /api/leaves/requests`: Leave history and pending approval list.
- `POST /api/leaves/apply`: Apply for leave.
  - **Rule 1:** Calculates working days strictly excluding configured weekends (Saturday & Sunday) and public holidays.
  - **Rule 2:** Detects overlapping active leave requests. Overlaps return **HTTP 422 Unprocessable Entity**.
  - **Rule 3:** Checks available leave balance. Over-quota requests return **HTTP 422 Unprocessable Entity**.
- `DELETE /api/leaves/requests/:id/cancel`: Cancel eligible pending leave request (restores pending balance).
- `PATCH /api/leaves/requests/:id/review`: HR approve/reject action with comments. Automatically adjusts `usedDays` and `remainingDays`.

### M6 — Payroll Lite
- `GET /api/payroll/drafts`: View monthly payroll runs and employee breakdowns.
- `POST /api/payroll/drafts`: Compute payroll draft for given month & year. Prorates gross pay, calculates absent and half-day deductions, calculates progressive Pakistan income tax slabs, and deducts 5% Provident Fund.
- `POST /api/payroll/drafts/:id/finalize`: **Admin-only**. Strictly finalizes and permanently locks payroll. Generates individual `Payslip` records and notifies employees. Finalized payroll cannot be modified.
- `GET /api/payroll/payslip`: Retrieve employee payslip.
- `GET /api/payroll/payslip/:id/pdf`: Download authenticated PDF salary slip generated via PDFKit.

### M7 — Dashboards & Analytics
- `GET /api/analytics/admin`: Live DB aggregations for Headcount, Attrition %, Monthly Payroll Cost, Average Salary, Department Headcounts, Gender Distribution, Monthly Payroll Trend, and Recent Audit Logs.
- `GET /api/analytics/hr`: Live HR KPIs: Headcount, Present Today, Late Today, On Leave Today, Pending Approvals, 7-Day Attendance Trend, Absenteeism by Department, Leave Type Breakdown, and Top 5 Late Comers.
- `GET /api/analytics/employee`: Personalized dashboard with Today's Punch Status, Weekly Hours, Month Late Count, Leave Balances, and Recent Announcements.

### M8 — AI Assistant
- `POST /api/ai/chat`: AI chat assistant supporting Roman Urdu and English. Includes live tool-calling integrations:
  - `get_headcount`
  - `get_attendance_summary`
  - `get_late_comers`
  - `get_leave_summary`
  - `get_my_leave_balance`
  - `get_payroll_summary`
  - `search_employees`
  - Policy Q&A engine for office hours, grace periods, 3-late rules, and payroll slabs.
- `POST /api/ai/smart-leave-parser`: Natural language parser converting freeform text into structured leave applications.
- `POST /api/ai/summarize-dashboard`: Live AI narrative summary for Executive Admin or HR Operations.
- **Audit Logging:** Every AI prompt and execution time is logged to the `AiLog` table.

### M9 — Communications & Audit Logs
- `GET /api/communications/announcements` & `POST /api/communications/announcements`: Company announcements.
- `GET /api/communications/notifications` & `PATCH /api/communications/notifications/:id/read`: In-app notifications.
- `GET /api/audit-logs`: **Admin-only** immutable audit log trail with before/after state, IP address, and actor metadata.

---

## 3. Getting Started

### Prerequisites
- Node.js (v18+)
- PostgreSQL (v14+) running on `localhost:5432`

### Environment Variables (.env)
```env
PORT=5000
DATABASE_URL="postgresql://postgres:OM_LocalDb_2026_Strong@localhost:5432/hcm_lite_db?schema=public"
JWT_SECRET="hcm-lite-jwt-secret-saylani-2026-super-secure-key"
JWT_EXPIRES_IN="7d"
ADMIN_EMAIL="admin@saylani.org"
ADMIN_PASSWORD="Password123!"
```

### Installation & Database Migration
```bash
# Install dependencies
npm install --legacy-peer-deps

# Generate Prisma Client & Push Schema
npx prisma generate
npx prisma db push
```

### Running the Server
```bash
# Development mode
npm run start:dev

# Production build & run
npm run build
npm run start:prod
```

### Running Tests
```bash
npm test
```

### Swagger Documentation
Interactive API docs are available at:  
`http://localhost:5000/api/docs`
