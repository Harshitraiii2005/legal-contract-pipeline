import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api/client";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function validateEmail(email: string): string | null {
  if (!email.trim()) return "Email is required";
  if (!EMAIL_PATTERN.test(email.trim())) return "Enter a valid email address";
  return null;
}

function validatePassword(password: string): string | null {
  if (!password) return "Password is required";
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  return null;
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 4.22-5.6M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a20.3 20.3 0 0 1-2.68 3.9M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const switchMode = (register: boolean) => {
    setIsRegister(register);
    setError("");
    setFieldErrors({});
    setConfirmPassword("");
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    const emailErr = validateEmail(email);
    if (emailErr) errors.email = emailErr;

    const passwordErr = validatePassword(password);
    if (passwordErr) errors.password = passwordErr;

    if (isRegister && !passwordErr && confirmPassword !== password) {
      errors.confirmPassword = "Passwords do not match";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!validate()) return;

    setLoading(true);
    try {
      if (isRegister) {
        // First register
        await authApi.register(email.trim(), password, fullName.trim());
      }
      // Then login (either directly or after registration)
      const { data } = await authApi.login(email.trim(), password);
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("refresh_token", data.refresh_token);
      navigate("/app");
    } catch (err: any) {
      setError(err.response?.data?.detail ?? (isRegister ? "Registration failed" : "Login failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__logo">
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: "drop-shadow(0 0 8px rgba(99, 102, 241, 0.5))" }}
          >
            <path d="M12 22V2M12 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8M12 6h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8" />
            <path d="M12 18H5M12 18h7" />
            <path d="M7 10h10" />
          </svg>
        </div>
        <h1 className="auth-card__title">LexAI Pipeline</h1>
        <p className="auth-card__subtitle">Enterprise AI-powered contract compliance & risk analytics</p>

        {/* Auth Mode Toggle */}
        <div className="auth-tabs" style={{ display: "flex", gap: "16px", marginBottom: "24px", justifyContent: "center" }}>
          <button
            type="button"
            className={`auth-tab ${!isRegister ? "active" : ""}`}
            style={{
              background: "none",
              border: "none",
              color: !isRegister ? "var(--color-accent)" : "var(--color-text-muted)",
              borderBottom: !isRegister ? "2px solid var(--color-accent)" : "none",
              paddingBottom: "4px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "1rem"
            }}
            onClick={() => switchMode(false)}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab ${isRegister ? "active" : ""}`}
            style={{
              background: "none",
              border: "none",
              color: isRegister ? "var(--color-accent)" : "var(--color-text-muted)",
              borderBottom: isRegister ? "2px solid var(--color-accent)" : "none",
              paddingBottom: "4px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "1rem"
            }}
            onClick={() => switchMode(true)}
          >
            Register
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {isRegister && (
            <div className="form-group">
              <label htmlFor="fullName" className="form-label">Full Name</label>
              <input
                id="fullName"
                type="text"
                placeholder="e.g. John Doe"
                className="form-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email" className="form-label">Corporate Email</label>
            <input
              id="email"
              type="email"
              placeholder="e.g. counsel@company.com"
              className={`form-input ${fieldErrors.email ? "form-input--error" : ""}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              aria-invalid={Boolean(fieldErrors.email)}
            />
            {fieldErrors.email && <span className="form-hint form-hint--error">{fieldErrors.email}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="password" className="form-label">Password</label>
            <div className="form-input-group">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                className={`form-input ${fieldErrors.password ? "form-input--error" : ""}`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isRegister ? "new-password" : "current-password"}
                aria-invalid={Boolean(fieldErrors.password)}
              />
              <button
                type="button"
                className="input-toggle-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
            {fieldErrors.password ? (
              <span className="form-hint form-hint--error">{fieldErrors.password}</span>
            ) : isRegister ? (
              <span className="form-hint">At least {MIN_PASSWORD_LENGTH} characters</span>
            ) : null}
          </div>

          {isRegister && (
            <div className="form-group">
              <label htmlFor="confirmPassword" className="form-label">Confirm Password</label>
              <input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                className={`form-input ${fieldErrors.confirmPassword ? "form-input--error" : ""}`}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                aria-invalid={Boolean(fieldErrors.confirmPassword)}
              />
              {fieldErrors.confirmPassword && (
                <span className="form-hint form-hint--error">{fieldErrors.confirmPassword}</span>
              )}
            </div>
          )}

          {error && <div className="alert alert--error">{error}</div>}

          <button type="submit" className="btn btn--primary btn--full" style={{ marginTop: "8px" }} disabled={loading}>
            {loading ? (
              <>
                <span className="spinner spinner--sm" style={{ borderTopColor: "#fff" }} />
                <span>{isRegister ? "Registering…" : "Signing in…"}</span>
              </>
            ) : (
              isRegister ? "Register" : "Sign In"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
