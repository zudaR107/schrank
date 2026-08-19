import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive } from 'lucide-react'
import { DirectExportAction, downloadJson } from '@zudar107/schloss-ui'
import { api, getUsage } from '../../lib/api'

interface UserProfile {
  id: string
  email: string
  name: string
}

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

export function SettingsPage() {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['userProfile'],
    queryFn: () => api.get('/users/me'),
  })

  const { data: usage } = useQuery({
    queryKey: ['usage'],
    queryFn: getUsage,
  })

  async function downloadExport() {
    setExporting(true)
    setExportError(null)
    try {
      const data = await api.get('/exports/me')
      downloadJson(data, `schrank-export-${new Date().toISOString().slice(0, 10)}.json`)
    } catch {
      setExportError('Не удалось скачать данные. Попробуйте ещё раз.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          Настройки
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
          Профиль
        </p>
      </div>

      <div className="card" style={{ padding: '1.5rem' }}>
        {isLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Загрузка…</div>
        ) : profile ? (
          <div>
            <div className="label">Аккаунт</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>{profile.name}</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{profile.email}</div>
          </div>
        ) : null}
        <p style={{ margin: '1rem 0 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          Смена пароля и удаление аккаунта — в настройках Schlüssel (доступны через значок профиля в шапке).
        </p>
      </div>

      <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
        <div className="label">Хранилище</div>
        {usage ? (
          <>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>
              Использовано {formatBytes(usage.usedBytes)} из {formatBytes(usage.limitBytes)}
            </div>
            <div style={{ marginTop: '0.5rem', height: 6, borderRadius: 999, background: 'var(--accent-muted)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 999, background: 'var(--accent)',
                width: `${Math.min(100, (usage.usedBytes / usage.limitBytes) * 100)}%`,
              }} />
            </div>
          </>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Загрузка…</div>
        )}
      </div>

      <div style={{ marginTop: '1rem' }}>
        <DirectExportAction
          icon={<Archive size={24} />}
          title="Экспорт данных"
          description="Скачайте JSON со списком всех ваших папок и файлов Schrank (без содержимого файлов)."
          actionLabel="Скачать данные"
          loadingLabel="Подготовка…"
          onExport={downloadExport}
          loading={exporting}
          error={exportError}
        />
      </div>
    </div>
  )
}
