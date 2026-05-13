# TaskFlow — Team Task Manager

A Notion-styled, single-team task manager built from the original
`SmartTaskManagerDEMO` HTML mock. Visuals are intentionally a 1:1
port of the demo — same dark surfaces, badges, sidebar, dashboard,
filters, and modal flow.

The project is split into two services:

- `backend/` — FastAPI + SQLite (via SQLModel) REST API.
- `frontend/` — React + Vite + TypeScript SPA.

There is no authentication yet — the API is open and the UI assumes
a single "You (Owner)" user. Auth is intentionally deferred.

## Quick start

### Backend

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

The first launch creates `backend/taskflow.db` and seeds 8 example
tasks plus the project/user reference data.

Run the test suite:

```bash
uv run pytest
uv run ruff check .
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The dev server proxies `/api/*` to `http://localhost:8000` (override
with `VITE_API_TARGET`). Run lint/build with:

```bash
npm run lint
npm run build
```

## REST API

| Method | Path                  | Purpose                         |
| ------ | --------------------- | ------------------------------- |
| GET    | `/api/health`         | Liveness probe                  |
| GET    | `/api/projects`       | Reference list of projects      |
| GET    | `/api/users`          | Reference list of assignees     |
| GET    | `/api/tasks`          | List all tasks                  |
| POST   | `/api/tasks`          | Create a task                   |
| GET    | `/api/tasks/{id}`     | Read a task                     |
| PATCH  | `/api/tasks/{id}`     | Partially update a task         |
| DELETE | `/api/tasks/{id}`     | Delete a task                   |

`Task` schema:

```
{
  id: int,
  title: str,
  desc: str,
  status: "todo" | "inprog" | "done",
  priority: "high" | "medium" | "low",
  tag: "dev" | "design" | "qa" | "pm",
  assignee: str,        // user code, e.g. "AK"
  due: date | null,
  proj: str,            // project name
  created_at: datetime,
  updated_at: datetime
}
```

## Feature parity with the demo

The React app reproduces every interaction from `SmartTaskManagerDEMO`:

- Sidebar with **Dashboard / My Tasks / All / Overdue** plus the four
  hardcoded projects (Website Redesign, Backend API, Mobile App,
  Operations).
- Dashboard with four stat cards and an overall progress bar.
- Task table with checkbox, category/priority/status badges, assignee
  avatar, due date (red when overdue) and edit/delete row actions.
- New / edit task modal with priority, category, assignee, due, project.
- Filters (`All / To Do / In Progress / Done / High`) and sort
  (Due / Priority / Status).
- Global search across title and project name (`Ctrl/Cmd + K`).
- CSV export of all tasks.
- Toast notifications and `Esc` to close the modal.

No AI features. No drag-and-drop. No hierarchical pages. Add them later.
