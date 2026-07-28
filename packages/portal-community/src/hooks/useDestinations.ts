import { useEffect, useState } from 'react';
import { getAlertRules, listDestinations } from '../lib/api/destinations';
import type { AlertRule, DestinationRow } from '../lib/api/types';

export function useDestinations() {
  const [loading, setLoading] = useState(true);
  const [destinations, setDestinations] = useState<DestinationRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([listDestinations(), getAlertRules()])
      .then(([dests, rules]) => {
        if (!cancelled) {
          setDestinations(dests);
          setAlerts(rules);
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

  return { loading, destinations, alerts, error };
}
