import { useState } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import RegistrationWizard from './pages/RegistrationWizard';
import TenantLogin from './pages/TenantLogin';
import PlatformAdminLogin from './pages/PlatformAdminLogin';
import SetupPassword from './pages/SetupPassword';
import OnboardingProgress from './pages/OnboardingProgress';
import TenantSettingsDashboard from './pages/TenantSettingsDashboard';
import PlatformAdminDashboard from './pages/PlatformAdminDashboard';
import MemberApply from './pages/MemberApply';
import MemberApplicationsAdmin from './pages/MemberApplicationsAdmin';
import { setTenantAccessToken, setPlatformAccessToken } from './api/client';

export default function App() {
  const [tenantLoggedIn, setTenantLoggedIn] = useState(false);
  const [platformLoggedIn, setPlatformLoggedIn] = useState(false);

  function tenantLogout() {
    setTenantAccessToken(null);
    sessionStorage.removeItem('tenantRefreshToken');
    setTenantLoggedIn(false);
  }

  function platformLogout() {
    setPlatformAccessToken(null);
    sessionStorage.removeItem('platformRefreshToken');
    setPlatformLoggedIn(false);
  }

  const query = new URLSearchParams(window.location.search);
  const page = query.get('page');
  const rootPage = query.get('fpoSetupToken')
    ? <SetupPassword />
    : page === 'login'
      ? <TenantLogin onLoggedIn={() => setTenantLoggedIn(true)} />
      : page === 'member-apply'
        ? <MemberApply />
        : <RegistrationWizard />;

  return (
    <BrowserRouter>
      <nav className="nav">
        <div className="nav-brand">FPO SaaS</div>
        <Link to="/register">Register FPO</Link>
        <Link to="/member-apply">कृषक शेयरधारक आवेदन</Link>
        <Link to="/login">FPO Login</Link>
        {tenantLoggedIn && <Link to="/settings">Settings</Link>}
        {tenantLoggedIn && <Link to="/members">सदस्य आवेदन</Link>}
        <Link to="/platform-admin/login">Platform Admin</Link>
        <div className="nav-spacer" />
        {tenantLoggedIn && <button className="nav-button" onClick={tenantLogout}>FPO Logout</button>}
        {platformLoggedIn && <button className="nav-button" onClick={platformLogout}>Platform Logout</button>}
      </nav>
      <Routes>
        <Route path="/" element={rootPage} />
        <Route path="/register" element={<RegistrationWizard />} />
        <Route path="/member-apply" element={<MemberApply />} />
        <Route
          path="/login"
          element={tenantLoggedIn ? <Navigate to="/settings" replace /> : <TenantLogin onLoggedIn={() => setTenantLoggedIn(true)} />}
        />
        <Route path="/setup-password" element={<SetupPassword />} />
        <Route
          path="/onboarding"
          element={tenantLoggedIn ? <OnboardingProgress /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/settings/*"
          element={tenantLoggedIn ? <TenantSettingsDashboard /> : <Navigate to="/login" replace />}
        />
        <Route path="/members" element={tenantLoggedIn ? <MemberApplicationsAdmin /> : <Navigate to="/login" replace />} />
        <Route
          path="/platform-admin/login"
          element={platformLoggedIn ? <Navigate to="/platform-admin" replace /> : <PlatformAdminLogin onLoggedIn={() => setPlatformLoggedIn(true)} />}
        />
        <Route
          path="/platform-admin/*"
          element={platformLoggedIn ? <PlatformAdminDashboard /> : <Navigate to="/platform-admin/login" replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}
