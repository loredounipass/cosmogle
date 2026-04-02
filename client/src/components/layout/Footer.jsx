export default function Footer() {
  return (
    <footer className="index-footer">
      <div className="footer-content">
        <p>&copy; {new Date().getFullYear()} Cosmogle. All rights reserved.</p>
        <div className="footer-links">
          <a href="#privacy">Privacy Policy</a>
          <a href="#terms">Terms of Service</a>
        </div>
      </div>
    </footer>
  );
}