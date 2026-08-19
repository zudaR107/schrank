import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FilesPage } from '../features/files/FilesPage'

describe('FilesPage', () => {
  it('renders the bootstrap-stage placeholder', () => {
    render(<FilesPage />)
    expect(screen.getByText('Файлы скоро появятся здесь')).toBeInTheDocument()
  })
})
