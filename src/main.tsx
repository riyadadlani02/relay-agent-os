import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
const workspace =
  import.meta.env.MODE !== 'pages' && new URLSearchParams(location.search).has('workspace');
const playground = new URLSearchParams(location.search).has('playground');
const LivePlayground = lazy(() => import('./playground/Playground'));
const Site = lazy(() => import('./site/Site'));
const Workspace = import.meta.env.MODE !== 'pages' ? lazy(() => import('./WorkspaceEntry')) : Site;
const Payments =
  import.meta.env.MODE !== 'pages' ? lazy(() => import('./connectors/Payments')) : Site;
const paymentDemo =
  import.meta.env.MODE !== 'pages' && new URLSearchParams(location.search).has('payments');
const Entry = paymentDemo ? Payments : playground ? LivePlayground : workspace ? Workspace : Site;
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
