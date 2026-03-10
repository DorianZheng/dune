import { Static, Type } from '@sinclair/typebox'

export const SandboxActorType = Type.Union([
  Type.Literal('human'),
  Type.Literal('agent'),
  Type.Literal('system'),
])

export const SandboxPermission = Type.Union([
  Type.Literal('operate'),
  Type.Literal('read'),
])

export const SandboxDurability = Type.Union([
  Type.Literal('ephemeral'),
  Type.Literal('persistent'),
])

export const SandboxAclEntrySchema = Type.Object({
  sandboxId: Type.String(),
  principalType: SandboxActorType,
  principalId: Type.String(),
  permission: SandboxPermission,
})

export const SandboxOwnershipSchema = Type.Object({
  creatorType: SandboxActorType,
  creatorId: Type.String(),
  readOnly: Type.Boolean(),
  readOnlyReason: Type.Union([Type.String(), Type.Null()]),
})

export const BoxStatus = Type.Union([
  Type.Literal('configured'),
  Type.Literal('creating'),
  Type.Literal('running'),
  Type.Literal('stopping'),
  Type.Literal('stopped'),
  Type.Literal('unknown'),
  Type.Literal('error'),
])

export const VolumeSpecSchema = Type.Object({
  hostPath: Type.String(),
  guestPath: Type.String(),
  readOnly: Type.Optional(Type.Boolean()),
})

export const PortSpecSchema = Type.Object({
  hostPort: Type.Optional(Type.Number()),
  guestPort: Type.Number(),
  protocol: Type.Optional(Type.Union([Type.Literal('tcp'), Type.Literal('udp')])),
  hostIp: Type.Optional(Type.String()),
})

export const BoxDuneMetadataSchema = Type.Object({
  ownership: SandboxOwnershipSchema,
  sharedWith: Type.Array(SandboxAclEntrySchema),
  readOnly: Type.Boolean(),
  readOnlyReason: Type.Union([Type.String(), Type.Null()]),
  managedByAgent: Type.Boolean(),
  agentId: Type.Union([Type.String(), Type.Null()]),
})

export const BoxResourceSchema = Type.Object({
  boxId: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
  status: BoxStatus,
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
  startedAt: Type.Union([Type.Number(), Type.Null()]),
  stoppedAt: Type.Union([Type.Number(), Type.Null()]),
  image: Type.String(),
  cpus: Type.Number(),
  memoryMib: Type.Number(),
  diskSizeGb: Type.Number(),
  workingDir: Type.Union([Type.String(), Type.Null()]),
  env: Type.Record(Type.String(), Type.String()),
  entrypoint: Type.Array(Type.String()),
  cmd: Type.Array(Type.String()),
  user: Type.Union([Type.String(), Type.Null()]),
  volumes: Type.Array(VolumeSpecSchema),
  ports: Type.Array(PortSpecSchema),
  labels: Type.Record(Type.String(), Type.String()),
  autoRemove: Type.Boolean(),
  detach: Type.Boolean(),
  durability: SandboxDurability,
  _dune: BoxDuneMetadataSchema,
})

export const BoxCreateRequestSchema = Type.Object({
  name: Type.Optional(Type.String()),
  image: Type.Optional(Type.String()),
  cpus: Type.Optional(Type.Number()),
  memoryMib: Type.Optional(Type.Number()),
  diskSizeGb: Type.Optional(Type.Number()),
  workingDir: Type.Optional(Type.String()),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  entrypoint: Type.Optional(Type.Array(Type.String())),
  cmd: Type.Optional(Type.Array(Type.String())),
  user: Type.Optional(Type.String()),
  volumes: Type.Optional(Type.Array(VolumeSpecSchema)),
  ports: Type.Optional(Type.Array(PortSpecSchema)),
  labels: Type.Optional(Type.Record(Type.String(), Type.String())),
  autoRemove: Type.Optional(Type.Boolean()),
  detach: Type.Optional(Type.Boolean()),
  durability: Type.Optional(SandboxDurability),
  acl: Type.Optional(Type.Array(Type.Object({
    principalType: SandboxActorType,
    principalId: Type.String(),
    permission: SandboxPermission,
  }))),
})

export const BoxPatchRequestSchema = Type.Partial(Type.Object({
  name: Type.String(),
  labels: Type.Record(Type.String(), Type.String()),
  autoRemove: Type.Boolean(),
  durability: SandboxDurability,
  acl: Type.Array(Type.Object({
    principalType: SandboxActorType,
    principalId: Type.String(),
    permission: SandboxPermission,
  })),
}))

export const BoxListResponseSchema = Type.Object({
  boxes: Type.Array(BoxResourceSchema),
  nextPageToken: Type.Union([Type.String(), Type.Null()]),
})

export const BoxStatusResponseSchema = Type.Object({
  boxId: Type.String(),
  status: BoxStatus,
  startedAt: Type.Union([Type.Number(), Type.Null()]),
  stoppedAt: Type.Union([Type.Number(), Type.Null()]),
})

export const ExecStatus = Type.Union([
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('killed'),
  Type.Literal('timed_out'),
  Type.Literal('failed'),
])

export const ExecCreateRequestSchema = Type.Object({
  command: Type.String(),
  args: Type.Optional(Type.Array(Type.String())),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  timeoutSeconds: Type.Optional(Type.Number()),
  workingDir: Type.Optional(Type.String()),
  tty: Type.Optional(Type.Boolean()),
})

