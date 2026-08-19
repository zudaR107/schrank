import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SettingsPage } from '../features/settings/SettingsPage'

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import { api } from '../lib/api'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const profile = { id: 'user-1', email: 'test@example.com', name: 'Test User' }

beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/users/me') return Promise.resolve(profile)
    return Promise.reject(new Error(`Unexpected GET ${path}`))
  })
})

describe('SettingsPage', () => {
  it('shows a loading state, then the profile name and email once GET /users/me resolves', async () => {
    render(<SettingsPage />, { wrapper: createWrapper() })

    expect(screen.getByText('Загрузка…')).toBeInTheDocument()

    expect(await screen.findByText('Test User')).toBeInTheDocument()
    expect(screen.getByText('test@example.com')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/users/me')
  })
})
