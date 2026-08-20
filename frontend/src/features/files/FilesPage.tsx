import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight, Download, File as FileIcon, FileText, Folder, FolderInput,
  FolderPlus, Home, Pencil, RefreshCw, Trash2, Upload,
} from 'lucide-react'
import { Button, downloadBlob, EmptyState, Toast } from '@zudar107/schloss-ui'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { HeroIllustration } from '../../components/HeroIllustration'
import { useToast } from '../../hooks/useToast'
import {
  ApiError, createFolder, deleteFile, deleteFolder, fetchFileBlob, getFolderContents,
  updateFile, updateFolder, uploadFile,
  type FileSummary, type FolderSummary,
} from '../../lib/api'
import { NameModal } from './NameModal'
import { FolderPickerModal } from './FolderPickerModal'
import { isPreviewable, previewKind, PreviewModal } from './PreviewModal'
import { loadPdfjs, PdfThumbnail } from './PdfThumbnail'

type RenameTarget = { kind: 'folder' | 'file'; id: string; name: string }
type MoveTarget = { kind: 'folder' | 'file'; id: string; currentParentId: string | null }

// Every breadcrumb segment (the Home icon button and each text button)
// gets this exact height, regardless of whether its content is an icon
// or a text line - without it, the icon-only Home button and the
// text buttons compute slightly different natural heights, which reads
// as the whole row "jumping" vertically the moment a second segment
// appears next to it.
const BREADCRUMB_ITEM_SIZE = 40

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`
}

function pluralizeItems(n: number): string {
  if (n === 0) return 'Пусто'
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return `${n} элементов`
  if (mod10 === 1) return `${n} элемент`
  if (mod10 >= 2 && mod10 <= 4) return `${n} элемента`
  return `${n} элементов`
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'Папка или файл с таким названием уже есть здесь'
    if (error.status === 404) return 'Не найдено'
    if (error.status === 413) return 'Превышен лимит размера файла или хранилища'
    if (error.status === 400) return 'Нельзя переместить папку в саму себя или во вложенную папку'
  }
  return fallback
}

export function FilesPage() {
  const { folder: folderIdRaw } = useSearch({ strict: false }) as { folder?: string }
  const folderId = folderIdRaw ?? null
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Kicked off the moment this page mounts, in parallel with the folder
  // listing itself fetching - not gated on this folder actually turning
  // out to contain a PDF, since waiting to find out would forfeit the
  // very overlap this is trying to buy: pdf.js only needs fetching once
  // per session (see PdfThumbnail's own module-level cache), so paying
  // that cost early, once, is worth it in a file-storage app where PDFs
  // are a routine file type - by the time a folder with one actually
  // renders, its thumbnail is often ready to render immediately instead
  // of visibly waiting on the library to arrive.
  useEffect(() => { void loadPdfjs() }, [])

  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [createFolderKey, setCreateFolderKey] = useState(0)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<FileSummary | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['folder-contents', folderId],
    queryFn: () => getFolderContents(folderId),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['folder-contents'] })
    void queryClient.invalidateQueries({ queryKey: ['folder-picker'] })
    void queryClient.invalidateQueries({ queryKey: ['usage'] })
  }

  function goTo(id: string | null) {
    void navigate({ to: '/files', search: id ? { folder: id } : {} })
  }

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => createFolder({ name, parentId: folderId }),
    onSuccess: () => {
      setCreateFolderOpen(false)
      invalidate()
      toast.showSuccess('Папка создана')
    },
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadFile(file, folderId),
    onSuccess: () => invalidate(),
    onError: (error) => toast.showError(errorMessage(error, 'Не удалось загрузить файл')),
  })

  const renameMutation = useMutation<FolderSummary | FileSummary, unknown, string>({
    mutationFn: (name) => {
      if (!renameTarget) throw new Error('no rename target')
      return renameTarget.kind === 'folder'
        ? updateFolder(renameTarget.id, { name })
        : updateFile(renameTarget.id, { name })
    },
    onSuccess: () => {
      setRenameTarget(null)
      invalidate()
    },
  })

  const moveMutation = useMutation<FolderSummary | FileSummary, unknown, string | null>({
    mutationFn: (destinationId) => {
      if (!moveTarget) throw new Error('no move target')
      return moveTarget.kind === 'folder'
        ? updateFolder(moveTarget.id, { parentId: destinationId })
        : updateFile(moveTarget.id, { folderId: destinationId })
    },
    onSuccess: () => {
      setMoveTarget(null)
      invalidate()
      toast.showSuccess('Перемещено')
    },
  })

  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => deleteFolder(id),
    onSuccess: () => {
      invalidate()
      toast.showSuccess('Папка удалена')
    },
    onError: () => toast.showError('Не удалось удалить папку'),
  })

  const deleteFileMutation = useMutation({
    mutationFn: (id: string) => deleteFile(id),
    onSuccess: () => {
      invalidate()
      toast.showSuccess('Файл удалён')
    },
    onError: () => toast.showError('Не удалось удалить файл'),
  })

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    for (const file of Array.from(fileList)) {
      await uploadMutation.mutateAsync(file)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleDownload(file: FileSummary) {
    setDownloadingId(file.id)
    try {
      const blob = await fetchFileBlob(file.id)
      downloadBlob(blob, file.name)
    } catch {
      toast.showError('Не удалось скачать файл')
    } finally {
      setDownloadingId(null)
    }
  }

  function handleOpen(file: FileSummary) {
    if (isPreviewable(file)) {
      setPreviewFile(file)
    } else {
      void handleDownload(file)
    }
  }

  const folders = data?.folders ?? []
  const files = data?.files ?? []
  const isEmpty = !isLoading && !isError && folders.length === 0 && files.length === 0

  return (
    <div>
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Файлы
          </h1>
          <nav aria-label="Breadcrumb" style={{
            display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', marginTop: '0.625rem',
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
            padding: 3, width: 'fit-content', maxWidth: '100%',
          }}>
            <button
              type="button"
              className="btn-ghost"
              aria-label="На главную"
              title="На главную"
              onClick={() => goTo(null)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: BREADCRUMB_ITEM_SIZE, height: BREADCRUMB_ITEM_SIZE, padding: 0, borderRadius: 8,
                background: !data?.folder ? 'var(--accent-muted)' : undefined,
                color: !data?.folder ? 'var(--accent)' : undefined,
              }}
            >
              <Home size={18} />
            </button>
            {(data?.ancestors ?? []).map((ancestor) => (
              <span key={ancestor.id} style={{ display: 'flex', alignItems: 'center' }}>
                <ChevronRight size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => goTo(ancestor.id)}
                  style={{ height: BREADCRUMB_ITEM_SIZE, padding: '0 0.75rem', borderRadius: 8, whiteSpace: 'nowrap' }}
                >
                  {ancestor.name}
                </button>
              </span>
            ))}
            {data?.folder && (
              <span style={{ display: 'flex', alignItems: 'center' }}>
                <ChevronRight size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                {/* The same accent-muted "you are here" treatment Home
                 * gets at root - whichever segment is the current
                 * location should look that way, not just root. */}
                <strong style={{
                  display: 'flex', alignItems: 'center', height: BREADCRUMB_ITEM_SIZE, padding: '0 0.75rem',
                  borderRadius: 8, background: 'var(--accent-muted)', color: 'var(--accent)',
                  fontSize: '0.875rem', fontWeight: 700, whiteSpace: 'nowrap',
                }}>
                  {data.folder.name}
                </strong>
              </span>
            )}
          </nav>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant="secondary" onClick={() => { setCreateFolderKey((k) => k + 1); setCreateFolderOpen(true) }}>
            <FolderPlus size={16} />Новая папка
          </Button>
          <Button variant="primary" disabled={uploadMutation.isPending} onClick={() => fileInputRef.current?.click()}>
            <Upload size={16} />{uploadMutation.isPending ? 'Загрузка…' : 'Загрузить'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => void handleFilesSelected(e.target.files)}
          />
        </div>
      </div>

      {isLoading && (
        <div className="empty-wrap">
          <LoadingFolderState />
        </div>
      )}
      {isError && (
        <div className="empty-wrap" role="alert">
          <ErrorFolderState onRetry={() => void refetch()} />
        </div>
      )}

      {isEmpty && (
        <div className="empty-wrap">
          <EmptyFolderState onUpload={() => fileInputRef.current?.click()} />
        </div>
      )}

      {!isLoading && !isError && !isEmpty && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '1rem' }}>
          {folders.map((folder) => (
            <FolderTile
              key={folder.id}
              folder={folder}
              onOpen={() => goTo(folder.id)}
              onRename={() => setRenameTarget({ kind: 'folder', id: folder.id, name: folder.name })}
              onMove={() => setMoveTarget({ kind: 'folder', id: folder.id, currentParentId: folderId })}
              onDelete={() => deleteFolderMutation.mutate(folder.id)}
            />
          ))}
          {files.map((file) => (
            <FileTile
              key={file.id}
              file={file}
              downloading={downloadingId === file.id}
              onOpen={() => handleOpen(file)}
              onDownload={() => void handleDownload(file)}
              onRename={() => setRenameTarget({ kind: 'file', id: file.id, name: file.name })}
              onMove={() => setMoveTarget({ kind: 'file', id: file.id, currentParentId: folderId })}
              onDelete={() => deleteFileMutation.mutate(file.id)}
            />
          ))}
        </div>
      )}

      <NameModal
        key={createFolderKey}
        open={createFolderOpen}
        title="Новая папка"
        icon={<FolderPlus size={20} />}
        submitLabel="Создать"
        pendingLabel="Создание…"
        onClose={() => setCreateFolderOpen(false)}
        onSubmit={(name) => name && createFolderMutation.mutate(name)}
        pending={createFolderMutation.isPending}
        error={createFolderMutation.error ? errorMessage(createFolderMutation.error, 'Не удалось создать папку') : null}
      />

      {renameTarget && (
        <NameModal
          key={renameTarget.id}
          open
          title={renameTarget.kind === 'folder' ? 'Переименовать папку' : 'Переименовать файл'}
          icon={<Pencil size={20} />}
          initialName={renameTarget.name}
          submitLabel="Сохранить"
          pendingLabel="Сохранение…"
          onClose={() => setRenameTarget(null)}
          onSubmit={(name) => name && renameMutation.mutate(name)}
          pending={renameMutation.isPending}
          error={renameMutation.error ? errorMessage(renameMutation.error, 'Не удалось переименовать') : null}
        />
      )}

      {moveTarget && (
        <FolderPickerModal
          open
          onClose={() => setMoveTarget(null)}
          onPick={(destinationId) => moveMutation.mutate(destinationId)}
          pending={moveMutation.isPending}
          error={moveMutation.error ? errorMessage(moveMutation.error, 'Не удалось переместить') : null}
          excludeFolderId={moveTarget.kind === 'folder' ? moveTarget.id : undefined}
        />
      )}

      {previewFile && (
        <PreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
          onDownload={() => void handleDownload(previewFile)}
        />
      )}

      {toast.toast && (
        <Toast open variant={toast.toast.variant} message={toast.toast.message} onDismiss={toast.dismiss} />
      )}
    </div>
  )
}

function EmptyFolderState({ onUpload }: { onUpload: () => void }) {
  return (
    <EmptyState
      illustration={<HeroIllustration size={100} />}
      title="Здесь пока пусто"
      description="Загрузите первый файл или создайте папку."
      actionLabel="Загрузить файл"
      actionIcon={<Upload size={16} />}
      onAction={onUpload}
    />
  )
}

// EmptyState itself requires an action, which a bare loading state has
// none of - this mirrors its illustration+title markup directly so
// loading still belongs to the same "mascot + centered text" visual
// family as every other start/empty page instead of falling back to
// unstyled inline text.
function LoadingFolderState() {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 2rem', maxWidth: 440, margin: '0 auto' }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: '1.5rem', borderRadius: 'var(--radius-lg)', background: 'var(--accent-muted)',
        margin: '0 auto 1.25rem',
      }}>
        <HeroIllustration size={100} />
      </div>
      <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.125rem', fontWeight: 600 }}>Загрузка…</h2>
    </div>
  )
}

function ErrorFolderState({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      illustration={<HeroIllustration size={100} />}
      title="Не удалось загрузить содержимое папки"
      description="Проверьте соединение и попробуйте ещё раз."
      actionLabel="Повторить"
      actionIcon={<RefreshCw size={16} />}
      onAction={onRetry}
    />
  )
}

function IconActionButton({ onClick, danger, disabled, label, children }: {
  onClick: () => void; danger?: boolean; disabled?: boolean; label: string; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      aria-label={label}
      title={label}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
        border: 0, background: 'transparent', color: danger ? 'var(--danger)' : 'var(--text-secondary)',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, borderRadius: 7, flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}

function Tile({ onOpen, thumbnail, name, meta, actions }: {
  onOpen?: () => void; thumbnail: React.ReactNode; name: string; meta: string; actions: React.ReactNode
}) {
  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 12,
        background: 'var(--bg-surface)', overflow: 'hidden', cursor: onOpen ? 'pointer' : undefined,
      }}
    >
      <div
        style={{
          // A tint distinct from both the page background and the
          // card's own surface, so a folder/generic-file icon reads as
          // sitting in a deliberate "preview slot" - not as an
          // unstyled gap that happens to match the page behind it. An
          // actual loaded image fills this completely, so the tint
          // only ever shows through for icons/loading state.
          aspectRatio: '1 / 1', background: 'var(--accent-muted)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', overflow: 'hidden',
        }}
      >
        {thumbnail}
      </div>
      <div style={{ padding: '0.625rem 0.75rem' }}>
        <div title={name} style={{
          fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{meta}</div>
        <div style={{ display: 'flex', gap: '0.125rem', marginTop: '0.375rem' }}>{actions}</div>
      </div>
    </div>
  )
}

function FolderTile({ folder, onOpen, onRename, onMove, onDelete }: {
  folder: FolderSummary; onOpen: () => void; onRename: () => void; onMove: () => void; onDelete: () => void
}) {
  return (
    <Tile
      onOpen={onOpen}
      thumbnail={<Folder size={40} color="var(--accent)" strokeWidth={1.5} />}
      name={folder.name}
      meta={pluralizeItems(folder.itemCount ?? 0)}
      actions={(
        <>
          <IconActionButton onClick={onRename} label={`Переименовать «${folder.name}»`}><Pencil size={15} /></IconActionButton>
          <IconActionButton onClick={onMove} label={`Переместить «${folder.name}»`}><FolderInput size={15} /></IconActionButton>
          <IconActionButton onClick={onDelete} danger label={`Удалить «${folder.name}»`}><Trash2 size={15} /></IconActionButton>
        </>
      )}
    />
  )
}

// How much of a text/markdown file's content actually gets rendered into
// the tiny, permanently-clipped grid thumbnail - a peek/texture, not a
// real read, so there's no point fetching-then-rendering (and, for
// markdown, re-parsing) an entire large file just for a few visible
// pixels of it.
const THUMBNAIL_TEXT_PREVIEW_CHARS = 2000

function FileThumbnail({ file }: { file: FileSummary }) {
  const kind = previewKind(file)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [textContent, setTextContent] = useState<string | null>(null)

  useEffect(() => {
    // PDF renders itself via PdfThumbnail below, with its own fetch -
    // an <iframe>/<embed> can't be made to show just the document
    // content at this size (see that component's own comment), so this
    // blob-URL path is only for image thumbnails now.
    if (kind !== 'image' && kind !== 'markdown' && kind !== 'text') return
    let cancelled = false
    let url: string | null = null
    fetchFileBlob(file.id)
      .then(async (blob) => {
        if (cancelled) return
        if (kind === 'markdown' || kind === 'text') {
          setTextContent((await blob.text()).slice(0, THUMBNAIL_TEXT_PREVIEW_CHARS))
        } else {
          url = URL.createObjectURL(blob)
          setObjectUrl(url)
        }
      })
      .catch(() => { /* falls back to the generic file icon below */ })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file.id, kind])

  if (kind === 'image' && objectUrl) {
    return <img src={objectUrl} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  }
  if (kind === 'pdf') {
    return <PdfThumbnail fileId={file.id} name={file.name} />
  }
  if (kind === 'markdown' && textContent !== null) {
    return (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none' }}>
        {/* A genuine miniature, not just small text: rendered at its
         * real proportions (so a top-level heading is still only
         * modestly bigger than body text, the way it reads in the
         * actual file) inside a box 4x the thumbnail's own width, then
         * shrunk 4x via transform - percentages, so this stays correct
         * regardless of how wide the grid actually makes this tile.
         * Shrinking the whole block instead of just setting a tiny
         * font-size is what makes many lines of body text visible
         * instead of one oversized heading swallowing the frame.
         * markdown-preview-mini strips code/pre/th's background badge
         * (see index.css) - illegible at this scale regardless. */}
        <div
          className="markdown-preview markdown-preview-mini"
          style={{ width: '400%', transform: 'scale(0.25)', transformOrigin: 'top left', padding: '0.75rem', textAlign: 'left' }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{textContent}</ReactMarkdown>
        </div>
      </div>
    )
  }
  if (kind === 'text' && textContent !== null) {
    return (
      <pre style={{
        width: '100%', height: '100%', margin: 0, padding: '0.5rem', textAlign: 'left',
        pointerEvents: 'none',
        fontSize: '0.5rem', lineHeight: 1.35, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {textContent}
      </pre>
    )
  }
  if (kind === 'markdown' || kind === 'text') return <FileText size={40} color="var(--accent)" strokeWidth={1.5} />
  return <FileIcon size={40} color="var(--accent)" strokeWidth={1.5} />
}

function FileTile({ file, downloading, onOpen, onDownload, onRename, onMove, onDelete }: {
  file: FileSummary; downloading: boolean; onOpen: () => void; onDownload: () => void; onRename: () => void; onMove: () => void; onDelete: () => void
}) {
  return (
    <Tile
      onOpen={onOpen}
      thumbnail={<FileThumbnail file={file} />}
      name={file.name}
      meta={formatBytes(file.sizeBytes)}
      actions={(
        <>
          <IconActionButton onClick={onDownload} disabled={downloading} label={`Скачать «${file.name}»`}><Download size={15} /></IconActionButton>
          <IconActionButton onClick={onRename} label={`Переименовать «${file.name}»`}><Pencil size={15} /></IconActionButton>
          <IconActionButton onClick={onMove} label={`Переместить «${file.name}»`}><FolderInput size={15} /></IconActionButton>
          <IconActionButton onClick={onDelete} danger label={`Удалить «${file.name}»`}><Trash2 size={15} /></IconActionButton>
        </>
      )}
    />
  )
}
