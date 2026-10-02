import { useState } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import RegistrationWizard from './pages/RegistrationWizard';
import TenantLogin from './pages/TenantLogin';
import PlatformAdminLogin from './pages/PlatformAdminLogin';
import SetupPassword from './pages/SetupPassword';
import OnboardingProgress from './pages/OnboardingProgress';

export default function App() {
  const [tenantLoggedIn, setTenantLoggedIn] = useState(false);
  const [platformLoggedIn, setPlatformLoggedIn] = useState(false);

  return (
    <BrowserRouter>
      <nav className="nav">
        <Link to="/register">Register FPO</Link>
        <Link to="/login">FPO Login</Link>
        <Link to="/platform-admin/login">Platform Admin</Link>
      </nav>
      <Routes>
        <Route path="/" element={<RegistrationWizard />} />
        <Route path="/register" element={<RegistrationWizard />} />
        <Route path="/login" element={tenantLoggedIn ? <OnboardingProgress /> : <TenantLogin onLoggedIn={() => setTenantLoggedIn(true)} />} />
        <Route path="/setup-password" element={<SetupPassword />} />
        <Route
          path="/platform-admin/login"
          element={platformLoggedIn ? <div className="card"><p>✅ Platform admin logged in.</p></div> : <PlatformAdminLogin onLoggedIn={() => setPlatformLoggedIn(true)} />}
        />
      </Routes>
    </BrowserRouter>
  );
}
