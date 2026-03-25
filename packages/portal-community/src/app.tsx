import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { Layout } from './components/Layout';
import { PortalShellProvider } from './context/PortalShellContext';
import { paths } from './routes/paths';

import DashboardPage from './routes/dashboard';
import SignalPage from './routes/signal';
import DestinationsPage from './routes/destinations';
import RequestLogsPage from './routes/logs';
import StrategiesPage from './routes/strategies';
import SiteConfigurationPage from './routes/configuration';
import AnalyticsPage from './routes/analytics';
import ExplorePage from './routes/explore';
import MigrationPage from './routes/migration';
import UpgradePage from './routes/upgrade';
import ExtensionsPage from './routes/extensions';

export default function App() {
  return (
    <BrowserRouter>
      <PortalShellProvider>
        <Layout>
          <Routes>
            <Route path={paths.root} element={<Navigate to={paths.dashboard} replace />} />
            <Route path={paths.dashboard} element={<DashboardPage />} />
            <Route path={paths.signal} element={<SignalPage />} />
            <Route path={paths.destinations} element={<DestinationsPage />} />
            <Route path={paths.logs} element={<RequestLogsPage />} />
            <Route path={paths.strategies} element={<StrategiesPage />} />
            <Route path={paths.configuration} element={<SiteConfigurationPage />} />
            <Route path={paths.analytics} element={<AnalyticsPage />} />
            <Route path={paths.explore} element={<ExplorePage />} />
            <Route path={paths.migration} element={<MigrationPage />} />
            <Route path={paths.upgrade} element={<UpgradePage />} />
            <Route path={paths.extensions} element={<ExtensionsPage />} />
            {/* Legacy paths → extensions handoff (bookmark compatibility) */}
            <Route path="/consent" element={<Navigate to={paths.extensions} replace />} />
            <Route path="/evidence" element={<Navigate to={paths.extensions} replace />} />
            <Route path="/banner" element={<Navigate to={paths.extensions} replace />} />
            <Route path="/policy" element={<Navigate to={paths.extensions} replace />} />
            <Route path="/counsel" element={<Navigate to={paths.extensions} replace />} />
            <Route path="*" element={<Navigate to={paths.dashboard} replace />} />
          </Routes>
        </Layout>
        <Toaster />
      </PortalShellProvider>
    </BrowserRouter>
  );
}
