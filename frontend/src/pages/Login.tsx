import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isRegister) {
        // First register
        await authApi.register(email, password, fullName);
      }
      // Then login (either directly or after registration)
      const { data } = await authApi.login(email, password);
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("refresh_token", data.refresh_token);
      navigate("/");
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
            onClick={() => {
              setIsRegister(false);
              setError("");
            }}
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
            onClick={() => {
              setIsRegister(true);
              setError("");
            }}
          >
            Register
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
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
                required
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email" className="form-label">Corporate Email</label>
            <input
              id="email"
              type="email"
              placeholder="e.g. counsel@company.com"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label htmlFor="password" className="form-label">Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

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
