import { BrowserRouter, Routes, Route } from 'react-router-dom';
import PublicRoute from './components/routing/PublicRoute.jsx';
import HomePage from './pages/HomePage.jsx';
import CheckingPage from './pages/CheckingPage.jsx';
import VideoPage from './pages/VideoPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PublicRoute />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/checking" element={<CheckingPage />} />
          <Route path="/video" element={<VideoPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
