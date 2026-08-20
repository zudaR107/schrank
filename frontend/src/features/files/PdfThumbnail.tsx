import { useEffect, useRef, useState } from 'react'
import { File as FileIcon } from 'lucide-react'
import type { RenderTask } from 'pdfjs-dist'
import { fetchFileBlob } from '../../lib/api'

// Rendered once at this pixel width (whatever the page's own aspect
// ratio is), then displayed via CSS object-fit: cover - a real
// thumbnail of the actual first page, not the browser's own PDF
// viewer chrome shrunk to fit (which is what an <iframe>/<embed>
// shows: its toolbar, search box, and outline panel, not the document -
// the #toolbar=0 open-parameter convention several browsers used to
// honor is no longer respected by current Chrome/Firefox).
const THUMBNAIL_TARGET_WIDTH = 300

// pdf.js is a large library only ever needed once a PDF actually needs
// rendering (most folders have none) - dynamically imported rather than
// bundled into the app's main chunk, and the worker script wired up
// exactly once regardless of how many PdfThumbnail instances mount.
let pdfjsReady: Promise<typeof import('pdfjs-dist')> | undefined
function loadPdfjs() {
  pdfjsReady ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjsLib, worker]) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjsLib
  })
  return pdfjsReady
}

export function PdfThumbnail({ fileId, name }: { fileId: string; name: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let renderTask: RenderTask | null = null
    setFailed(false)

    Promise.all([loadPdfjs(), fetchFileBlob(fileId)])
      .then(async ([{ getDocument }, blob]) => {
        if (cancelled) return
        const data = new Uint8Array(await blob.arrayBuffer())
        const pdf = await getDocument({ data }).promise
        if (cancelled) return
        const page = await pdf.getPage(1)
        if (cancelled) return

        const unscaledViewport = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: THUMBNAIL_TARGET_WIDTH / unscaledViewport.width })
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')
        if (!canvas || !context || cancelled) return
        canvas.width = viewport.width
        canvas.height = viewport.height

        renderTask = page.render({ canvas, canvasContext: context, viewport })
        await renderTask.promise
      })
      .catch(() => { if (!cancelled) setFailed(true) })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [fileId])

  if (failed) return <FileIcon size={40} color="var(--accent)" strokeWidth={1.5} />
  return (
    <canvas
      ref={canvasRef}
      aria-label={name}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  )
}
