"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || "No se ha podido iniciar sesión.");
      setLoading(false);
      return;
    }

    window.location.href = "/";
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">F</div>
        <p className="eyebrow">Área privada</p>
        <h1>Facturas</h1>
        <p className="muted">Introduce tu contraseña para acceder al gestor.</p>

        <form onSubmit={submit} className="login-form">
          <label>
            Contraseña
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="button primary wide" disabled={loading}>
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
