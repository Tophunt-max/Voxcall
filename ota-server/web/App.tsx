import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch } from 'wouter';
import { Toaster } from 'sonner';
import { getToken, setToken, setUnauthorizedHandler, type AppId } from '@/lib/api';
import { ScopeContext } from '@/scope';
import { Layout } from '@/components/Layout';
import { Login } from '@/pages/Login';
import { Overview } from '@/pages/Overview';
import { Updates } from '@/pages/Updates';
import { Channels } from '@/pages/Channels';
import { Downloads } from '@/pages/Downloads';

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [app, setApp] = useState<AppId>('user');
  const qc = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } }),
    [],
  );

  function logout() {
    setToken('');
    qc.clear();
    setAuthed(false);
  }

  useEffect(() => {
    setUnauthorizedHandler(logout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc]);

  return (
    <QueryClientProvider client={qc}>
      <Toaster theme="dark" position="bottom-center" richColors />
      {!authed ? (
        <Login onSuccess={() => setAuthed(true)} />
      ) : (
        <ScopeContext.Provider value={{ app, setApp }}>
          <Layout onLogout={logout}>
            <Switch>
              <Route path="/" component={Overview} />
              <Route path="/updates" component={Updates} />
              <Route path="/channels" component={Channels} />
              <Route path="/downloads" component={Downloads} />
              <Route component={Overview} />
            </Switch>
          </Layout>
        </ScopeContext.Provider>
      )}
    </QueryClientProvider>
  );
}
