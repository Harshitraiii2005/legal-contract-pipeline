import { useState } from "react";
import { Link } from "react-router-dom";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";

export default function LandingPage() {
  const [feedbackName, setFeedbackName] = useState("");
  const [feedbackEmail, setFeedbackEmail] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  
  const [activeStep, setActiveStep] = useState(0);
  const [activeClause, setActiveClause] = useState<keyof typeof CLAUSE_EXPLORER_DATA>("indemnification");

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackLoading(true);
    // Simulate API request to store feedback
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setFeedbackSuccess(true);
    setFeedbackLoading(false);
    setFeedbackName("");
    setFeedbackEmail("");
    setFeedbackText("");
  };

  return (
    <div className="landing">
      <Navbar />

      {/* ── Hero Section ───────────────────────────────────────────── */}
      <section className="hero" id="hero">
        <div className="hero__glow hero__glow--1" />
        <div className="hero__glow hero__glow--2" />
        <div className="hero__grid-overlay" />

        <div className="hero__content">
          <span className="hero__eyebrow">
            <span className="hero__eyebrow-dot" />
            AI-Powered Legal Intelligence
          </span>
          <h1 className="hero__title">
            Transform Contract Review
            <br />
            with <span className="hero__gradient-text">LexAI Pipeline</span>
          </h1>
          <p className="hero__subtitle">
            Analyze, score, and redline legal contracts in minutes — not days.
            Our multi-agent AI pipeline identifies risks, checks compliance, and
            generates attorney-ready redlines with full audit trails.
          </p>
          <div className="hero__actions">
            <Link to="/app" className="hero__cta hero__cta--primary">
              <span>Launch App</span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <Link to="/contact" className="hero__cta hero__cta--ghost">
              Contact Sales
            </Link>
          </div>
        </div>

        {/* Animated dashboard preview */}
        <div className="hero__visual">
          <div className="hero__preview">
            <div className="hero__preview-bar">
              <div className="hero__preview-dots">
                <span /><span /><span />
              </div>
              <span className="hero__preview-url">app.lexai.dev / dashboard</span>
            </div>
            <div className="hero__preview-body">
              <div className="hero__preview-sidebar">
                <div className="hero__preview-nav-item hero__preview-nav-item--active" />
                <div className="hero__preview-nav-item" />
                <div className="hero__preview-nav-item" />
                <div className="hero__preview-nav-item" />
              </div>
              <div className="hero__preview-main">
                <div className="hero__preview-stats">
                  <div className="hero__preview-stat">
                    <span className="hero__preview-stat-value">47</span>
                    <span className="hero__preview-stat-label">Contracts</span>
                  </div>
                  <div className="hero__preview-stat hero__preview-stat--accent">
                    <span className="hero__preview-stat-value">12</span>
                    <span className="hero__preview-stat-label">Flagged</span>
                  </div>
                  <div className="hero__preview-stat hero__preview-stat--green">
                    <span className="hero__preview-stat-value">98%</span>
                    <span className="hero__preview-stat-label">Accuracy</span>
                  </div>
                </div>
                <div className="hero__preview-cards">
                  <div className="hero__preview-card" />
                  <div className="hero__preview-card" />
                  <div className="hero__preview-card" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Vision Section ─────────────────────────────────────────── */}
      <section className="section vision" id="vision">
        <div className="section__container">
          <span className="section__eyebrow">Our Vision</span>
          <h2 className="section__title">
            Why We Built <span className="text-gradient">LexAI</span>
          </h2>
          <p className="section__description">
            Legal teams spend <strong>60%+ of their time</strong> on repetitive contract review.
            We envisioned a world where AI handles the heavy lifting — clause extraction,
            risk scoring, compliance checking — so attorneys can focus on strategy and negotiation.
          </p>

          <div className="vision__grid">
            <div className="vision__card">
              <div className="vision__card-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <h3 className="vision__card-title">Hours → Minutes</h3>
              <p className="vision__card-text">
                What takes a junior associate 4–6 hours, LexAI completes in under 3 minutes
                with higher consistency and zero fatigue-related errors.
              </p>
            </div>
            <div className="vision__card">
              <div className="vision__card-icon vision__card-icon--blue">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h3 className="vision__card-title">Human-in-the-Loop</h3>
              <p className="vision__card-text">
                AI augments, never replaces. Every analysis goes through an attorney
                approval gate with a full audit trail for regulatory compliance.
              </p>
            </div>
            <div className="vision__card">
              <div className="vision__card-icon vision__card-icon--emerald">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              </div>
              <h3 className="vision__card-title">Enterprise-Grade</h3>
              <p className="vision__card-text">
                SOC 2 ready architecture with end-to-end encryption, MLflow observability,
                Kubernetes deployment, and CI/CD via Jenkins pipelines.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features Section ───────────────────────────────────────── */}
      <section className="section features" id="features">
        <div className="section__container">
          <span className="section__eyebrow">Features</span>
          <h2 className="section__title">
            Everything You Need for
            <br />
            <span className="text-gradient">Intelligent Contract Analysis</span>
          </h2>

          <div className="features__grid">
            {FEATURES.map((f, i) => (
              <div className="feature-card" key={i}>
                <div className={`feature-card__icon feature-card__icon--${f.color}`}>
                  {f.icon}
                </div>
                <h3 className="feature-card__title">{f.title}</h3>
                <p className="feature-card__text">{f.desc}</p>
                {f.tag && <span className="feature-card__tag">{f.tag}</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ───────────────────────────────────────────── */}
      <section className="section how-it-works" id="how-it-works">
        <div className="section__container">
          <span className="section__eyebrow">Interactive Pipeline</span>
          <h2 className="section__title">
            From Ingestion to <span className="text-gradient">Attorney-Ready Report</span>
          </h2>
          <p className="section__description" style={{ maxWidth: "800px", margin: "0 auto 40px auto", textAlign: "center" }}>
            Explore how our pipeline processes your contracts stage-by-stage. Click on any step to view its technical details, system agents, and live telemetry simulation.
          </p>

          <div className="interactive-pipeline">
            <div className="pipeline-nav">
              {PIPELINE_DETAILS.map((step, i) => (
                <button
                  key={i}
                  className={`pipeline-nav-btn ${activeStep === i ? "pipeline-nav-btn--active" : ""}`}
                  onClick={() => setActiveStep(i)}
                >
                  <span className="pipeline-nav-btn__num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="pipeline-nav-btn__emoji">{step.emoji}</span>
                  <span className="pipeline-nav-btn__title">{step.title}</span>
                </button>
              ))}
            </div>

            <div className="pipeline-details-panel">
              <div>
                <span className="pipeline-details-badge">{PIPELINE_DETAILS[activeStep].agent}</span>
                <h3 className="pipeline-details-title" style={{ marginTop: "12px", marginBottom: "8px" }}>
                  {PIPELINE_DETAILS[activeStep].title}
                </h3>
                <p className="pipeline-details-desc">
                  {PIPELINE_DETAILS[activeStep].technicalText}
                </p>
              </div>

              <div className="terminal-console">
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "8px", marginBottom: "8px" }}>
                  <span style={{ color: "#818cf8", fontSize: "0.75rem", fontWeight: 700 }}>Telemetry Console</span>
                  <span style={{ color: "rgba(255,255,255,0.25)", fontSize: "0.7rem" }}>LIVE SIMULATION</span>
                </div>
                {PIPELINE_DETAILS[activeStep].log.map((line, idx) => {
                  let cls = "terminal-line--info";
                  if (line.startsWith("[success]")) cls = "terminal-line--success";
                  if (line.startsWith("[warning]")) cls = "terminal-line--warning";
                  return (
                    <div key={idx} className={`terminal-line ${cls}`}>
                      <span className="terminal-line__prefix">&gt;</span>
                      <span>{line}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Clause Types Explorer ─────────────────────────────────── */}
          <div className="clause-explorer">
            <span className="section__eyebrow" style={{ display: "block", textAlign: "center" }}>Supported Provisions</span>
            <h2 className="section__title" style={{ textAlign: "center", marginBottom: "16px" }}>
              What Clauses Do We <span className="text-gradient">Analyze & Redline?</span>
            </h2>
            <p className="section__description" style={{ maxWidth: "800px", margin: "0 auto 40px auto", textAlign: "center" }}>
              Select a clause type to explore common risk flags, compliance checks, and a comparison of original one-sided provisions versus mitigated, balanced suggestions.
            </p>

            <div className="clause-explorer-grid">
              <div className="clause-sidebar">
                {Object.keys(CLAUSE_EXPLORER_DATA).map((key) => (
                  <button
                    key={key}
                    className={`clause-btn ${activeClause === key ? "clause-btn--active" : ""}`}
                    onClick={() => setActiveClause(key as any)}
                  >
                    {CLAUSE_EXPLORER_DATA[key as keyof typeof CLAUSE_EXPLORER_DATA].name}
                  </button>
                ))}
              </div>

              <div className="clause-content">
                <div className="clause-header">
                  <h3 className="clause-title">{CLAUSE_EXPLORER_DATA[activeClause].name}</h3>
                  <p className="clause-desc">{CLAUSE_EXPLORER_DATA[activeClause].description}</p>
                </div>

                <div>
                  <h4 style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "1px", color: "var(--color-text-muted)", marginBottom: "12px" }}>
                    AI Checkpoints & Compliance Audits
                  </h4>
                  <div className="clause-checkpoints">
                    {CLAUSE_EXPLORER_DATA[activeClause].checkpoints.map((cp, idx) => (
                      <span key={idx} className="clause-checkpoint">✓ {cp}</span>
                    ))}
                  </div>
                </div>

                <div className="diff-display">
                  <div className="diff-box diff-box--original">
                    <span className="diff-box__label">Original Draft (One-Sided)</span>
                    <p className="diff-box__text">{CLAUSE_EXPLORER_DATA[activeClause].original}</p>
                  </div>
                  <div className="diff-box diff-box--revised">
                    <span className="diff-box__label">AI Redline (Balanced / Mitigated)</span>
                    <p className="diff-box__text">{CLAUSE_EXPLORER_DATA[activeClause].revised}</p>
                  </div>
                </div>

                <div className="rationale-panel">
                  <strong>AI Mitigation Rationale:</strong> {CLAUSE_EXPLORER_DATA[activeClause].rationale}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feedback Section ───────────────────────────────────────────── */}
      <section className="section feedback-section" id="feedback">
        <div className="section__container">
          <span className="section__eyebrow" style={{ display: "block", textAlign: "center" }}>User Feedback</span>
          <h2 className="section__title" style={{ textAlign: "center", marginBottom: "32px" }}>
            Share Your <span className="text-gradient">Feedback</span>
          </h2>
          <div className="feedback-card">
            {feedbackSuccess && (
              <div className="feedback-success" style={{ marginBottom: "20px" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "8px" }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Thank you! Your feedback has been recorded successfully.</span>
              </div>
            )}
            <form className="feedback-form" onSubmit={handleFeedbackSubmit}>
              <div className="form-group">
                <label htmlFor="feedback-name" className="form-label">Name</label>
                <input
                  id="feedback-name"
                  type="text"
                  placeholder="e.g. Alex Johnson"
                  className="form-input"
                  value={feedbackName}
                  onChange={(e) => setFeedbackName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="feedback-email" className="form-label">Email</label>
                <input
                  id="feedback-email"
                  type="email"
                  placeholder="e.g. alex@company.com"
                  className="form-input"
                  value={feedbackEmail}
                  onChange={(e) => setFeedbackEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="feedback-text" className="form-label">Your Feedback / Suggestion</label>
                <textarea
                  id="feedback-text"
                  placeholder="Tell us what you think or suggest new features..."
                  className="form-input"
                  style={{ minHeight: "120px", resize: "vertical" }}
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn--primary btn--full" disabled={feedbackLoading}>
                {feedbackLoading ? "Submitting..." : "Submit Feedback"}
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* ── CTA Section ────────────────────────────────────────────── */}
      <section className="cta-section">
        <div className="cta-section__glow" />
        <div className="cta-section__content">
          <h2 className="cta-section__title">
            Ready to Transform Your Contract Workflow?
          </h2>
          <p className="cta-section__desc">
            Start analyzing contracts with AI today. No credit card required.
          </p>
          <div className="cta-section__actions">
            <Link to="/app" className="hero__cta hero__cta--primary hero__cta--lg">
              <span>Get Started Free</span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <Link to="/contact" className="hero__cta hero__cta--ghost">
              Talk to Sales
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

/* ── Static Data ─────────────────────────────────────────────── */

const FEATURES = [
  {
    title: "Vercel AI SDK Core",
    desc: "Leverages the state-of-the-art Vercel AI SDK to orchestrate smart agents, stream completions with low latency, and enforce highly structured compliance JSON output schemas.",
    color: "indigo",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 22h20L12 2z" />
      </svg>
    ),
    tag: "Next-Gen AI",
  },
  {
    title: "Go API Gateway",
    desc: "Engineered using Fiber and Go for ultra-low latency request routing, asynchronous Redis job dispatching, and high-concurrency database connection pooling.",
    color: "cyan",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
        <line x1="6" y1="6" x2="6.01" y2="6" />
        <line x1="6" y1="18" x2="6.01" y2="18" />
      </svg>
    ),
    tag: "High Perf",
  },
  {
    title: "TS Worker Pipeline",
    desc: "A dedicated Node.js/TypeScript queue consumer running asynchronous pipeline agents in isolated environments, ensuring reliable execution and automatic retries.",
    color: "emerald",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
    tag: "Async Queue",
  },
  {
    title: "Express Production Server",
    desc: "Serves optimized React web assets securely, implementing dynamic wildcard fallbacks for React Router single-page application (SPA) routing.",
    color: "violet",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
      </svg>
    ),
  },
  {
    title: "Model Context Protocol (MCP)",
    desc: "Fully compatible with the Model Context Protocol (MCP), enabling seamless context sharing between local LLMs, editor extensions, and RAG databases.",
    color: "rose",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
    tag: "MCP Spec",
  },
  {
    title: "Advanced Shield Security",
    desc: "Multi-layered enterprise defense featuring role-based access control (RBAC), bcrypt password hashing, HTTP-only secure cookie rotations, and JWT session handling.",
    color: "orange",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    tag: "Secure",
  },
];

