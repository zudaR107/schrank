import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

// Purely additive/descriptive: this file only describes the API surface
// already implemented under src/features/*/router.ts. It has zero
// effect on runtime request validation - deleting it wouldn't change
// any endpoint's behavior. Grows alongside the folders/files feature in
// a later stage; this is the bootstrap-only surface.

const registry = new OpenAPIRegistry()

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
})
registry.registerComponent('securitySchemes', 'exportDelegationAuth', {
  type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
  description: 'Schlüssel export delegation scoped to audience hof-service:schrank and data:export.',
})
registry.registerComponent('securitySchemes', 'hofHmac', {
  type: 'apiKey', in: 'header', name: 'X-Hof-Signature',
  description: '64-character hexadecimal HMAC-SHA-256 over timestamp, uppercase method, path with query, SHA-256 of the exact body bytes, key id, and source (newline-delimited). Also requires X-Hof-Service, X-Hof-Key-Id, and X-Hof-Timestamp.',
})

const BEARER = [{ bearerAuth: [] }]

const errorResponseSchema = z.object({ error: z.string() })

const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  weekStart: z.enum(['monday', 'sunday']).nullable(),
  dateFormat: z.enum(['dmy', 'mdy', 'ymd']).nullable(),
  timezone: z.string().nullable(),
})

registry.registerPath({
  method: 'get', path: '/users/me', tags: ['users'], summary: 'Get the current user', security: BEARER,
  responses: { 200: { description: 'Current user', content: { 'application/json': { schema: userResponseSchema } } } },
})

const folderResponseSchema = z.object({
  id: z.string(), name: z.string(), parentId: z.string().nullable(), createdAt: z.iso.datetime(),
})
const fileResponseSchema = z.object({
  id: z.string(), name: z.string(), folderId: z.string().nullable(), mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
})
const folderWithCountResponseSchema = folderResponseSchema.extend({
  itemCount: z.number().int().nonnegative(),
})
const folderContentsResponseSchema = z.object({
  folder: folderResponseSchema.nullable(),
  ancestors: z.array(folderResponseSchema),
  folders: z.array(folderWithCountResponseSchema),
  files: z.array(fileResponseSchema),
})
const folderCreateSchema = z.object({ name: z.string().min(1).max(200), parentId: z.string().nullable() })
const folderUpdateSchema = z.object({ name: z.string().min(1).max(200).optional(), parentId: z.string().nullable().optional() })
const fileUpdateSchema = z.object({ name: z.string().min(1).max(200).optional(), folderId: z.string().nullable().optional() })

