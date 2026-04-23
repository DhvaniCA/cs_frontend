import React, { useState, useEffect } from "react";
import api from "./api";
import "./App.css";

interface Props {
  onLoggedIn: (role: "student" | "admin") => void;
}

const CS_LEVELS = ["CSEET", "Executive", "Professional"] as const;
type CSLevel = typeof CS_LEVELS[number];

declare global {
  interface Window { Razorpay: any; }
}

const PLAN_PRICES: Record<CSLevel, number> = {
  CSEET:   499,
  Executive:    599,
  Professional: 699,
};

const PLAN_FEATURES: Record<CSLevel, string[]> = {
  CSEET: [
    "All CSEET study materials",
    "AI Tutor – unlimited questions",
    "ICSI syllabus PDFs",
    "Company Law basics covered",
    "Priority support",
  ],
  Executive: [
    "All Executive modules",
    "AI Tutor – unlimited questions",
    "Corporate Law & Governance PDFs",
    "SEBI & Securities Law materials",
    "Mock test papers",
    "Priority support",
  ],
  Professional: [
    "Complete Professional level content",
    "AI Tutor – unlimited questions",
    "Advanced Corporate Law PDFs",
    "Insolvency (IBC) study materials",
    "Full mock test series",
    "1-on-1 doubt resolution",
    "Priority support",
  ],
};

const ATTEMPT_MONTHS: Record<CSLevel, string[]> = {
  CSEET:        ["February", "June", "October"],
  Executive:    ["June", "December"],
  Professional: ["June", "December"],
};

const FREE_FEATURES = [
  "3 AI questions per day",
  "Limited study material access",
  "Basic ICSI PDFs only",
  "Community support",
];

type Step = "details" | "plan" | "payment";
type ForgotStep = "email" | "otp" | "newpass" | "done";

