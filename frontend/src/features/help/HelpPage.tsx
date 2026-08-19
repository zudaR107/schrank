export function HelpPage() {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          Как пользоваться Schrank
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
          Файловое хранилище с папками
        </p>
      </div>

      <p style={{ margin: '0 0 1.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
        Schrank — файловое хранилище платформы Hof с настоящими вложенными
        папками и просмотром изображений/PDF прямо в браузере. Сервис пока
        в разработке: этот раздел появится, как только будет готова
        основная функциональность.
      </p>
    </div>
  )
}
