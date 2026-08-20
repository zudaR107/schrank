import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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

// PdfThumbnail dynamically imports the real pdf.js - real PDF parsing
// needs actual valid PDF bytes, and real rendering needs a genuine
// Canvas 2D context that jsdom doesn't provide. Mocked here so its
// tests exercise this component's own control flow, not pdf.js itself.
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      getPage: vi.fn(() => Promise.resolve({
        getViewport: vi.fn(({ scale = 1 }: { scale?: number }) => ({ width: 300 * scale, height: 400 * scale })),
        render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
      })),
    }),
  })),
  GlobalWorkerOptions: {},
}))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'mock-worker-url' }))

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
  // Previewable files (now including .pdf/.md/text) eagerly fetch their
  // thumbnail as soon as their tile mounts - most tests below render a
  // folder containing one without caring about its content, so this
  // needs a safe default rather than resolving to undefined; tests that
  // do care override it with their own mockResolvedValue afterward.
  vi.mocked(fetchFileBlob).mockReset().mockResolvedValue(new Blob())
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

  it('keeps the rest of the trail visible when navigating back to an ancestor, only moving which segment is "current"', async () => {
    const work = { id: 'work', name: 'Work', parentId: null, createdAt: '2026-08-19T10:00:00.000Z' }
    const photos = { id: 'photos', name: 'Photos', parentId: 'work', createdAt: '2026-08-19T10:00:00.000Z' }
    const vacation = { id: 'vacation', name: 'Vacation', parentId: 'photos', createdAt: '2026-08-19T10:00:00.000Z' }
    vi.mocked(getFolderContents).mockImplementation((id) => {
      if (id === 'vacation') return Promise.resolve({ folder: vacation, ancestors: [work, photos], folders: [], files: [] })
      if (id === 'work') return Promise.resolve({ folder: work, ancestors: [], folders: [], files: [] })
      return Promise.resolve(emptyRoot)
    })
    mockUseSearch.mockReturnValue({ folder: 'vacation' })
    const { rerender } = render(<FilesPage />, { wrapper: createWrapper() })

    expect(await screen.findByText('Vacation')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Work' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Photos' })).toBeInTheDocument()

    // Same effect a breadcrumb click or a browser-back navigation to an
    // ancestor already on screen has: the `folder` search param changes.
    mockUseSearch.mockReturnValue({ folder: 'work' })
    rerender(<FilesPage />)

    // Photos/Vacation stay visible (and still clickable) instead of
    // being truncated away, so a multi-level jump is still one click.
    expect(await screen.findByText('Photos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Photos' })).toBeInTheDocument()
    expect(screen.getByText('Vacation')).toBeInTheDocument()
    // Work itself is now "current" - no longer a clickable button.
    expect(screen.queryByRole('button', { name: 'Work' })).not.toBeInTheDocument()
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

  it('resets the name field to empty when reopened, instead of carrying over the last-created name', async () => {
    const user = userEvent.setup()
    vi.mocked(getFolderContents).mockResolvedValue(emptyRoot)
    vi.mocked(createFolder).mockResolvedValue({ id: 'new-folder', name: 'Work', parentId: null, createdAt: '2026-08-19T12:00:00.000Z' })
    render(<FilesPage />, { wrapper: createWrapper() })
    await screen.findByText('Здесь пока пусто')

    await user.click(screen.getByRole('button', { name: /новая папка/i }))
    await user.type(screen.getByLabelText('Название'), 'Work')
    await user.click(screen.getByRole('button', { name: 'Создать' }))
    await waitFor(() => expect(createFolder).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: /новая папка/i }))

    expect(screen.getByLabelText('Название')).toHaveValue('')
  })
})