const PIPELINE_DETAILS = [
  {
    title: "Ingestion Engine",
    emoji: "📄",
    agent: "Ingestion & Sanitization Worker",
    log: [
      "[info] Ingesting 'service_agreement_v2.docx'",
      "[info] Extracting document paragraphs...",
      "[success] Extracted 42 paragraphs, 14,230 characters.",
      "[info] Sanitizing control characters & non-utf8 segments..."
    ],
    technicalText: "The system reads raw binary DOCX structures, parses XML namespaces, sanitizes formatting overhead, and returns clean markdown/text content while retaining document flow indicators."
  },
  {
    title: "Clause Extraction",
    emoji: "🔍",
    agent: "Clause Extraction Agent",
    log: [
      "[info] Starting paragraph segmentation...",
      "[info] Invoking Llama-3.1 via Vercel AI SDK...",
      "[info] Segmenting clauses by thematic boundaries & headings...",
      "[success] Extracted 12 key clauses (Indemnification, SLA, IP, etc.)",
      "[warning] 1 unnamed paragraph appended to preceding clause"
    ],
    technicalText: "Our semantic extraction agent maps document partitions to structured schemas. It validates that every numbered/named section heading is accounted for, preventing extraction dropouts."
  },
  {
    title: "Risk & Compliance",
    emoji: "⚖️",
    agent: "Risk Scorer & Compliance Checker",
    log: [
      "[info] Running risk scoring on 12 extracted clauses...",
      "[info] Scoring Clause 4 (Indemnification): 85/100 (Critical)",
      "[info] Checking compliance against GDPR, CCPA, SOX...",
      "[warning] Clause 9 (Data Protection) missing standard GDPR Article 28 DPA references."
    ],
    technicalText: "Using dynamic RAG-based calibration and regulatory rules, clauses are assessed for liability limits, compliance overrides, and score floors. Overall score is aggregated using a weighted floor algorithm."
  },
  {
    title: "Agentic Redlining",
    emoji: "✏️",
    agent: "Redliner & Mitigation Agent",
    log: [
      "[info] Preparing redlines for high-risk clauses (Score >= 60)...",
      "[info] Redlining Clause 4 (Indemnification) from Provider to Client perspective...",
      "[success] Generated revised text with tracked-changes.",
      "[info] Re-evaluating mitigated clause risk: 85 -> 15 (Low Risk)"
    ],
    technicalText: "The redlining agent strikes out one-sided clauses, replacing them with commercial-friendly terms. A self-correction loop scores the revision to ensure risk was actually mitigated."
  },
  {
    title: "Attorney Review",
    emoji: "✅",
    agent: "Human-In-The-Loop Approval Gate",
    log: [
      "[info] Compiling redlined DOCX and executive summary PDF...",
      "[info] Publishing review package to database: awaiting approval...",
      "[success] Audit trail logged: State ready for manual review.",
      "[info] Ready for human sign-off."
    ],
    technicalText: "Aggregated results are compiled into visual track-change documents (DOCX) and PDF reports. An approval gate blocks deployment until an attorney reviews the suggestions."
  }
];