const Auth: React.FC<Props> = ({ onLoggedIn }) => {
  const [mode, setMode] = useState<"login" | "signup">("login");

  const [forgotOpen,    setForgotOpen]    = useState(false);
  const [forgotStep,    setForgotStep]    = useState<ForgotStep>("email");
  const [forgotEmail,   setForgotEmail]   = useState("");
  const [forgotOtp,     setForgotOtp]     = useState("");
  const [newPassword,   setNewPassword]   = useState("");
  const [forgotError,   setForgotError]   = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const [step, setStep] = useState<Step>("details");
  const [email,         setEmail]         = useState("");
  const [password,      setPassword]      = useState("");
  const [name,          setName]          = useState("");
  const [phone,         setPhone]         = useState("");
  const [csLevel,       setCsLevel]       = useState<CSLevel | "">("");
  const [csAttempt,     setCsAttempt]     = useState("");
  const [selectedPlan,  setSelectedPlan]  = useState<"free" | "paid" | null>(null);
  const [paymentDone,   setPaymentDone]   = useState(false);
  const [razorpayOrderId, setRazorpayOrderId] = useState<string | null>(null);

  const [error,          setError]          = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading,        setLoading]        = useState(false);
  const [showPass,       setShowPass]       = useState(false);
  const [rzpLoaded,      setRzpLoaded]      = useState(false);

  useEffect(() => {
    if (document.getElementById("razorpay-sdk")) { setRzpLoaded(true); return; }
    const script = document.createElement("script");
    script.id = "razorpay-sdk";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => setRzpLoaded(true);
    document.body.appendChild(script);
  }, []);

  const resetForgot = () => {
    setForgotOpen(false); setForgotStep("email");
    setForgotEmail(""); setForgotOtp(""); setNewPassword(""); setForgotError("");
  };

  const handleForgotSendOtp = async (e: React.FormEvent) => {
    e.preventDefault(); setForgotError(""); setForgotLoading(true);
    try { await api.post("/auth/forgot-password", { email: forgotEmail }); setForgotStep("otp"); }
    catch (err: any) { setForgotError(err?.response?.data?.detail || "Failed to send OTP."); }
    finally { setForgotLoading(false); }
  };

  const handleForgotVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault(); setForgotError(""); setForgotLoading(true);
    try { await api.post("/auth/verify-otp", { email: forgotEmail, otp: forgotOtp }); setForgotStep("newpass"); }
    catch (err: any) { setForgotError(err?.response?.data?.detail || "Invalid OTP."); }
    finally { setForgotLoading(false); }
  };

  const handleForgotResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) { setForgotError("Password must be at least 6 characters."); return; }
    setForgotError(""); setForgotLoading(true);
    try {
      await api.post("/auth/reset-password", { email: forgotEmail, otp: forgotOtp, new_password: newPassword });
      setForgotStep("done");
    } catch (err: any) { setForgotError(err?.response?.data?.detail || "Reset failed."); }
    finally { setForgotLoading(false); }
  };

  const reset = () => {
    setEmail(""); setPassword(""); setError(""); setSuccessMessage("");
    setName(""); setPhone(""); setCsLevel(""); setCsAttempt("");
    setStep("details"); setSelectedPlan(null); setPaymentDone(false); setRazorpayOrderId(null);
  };

  const toggleMode = () => { reset(); setMode((m) => m === "login" ? "signup" : "login"); };

  const proceedToPlan = (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    if (!csLevel)   { setError("Please select your CS level."); return; }
    if (!csAttempt) { setError("Please select your attempt."); return; }
    setStep("plan");
  };

  const choosePlan = async (plan: "free" | "paid") => {
    setSelectedPlan(plan); setError("");
    if (plan === "free") { setStep("payment"); return; }
    setLoading(true);
    try {
      const amount = PLAN_PRICES[csLevel as CSLevel] * 100;
      const res = await api.post("/payments/create-order", { amount, currency: "INR", plan: csLevel });
      setRazorpayOrderId(res.data.order_id);
      setStep("payment");
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Could not initiate payment. Please try again.");
      setSelectedPlan(null);
    } finally { setLoading(false); }
  };

  const launchRazorpay = () => {
    if (!rzpLoaded || !window.Razorpay) { setError("Payment SDK not loaded. Please refresh."); return; }
    const amount = PLAN_PRICES[csLevel as CSLevel];
    const options = {
      key: import.meta.env.VITE_RAZORPAY_KEY_ID || "rzp_test_XXXXXXXXXXXXXXX",
      amount: amount * 100,
      currency: "INR",
      name: "CS Tutor",
      description: `${csLevel} Plan – ₹${amount}/month`,
      order_id: razorpayOrderId,
      prefill: { name, email, contact: phone },
      theme: { color: "#d4882a" },
      handler: async (response: any) => {
        setLoading(true);
        try {
          await api.post("/payments/verify", {
            razorpay_order_id:   response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature:  response.razorpay_signature,
          });
          setPaymentDone(true);
          await submitSignup("paid", response.razorpay_payment_id);
        } catch { setError("Payment verification failed. Please contact support."); }
        finally { setLoading(false); }
      },
      modal: { ondismiss: () => setError("Payment cancelled. You can try again.") },
    };
    const rzp = new window.Razorpay(options);
    rzp.open();
  };

  const submitSignup = async (plan: "free" | "paid", paymentId?: string) => {
    setLoading(true); setError("");
    try {
      await api.post("/auth/register", {
        email, password, name, phone,
        cs_level:   csLevel,
        cs_attempt: csAttempt,
        plan,
        payment_id: paymentId || null,
      });
      setSuccessMessage(
        plan === "paid"
          ? "Payment successful! Your CS Tutor account has been created."
          : "Free account created! You can now sign in."
      );
      setMode("login");
      reset();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Signup failed. Please try again.");
    } finally { setLoading(false); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setSuccessMessage(""); setLoading(true);
    try {
      const res = await api.post("/auth/login", { email, password });
      localStorage.setItem("token", res.data.access_token);
      const me = await api.get("/auth/me");
      onLoggedIn(me.data.role);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Invalid credentials. Please try again.");
    } finally { setLoading(false); }
  };

  const STEPS = ["Details", "Choose Plan", "Confirm"];
  const stepIdx = step === "details" ? 0 : step === "plan" ? 1 : 2;

  return (
    <div className="auth-page">
      <div className="auth-bg-blob auth-bg-blob-1" />
      <div className="auth-bg-blob auth-bg-blob-2" />

      <div className={`auth-card-premium${mode === "signup" && step !== "details" ? " auth-card-wide" : ""}`}>

        {/* Brand */}
        <div className="auth-brand">
          <div className="auth-logo"><span className="auth-logo-text">CS</span></div>
          <div className="auth-brand-info">
            <span className="auth-brand-name">CS Tutor</span>
            <span className="auth-brand-tag">AI-Powered ICSI Exam Prep</span>
          </div>
        </div>

        {/* ── LOGIN ── */}
        {mode === "login" && (
          <>
            <div className="auth-top">
              <h1>Welcome back</h1>
              <p>Sign in to continue your Company Secretary exam preparation.</p>
            </div>
            <form className="auth-form" onSubmit={handleLogin}>
              <div className="auth-field">
                <label className="auth-label">Email address</label>
                <input className="auth-input" type="email" placeholder="you@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              <div className="auth-field">
                <div className="auth-label-row">
                  <label className="auth-label">Password</label>
                  <button type="button" className="auth-forgot-link"
                    onClick={() => { setForgotOpen(true); setForgotStep("email"); setForgotError(""); }}>
                    Forgot password?
                  </button>
                </div>
                <div className="auth-input-wrap">
                  <input className="auth-input" type={showPass ? "text" : "password"}
                    placeholder="••••••••" value={password}
                    onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                  <button type="button" className="auth-pass-toggle"
                    onClick={() => setShowPass((p) => !p)} tabIndex={-1}
                    aria-label={showPass ? "Hide" : "Show"}>
                    {showPass ? "🙈" : "👁"}
                  </button>
                </div>
              </div>
              {error && <div className="auth-error" role="alert"><span className="auth-alert-icon">⚠</span> {error}</div>}
              {successMessage && <div className="auth-success" role="status"><span className="auth-alert-icon">✅</span> {successMessage}</div>}
              <button className="auth-btn" type="submit" disabled={loading}>
                {loading ? <span className="auth-btn-loading"><span className="auth-spinner" />Please wait…</span> : "Sign In →"}
              </button>
            </form>
            <div className="auth-divider"><span>or</span></div>
            <div className="auth-switch">
              Don't have an account? <button type="button" onClick={toggleMode}>Sign up free</button>
            </div>
            <div className="auth-trust">
              <span>🔒 Secure</span><span>📋 ICSI Aligned</span><span>🤖 AI-Powered</span>
            </div>
          </>
        )}

        {/* ── SIGNUP ── */}
        {mode === "signup" && (
          <>
            {/* Step bar */}
            <div className="signup-steps">
              {STEPS.map((label, i) => (
                <React.Fragment key={label}>
                  <div className={`signup-step${i <= stepIdx ? " signup-step-done" : ""}${i === stepIdx ? " signup-step-active" : ""}`}>
                    <div className="signup-step-dot">{i < stepIdx ? "✓" : i + 1}</div>
                    <span className="signup-step-label">{label}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`signup-step-line${i < stepIdx ? " signup-step-line-done" : ""}`} />
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* Step 1: Details */}
            {step === "details" && (
              <>
                <div className="auth-top">
                  <h1>Create account</h1>
                  <p>Join CS students preparing smarter with AI.</p>
                </div>

                {/* CS Level pills */}
                <div className="auth-level-pills">
                  {CS_LEVELS.map((lvl) => (
                    <button key={lvl} type="button"
                      className={`auth-level-pill${csLevel === lvl ? " auth-level-pill-active" : ""}`}
                      onClick={() => setCsLevel(lvl)}>{lvl}</button>
                  ))}
                </div>

                <form className="auth-form" onSubmit={proceedToPlan}>
                  <div className="auth-form-row">
                    <div className="auth-field">
                      <label className="auth-label">Full Name</label>
                      <input className="auth-input" type="text" placeholder="Priya Sharma"
                        value={name} onChange={(e) => setName(e.target.value)} required />
                    </div>
                    <div className="auth-field">
                      <label className="auth-label">Phone</label>
                      <input className="auth-input" type="tel" placeholder="10-digit number"
                        value={phone} onChange={(e) => setPhone(e.target.value)} required />
                    </div>
                  </div>
                  <div className="auth-field">
                    <label className="auth-label">Email address</label>
                    <input className="auth-input" type="email" placeholder="you@example.com"
                      value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                  </div>
                  <div className="auth-field">
                    <label className="auth-label">
                      CS Attempt
                      <span className="auth-label-hint"> (select your exam attempt)</span>
                    </label>
                    <select
                      className="auth-input"
                      value={csAttempt}
                      onChange={(e) => setCsAttempt(e.target.value)}
                      required
                      disabled={!csLevel}
                      style={{ cursor: csLevel ? "pointer" : "not-allowed", opacity: csLevel ? 1 : 0.5 }}
                    >
                      <option value="" disabled>
                        {csLevel ? "— Select attempt —" : "Select your CS level first"}
                      </option>
                      {csLevel && (() => {
                        const curYear  = new Date().getFullYear();
                        const nextYear = curYear + 1;
                        return [curYear, nextYear].map((yr) => (
                          <optgroup key={yr} label={`📅 ${yr}`}>
                            {ATTEMPT_MONTHS[csLevel as CSLevel].map((month) => (
                              <option key={`${month}-${yr}`} value={`${month} ${yr}`}>
                                {month} {yr}
                              </option>
                            ))}
                          </optgroup>
                        ));
                      })()}
                    </select>
                    {csLevel && (
                      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                        {csLevel} exams: {ATTEMPT_MONTHS[csLevel as CSLevel].join(", ")} each year
                        {csLevel === "CSEET" && " (3 attempts per year)"}
                      </p>
                    )}
                  </div>
                  <div className="auth-field">
                    <label className="auth-label">Password</label>
                    <div className="auth-input-wrap">
                      <input className="auth-input" type={showPass ? "text" : "password"}
                        placeholder="••••••••" value={password}
                        onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
                      <button type="button" className="auth-pass-toggle"
                        onClick={() => setShowPass((p) => !p)} tabIndex={-1}>
                        {showPass ? "🙈" : "👁"}
                      </button>
                    </div>
                  </div>
                  {error && <div className="auth-error" role="alert"><span className="auth-alert-icon">⚠</span> {error}</div>}
                  <button className="auth-btn" type="submit">Choose Plan →</button>
                </form>
              </>
            )}

            {/* Step 2: Plan */}
            {step === "plan" && (
              <div className="plan-step">
                <div className="auth-top">
                  <h1>Choose your plan</h1>
                  <p>Selected level: <strong>{csLevel}</strong></p>
                </div>

                <div className="plan-cards">
                  <div className="plan-card plan-card-free">
                    <div className="plan-card-top">
                      <div className="plan-badge plan-badge-free">Free</div>
                      <div className="plan-price">
                        <span className="plan-price-amount">₹0</span>
                        <span className="plan-price-period">/month</span>
                      </div>
                      <p className="plan-card-desc">Get started with limited access</p>
                    </div>
                    <ul className="plan-features">
                      {FREE_FEATURES.map((f) => (
                        <li key={f}><span className="plan-feat-icon plan-feat-icon-free">✓</span>{f}</li>
                      ))}
                    </ul>
                    <button className="plan-cta plan-cta-free" onClick={() => choosePlan("free")} disabled={loading}>
                      Continue Free
                    </button>
                  </div>

                  <div className="plan-card plan-card-paid">
                    <div className="plan-card-glow" />
                    <div className="plan-card-top">
                      <div className="plan-badge plan-badge-paid">✨ Premium</div>
                      <div className="plan-price">
                        <span className="plan-price-amount">₹{PLAN_PRICES[csLevel as CSLevel]}</span>
                        <span className="plan-price-period">/month</span>
                      </div>
                      <p className="plan-card-desc">{csLevel} — full access</p>
                    </div>
                    <ul className="plan-features">
                      {PLAN_FEATURES[csLevel as CSLevel].map((f) => (
                        <li key={f}><span className="plan-feat-icon plan-feat-icon-paid">★</span>{f}</li>
                      ))}
                    </ul>
                    <button className="plan-cta plan-cta-paid" onClick={() => choosePlan("paid")} disabled={loading}>
                      {loading ? <><span className="auth-spinner" /> Loading…</> : "Pay with Razorpay →"}
                    </button>
                    <p className="plan-secure-note">🔒 Secured by Razorpay · UPI · Cards · NetBanking</p>
                  </div>
                </div>

                {error && <div className="auth-error" role="alert"><span className="auth-alert-icon">⚠</span> {error}</div>}
                <button className="plan-back-btn" onClick={() => { setStep("details"); setError(""); }}>← Back</button>
              </div>
            )}

            {/* Step 3: Payment / Confirm */}
            {step === "payment" && (
              <div className="payment-step">
                {selectedPlan === "free" ? (
                  <div className="payment-confirm">
                    <div className="payment-confirm-icon">🎓</div>
                    <h2>Free Plan Selected</h2>
                    <p>You're signing up for the <strong>free tier</strong>. You'll get limited access to CS Tutor.</p>
                    <div className="payment-summary-box payment-summary-free">
                      <div className="psb-row"><span>Plan</span><strong>Free</strong></div>
                      <div className="psb-row"><span>Level</span><strong>{csLevel}</strong></div>
                      <div className="psb-row"><span>Billing</span><strong>₹0 / month</strong></div>
                    </div>
                    {error && <div className="auth-error" role="alert"><span className="auth-alert-icon">⚠</span> {error}</div>}
                    <button className="auth-btn" onClick={() => submitSignup("free")} disabled={loading}>
                      {loading ? <><span className="auth-spinner" /> Creating account…</> : "Create Free Account →"}
                    </button>
                  </div>
                ) : paymentDone ? (
                  <div className="payment-confirm payment-success-screen">
                    <div className="payment-confirm-icon payment-success-icon">✅</div>
                    <h2>Payment Successful!</h2>
                    <p>Your <strong>{csLevel} Premium</strong> account is being set up.</p>
                  </div>
                ) : (
                  <div className="payment-confirm">
                    <div className="payment-confirm-icon">💳</div>
                    <h2>Complete Payment</h2>
                    <p>You're one step away from full <strong>{csLevel}</strong> access.</p>
                    <div className="payment-summary-box payment-summary-paid">
                      <div className="psb-row"><span>Plan</span><strong>{csLevel} Premium</strong></div>
                      <div className="psb-row"><span>Billing</span><strong>Monthly</strong></div>
                      <div className="psb-row psb-total">
                        <span>Total</span>
                        <strong>₹{PLAN_PRICES[csLevel as CSLevel]} / month</strong>
                      </div>
                    </div>
                    <div className="rzp-methods">
                      <span>UPI</span><span>Cards</span><span>Net Banking</span><span>Wallets</span>
                    </div>
                    {error && <div className="auth-error" role="alert"><span className="auth-alert-icon">⚠</span> {error}</div>}
                    <button className="auth-btn plan-cta-paid-btn" onClick={launchRazorpay} disabled={loading || !rzpLoaded}>
                      {loading ? <><span className="auth-spinner" /> Please wait…</> : `Pay ₹${PLAN_PRICES[csLevel as CSLevel]} →`}
                    </button>
                    <p className="plan-secure-note">🔒 100% secure · Powered by Razorpay</p>
                  </div>
                )}
                <button className="plan-back-btn" onClick={() => { setStep("plan"); setError(""); }}>← Change Plan</button>
              </div>
            )}

            <div className="auth-divider"><span>or</span></div>
            <div className="auth-switch">
              Already have an account? <button type="button" onClick={toggleMode}>Sign in</button>
            </div>
          </>
        )}
      </div>

      {/* FORGOT PASSWORD MODAL */}
      {forgotOpen && (
        <div className="forgot-overlay" onClick={(e) => { if (e.target === e.currentTarget) resetForgot(); }}>
          <div className="forgot-modal" role="dialog" aria-modal="true" aria-label="Reset Password">
            <button className="forgot-close" onClick={resetForgot} aria-label="Close">✕</button>

            {forgotStep === "email" && (
              <>
                <div className="forgot-icon">🔐</div>
                <h2 className="forgot-title">Forgot Password?</h2>
                <p className="forgot-sub">Enter your registered email. We'll send a 6-digit OTP.</p>
                <form className="auth-form" onSubmit={handleForgotSendOtp}>
                  <div className="auth-field">
                    <label className="auth-label">Email address</label>
                    <input className="auth-input" type="email" placeholder="you@example.com"
                      value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} required autoFocus />
                  </div>
                  {forgotError && <div className="auth-error" role="alert"><span className="auth-alert-icon">⚠</span> {forgotError}</div>}
                  <button className="auth-btn" type="submit" disabled={forgotLoading}>
                    {forgotLoading ? <><span className="auth-spinner" /> Sending…</> : "Send OTP →"}
                  </button>
                </form>
              </>
            )}

            {forgotStep === "otp" && (
              <>
                <div className="forgot-icon">📩</div>
                <h2 className="forgot-title">Enter OTP</h2>
                <p className="forgot-sub">A 6-digit OTP was sent to <strong>{forgotEmail}</strong>. Valid for 10 minutes.</p>
                <form className="auth-form" onSubmit={handleForgotVerifyOtp}>
                  <div className="auth-field">
                    <label className="auth-label">6-digit OTP</label>
                    <input className="auth-input forgot-otp-input" type="text"
                      placeholder="— — — — — —" maxLength={6} value={forgotOtp}
                      onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, ""))}
                      required autoFocus />
                  </div>
                  {forgotError && <div className="auth-error" role="alert"><span className="auth-alert-icon">⚠</span> {forgotError}</div>}
                  <button className="auth-btn" type="submit" disabled={forgotLoading || forgotOtp.length < 6}>
                    {forgotLoading ? <><span className="auth-spinner" /> Verifying…</> : "Verify OTP →"}
                  </button>
                </form>
                <button className="plan-back-btn" style={{ marginTop: 8 }}
                  onClick={() => { setForgotStep("email"); setForgotError(""); setForgotOtp(""); }}>
                  ← Change email
                </button>
              </>
            )}

            {forgotStep === "newpass" && (
              <>
                <div className="forgot-icon">🔑</div>
                <h2 className="forgot-title">Set New Password</h2>
                <p className="forgot-sub">Choose a strong password for your account.</p>
                <form className="auth-form" onSubmit={handleForgotResetPassword}>
                  <div className="auth-field">
                    <label className="auth-label">New Password</label>
                    <div className="auth-input-wrap">
                      <input className="auth-input" type={showPass ? "text" : "password"}
                        placeholder="Min. 6 characters" value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)} required autoFocus />
                      <button type="button" className="auth-pass-toggle"
                        onClick={() => setShowPass((p) => !p)} tabIndex={-1}>
                        {showPass ? "🙈" : "👁"}
                      </button>
                    </div>
                  </div>
                  {forgotError && <div className="auth-error" role="alert"><span className="auth-alert-icon">⚠</span> {forgotError}</div>}
                  <button className="auth-btn" type="submit" disabled={forgotLoading || newPassword.length < 6}>
                    {forgotLoading ? <><span className="auth-spinner" /> Saving…</> : "Reset Password →"}
                  </button>
                </form>
              </>
            )}

            {forgotStep === "done" && (
              <div className="forgot-done">
                <div className="forgot-done-icon">✅</div>
                <h2 className="forgot-title">Password Reset!</h2>
                <p className="forgot-sub">Your password has been updated. You can now sign in.</p>
                <button className="auth-btn" onClick={resetForgot}>Go to Sign In →</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Auth;
