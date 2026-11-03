'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import Link from 'next/link';

export const AdvertisingCallback = ({ provider, state, code, error }: {
  provider: string; state?: string; code?: string; error?: string;
}) => {
  const fetch = useFetch();
  const started = useRef(false);
  const valid = ['meta', 'google'].includes(provider) && !!state;
  const [message, setMessage] = useState(valid ? 'Completing advertising authorization…' : 'Authorization is invalid. Return to Settings and reconnect.');
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Authorization codes/state must not remain in history, referrers or screenshots.
    window.history.replaceState(null, '', window.location.pathname);
    if (!valid) return;
    void (async () => {
      try {
        const response = await fetch(`/advertising/${provider}/callback`, {
          method: 'POST', body: JSON.stringify({ state, code, error }),
        });
        if (!response.ok) { setMessage('Authorization could not be completed. Check the workspace you started from, then reconnect.'); return; }
        setMessage('Connected. Return to Advertising Accounts to discover and select accounts.');
      } catch { setMessage('Authorization could not be completed. Return to Settings and reconnect.'); }
    })();
  }, [provider, state, code, error, fetch, valid]);
  return <div className="flex flex-col gap-4"><p role="status">{message}</p>
    <Link href="/settings?tab=advertising">Return to Advertising Accounts</Link></div>;
};
