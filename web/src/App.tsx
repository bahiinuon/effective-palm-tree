import { useEffect, useState } from 'react';
import RequestFlow from './components/RequestFlow';
import StatusLookup from './components/StatusLookup';
import Admin from './components/Admin';

type Route = 'request' | 'status' | 'admin';

function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (hash === 'status') return 'status';
  if (hash === 'admin') return 'admin';
  return 'request';
}

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <div className="app">
      <header className="site-header">
        <a className="wordmark" href="#/">
          Songs on request
        </a>
        <nav>
          <a className={route === 'request' ? 'active' : ''} href="#/">
            Commission
          </a>
          <a className={route === 'status' ? 'active' : ''} href="#/status">
            Check a request
          </a>
        </nav>
      </header>

      <main>
        {route === 'request' && <RequestFlow />}
        {route === 'status' && <StatusLookup />}
        {route === 'admin' && <Admin />}
      </main>

      <footer className="site-footer">
        <p>
          Every song is written from scratch for one person. Nothing is charged until we've agreed
          the brief.
        </p>
        <a href="#/admin">Artist login</a>
      </footer>
    </div>
  );
}