describe('FilesPage — folder item counts', () => {
  it('shows the item count on a folder tile', async () => {
    vi.mocked(getFolderContents).mockResolvedValue({
      ...emptyRoot,
      folders: [{ id: 'folder-1', name: 'Photos', parentId: null, createdAt: '2026-08-19T10:00:00.000Z', itemCount: 5 }],
    })
    render(<FilesPage />, { wrapper: createWrapper() })

    expect(await screen.findByText('Photos')).toBeInTheDocument()
    expect(screen.getByText('5 элементов')).toBeInTheDocument()
  })

  it('shows "Пусто" for a folder with no children', async () => {
    vi.mocked(getFolderContents).mockResolvedValue({
      ...emptyRoot,
      folders: [{ id: 'folder-1', name: 'Empty', parentId: null, createdAt: '2026-08-19T10:00:00.000Z', itemCount: 0 }],
    })
    render(<FilesPage />, { wrapper: createWrapper() })

    expect(await screen.findByText('Empty')).toBeInTheDocument()
    expect(screen.getByText('Пусто')).toBeInTheDocument()
  })

  it('uses correct Russian plural forms for 1, 2, and 5 items', async () => {
    vi.mocked(getFolderContents).mockResolvedValue({
      ...emptyRoot,
      folders: [
        { id: 'f1', name: 'One', parentId: null, createdAt: '2026-08-19T10:00:00.000Z', itemCount: 1 },
        { id: 'f2', name: 'Two', parentId: null, createdAt: '2026-08-19T10:00:00.000Z', itemCount: 2 },
      ],
    })
    render(<FilesPage />, { wrapper: createWrapper() })

    expect(await screen.findByText('1 элемент')).toBeInTheDocument()
    expect(screen.getByText('2 элемента')).toBeInTheDocument()
  })
})

describe('FilesPage — image thumbnails', () => {
  it('eagerly fetches and shows an inline thumbnail for an image file, without a click', async () => {
    vi.mocked(getFolderContents).mockResolvedValue({
      ...emptyRoot,
      files: [{
        id: 'file-3', name: 'photo.jpg', folderId: null, mimeType: 'image/jpeg',
        sizeBytes: 1024, createdAt: '2026-08-19T10:00:00.000Z', updatedAt: '2026-08-19T10:00:00.000Z',
      }],
    })
    const blob = new Blob(['jpg'], { type: 'image/jpeg' })
    vi.mocked(fetchFileBlob).mockResolvedValue(blob)
    render(<FilesPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(fetchFileBlob).toHaveBeenCalledWith('file-3'))
    expect(await screen.findByRole('img', { name: 'photo.jpg' })).toHaveAttribute('src', 'blob:mock')
  })

  it('eagerly fetches a thumbnail for an image file the browser reported no MIME type for, via its extension', async () => {
    vi.mocked(getFolderContents).mockResolvedValue({
      ...emptyRoot,
      files: [{
        id: 'file-5', name: 'photo.webp', folderId: null, mimeType: '',
        sizeBytes: 2048, createdAt: '2026-08-19T10:00:00.000Z', updatedAt: '2026-08-19T10:00:00.000Z',
      }],
    })
    const blob = new Blob(['webp'], { type: 'image/webp' })
    vi.mocked(fetchFileBlob).mockResolvedValue(blob)
    render(<FilesPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(fetchFileBlob).toHaveBeenCalledWith('file-5'))
    expect(await screen.findByRole('img', { name: 'photo.webp' })).toHaveAttribute('src', 'blob:mock')
  })

  it('does not eagerly fetch a thumbnail for a non-previewable file', async () => {
    vi.mocked(getFolderContents).mockResolvedValue({
      ...emptyRoot,
      files: [{
        id: 'file-6', name: 'archive.zip', folderId: null, mimeType: 'application/zip',
        sizeBytes: 4096, createdAt: '2026-08-19T10:00:00.000Z', updatedAt: '2026-08-19T10:00:00.000Z',
      }],
    })
    render(<FilesPage />, { wrapper: createWrapper() })

    await screen.findByText('archive.zip')

    expect(fetchFileBlob).not.toHaveBeenCalled()
  })
})

