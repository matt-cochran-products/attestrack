import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getSiteConfig } from '../lib/api/configuration';
import type { SiteConfig } from '../lib/api/types';

export interface AnalyticsDateRange {
  dateFrom: string;
  dateTo: string;
}

const defaultRange = (): AnalyticsDateRange => {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
  };
};

export interface PortalShellValue {
  siteConfig: SiteConfig | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  analyticsRange: AnalyticsDateRange;
  setAnalyticsRange: (r: AnalyticsDateRange) => void;
  /** PORTAL.3 — human-readable mode for shell */
  modeShellLabel: string;
  modeTone: 'shadow' | 'enforcement' | 'amber';
}

const PortalShellContext = createContext<PortalShellValue | null>(null);

export function PortalShellProvider({ children }: { children: ReactNode }) {
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsDateRange>(defaultRange);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cfg = await getSiteConfig();
      setSiteConfig(cfg);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const { modeShellLabel, modeTone } = useMemo(() => {
    if (!siteConfig) {
      return { modeShellLabel: '…', modeTone: 'amber' as const };
    }
    if (siteConfig.mode === 'ENFORCEMENT') {
      return { modeShellLabel: 'ENFORCEMENT ACTIVE', modeTone: 'enforcement' as const };
    }
    if (siteConfig.mode === 'SHADOW') {
      return { modeShellLabel: 'SHADOW MODE', modeTone: 'shadow' as const };
    }
    return {
      modeShellLabel: 'SHADOW MODE — CONSENT NOT CONFIGURED',
      modeTone: 'amber' as const,
    };
  }, [siteConfig]);

  const value: PortalShellValue = {
    siteConfig,
    loading,
    error,
    refresh,
    analyticsRange,
    setAnalyticsRange,
    modeShellLabel,
    modeTone,
  };

  return <PortalShellContext.Provider value={value}>{children}</PortalShellContext.Provider>;
}

export function usePortalShell(): PortalShellValue {
  const ctx = useContext(PortalShellContext);
  if (!ctx) {
    throw new Error('usePortalShell must be used within PortalShellProvider');
  }
  return ctx;
}
