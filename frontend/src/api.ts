import type { AssistantLanguage, AssistantResponse, Project, Task, TaskInput, User } from './types'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  listProjects: () => request<Project[]>('/projects'),
  listUsers: () => request<User[]>('/users'),
  listTasks: () => request<Task[]>('/tasks'),
  createTask: (payload: TaskInput) =>
    request<Task>('/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  updateTask: (id: number, payload: Partial<TaskInput>) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteTask: (id: number) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  askAssistant: (text: string, language: AssistantLanguage) =>
    request<AssistantResponse>('/assistant', {
      method: 'POST',
      body: JSON.stringify({ text, language }),
    }),
}
