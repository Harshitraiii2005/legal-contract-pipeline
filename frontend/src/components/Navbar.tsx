import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className={`navbar ${scrolled ? "navbar--scrolled" : ""}`}>
      <div className="navbar__container">
        <Link to="/" className="navbar__brand">
          <span className="navbar__logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="url(#nav-grad)" />
              <path
                d="M10 8h4v12H10V8zm8 4h4v8h-4v-8z"
                fill="white"
                opacity="0.9"
              />
              <defs>
                <linearGradient id="nav-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6366f1" />
                  <stop offset="1" stopColor="#3b82f6" />
                </linearGradient>
              </defs>
            </svg>
          </span>
          <span className="navbar__name">LexAI</span>
          <span className="navbar__badge-pill">Pipeline</span>
        </Link>

        <div className={`navbar__links ${mobileOpen ? "navbar__links--open" : ""}`}>
          <a href="/#vision" className={`navbar__link ${isActive("/") ? "" : ""}`}>Vision</a>
          <a href="/#features" className="navbar__link">Features</a>
          <a href="/#how-it-works" className="navbar__link">How It Works</a>
          <Link to="/contact" className={`navbar__link ${isActive("/contact") ? "navbar__link--active" : ""}`}>Contact</Link>
        </div>

        <div className="navbar__actions">
          <Link to="/app" className="navbar__cta">
            Launch App
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className={`navbar__hamburger ${mobileOpen ? "navbar__hamburger--open" : ""}`}
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <span /><span /><span />
        </button>
      </div>
    </nav>
  );
}
