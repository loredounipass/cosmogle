import { useNavigate } from 'react-router-dom';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';

export default function HomePage() {
  const navigate = useNavigate();

  function handleStart() {
    navigate('/checking');
  }

  return (
    <div className="page-index-root">
      <Navbar />

      <main className="index-main-content">
        <div className="index-wrapper">
          <div className="welcome-content">
            <h1>Connect instantly.</h1>
            <p className="subtitle">Start video chatting with strangers around the world.</p>
            
            <div className="features">
              <div className="feature">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 2 2 4-4"/></svg>
                <span>No Registration</span>
              </div>
              <div className="feature">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></svg>
                <span>High Quality Video</span>
              </div>
              <div className="feature">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>
                <span>Secure & Anonymous</span>
              </div>
            </div>

            <button className="btn-start" onClick={handleStart}>
              Start Chatting
            </button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
