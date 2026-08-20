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

  it('recognizes .md/.markdown as the markdown kind regardless of mime type', () => {
    expect(previewKind({ name: 'notes.md', mimeType: 'text/markdown' })).toBe('markdown')
    expect(previewKind({ name: 'notes.markdown', mimeType: '' })).toBe('markdown')
    expect(previewKind({ name: 'notes.MD', mimeType: '' })).toBe('markdown')
    expect(previewKind({ name: 'notes.md', mimeType: 'application/octet-stream' })).toBe('markdown')
  })

  it('recognizes text/markdown mime type even without a .md extension', () => {
    expect(previewKind({ name: 'notes', mimeType: 'text/markdown' })).toBe('markdown')
  })

  it('recognizes any text/* mime type as the plain text kind', () => {
    expect(previewKind({ name: 'notes.txt', mimeType: 'text/plain' })).toBe('text')
    expect(previewKind({ name: 'script.sh', mimeType: 'text/x-shellscript' })).toBe('text')
  })

  it('falls back to a common text/code extension when the browser reported no MIME type or a generic one', () => {
    expect(previewKind({ name: 'notes.txt', mimeType: '' })).toBe('text')
    expect(previewKind({ name: 'data.json', mimeType: '' })).toBe('text')
    expect(previewKind({ name: 'config.yaml', mimeType: 'application/octet-stream' })).toBe('text')
    expect(previewKind({ name: 'script.sh', mimeType: '' })).toBe('text')
    expect(previewKind({ name: 'main.py', mimeType: '' })).toBe('text')
  })

  it('treats a dotfile with no further extension as plain text', () => {
    expect(previewKind({ name: '.bashrc', mimeType: '' })).toBe('text')
    expect(previewKind({ name: '.gitignore', mimeType: 'application/octet-stream' })).toBe('text')
  })

  it('falls back to a common image extension when the browser reported no MIME type or a generic one', () => {
    expect(previewKind({ name: 'photo.jpg', mimeType: '' })).toBe('image')
    expect(previewKind({ name: 'photo.jpeg', mimeType: '' })).toBe('image')
    expect(previewKind({ name: 'photo.png', mimeType: 'application/octet-stream' })).toBe('image')
    expect(previewKind({ name: 'photo.webp', mimeType: '' })).toBe('image')
    expect(previewKind({ name: 'photo.gif', mimeType: '' })).toBe('image')
    expect(previewKind({ name: 'photo.svg', mimeType: '' })).toBe('image')
  })

  it('does not treat an unknown-mime file with a non-text, non-image extension as previewable', () => {
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
    expect(isPreviewable({ name: '.bashrc', mimeType: '' })).toBe(true)
    expect(isPreviewable({ name: 'archive.zip', mimeType: 'application/zip' })).toBe(false)
  })
})
