// Thin wrapper around @zudar107/schloss-ui's config-driven API client -
// `apiClient` (the raw instance) is also exported so hooks/useAuth.ts can
// share the exact same token state via useAuthProvider's `apiClient` config.
import { createApiClient, ApiError } from '@zudar107/schloss-ui'
import { buildSchluesselLoginUrl } from './authRedirect'

export { ApiError }

export const apiClient = createApiClient({
  base: '/backend',
  // A background request's own refresh-and-retry both failed - the
  // session is genuinely gone, so send the browser to schlussel's
  // hosted login (PKCE) rather than a local /login route this app
  // doesn't have.
  onUnauthorized: () => {
    void buildSchluesselLoginUrl(window.location.pathname).then((url) => {
      window.location.href = url
    })
  },
})

export const setAccessToken = apiClient.setAccessToken
export const getAccessToken = apiClient.getAccessToken

export const api = {
  get: apiClient.get,
  post: apiClient.post,
  put: apiClient.put,
  patch: apiClient.patch,
  delete: apiClient.delete,
}

export interface FolderSummary {
  id: string
  name: string
  parentId: string | null
  createdAt: string
}

export interface FileSummary {
  id: string
  name: string
  folderId: string | null
  mimeType: string
  sizeBytes: number
  createdAt: string
  updatedAt: string
}

export interface FolderContents {
  folder: FolderSummary | null
  ancestors: FolderSummary[]
  folders: FolderSummary[]
  files: FileSummary[]
}

export function getFolderContents(id: string | null): Promise<FolderContents> {
  return api.get(id ? `/folders/${encodeURIComponent(id)}` : '/folders/root')
}

export function createFolder(input: { name: string; parentId: string | null }): Promise<FolderSummary> {
  return api.post('/folders', input)
}

export function updateFolder(id: string, input: { name?: string; parentId?: string | null }): Promise<FolderSummary> {
  return api.patch(`/folders/${encodeURIComponent(id)}`, input)
}

export function deleteFolder(id: string): Promise<{ ok: true }> {
  return api.delete(`/folders/${encodeURIComponent(id)}`)
}

export function updateFile(id: string, input: { name?: string; folderId?: string | null }): Promise<FileSummary> {
  return api.patch(`/files/${encodeURIComponent(id)}`, input)
}

export function deleteFile(id: string): Promise<{ ok: true }> {
  return api.delete(`/files/${encodeURIComponent(id)}`)
}

export function fileContentUrl(id: string): string {
  return `/backend/files/${encodeURIComponent(id)}/content`
}

// Bypasses the shared apiClient - it always JSON.stringifies the body and
// forces Content-Type: application/json, neither of which works for a
// multipart upload (the correct Content-Type, including its boundary
// parameter, has to come from FormData's own encoding, not a hardcoded
// header). Skips the client's automatic refresh-on-401 retry as a
// result; a stale token here just fails the upload once rather than
// transparently retrying, which is an acceptable simplification for
// this one endpoint - a normal page visit already refreshes the token
// well before a user gets around to uploading something.
export async function uploadFile(file: File, folderId: string | null): Promise<FileSummary> {
  const formData = new FormData()
  formData.append('file', file)
  if (folderId) formData.append('folderId', folderId)

  const token = getAccessToken()
  const res = await fetch('/backend/files', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: formData,
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json() as Promise<FileSummary>
}

// Same reasoning as uploadFile above - a plain <img>/<a href> can't carry
// a bearer token, so downloading/previewing needs an authenticated fetch
// first, turning the response into a blob URL the browser can actually
// load.
export async function fetchFileBlob(id: string): Promise<Blob> {
  const token = getAccessToken()
  const res = await fetch(fileContentUrl(id), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.blob()
}

export interface UsageSummary {
  usedBytes: number
  limitBytes: number
}

export function getUsage(): Promise<UsageSummary> {
  return api.get('/usage')
}
