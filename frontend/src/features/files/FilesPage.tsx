import { FolderOpen } from 'lucide-react'

// Placeholder for the file browser (folders/upload/preview) - this is
// the bootstrap stage only, wiring up auth/layout/routing before any of
// that exists. Replaced by the real page in a later stage.
export function FilesPage() {
  return (
    <div className="empty-wrap" style={{ textAlign: 'center', padding: '4rem 2rem', maxWidth: 440, margin: '0 auto' }}>
      <div style={{
        width: 52, height: 52, margin: '0 auto 1rem', borderRadius: '50%',
        background: 'var(--accent-muted)', color: 'var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <FolderOpen size={25} />
      </div>
      <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
        Файлы скоро появятся здесь
      </h2>
      <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        Раздел ещё в разработке.
      </p>
    </div>
  )
}
