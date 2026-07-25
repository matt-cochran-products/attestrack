export interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmActionDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card-surface max-w-lg w-full p-6 border border-[var(--border-card)]"
      >
        <div className="font-mono text-sm text-[var(--text-active)] uppercase tracking-wide mb-2">{title}</div>
        <p className="font-sans text-[13px] text-[var(--text-muted)] leading-relaxed mb-6">{body}</p>
        <div className="flex gap-3 justify-end">
          <button type="button" className="btn-secondary text-[10px]" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-primary text-[10px]" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