const CLAUSE_EXPLORER_DATA = {
  indemnification: {
    name: "Indemnification",
    description: "Deals with duty to defend and pay for damages arising from third-party lawsuits.",
    checkpoints: ["Is it mutual?", "Are third-party IP claims capped?", "Are there clear exclusions for negligence?"],
    original: "Contractor shall indemnify, defend, and hold harmless Client from and against any and all claims, losses, liabilities, damages, and expenses without limit.",
    revised: "Contractor shall indemnify, defend, and hold harmless Client from and against third-party claims arising from Contractor's gross negligence or willful misconduct, capped at the liability limit of this Agreement.",
    rationale: "Balances the indemnity to prevent unlimited liability exposure and limits it to gross negligence."
  },
  liability: {
    name: "Limitation of Liability",
    description: "Sets the maximum financial liability of a party under the contract.",
    checkpoints: ["Is there a cap?", "Is the cap mutual?", "Are indirect or consequential damages excluded?"],
    original: "In no event shall Company be liable for any damages whatsoever, and Client's liability for any breach shall be completely unlimited.",
    revised: "Except for breach of confidentiality, neither party shall be liable for indirect or consequential damages, and each party's total liability shall be capped at the fees paid in the prior 12 months.",
    rationale: "Establishes a mutual cap based on contract value and excludes consequential damages."
  },
  ip: {
    name: "Intellectual Property",
    description: "Determines ownership of existing IP and newly developed work product.",
    checkpoints: ["Is work-for-hire explicitly defined?", "Are pre-existing materials licensed?", "Is there a clear transfer of ownership?"],
    original: "All materials, concepts, designs, and code created by Developer shall immediately become the absolute property of Client upon creation.",
    revised: "All deliverables created specifically for Client shall become Client property upon full payment of outstanding invoices. Pre-existing materials remain Developer property.",
    rationale: "Gates ownership transfer on payment receipt and preserves pre-existing intellectual property rights."
  },
  data_protection: {
    name: "Data Protection / GDPR",
    description: "Governs personal data security, processing guidelines, and regulatory compliance.",
    checkpoints: ["Are sub-processors listed?", "Is there a data breach notification window?", "Is DPA incorporated?"],
    original: "Provider will take reasonable measures to secure client data and will notify client of any security incident in due course.",
    revised: "Provider will process personal data in compliance with GDPR and the DPA, implementing industry-standard security. Provider will notify Client of any confirmed data breach within 48 hours.",
    rationale: "Establishes GDPR compliance and sets a concrete 48-hour notification window for breaches."
  },
  governing_law: {
    name: "Governing Law",
    description: "Specifies the jurisdiction and laws that govern the contract and disputes.",
    checkpoints: ["Is the jurisdiction neutral?", "Is arbitration required?", "Are local court systems specified?"],
    original: "This Agreement shall be governed by and construed in accordance with the laws of the counterparty's home jurisdiction in Zurich, Switzerland.",
    revised: "This Agreement shall be governed by the laws of the State of Delaware, without regard to conflict of law principles. Any dispute shall be heard in the courts of Delaware.",
    rationale: "Standardizes governing law to a neutral, commercially recognized jurisdiction (Delaware)."
  }
};
