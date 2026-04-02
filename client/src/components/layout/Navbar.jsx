import { Link } from 'react-router-dom';

export default function Navbar() {
  return (
    <nav className="index-navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-logo">
          <img src="/assets/cosmogle.png" alt="Cosmogle" />
        </Link>
        <div className="navbar-links hidden md:flex">
          <a href="#about">About Us</a>
          <a href="#mission">Our Mission</a>
          <a href="#services">Our Services</a>
        </div>
      </div>
    </nav>
  );
}