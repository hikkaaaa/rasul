import { AnimatePresence } from 'framer-motion';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Clients } from './pages/Clients';
import { Invite } from './pages/Invite';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Profile } from './pages/Profile';
import { Register } from './pages/Register';
import { Team } from './pages/Team';

const FULL_BLEED_ROUTES = new Set<string>(['/']);

function AnimatedRoutes() {
  const location = useLocation();
  const fullBleed = FULL_BLEED_ROUTES.has(location.pathname);

  const routes = (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/team" element={<Team />} />
        <Route path="/invite/:token" element={<Invite />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </AnimatePresence>
  );

  if (fullBleed) {
    return <div className="min-h-screen bg-cream-50">{routes}</div>;
  }
  return (
    <div className="min-h-screen bg-cream-50 flex items-center justify-center p-4 sm:p-8">
      {routes}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AnimatedRoutes />
    </BrowserRouter>
  );
}

export default App;
