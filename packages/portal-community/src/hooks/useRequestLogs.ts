import { useEffect, useState } from 'react';
import { getIncomingLogs } from '../lib/api/logs';
import type { RequestLogRow } from '../lib/api/types';

export function useRequestLogs() {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<RequestLogRow[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getIncomingLogs()
      .then((data) => {
        if (!cancelled) {
          setLogs(data);
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

  return { loading, logs, error };
}
