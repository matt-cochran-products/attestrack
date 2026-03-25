import { useEffect, useState } from 'react';
import { getSignalRecovery } from '../lib/api/signal';
import type { SignalRecoveryMetrics } from '../lib/api/types';

export function useSignalRecovery() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<SignalRecoveryMetrics | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSignalRecovery()
      .then((m) => {
        if (!cancelled) {
          setMetrics(m);
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
  }, []);

  return { loading, metrics, error };
}
