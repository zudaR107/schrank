import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HelpPage } from '../features/help/HelpPage'

describe('HelpPage', () => {
  it('renders the guide heading', () => {
    render(<HelpPage />)
    expect(screen.getByText('Как пользоваться Schrank')).toBeInTheDocument()
  })

  it('renders a heading for every section', () => {
    render(<HelpPage />)
    expect(screen.getByText('Папки')).toBeInTheDocument()
    expect(screen.getByText('Загрузка и скачивание')).toBeInTheDocument()
    expect(screen.getByText('Переименование и перемещение')).toBeInTheDocument()
    expect(screen.getByText('Удаление')).toBeInTheDocument()
    expect(screen.getByText('Хранилище')).toBeInTheDocument()
    expect(screen.getByText('Экспорт')).toBeInTheDocument()
  })

  it('renders the "Первые шаги" ordered list with visible decimal numbering', () => {
    render(<HelpPage />)

    const heading = screen.getByText('Первые шаги')
    const ol = heading.parentElement?.querySelector('ol')
    expect(ol).toBeInTheDocument()
    expect(ol).toHaveStyle({ listStyleType: 'decimal' })

    const items = ol ? Array.from(ol.querySelectorAll('li')) : []
    expect(items).toHaveLength(3)
  })

  it('documents recursive folder deletion and data export', () => {
    render(<HelpPage />)
    const guide = document.body.textContent ?? ''

    expect(guide).toMatch(/рекурсивно/i)
    expect(guide).toMatch(/необратим/i)
    expect(guide).toMatch(/экспорт/i)
  })
})
