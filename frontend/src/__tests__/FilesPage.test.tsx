import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FilesPage } from '../features/files/FilesPage'

const mockNavigate = vi.fn()
const mockUseSearch = vi.fn(() => ({}) as Record<string, unknown>)
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => mockUseSearch(),
}))

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) { super(message); this.status = status }
  },
  getFolderContents: vi.fn(),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  updateFile: vi.fn(),
  deleteFile: vi.fn(),
  uploadFile: vi.fn(),
  fetchFileBlob: vi.fn(),
}))

import {
  createFolder, deleteFile, deleteFolder, fetchFileBlob, getFolderContents, updateFile, updateFolder, uploadFile,
} from '../lib/api'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const emptyRoot = { folder: null, ancestors: [], folders: [], files: [] }

const rootContents = {
  folder: null,
  ancestors: [],
  folders: [{ id: 'folder-1', name: 'Photos', parentId: null, createdAt: '2026-08-19T10:00:00.000Z' }],
  files: [{
    id: 'file-1', name: 'report.pdf', folderId: null, mimeType: 'application/pdf',
    sizeBytes: 2048, createdAt: '2026-08-19T10:00:00.000Z', updatedAt: '2026-08-19T10:00:00.000Z',
  }],
}

beforeEach(() => {
  vi.mocked(getFolderContents).mockReset()
  vi.mocked(createFolder).mockReset()
  vi.mocked(updateFolder).mockReset()
  vi.mocked(deleteFolder).mockReset()
  vi.mocked(updateFile).mockReset()
  vi.mocked(deleteFile).mockReset()
  vi.mocked(uploadFile).mockReset()
  vi.mocked(fetchFileBlob).mockReset()
  mockNavigate.mockReset()
  mockUseSearch.mockReturnValue({})
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
})

describe('FilesPage — empty state', () => {
  it('shows the mascot empty state when the current folder has no folders or files', async () => {
    vi.mocked(getFolderContents).mockResolvedValue(emptyRoot)
    render(<FilesPage />, { wrapper: createWrapper() })

    expect(await screen.findByText('Здесь пока пусто')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Schrank' })).toBeInTheDocument()
  })
})

describe('FilesPage — listing', () => {
  it('lists folders and files with the file size shown', async () => {
    vi.mocked(getFolderContents).mockResolvedValue(rootContents)
    render(<FilesPage />, { wrapper: createWrapper() })

    expect(await screen.findByText('Photos')).toBeInTheDocument()
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText('2.0 КБ')).toBeInTheDocument()
  })

  it('fetches the folder named by the `folder` search param, not root', async () => {
    mockUseSearch.mockReturnValue({ folder: 'folder-1' })
    vi.mocked(getFolderContents).mockResolvedValue({
      folder: { id: 'folder-1', name: 'Photos', parentId: null, createdAt: '2026-08-19T10:00:00.000Z' },
      ancestors: [],
      folders: [],
      files: [],
    })
    render(<FilesPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(getFolderContents).toHaveBeenCalledWith('folder-1'))
  })

  it('renders breadcrumb ancestors and navigates when one is clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(getFolderContents).mockResolvedValue({
      folder: { id: 'sub', name: 'Vacation', parentId: 'folder-1', createdAt: '2026-08-19T10:00:00.000Z' },
      ancestors: [{ id: 'folder-1', name: 'Photos', parentId: null, createdAt: '2026-08-19T10:00:00.000Z' }],
      folders: [],
      files: [],
    })
    render(<FilesPage />, { wrapper: createWrapper() })

    const crumb = await screen.findByRole('button', { name: 'Photos' })
    await user.click(crumb)

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/files', search: { folder: 'folder-1' } })
  })

  it('navigates into a folder when its row is clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(getFolderContents).mockResolvedValue(rootContents)
    render(<FilesPage />, { wrapper: createWrapper() })

    await user.click(await screen.findByText('Photos'))

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/files', search: { folder: 'folder-1' } })
  })
})

describe('FilesPage — create folder', () => {
  it('creates a folder in the current directory and refreshes the list', async () => {
    const user = userEvent.setup()
    vi.mocked(getFolderContents).mockResolvedValue(emptyRoot)
    vi.mocked(createFolder).mockResolvedValue({ id: 'new-folder', name: 'Work', parentId: null, createdAt: '2026-08-19T12:00:00.000Z' })
    render(<FilesPage />, { wrapper: createWrapper() })
    await screen.findByText('Здесь пока пусто')

    await user.click(screen.getByRole('button', { name: /новая папка/i }))
    await user.type(screen.getByLabelText('Название'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    await waitFor(() => expect(createFolder).toHaveBeenCalledWith({ name: 'Work', parentId: null }))
  })
})

describe('FilesPage — upload', () => {
  it('uploads a selected file to the current folder', async () => {
    const user = userEvent.setup()
    vi.mocked(getFolderContents).mockResolvedValue(emptyRoot)
    vi.mocked(uploadFile).mockResolvedValue({
      id: 'file-2', name: 'notes.txt', folderId: null, mimeType: 'text/plain',
      sizeBytes: 5, createdAt: '2026-08-19T12:00:00.000Z', updatedAt: '2026-08-19T12:00:00.000Z',
    })
    render(<FilesPage />, { wrapper: createWrapper() })
    await screen.findByText('Здесь пока пусто')

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)

    await waitFor(() => expect(uploadFile).toHaveBeenCalledWith(file, null))
  })
})

describe('FilesPage — rename', () => {
  it('renames a folder', async () => {
    const user = userEvent.setup()
    vi.mocked(getFolderContents).mockResolvedValue(rootContents)
    vi.mocked(updateFolder).mockResolvedValue({ id: 'folder-1', name: 'Photos 2026', parentId: null, createdAt: '2026-08-19T10:00:00.000Z' })
    render(<FilesPage />, { wrapper: createWrapper() })
    await screen.findByText('Photos')

    await user.click(screen.getByRole('button', { name: 'Переименовать «Photos»' }))
    const nameField = screen.getByLabelText('Название')
    await user.clear(nameField)
    await user.type(nameField, 'Photos 2026')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(updateFolder).toHaveBeenCalledWith('folder-1', { name: 'Photos 2026' }))
  })
})

