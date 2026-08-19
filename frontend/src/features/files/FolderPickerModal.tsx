import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder, FolderInput, Home } from 'lucide-react'
import { Modal } from '@zudar107/schloss-ui'
import { getFolderContents } from '../../lib/api'

export interface FolderPickerModalProps {
  open: boolean
  onClose: () => void
  onPick: (folderId: string | null) => void
  pending: boolean
  error: string | null
  /** The item being moved can't be picked as its own destination, and
   * (for a folder) neither can any of its own descendants - the caller
   * already rejects those server-side, but excluding them here avoids
   * an obviously-doomed round trip. Undefined for a file (files have no
   * descendants to worry about). */
  excludeFolderId?: string
}

// A simple "navigate down, then move here" picker - not a full tree
// view, just one directory level at a time (reusing the same
// GET /folders/:id the main page itself uses) with its own breadcrumb.
export function FolderPickerModal({ open, onClose, onPick, pending, error, excludeFolderId }: FolderPickerModalProps) {
  const [browsingId, setBrowsingId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['folder-picker', browsingId],
    queryFn: () => getFolderContents(browsingId),
    enabled: open,
  })

  function handleClose() {
    setBrowsingId(null)
    onClose()
  }

  const folders = (data?.folders ?? []).filter((f) => f.id !== excludeFolderId)

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Переместить в…"
      icon={<FolderInput size={20} />}
      actions={[
        { label: 'Отмена', onClick: handleClose, variant: 'secondary' },
        { label: pending ? 'Перемещение…' : 'Переместить сюда', onClick: () => onPick(browsingId), variant: 'primary' },
      ]}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.75rem', fontSize: '0.8125rem' }}>
        <button type="button" className="btn-ghost" style={{ padding: '0.25rem 0.5rem' }} onClick={() => setBrowsingId(null)}>
          <Home size={14} />
        </button>
        {(data?.ancestors ?? []).map((ancestor) => (
          <span key={ancestor.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <ChevronRight size={13} color="var(--text-muted)" />
            <button type="button" className="btn-ghost" style={{ padding: '0.25rem 0.5rem' }} onClick={() => setBrowsingId(ancestor.id)}>
              {ancestor.name}
            </button>
          </span>
        ))}
        {data?.folder && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <ChevronRight size={13} color="var(--text-muted)" />
            <strong style={{ padding: '0.25rem 0.5rem' }}>{data.folder.name}</strong>
          </span>
        )}
      </div>

      {error && <p role="alert" style={{ margin: '0 0 0.75rem', color: 'var(--danger)', fontSize: '0.8125rem' }}>{error}</p>}

      <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        {isLoading ? (
          <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>Загрузка…</div>
        ) : folders.length === 0 ? (
          <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>Здесь нет папок</div>
        ) : (
          folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setBrowsingId(folder.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%',
                padding: '0.625rem 0.75rem', background: 'none', border: 'none', borderBottom: '1px solid var(--border)',
                cursor: 'pointer', textAlign: 'left', fontSize: '0.875rem', color: 'var(--text-primary)',
              }}
            >
              <Folder size={16} color="var(--accent)" />
              {folder.name}
            </button>
          ))
        )}
      </div>
    </Modal>
  )
}
