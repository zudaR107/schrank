import { useState, type ReactNode } from 'react'
import { Field, Modal } from '@zudar107/schloss-ui'

export interface NameModalProps {
  open: boolean
  title: string
  icon: ReactNode
  initialName?: string
  submitLabel: string
  pendingLabel: string
  onClose: () => void
  onSubmit: (name: string) => void
  pending: boolean
  error: string | null
}

// Shared by "New folder" (initialName omitted) and "Rename" (initialName
// set to the item's current name). The caller must render this with
// `key={target.id}` when reusing it for rename across different items
// (see FilesPage) so switching targets remounts it with a fresh `name`
// state, rather than carrying over whatever was last typed for the
// previous item.
export function NameModal({
  open, title, icon, initialName = '', submitLabel, pendingLabel, onClose, onSubmit, pending, error,
}: NameModalProps) {
  const [name, setName] = useState(initialName)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      icon={icon}
      actions={[
        { label: 'Отмена', onClick: onClose, variant: 'secondary' },
        { label: pending ? pendingLabel : submitLabel, onClick: () => onSubmit(name.trim()), variant: 'primary' },
      ]}
    >
      <Field
        label="Название"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        disabled={pending}
        maxLength={200}
        error={error ?? undefined}
      />
    </Modal>
  )
}
