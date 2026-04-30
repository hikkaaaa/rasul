import { AnimatePresence } from 'framer-motion';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Clients } from './pages/Clients';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Profile } from './pages/Profile';
import { Register } from './pages/Register';

// Routes that own their own full-bleed layout (header, scroll, etc.)
// shouldn't be wrapped in the centered card chrome.
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
