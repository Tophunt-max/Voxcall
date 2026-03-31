import { Switch, Route, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Layout } from '@/components/Layout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Users from '@/pages/Users';
import Hosts from '@/pages/Hosts';
import Withdrawals from '@/pages/Withdrawals';
import CoinPlans from '@/pages/CoinPlans';
import CallSessions from '@/pages/CallSessions';
import FAQs from '@/pages/FAQs';
import TalkTopics from '@/pages/TalkTopics';
import CoinTransactions from '@/pages/CoinTransactions';
import Ratings from '@/pages/Ratings';
import Notifications from '@/pages/Notifications';
import SettingsPage from '@/pages/SettingsPage';
import LevelConfig from '@/pages/LevelConfig';
import HostApplications from '@/pages/HostApplications';

const queryClient = new QueryClient();
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

function ProtectedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <Layout>
      <Switch>
        <Route path="/" component={() => <Redirect to="/dashboard" />} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/users" component={Users} />
        <Route path="/hosts" component={Hosts} />
        <Route path="/calls" component={CallSessions} />
        <Route path="/ratings" component={Ratings} />
        <Route path="/withdrawals" component={Withdrawals} />
        <Route path="/coin-plans" component={CoinPlans} />
        <Route path="/transactions" component={CoinTransactions} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/talk-topics" component={TalkTopics} />
        <Route path="/faqs" component={FAQs} />
        <Route path="/level-config" component={LevelConfig} />
        <Route path="/host-applications" component={HostApplications} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={() => <Redirect to="/dashboard" />} />
      </Switch>
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter base={base}>
          <ProtectedApp />
        </WouterRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
