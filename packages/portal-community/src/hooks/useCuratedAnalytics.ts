import { useEffect, useState } from 'react';
import { getAnalyticsWarehouseStatus, getCuratedAnalyticsCharts } from '../lib/api/analytics';
import type { AnalyticsChartSeries } from '../lib/api/analytics';
import type { WarehouseStatus } from '../lib/api/analytics';
import { usePortalShell } from '../context/PortalShellContext';

export function useCuratedAnalytics() {
  const { analyticsRange } = usePortalShell();
  const [loading, setLoading] = useState(true);
  const [charts, setCharts] = useState<AnalyticsChartSeries[]>([]);
  const [warehouse, setWarehouse] = useState<WarehouseStatus | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getCuratedAnalyticsCharts(analyticsRange),
      getAnalyticsWarehouseStatus(),
    ])
      .then(([c, w]) => {
        if (!cancelled) {
          setCharts(c);
          setWarehouse(w);
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
  }, [analyticsRange]);

  return { loading, charts, warehouse, error };
}
