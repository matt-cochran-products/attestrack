// @vitest-environment jsdom
/**
 * P6.4 — confirmation dialog contracts (destructive-action guards) plus
 * component-level axe scans (P6.5). Browser-level a11y runs in e2e/journeys.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { ConfirmActionDialog } from './ConfirmActionDialog';
import { ConfirmPhraseDialog } from './ConfirmPhraseDialog';

function severeViolations(results: Awaited<ReturnType<typeof axe>>) {
  return results.violations
    .filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.description}`);
}

describe('ConfirmActionDialog', () => {
  afterEach(cleanup);

  it('renders nothing when closed', () => {
    render(
      <ConfirmActionDialog
        open={false}
        title="Disable strategy"
        body="This stops delivery."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a labeled modal dialog; Confirm and Cancel invoke the right callbacks', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmActionDialog
        open
        title="Disable strategy"
        body="This stops delivery."
        confirmLabel="Disable"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Disable strategy' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('has no serious/critical axe violations', async () => {
    const { container } = render(
      <ConfirmActionDialog
        open
        title="Disable strategy"
        body="This stops delivery."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(severeViolations(await axe(container))).toEqual([]);
  });
});

describe('ConfirmPhraseDialog', () => {
  afterEach(cleanup);

  it('keeps Confirm disabled until the exact phrase is typed', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmPhraseDialog
        open
        title="Delete saved query"
        description="This cannot be undone."
        phrase="DELETE"
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'delete' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'DELETE' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('clears the typed phrase when reopened (no pre-armed confirm)', () => {
    const { rerender } = render(
      <ConfirmPhraseDialog
        open
        title="Delete saved query"
        description="d"
        phrase="DELETE"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE' } });
    rerender(
      <ConfirmPhraseDialog
        open={false}
        title="Delete saved query"
        description="d"
        phrase="DELETE"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    rerender(
      <ConfirmPhraseDialog
        open
        title="Delete saved query"
        description="d"
        phrase="DELETE"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('has no serious/critical axe violations', async () => {
    const { container } = render(
      <ConfirmPhraseDialog
        open
        title="Delete saved query"
        description="This cannot be undone."
        phrase="DELETE"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(severeViolations(await axe(container))).toEqual([]);
  });
});
