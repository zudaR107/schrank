import { describe, expect, it } from 'vitest'
import { isPreviewable, previewKind } from '../features/files/PreviewModal'

describe('previewKind', () => {
  it('recognizes image mime types', () => {
    expect(previewKind({ name: 'photo.jpg', mimeType: 'image/jpeg' })).toBe('image')
    expect(previewKind({ name: 'photo.png', mimeType: 'image/png' })).toBe('image')
  })

  it('recognizes application/pdf', () => {
    expect(previewKind({ name: 'report.pdf', mimeType: 'application/pdf' })).toBe('pdf')
  })

  it('recognizes text/markdown and text/plain', () => {
    expect(previewKind({ name: 'notes.md', mimeType: 'text/markdown' })).toBe('text')
    expect(previewKind({ name: 'notes.txt', mimeType: 'text/plain' })).toBe('text')
  })

  it('falls back to the .md/.markdown/.txt extension when the browser reported no MIME type', () => {
    expect(previewKind({ name: 'README.md', mimeType: '' })).toBe('text')
    expect(previewKind({ name: 'README.markdown', mimeType: '' })).toBe('text')
    expect(previewKind({ name: 'notes.txt', mimeType: '' })).toBe('text')
  })

  it('falls back to the extension when the browser reported application/octet-stream', () => {
    expect(previewKind({ name: 'README.md', mimeType: 'application/octet-stream' })).toBe('text')
  })

  it('is case-insensitive about the extension', () => {
    expect(previewKind({ name: 'README.MD', mimeType: '' })).toBe('text')
  })

  it('does not treat an unknown-mime file with a non-text extension as previewable', () => {
    expect(previewKind({ name: 'archive.zip', mimeType: '' })).toBe(null)
    expect(previewKind({ name: 'archive.zip', mimeType: 'application/octet-stream' })).toBe(null)
  })

  it('returns null for anything else', () => {
    expect(previewKind({ name: 'archive.zip', mimeType: 'application/zip' })).toBe(null)
    expect(previewKind({ name: 'video.mp4', mimeType: 'video/mp4' })).toBe(null)
  })
})

describe('isPreviewable', () => {
  it('mirrors previewKind - true whenever a kind is returned', () => {
    expect(isPreviewable({ name: 'photo.jpg', mimeType: 'image/jpeg' })).toBe(true)
    expect(isPreviewable({ name: 'README.md', mimeType: '' })).toBe(true)
    expect(isPreviewable({ name: 'archive.zip', mimeType: 'application/zip' })).toBe(false)
  })
})