export const ExecResourceSchema = Type.Object({
  executionId: Type.String(),
  boxId: Type.String(),
  status: ExecStatus,
  command: Type.String(),
  args: Type.Array(Type.String()),
  env: Type.Record(Type.String(), Type.String()),
  timeoutSeconds: Type.Union([Type.Number(), Type.Null()]),
  workingDir: Type.Union([Type.String(), Type.Null()]),
  tty: Type.Boolean(),
  createdAt: Type.Number(),
  startedAt: Type.Union([Type.Number(), Type.Null()]),
  completedAt: Type.Union([Type.Number(), Type.Null()]),
  durationMs: Type.Union([Type.Number(), Type.Null()]),
  exitCode: Type.Union([Type.Number(), Type.Null()]),
  errorMessage: Type.Union([Type.String(), Type.Null()]),
  stdout: Type.String(),
  stderr: Type.String(),
})

export const ExecListResponseSchema = Type.Object({
  execs: Type.Array(ExecResourceSchema),
})

export const ExecEventType = Type.Union([
  Type.Literal('stdout'),
  Type.Literal('stderr'),
  Type.Literal('exit'),
  Type.Literal('info'),
  Type.Literal('error'),
])

export const ExecEventSchema = Type.Object({
  executionId: Type.String(),
  seq: Type.Number(),
  timestamp: Type.Number(),
  eventType: ExecEventType,
  data: Type.String(),
})

export const FileUploadRequestSchema = Type.Object({
  path: Type.String(),
  contentBase64: Type.String(),
  overwrite: Type.Optional(Type.Boolean()),
})

export const FileDownloadResponseSchema = Type.Object({
  path: Type.String(),
  contentBase64: Type.String(),
  size: Type.Number(),
})

export const SandboxFsEntryType = Type.Union([
  Type.Literal('file'),
  Type.Literal('directory'),
  Type.Literal('symlink'),
  Type.Literal('other'),
])

export const SandboxFsEntrySchema = Type.Object({
  path: Type.String(),
  name: Type.String(),
  type: SandboxFsEntryType,
  size: Type.Union([Type.Number(), Type.Null()]),
  modifiedAt: Type.Union([Type.Number(), Type.Null()]),
  hidden: Type.Boolean(),
})

export const SandboxFsListResponseSchema = Type.Object({
  path: Type.String(),
  parentPath: Type.Union([Type.String(), Type.Null()]),
  entries: Type.Array(SandboxFsEntrySchema),
  truncated: Type.Boolean(),
})

export const SandboxFsReadResponseSchema = Type.Object({
  path: Type.String(),
  size: Type.Number(),
  contentBase64: Type.String(),
  truncated: Type.Boolean(),
  mimeType: Type.Union([Type.String(), Type.Null()]),
})

export const SandboxFsMkdirRequestSchema = Type.Object({
  path: Type.String(),
  recursive: Type.Optional(Type.Boolean()),
})

export const SandboxFsMoveRequestSchema = Type.Object({
  fromPath: Type.String(),
  toPath: Type.String(),
  overwrite: Type.Optional(Type.Boolean()),
})

export const HostImportRequestSchema = Type.Object({
  hostPath: Type.String(),
  destPath: Type.String(),
})

export type SandboxActorTypeType = Static<typeof SandboxActorType>
export type SandboxPermissionType = Static<typeof SandboxPermission>
export type SandboxDurabilityType = Static<typeof SandboxDurability>
export type SandboxAclEntry = Static<typeof SandboxAclEntrySchema>
export type SandboxOwnership = Static<typeof SandboxOwnershipSchema>
export type BoxStatusType = Static<typeof BoxStatus>
export type VolumeSpec = Static<typeof VolumeSpecSchema>
export type PortSpec = Static<typeof PortSpecSchema>
export type BoxDuneMetadata = Static<typeof BoxDuneMetadataSchema>
export type BoxResource = Static<typeof BoxResourceSchema>
export type BoxCreateRequest = Static<typeof BoxCreateRequestSchema>
export type BoxPatchRequest = Static<typeof BoxPatchRequestSchema>
export type BoxListResponse = Static<typeof BoxListResponseSchema>
export type BoxStatusResponse = Static<typeof BoxStatusResponseSchema>
export type ExecStatusType = Static<typeof ExecStatus>
export type ExecCreateRequest = Static<typeof ExecCreateRequestSchema>
export type ExecResource = Static<typeof ExecResourceSchema>
export type ExecListResponse = Static<typeof ExecListResponseSchema>
export type ExecEventTypeType = Static<typeof ExecEventType>
export type ExecEvent = Static<typeof ExecEventSchema>
export type FileUploadRequest = Static<typeof FileUploadRequestSchema>
export type FileDownloadResponse = Static<typeof FileDownloadResponseSchema>
export type SandboxFsEntryTypeType = Static<typeof SandboxFsEntryType>
export type SandboxFsEntry = Static<typeof SandboxFsEntrySchema>
export type SandboxFsListResponse = Static<typeof SandboxFsListResponseSchema>
export type SandboxFsReadResponse = Static<typeof SandboxFsReadResponseSchema>
export type SandboxFsMkdirRequest = Static<typeof SandboxFsMkdirRequestSchema>
export type SandboxFsMoveRequest = Static<typeof SandboxFsMoveRequestSchema>
export type HostImportRequest = Static<typeof HostImportRequestSchema>