registry.registerPath({
  method: 'get', path: '/folders/root', tags: ['folders'], summary: "List the caller's root folder contents", security: BEARER,
  responses: { 200: { description: 'Root contents', content: { 'application/json': { schema: folderContentsResponseSchema } } } },
})
registry.registerPath({
  method: 'get', path: '/folders/{id}', tags: ['folders'], summary: 'Get a folder and its contents', security: BEARER,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Folder, its breadcrumb ancestors, and contents', content: { 'application/json': { schema: folderContentsResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})
registry.registerPath({
  method: 'post', path: '/folders', tags: ['folders'], summary: 'Create a folder', security: BEARER,
  request: { body: { content: { 'application/json': { schema: folderCreateSchema } } } },
  responses: {
    201: { description: 'Created folder', content: { 'application/json': { schema: folderResponseSchema } } },
    404: { description: 'Parent folder not found', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Name already taken in that location', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})
registry.registerPath({
  method: 'patch', path: '/folders/{id}', tags: ['folders'], summary: 'Rename or move a folder', security: BEARER,
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: folderUpdateSchema } } } },
  responses: {
    200: { description: 'Updated folder', content: { 'application/json': { schema: folderResponseSchema } } },
    400: { description: 'Would move the folder into itself or a descendant', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Folder or target parent not found', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Name already taken in that location', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})
registry.registerPath({
  method: 'delete', path: '/folders/{id}', tags: ['folders'], summary: 'Recursively delete a folder', security: BEARER,
  description: 'Deletes the folder, every descendant folder/file, and their bytes on disk.',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted' },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})

registry.registerPath({
  method: 'post', path: '/files', tags: ['files'], summary: 'Upload a file', security: BEARER,
  description: 'multipart/form-data with a "file" field and an optional "folderId" field (absent/empty means root).',
  responses: {
    201: { description: 'Created file', content: { 'application/json': { schema: fileResponseSchema } } },
    404: { description: 'Folder not found', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Name already taken in that location', content: { 'application/json': { schema: errorResponseSchema } } },
    413: { description: 'Over the per-file size limit or the account storage quota', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})
registry.registerPath({
  method: 'get', path: '/files/{id}', tags: ['files'], summary: 'Get file metadata', security: BEARER,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'File metadata', content: { 'application/json': { schema: fileResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})
registry.registerPath({
  method: 'get', path: '/files/{id}/content', tags: ['files'], summary: 'Download the file bytes', security: BEARER,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Raw file bytes, with the stored Content-Type' },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})
registry.registerPath({
  method: 'patch', path: '/files/{id}', tags: ['files'], summary: 'Rename or move a file', security: BEARER,
  request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: fileUpdateSchema } } } },
  responses: {
    200: { description: 'Updated file', content: { 'application/json': { schema: fileResponseSchema } } },
    404: { description: 'File or target folder not found', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Name already taken in that location', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})
registry.registerPath({
  method: 'delete', path: '/files/{id}', tags: ['files'], summary: 'Delete a file', security: BEARER,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Deleted' },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})

registry.registerPath({
  method: 'get', path: '/usage', tags: ['usage'], summary: "Get the caller's storage usage and limit", security: BEARER,
  responses: {
    200: {
      description: 'Usage',
      content: { 'application/json': { schema: z.object({ usedBytes: z.number().int().nonnegative(), limitBytes: z.number().int().positive() }) } },
    },
  },
})

registry.registerPath({
  method: 'get', path: '/exports/me', tags: ['exports'], summary: "Export the caller's folder tree and file metadata",
  description: 'Metadata only (names, sizes, mime types, timestamps) - never file content.',
  security: [{ bearerAuth: [] }, { exportDelegationAuth: [] }],
  responses: {
    200: {
      description: 'Versioned Schrank export envelope',
      content: {
        'application/json': {
          schema: z.object({
            version: z.literal('1'), service: z.literal('schrank'), exportedAt: z.iso.datetime(),
            data: z.object({ folders: z.array(folderResponseSchema), files: z.array(fileResponseSchema) }),
          }),
        },
      },
    },
    401: { description: 'Missing, invalid, expired, or incorrectly scoped token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
})

const zettelSyncEventSchema = z.object({
  version: z.literal('1'), id: z.uuid(), type: z.enum(['zettel.note.mirrored.v1', 'zettel.note.unmirrored.v1']),
  source: z.literal('zettel'), occurredAt: z.iso.datetime(), correlationId: z.uuid(), payload: z.unknown(),
})

registry.registerPath({
  method: 'post', path: '/internal/v1/events', tags: ['internal'], summary: 'Accept a signed note-sync event from Zettel',
  description: 'Authenticates the exact request body bytes and the configured Zettel producer identity before mirroring or removing the corresponding .md file in the well-known "zettel" folder. A new event returns 202, an exact byte-for-byte replay of the same event id returns 200, and identity reuse with different bytes returns 409.',
  security: [{ hofHmac: [] }],
  request: { body: { content: { 'application/json': { schema: zettelSyncEventSchema } } } },
  responses: {
    202: { description: 'Durably applied as a new inbox event' },
    200: { description: 'Exact duplicate; no second mutation was applied' },
    400: { description: 'Invalid JSON, envelope, or payload' },
    401: { description: 'Missing, malformed, stale, or invalid signature' },
    403: { description: 'Source producer is not configured' },
    409: { description: 'The event id already exists with different exact body bytes' },
    413: { description: 'Request body exceeds the configured event limit' },
  },
})

export const openApiDocument = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.0',
  info: { title: 'Schrank API', version: '0.1.0' },
  servers: [{ url: '/' }],
})
