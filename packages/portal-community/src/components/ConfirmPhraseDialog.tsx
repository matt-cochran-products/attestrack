import { useEffect, useState } from 'react';

export interface ConfirmPhraseDialogProps {
  open: boolean;
  title: string;
  description: string;
  phrase: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmPhraseDialog({
  open,
  title,
  description,
  phrase,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: ConfirmPhraseDialogProps) {
  const [input, setInput] = useState('');

  useEffect(() => {
    if (!open) {
      setInput('');
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const match = input === phrase;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card-surface max-w-lg w-full p-6 border border-[var(--border-card)]"
      >
        <div className="font-mono text-sm text-[var(--text-active)] uppercase tracking-wide mb-2">{title}</div>
        <p className="font-sans text-[13px] text-[var(--text-muted)] leading-relaxed mb-4">{description}</p>
        <p className="font-mono text-[11px] text-[var(--accent-amber)] mb-2">
          Type <span className="text-[var(--text-active)]">{phrase}</span> to confirm.
        </p>
        <input
          value={input}
          aria-label={`Type ${phrase} to confirm`}
          onChange={(e) => setInput(e.target.value)}
          className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.15)] p-2 font-mono text-[11px] text-[var(--text-active)] mb-4"
          autoComplete="off"
        />
        <div className="flex gap-3 justify-end">
          <button type="button" className="btn-secondary text-[10px]" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-primary text-[10px]" disabled={!match} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
