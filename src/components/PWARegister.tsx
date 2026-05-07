'use client';

import { useEffect } from 'react';

export function PWARegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(() => undefined);
    };

    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad);

    return () => window.removeEventListener('load', onLoad);
  }, []);

  return null;
}
