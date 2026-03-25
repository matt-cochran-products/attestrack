import { paths } from '../paths';

/**
 * Attestrack ships analytics + server-side measurement only.
 * Consent runtime, regulation UI, proof, and counsel workflows are Attestrue extensions (CDN + edge cache).
 */
export default function ExtensionsPage() {
  return (
    <div className="p-8 max-w-2xl">
      <h1 className="font-mono text-lg text-[var(--text-active)] mb-4">Attestrue extensions</h1>
      <p className="font-mono text-[12px] text-[var(--text-muted)] leading-relaxed mb-6">
        Privacy consent, regulation configuration, independently witnessed records, and counsel portals are not part of
        open-source Attestrack. They are activated as licensed extensions: artifacts are published on the Attestrue CDN,
        cached on your Worker, and served first-party to visitors (see ADR-010).
      </p>
      <p className="font-mono text-[12px] text-[var(--text-muted)] leading-relaxed mb-6">
        Use your deployment&apos;s Extensions flow or visit{' '}
        <a
          href="https://attestrue.com/upgrade"
          className="text-[var(--accent-green)] underline"
          target="_blank"
          rel="noreferrer"
        >
          attestrue.com
        </a>{' '}
        when you are ready to add those capabilities.
      </p>
      <a
        href={paths.upgrade}
        className="inline-block font-mono text-[11px] px-4 py-2 border border-[rgba(255,255,255,0.15)] rounded hover:border-[var(--accent-green)]"
      >
        Open upgrade handoff →
      </a>
    </div>
  );
}
