import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button, Modal } from '@zudar107/schloss-ui'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { fetchFileBlob, type FileSummary } from '../../lib/api'

export type PreviewKind = 'image' | 'pdf' | 'markdown' | 'text' | null

// Browsers commonly report no MIME type at all (empty string) for
// extensions they have no registered handler for - .md and dotfiles like
// .bashrc being the common cases on every desktop OS - so upload falls
// back to "application/octet-stream" (see the backend's upload route).
// Extension/filename sniffing is the only reliable signal left in that
// case. Images are normally detected correctly by every browser, but
// the same fallback is applied for them too, defensively, since a
// mis-detected image is a much worse experience (silently falls back to
// a generic icon with no visual preview at all) than a mis-detected
// text file.
const MARKDOWN_EXTENSIONS = /\.(md|markdown)$/i
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i
const TEXT_EXTENSIONS = /\.(txt|json|ya?ml|csv|log|sh|bash|zsh|conf|cfg|ini|env|toml|xml|html?|css|jsx?|tsx?|py|rb|go|rs|c|cpp|h|hpp|java|php|sql)$/i
// A dotfile with no further extension - .bashrc, .gitignore, .eslintrc -
// is always plain text in practice, never a binary format.
const DOTFILE_NO_EXTENSION = /^\.[^./\\]+$/

export function previewKind(file: { name: string; mimeType: string }): PreviewKind {
  // Checked before mimeType, since a real .md file is unambiguous
  // regardless of what (if anything) the browser reported for it.
  if (MARKDOWN_EXTENSIONS.test(file.name) || file.mimeType === 'text/markdown') return 'markdown'
  if (file.mimeType.startsWith('image/')) return 'image'
  if (file.mimeType === 'application/pdf') return 'pdf'
  if (file.mimeType.startsWith('text/')) return 'text'
  if (file.mimeType === '' || file.mimeType === 'application/octet-stream') {
    if (IMAGE_EXTENSIONS.test(file.name)) return 'image'
    if (TEXT_EXTENSIONS.test(file.name) || DOTFILE_NO_EXTENSION.test(file.name)) return 'text'
  }
  return null
}

export function isPreviewable(file: { name: string; mimeType: string }): boolean {
  return previewKind(file) !== null
}

// A PDF page reads like an actual sheet of paper - showing one at a
// useful size needs real vertical room, far more than the shared
// Modal's own maxWidth: 900 / maxHeight: 90vh caps are meant to give
// (those are deliberately kept well short of the viewport edges, sized
// for forms and short dialogs - see that component's own doc comment).
// Rather than stretch a shared, every-service component past what it's
// designed for, this is a bespoke, Schrank-only dialog that mirrors
// Modal's own look (backdrop, card, header, Escape-to-close) but is
// free to fill nearly the whole viewport.
function PdfPreviewDialog({ file, objectUrl, loading, failed, onClose, onDownload }: {
  file: FileSummary
  objectUrl: string | null
  loading: boolean
  failed: boolean
  onClose: () => void
  onDownload: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [onClose])

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={file.name}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(960px, 94vw)', height: '94vh', display: 'flex', flexDirection: 'column',
          padding: '1.5rem', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>{file.name}</h2>
          <button
            type="button"
            className="btn-ghost"
            aria-label="Закрыть"
            onClick={onClose}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, padding: 0, borderRadius: 8 }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {failed && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Не удалось загрузить предпросмотр</p>
          )}
          {!failed && loading && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Загрузка…</p>
          )}
          {objectUrl && (
            <iframe
              src={objectUrl}
              title={file.name}
              style={{ width: '100%', height: '100%', border: 'none', borderRadius: 'var(--radius-md)' }}
            />
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
          <Button variant="secondary" onClick={onDownload}>Скачать</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function PreviewModal({ file, onClose, onDownload }: {
  file: FileSummary
  onClose: () => void
  onDownload: () => void
}) {
  const kind = previewKind(file)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [textContent, setTextContent] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    setObjectUrl(null)
    setTextContent(null)
    setFailed(false)

    fetchFileBlob(file.id)
      .then(async (blob) => {
        if (cancelled) return
        if (kind === 'markdown' || kind === 'text') {
          setTextContent(await blob.text())
        } else {
          url = URL.createObjectURL(blob)
          setObjectUrl(url)
        }
      })
      .catch(() => { if (!cancelled) setFailed(true) })

    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file.id, kind])

  const loading = !failed && objectUrl === null && textContent === null

  if (kind === 'pdf') {
    return (
      <PdfPreviewDialog
        file={file}
        objectUrl={objectUrl}
        loading={loading}
        failed={failed}
        onClose={onClose}
        onDownload={onDownload}
      />
    )
  }

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
        {!failed && loading && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Загрузка…</p>
        )}
        {objectUrl && kind === 'image' && (
          <img
            src={objectUrl}
            alt={file.name}
            style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 'var(--radius-md)' }}
          />
        )}
        {textContent !== null && kind === 'markdown' && (
          <div
            className="markdown-preview"
            style={{
              width: '100%', maxHeight: '70vh', overflow: 'auto', textAlign: 'left',
              padding: '1rem', borderRadius: 'var(--radius-md)', background: 'var(--bg-base)',
            }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {textContent}
            </ReactMarkdown>
          </div>
        )}
        {textContent !== null && kind === 'text' && (
          <pre style={{
            width: '100%', maxHeight: '70vh', overflow: 'auto', margin: 0, textAlign: 'left',
            padding: '1rem', borderRadius: 'var(--radius-md)', background: 'var(--bg-base)',
            fontSize: '0.8125rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            color: 'var(--text-primary)',
          }}>
            {textContent}
          </pre>
        )}
      </div>
    </Modal>
  )
}
