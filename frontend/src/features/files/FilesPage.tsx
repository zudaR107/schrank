import { useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight, Download, File as FileIcon, Folder, FolderInput,
  FolderPlus, Home, Pencil, Trash2, Upload,
} from 'lucide-react'
import { Button, EmptyState, Toast } from '@zudar107/schloss-ui'
import { HeroIllustration } from '../../components/HeroIllustration'
import { useToast } from '../../hooks/useToast'
import {
  ApiError, createFolder, deleteFile, deleteFolder, fetchFileBlob, getFolderContents,
  updateFile, updateFolder, uploadFile,
  type FileSummary, type FolderSummary,
} from '../../lib/api'
import { NameModal } from './NameModal'
import { FolderPickerModal } from './FolderPickerModal'

type RenameTarget = { kind: 'folder' | 'file'; id: string; name: string }
type MoveTarget = { kind: 'folder' | 'file'; id: string; currentParentId: string | null }

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

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'Папка или файл с таким названием уже есть здесь'
    if (error.status === 404) return 'Не найдено'
    if (error.status === 413) return 'Превышен лимит размера файла или хранилища'
    if (error.status === 400) return 'Нельзя переместить папку в саму себя или во вложенную папку'
  }
  return fallback
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function FilesPage() {
  const { folder: folderIdRaw } = useSearch({ strict: false }) as { folder?: string }
  const folderId = folderIdRaw ?? null
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
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
      triggerBrowserDownload(blob, file.name)
    } catch {
      toast.showError('Не удалось скачать файл')
    } finally {
      setDownloadingId(null)
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
          <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.375rem', fontSize: '0.8125rem' }}>
            <button type="button" className="btn-ghost" style={{ padding: '0.25rem 0.5rem' }} onClick={() => goTo(null)}>
              <Home size={14} />
            </button>
            {(data?.ancestors ?? []).map((ancestor) => (
              <span key={ancestor.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <ChevronRight size={13} color="var(--text-muted)" />
                <button type="button" className="btn-ghost" style={{ padding: '0.25rem 0.5rem' }} onClick={() => goTo(ancestor.id)}>
                  {ancestor.name}
                </button>
              </span>
            ))}
            {data?.folder && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <ChevronRight size={13} color="var(--text-muted)" />
                <strong style={{ padding: '0.25rem 0.5rem', color: 'var(--text-primary)' }}>{data.folder.name}</strong>
              </span>
            )}
          </nav>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant="secondary" onClick={() => setCreateFolderOpen(true)}>
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

      {isLoading && <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Загрузка…</div>}
      {isError && <div role="alert" className="inline-error">Не удалось загрузить содержимое папки</div>}

      {isEmpty && (
        <div className="empty-wrap">
          <EmptyFolderState onUpload={() => fileInputRef.current?.click()} />
        </div>
      )}

      {!isLoading && !isError && !isEmpty && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-surface)' }}>
          {folders.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              onOpen={() => goTo(folder.id)}
              onRename={() => setRenameTarget({ kind: 'folder', id: folder.id, name: folder.name })}
              onMove={() => setMoveTarget({ kind: 'folder', id: folder.id, currentParentId: folderId })}
              onDelete={() => deleteFolderMutation.mutate(folder.id)}
            />
          ))}
          {files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              downloading={downloadingId === file.id}
              onDownload={() => void handleDownload(file)}
              onRename={() => setRenameTarget({ kind: 'file', id: file.id, name: file.name })}
              onMove={() => setMoveTarget({ kind: 'file', id: file.id, currentParentId: folderId })}
              onDelete={() => deleteFileMutation.mutate(file.id)}
            />
          ))}
        </div>
      )}

      <NameModal
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

function ItemActions({ children }: { children: React.ReactNode }) {
  return <div className="file-row-actions" style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>{children}</div>
}

function ActionButton({ onClick, danger, children, label }: { onClick: () => void; danger?: boolean; children: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.3rem', border: 0, background: 'transparent',
        color: danger ? 'var(--danger)' : 'var(--accent)', cursor: 'pointer', padding: '0.35rem 0.5rem',
        borderRadius: 7, fontSize: '0.78rem', fontWeight: 650,
      }}
    >
      {children}
    </button>
  )
}

function RowShell({ onClick, icon, name, meta, children }: {
  onClick?: () => void; icon: React.ReactNode; name: string; meta?: string; children: React.ReactNode
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem',
        borderBottom: '1px solid var(--border)', cursor: onClick ? 'pointer' : undefined,
      }}
    >
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </div>
        {meta && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{meta}</div>}
      </div>
      {children}
    </div>
  )
}

function FolderRow({ folder, onOpen, onRename, onMove, onDelete }: {
  folder: FolderSummary; onOpen: () => void; onRename: () => void; onMove: () => void; onDelete: () => void
}) {
  return (
    <RowShell onClick={onOpen} icon={<Folder size={20} color="var(--accent)" style={{ flexShrink: 0 }} />} name={folder.name}>
      <ItemActions>
        <ActionButton onClick={onRename} label={`Переименовать «${folder.name}»`}><Pencil size={14} />Переименовать</ActionButton>
        <ActionButton onClick={onMove} label={`Переместить «${folder.name}»`}><FolderInput size={14} />Переместить</ActionButton>
        <ActionButton onClick={onDelete} danger label={`Удалить «${folder.name}»`}><Trash2 size={14} />Удалить</ActionButton>
      </ItemActions>
    </RowShell>
  )
}

function FileRow({ file, downloading, onDownload, onRename, onMove, onDelete }: {
  file: FileSummary; downloading: boolean; onDownload: () => void; onRename: () => void; onMove: () => void; onDelete: () => void
}) {
  return (
    <RowShell
      onClick={onDownload}
      icon={<FileIcon size={20} color="var(--text-muted)" style={{ flexShrink: 0 }} />}
      name={file.name}
      meta={formatBytes(file.sizeBytes)}
    >
      <ItemActions>
        <ActionButton onClick={onDownload} label={`Скачать «${file.name}»`}>
          <Download size={14} />{downloading ? 'Скачивание…' : 'Скачать'}
        </ActionButton>
        <ActionButton onClick={onRename} label={`Переименовать «${file.name}»`}><Pencil size={14} />Переименовать</ActionButton>
        <ActionButton onClick={onMove} label={`Переместить «${file.name}»`}><FolderInput size={14} />Переместить</ActionButton>
        <ActionButton onClick={onDelete} danger label={`Удалить «${file.name}»`}><Trash2 size={14} />Удалить</ActionButton>
      </ItemActions>
    </RowShell>
  )
}
