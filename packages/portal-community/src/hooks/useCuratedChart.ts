import { useEffect, useState } from 'react';
import type { CuratedChartId } from '@attestrack/types';
import { getCuratedChart } from '../lib/api/analytics';
import type { CuratedChart } from '../lib/api/types';
import { usePortalShell } from '../context/PortalShellContext';

/**
 * One hook instance per curated chart: each card fetches independently so a
 * slow query on one chart never delays the others (ANA.6). The date range is
 * session-global via PortalShellContext (ANA.5).
 */
export function useCuratedChart(chartId: CuratedChartId) {
  const { analyticsRange } = usePortalShell();
  const [loading, setLoading] = useState(true);
  const [chart, setChart] = useState<CuratedChart | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCuratedChart(chartId, analyticsRange)
      .then((c) => {
        if (!cancelled) {
          setChart(c);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chartId, analyticsRange]);

  return { loading, chart, error };
}