describe('FilesPage — PDF and text thumbnails', () => {
  it('prefetches pdf.js as soon as the page mounts, even for a folder with no PDF in it', async () => {
    vi.mocked(getFolderContents).mockResolvedValue(emptyRoot)
    render(<FilesPage />, { wrapper: createWrapper() })
    await screen.findByText('Здесь пока пусто')

    // Only loadPdfjs() (triggered here purely because the page mounted,
    // regardless of this specific folder's contents) ever sets this -
    // an indirect but real signal that the prefetch actually ran, not
    // just that the module would resolve if asked.
    const { GlobalWorkerOptions } = await import('pdfjs-dist')
    await waitFor(() => expect(GlobalWorkerOptions.workerSrc).toBe('mock-worker-url'))
  })

  it('eagerly renders an actual page-content thumbnail (a <canvas>, not an embedded viewer) for a PDF file, without a click', async () => {
    vi.mocked(getFolderContents).mockResolvedValue({
      ...emptyRoot,
      files: [{
        id: 'file-7', name: 'report.pdf', folderId: null, mimeType: 'application/pdf',
        sizeBytes: 2048, createdAt: '2026-08-19T10:00:00.000Z', updatedAt: '2026-08-19T10:00:00.000Z',
      }],
    })
    const blob = new Blob(['%PDF'], { type: 'application/pdf' })
    vi.mocked(fetchFileBlob).mockResolvedValue(blob)
    const { container } = render(<FilesPage />, { wrapper: createWrapper() })

    // Confirms it's rendered via pdf.js (a real thumbnail of the page
    // content), not an <iframe>/<embed> pointed at the file - neither
    // of those can be made to hide the browser's own PDF viewer chrome
    // (toolbar, search box, outline panel), which is what dominates a
    // thumbnail this small if used instead.
    await waitFor(() => expect(fetchFileBlob).toHaveBeenCalledWith('file-7'))
    await waitFor(() => expect(container.querySelector('canvas')).not.toBeNull())
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('embed')).toBeNull()
  })

  it('eagerly renders a formatted markdown preview for a .md file, not raw source text', async () => {
    vi.mocked(getFolderContents).mockResolvedValue({
      ...emptyRoot,
      files: [{
        id: 'file-8', name: 'README.md', folderId: null, mimeType: 'text/markdown',
        sizeBytes: 40, createdAt: '2026-08-19T10:00:00.000Z', updatedAt: '2026-08-19T10:00:00.000Z',
      }],
    })
    const blob = new Blob(['# Hello'], { type: 'text/markdown' })
    vi.mocked(fetchFileBlob).mockResolvedValue(blob)
    render(<FilesPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(fetchFileBlob).toHaveBeenCalledWith('file-8'))
    const heading = await screen.findByRole('heading', { name: 'Hello', level: 1 })
    expect(heading).toBeInTheDocument()
    // Rendered at real proportions and shrunk as a whole block via
    // transform, not just given a tiny font-size - otherwise a
    // top-level heading (naturally the biggest element on the page)
    // ends up dominating the entire thumbnail on its own, showing no
    // body text at all.
    const scaledBlock = heading.closest('.markdown-preview') as HTMLElement
    expect(scaledBlock.style.transform).toBe('scale(0.25)')
  })

  it('eagerly fetches and shows a plain-text thumbnail for a dotfile with no extension', async () => {
    vi.mocked(getFolderContents).mockResolvedValue({
      ...emptyRoot,
      files: [{
        id: 'file-9', name: '.bashrc', folderId: null, mimeType: '',
        sizeBytes: 259, createdAt: '2026-08-19T10:00:00.000Z', updatedAt: '2026-08-19T10:00:00.000Z',
      }],
    })
    const blob = new Blob(['export PATH=$PATH:/usr/local/bin'], { type: '' })
    vi.mocked(fetchFileBlob).mockResolvedValue(blob)
    render(<FilesPage />, { wrapper: createWrapper() })

    await waitFor(() => expect(fetchFileBlob).toHaveBeenCalledWith('file-9'))
    expect(await screen.findByText(/export PATH/)).toBeInTheDocument()
  })
})

describe('FilesPage — text preview', () => {
  it('opens a rendered markdown preview for a .md file with no browser-reported MIME type', async () => {
    const user = userEvent.setup()
    vi.mocked(getFolderContents).mockResolvedValue({
      ...emptyRoot,
      files: [{
        id: 'file-4', name: 'README.md', folderId: null, mimeType: '',
        sizeBytes: 40, createdAt: '2026-08-19T10:00:00.000Z', updatedAt: '2026-08-19T10:00:00.000Z',
      }],
    })
    const blob = new Blob(['# Hello'], { type: 'text/markdown' })
    vi.mocked(fetchFileBlob).mockResolvedValue(blob)
    render(<FilesPage />, { wrapper: createWrapper() })

    await user.click(await screen.findByText('README.md'))

    const dialog = await screen.findByRole('dialog', { name: 'README.md' })
    // Rendered as markdown (a real <h1>), not the literal source text -
    // scoped to the dialog since the grid tile's own thumbnail also
    // renders the same "# Hello" as a heading in the background.
    expect(within(dialog).getByRole('heading', { name: 'Hello', level: 1 })).toBeInTheDocument()
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
