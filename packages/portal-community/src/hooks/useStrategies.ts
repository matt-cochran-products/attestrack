import { useCallback, useEffect, useState } from 'react';
import { listStrategies, toggleStrategy } from '../lib/api/strategies';
import type { StrategiesResponse } from '../lib/api/types';

export function useStrategies() {
  const [loading, setLoading] = useState(true);
  const [strategies, setStrategies] = useState<StrategiesResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    return listStrategies()
      .then((data) => {
        setStrategies(data);
        setError(null);
      })
      .catch((e) => {
        setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      await toggleStrategy(id, enabled);
      await reload();
    },
    [reload],
  );

  return { loading, strategies, error, reload, setEnabled };
}
