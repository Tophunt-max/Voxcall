// FIX #13: Route-level lazy loading — all 30+ pages now load on demand
// Reduces initial JS bundle size dramatically, improving first-load performance
import { Suspense, lazy } from 'react';
import { Switch, Route, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Layout } from '@/components/Layout';
import { Toaster } from '@/components/ui/sonner';
import Login from '@/pages/Login';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Users = lazy(() => import('@/pages/Users'));
const Hosts = lazy(() => import('@/pages/Hosts'));
const Withdrawals = lazy(() => import('@/pages/Withdrawals'));
const CoinPlans = lazy(() => import('@/pages/CoinPlans'));
const CallSessions = lazy(() => import('@/pages/CallSessions'));
const FAQs = lazy(() => import('@/pages/FAQs'));
const TalkTopics = lazy(() => import('@/pages/TalkTopics'));
const CoinTransactions = lazy(() => import('@/pages/CoinTransactions'));
const Ratings = lazy(() => import('@/pages/Ratings'));
const Notifications = lazy(() => import('@/pages/Notifications'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const LevelConfig = lazy(() => import('@/pages/LevelConfig'));
const HostApplications = lazy(() => import('@/pages/HostApplications'));
const Analytics = lazy(() => import('@/pages/Analytics'));
const PromoCodes = lazy(() => import('@/pages/PromoCodes'));
const PayoutManagement = lazy(() => import('@/pages/PayoutManagement'));
const SupportTickets = lazy(() => import('@/pages/SupportTickets'));
const ContentModeration = lazy(() => import('@/pages/ContentModeration'));
const BanManagement = lazy(() => import('@/pages/BanManagement'));
const BulkNotifications = lazy(() => import('@/pages/BulkNotifications'));
const AuditLogs = lazy(() => import('@/pages/AuditLogs'));
const Banners = lazy(() => import('@/pages/Banners'));
const ReferralSystem = lazy(() => import('@/pages/ReferralSystem'));
const LiveCalls = lazy(() => import('@/pages/LiveCalls'));
const AppConfig = lazy(() => import('@/pages/AppConfig'));
const PaymentGateways = lazy(() => import('@/pages/PaymentGateways'));
const Deposits = lazy(() => import('@/pages/Deposits'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});
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
      <Suspense fallback={<PageLoader />}>
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
        <Route path="/ban-management" component={BanManagement} />
        <Route path="/live-calls" component={LiveCalls} />
        <Route path="/payout-management" component={PayoutManagement} />
        <Route path="/promo-codes" component={PromoCodes} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/referral-system" component={ReferralSystem} />
        <Route path="/content-moderation" component={ContentModeration} />
        <Route path="/support-tickets" component={SupportTickets} />
        <Route path="/bulk-notifications" component={BulkNotifications} />
        <Route path="/banners" component={Banners} />
        <Route path="/audit-logs" component={AuditLogs} />
        <Route path="/app-config" component={AppConfig} />
        <Route path="/deposits" component={Deposits} />
        <Route path="/payment-gateways" component={PaymentGateways} />
        <Route path="/settings" component={SettingsPage} />
          <Route component={() => <Redirect to="/dashboard" />} />
        </Switch>
      </Suspense>
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
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
