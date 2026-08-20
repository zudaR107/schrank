import { useEffect, useState } from 'react'
import { Modal } from '@zudar107/schloss-ui'
import { fetchFileBlob, type FileSummary } from '../../lib/api'

export function isPreviewable(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType === 'application/pdf'
}

export function PreviewModal({ file, onClose, onDownload }: {
  file: FileSummary
  onClose: () => void
  onDownload: () => void
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    setObjectUrl(null)
    setFailed(false)

    fetchFileBlob(file.id)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setObjectUrl(url)
      })
      .catch(() => { if (!cancelled) setFailed(true) })

    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file.id])

  return (
    <Modal
      open
      onClose={onClose}
      title={file.name}
      size="large"
      actions={[{ label: 'Скачать', onClick: onDownload, variant: 'secondary' }]}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
        {failed && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Не удалось загрузить предпросмотр</p>
        )}
        {!failed && !objectUrl && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Загрузка…</p>
        )}
        {objectUrl && file.mimeType.startsWith('image/') && (
          <img
            src={objectUrl}
            alt={file.name}
            style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 'var(--radius-md)' }}
          />
        )}
        {objectUrl && file.mimeType === 'application/pdf' && (
          <iframe
            src={objectUrl}
            title={file.name}
            style={{ width: '100%', height: '70vh', border: 'none', borderRadius: 'var(--radius-md)' }}
          />
        )}
      </div>
    </Modal>
  )
}
