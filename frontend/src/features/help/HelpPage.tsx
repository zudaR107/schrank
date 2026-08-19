interface Section {
  title: string
  text: string
}

const SECTIONS: Section[] = [
  {
    title: 'Папки',
    text: 'Создавайте вложенные папки кнопкой «Новая папка» на странице «Файлы». Хлебные крошки наверху показывают путь от корня и позволяют быстро вернуться в любую из родительских папок.',
  },
  {
    title: 'Загрузка и скачивание',
    text: 'Кнопка «Загрузить» открывает системный диалог выбора файлов — можно выбрать сразу несколько. Нажмите на файл в списке, чтобы скачать его.',
  },
  {
    title: 'Переименование и перемещение',
    text: 'У каждой папки и файла есть действия «Переименовать» и «Переместить». Перемещение открывает окно с навигацией по вашим папкам — выберите нужную и нажмите «Переместить сюда».',
  },
  {
    title: 'Удаление',
    text: 'Удаление файла необратимо. Удаление папки рекурсивно удаляет всё её содержимое — вложенные папки и файлы — тоже без возможности восстановления, поэтому используйте эту кнопку осознанно.',
  },
  {
    title: 'Хранилище',
    text: 'В «Настройках» показан объём использованного хранилища относительно лимита аккаунта. Загрузка файла, из-за которого лимит будет превышен, отклоняется.',
  },
  {
    title: 'Экспорт',
    text: 'В «Настройках» напрямую скачивается JSON со списком всех папок и файлов Schrank (названия, размеры, даты) — без содержимого самих файлов. ZIP всего Hof создаётся отдельно в настройках аккаунта Schlüssel.',
  },
]

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
        Schrank — личное файловое хранилище платформы Hof: настоящие
        вложенные папки и файлы любых типов, доступные только вам.
      </p>

      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Первые шаги
        </h2>
        <ol style={{ margin: 0, paddingLeft: '1.25rem', listStyleType: 'decimal', color: 'var(--text-muted)', fontSize: '0.8125rem', lineHeight: 1.7 }}>
          <li>Нажмите «Загрузить» на странице «Файлы», чтобы добавить первый файл.</li>
          <li>Создайте папку кнопкой «Новая папка» и переместите в неё файлы.</li>
          <li>Открывайте вложенные папки, нажимая на них в списке.</li>
        </ol>
      </div>

      {SECTIONS.map((s) => (
        <div key={s.title} className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {s.title}
          </h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8125rem', lineHeight: 1.6 }}>
            {s.text}
          </p>
        </div>
      ))}
    </div>
  )
}
