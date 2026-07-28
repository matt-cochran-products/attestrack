import { Toaster as Sonner, type ToasterProps } from 'sonner';

export function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-[var(--bg-card)] group-[.toaster]:text-[var(--text-active)] group-[.toaster]:border-[var(--border-card)] group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-[var(--text-muted)]',
          actionButton: 'group-[.toast]:bg-[var(--red)] group-[.toast]:text-white',
          cancelButton:
            'group-[.toast]:bg-[rgba(255,255,255,0.1)] group-[.toast]:text-[var(--text-muted)]',
        },
      }}
      {...props}
    />
  );
}
