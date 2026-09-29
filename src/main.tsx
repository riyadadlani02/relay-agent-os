import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
const workspace =
  import.meta.env.MODE !== 'pages' && new URLSearchParams(location.search).has('workspace');
const Entry = lazy(() => (workspace ? import('./WorkspaceEntry') : import('./site/Site')));
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense
      fallback={
        <div
          style={{
            padding: 40,
            fontFamily: 'monospace',
            background: '#b5bea0',
            minHeight: '100vh',
          }}
        >
          RELAY OS / INITIALIZING…
        </div>
      }
    >
      <Entry />
    </Suspense>
  </React.StrictMode>,
);
