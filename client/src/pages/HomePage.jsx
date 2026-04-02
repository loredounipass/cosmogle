import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';

export default function HomePage() {
  const navigate = useNavigate();
  const [isLoaded, setIsLoaded] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 50) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  function handleStart() {
    navigate('/checking');
  }

  return (
    <div className="page-home-root">
      {/* Animated Background */}
      <div className="home-bg-gradient"></div>
      <div className="home-bg-grid"></div>

      {/* Navigation */}
      <nav className={`home-nav ${isScrolled ? 'hidden' : ''}`}>
        <div className="home-nav-container">
          <div className="home-logo">
            <img src="/assets/cosmogle.png" alt="Cosmogle" />
          </div>
          <div className="home-nav-links">
            <a href="#about">About Cosmogle</a>
            <a href="#features">Características</a>
            <a href="#contact">Contacto</a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="home-main">
        <section className="home-hero">
          <div className={`home-hero-content ${isLoaded ? 'loaded' : ''}`}>
            <h1 className="hero-title">
              <span className="title-line">Conecta con</span>
              <span className="title-gradient">Personas del Mundo</span>
            </h1>
            
            <p className="hero-subtitle">
              Experimenta conversaciones auténticas con personas aleatorias de todo el mundo. 
              Sin registros, sin complicaciones, solo conexión humana real.
            </p>

            <div className="hero-cta">
              <button className="home-btn-primary" onClick={handleStart}>
                <span>Comenzar Ahora</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14"/>
                  <path d="M12 5l7 7-7 7"/>
                </svg>
              </button>
              <button className="home-btn-secondary">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                <span>Ver Demo</span>
              </button>
            </div>

            <div className="hero-stats">
              <div className="stat">
                <span className="stat-number">10K+</span>
                <span className="stat-label">Usuarios Activos</span>
              </div>
              <div className="stat">
                <span className="stat-number">50+</span>
                <span className="stat-label">Países</span>
              </div>
              <div className="stat">
                <span className="stat-number">1M+</span>
                <span className="stat-label">Conexiones</span>
              </div>
            </div>
          </div>

          <div className={`home-hero-visual ${isLoaded ? 'loaded' : ''}`}>
            <div className="visual-card">
              <div className="visual-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
                <span>Vista previa de cámara</span>
              </div>
              <div className="visual-overlay">
                <div className="overlay-badge">HD</div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="home-features">
          <div className="section-header">
            <h2>¿Por qué elegir Cosmogle?</h2>
            <p>Características diseñadas para tu mejor experiencia</p>
          </div>

          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <path d="m9 15 2 2 4-4"/>
                </svg>
              </div>
              <h3>Sin Registro</h3>
              <p>Comienza a chatear inmediatamente. No necesitas crear una cuenta ni proporcionar información personal.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect width="18" height="18" x="3" y="3" rx="2"/>
                  <path d="M7 3v18"/>
                  <path d="M3 7.5h4"/>
                  <path d="M3 12h18"/>
                  <path d="M3 16.5h4"/>
                  <path d="M17 3v18"/>
                  <path d="M17 7.5h4"/>
                  <path d="M17 16.5h4"/>
                </svg>
              </div>
              <h3>Video HD</h3>
              <p>Disfruta de video de alta definición con adaptación automática de calidad según tu conexión.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>
                </svg>
              </div>
              <h3>Seguro y Privado</h3>
              <p>Tus conversaciones son privadas. No almacenamos chats ni compartimos tu información.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <h3>Comunidad Global</h3>
              <p>Conecta con personas de más de 50 países y culturas diferentes en tiempo real.</p>
            </div>
          </div>
        </section>

        {/* How it Works */}
        <section id="how-it-works" className="home-how-it-works">
          <div className="section-header">
            <h2>¿Cómo Funciona?</h2>
            <p>Tres simples pasos para comenzar</p>
          </div>

          <div className="steps-container">
            <div className="step">
              <div className="step-number">01</div>
              <div className="step-content">
                <h3>Activa tu Cámara</h3>
                <p>Permite el acceso a tu cámara y micrófono para comenzar la experiencia.</p>
              </div>
            </div>

            <div className="step-connector"></div>

            <div className="step">
              <div className="step-number">02</div>
              <div className="step-content">
                <h3>Verifica tu Equipo</h3>
                <p>Asegúrate de que tu cámara y micrófono funcionan correctamente.</p>
              </div>
            </div>

            <div className="step-connector"></div>

            <div className="step">
              <div className="step-number">03</div>
              <div className="step-content">
                <h3>Conecta y Chatea</h3>
                <p>Te emparejamos automáticamente con alguien para conversar.</p>
              </div>
            </div>
          </div>
        </section>

        {/* About Section */}
        <section id="about" className="home-about">
          <div className="section-header">
            <h2>About Cosmogle</h2>
            <p>Conoce más sobre nuestra plataforma</p>
          </div>

          <div className="about-content">
            <div className="about-text">
              <h3>Nuestra Misión</h3>
              <p>
                Cosmogle nació de la idea de conectar personas de todo el mundo a través de conversaciones auténticas.
                Creemos que cada persona tiene una historia que contar y experiencias que compartir.
              </p>
              <p>
                Nuestra plataforma facilita conexiones genuinas entre personas de diferentes culturas,
                países y backgrounds, creando un espacio donde las barreras desaparecen y la comunicación fluye libremente.
              </p>
            </div>
            <div className="about-stats">
              <div className="about-stat">
                <span className="stat-number">2024</span>
                <span className="stat-label">Año de Fundación</span>
              </div>
              <div className="about-stat">
                <span className="stat-number">50+</span>
                <span className="stat-label">Países Conectados</span>
              </div>
              <div className="about-stat">
                <span className="stat-number">100%</span>
                <span className="stat-label">Privado y Seguro</span>
              </div>
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section id="contact" className="home-contact">
          <div className="section-header">
            <h2>Contacto</h2>
            <p>¿Tienes preguntas? Estamos aquí para ayudarte</p>
          </div>

          <div className="contact-content">
            <div className="contact-card">
              <div className="contact-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              </div>
              <h3>Email</h3>
              <p>support@cosmogle.com</p>
            </div>

            <div className="contact-card">
              <div className="contact-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                </svg>
              </div>
              <h3>Chat en Vivo</h3>
              <p>Disponible 24/7</p>
            </div>

            <div className="contact-card">
              <div className="contact-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>
                </svg>
              </div>
              <h3>Privacidad</h3>
              <p>Tu información está segura</p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="home-footer">
        <div className="home-footer-container">
          <div className="footer-brand">
            <img src="/assets/cosmogle.png" alt="Cosmogle" />
            <p>Conectando personas a través del mundo</p>
          </div>
          <div className="footer-links">
            <a href="#">Privacidad</a>
            <a href="#">Términos</a>
            <a href="#">Contacto</a>
          </div>
          <div className="footer-copy">
            <p>&copy; 2026 Cosmogle. Todos los derechos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