describe('FilesPage — delete', () => {
  it('deletes a file directly, with no confirmation step', async () => {
    const user = userEvent.setup()
    vi.mocked(getFolderContents).mockResolvedValue(rootContents)
    vi.mocked(deleteFile).mockResolvedValue({ ok: true })
    render(<FilesPage />, { wrapper: createWrapper() })
    await screen.findByText('report.pdf')

    await user.click(screen.getByRole('button', { name: 'Удалить «report.pdf»' }))

    expect(deleteFile).toHaveBeenCalledWith('file-1')
  })

  it('deletes a folder directly, with no confirmation step', async () => {
    const user = userEvent.setup()
    vi.mocked(getFolderContents).mockResolvedValue(rootContents)
    vi.mocked(deleteFolder).mockResolvedValue({ ok: true })
    render(<FilesPage />, { wrapper: createWrapper() })
    await screen.findByText('Photos')

    await user.click(screen.getByRole('button', { name: 'Удалить «Photos»' }))

    expect(deleteFolder).toHaveBeenCalledWith('folder-1')
  })
})

describe('FilesPage — download', () => {
  it("does not trigger a folder's own click-to-open when clicking its action buttons", async () => {
    const user = userEvent.setup()
    vi.mocked(getFolderContents).mockResolvedValue(rootContents)
    render(<FilesPage />, { wrapper: createWrapper() })
    await screen.findByText('Photos')

    await user.click(screen.getByRole('button', { name: 'Переименовать «Photos»' }))

    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('downloads directly when the "Скачать" action button is clicked, even for a previewable file', async () => {
    const user = userEvent.setup()
    vi.mocked(getFolderContents).mockResolvedValue(rootContents)
    const blob = new Blob(['%PDF'], { type: 'application/pdf' })
    vi.mocked(fetchFileBlob).mockResolvedValue(blob)
    render(<FilesPage />, { wrapper: createWrapper() })
    await screen.findByText('report.pdf')

    await user.click(screen.getByRole('button', { name: 'Скачать «report.pdf»' }))

    await waitFor(() => expect(fetchFileBlob).toHaveBeenCalledWith('file-1'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('downloads a non-previewable file directly, without opening a preview, when its row is clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(getFolderContents).mockResolvedValue({
      ...emptyRoot,
      files: [{
        id: 'file-2', name: 'archive.zip', folderId: null, mimeType: 'application/zip',
        sizeBytes: 4096, createdAt: '2026-08-19T10:00:00.000Z', updatedAt: '2026-08-19T10:00:00.000Z',
      }],
    })
    const blob = new Blob(['zip'], { type: 'application/zip' })
    vi.mocked(fetchFileBlob).mockResolvedValue(blob)
    render(<FilesPage />, { wrapper: createWrapper() })

    await user.click(await screen.findByText('archive.zip'))

    await waitFor(() => expect(fetchFileBlob).toHaveBeenCalledWith('file-2'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('FilesPage — preview', () => {
  it('opens an in-browser preview instead of downloading when a previewable file is clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(getFolderContents).mockResolvedValue(rootContents)
    const blob = new Blob(['%PDF'], { type: 'application/pdf' })
    vi.mocked(fetchFileBlob).mockResolvedValue(blob)
    render(<FilesPage />, { wrapper: createWrapper() })

    await user.click(await screen.findByText('report.pdf'))

    await waitFor(() => expect(fetchFileBlob).toHaveBeenCalledWith('file-1'))
    expect(await screen.findByRole('dialog', { name: 'report.pdf' })).toBeInTheDocument()
  })

  it('lets the user download from inside the preview via the modal\'s action button', async () => {
    const user = userEvent.setup()
    vi.mocked(getFolderContents).mockResolvedValue(rootContents)
    const blob = new Blob(['%PDF'], { type: 'application/pdf' })
    vi.mocked(fetchFileBlob).mockResolvedValue(blob)
    render(<FilesPage />, { wrapper: createWrapper() })
    await user.click(await screen.findByText('report.pdf'))
    await screen.findByRole('dialog', { name: 'report.pdf' })
    vi.mocked(fetchFileBlob).mockClear()

    await user.click(screen.getByRole('button', { name: 'Скачать' }))

    await waitFor(() => expect(fetchFileBlob).toHaveBeenCalledWith('file-1'))
  })
})
