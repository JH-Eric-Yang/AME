<script lang="ts">
  import { goto } from "$app/navigation";
  import { auth } from "$lib/stores/auth";
  import * as api from "$lib/api";
  import { onMount } from "svelte";

  let mode = $state<"login" | "signup">("login");
  let email = $state("");
  let password = $state("");
  let name = $state("");
  let error = $state("");
  let success = $state("");
  let loading = $state(false);
  let loaded = $state(false);

  onMount(() => {
    requestAnimationFrame(() => { loaded = true; });
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = "";
    success = "";
    loading = true;

    try {
      if (mode === "login") {
        const res = await api.login(email, password);
        auth.login(res.token, res.experimenter);
        goto("/admin/dashboard");
      } else {
        const res = await api.signup(email, password, name);
        success = res.message;
        mode = "login";
      }
    } catch (err) {
      error = err instanceof api.ApiError ? err.message : "An error occurred";
    } finally {
      loading = false;
    }
  }
</script>

<div class="login-page" class:loaded>
  <div class="grain"></div>

  <!-- Left panel: branding -->
  <div class="brand-panel">
    <div class="brand-content">
      <div class="brand-hero">
        <div class="brand-badge">EXPERIMENTER ACCESS</div>
        <h1>AME</h1>
        <p>Design autonomous experiments with multimodal data collection and real-time video conferencing.</p>
      </div>

      <div class="brand-footer">
        <div class="feature">
          <div class="feature-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>
          </div>
          <span>Visual Builder</span>
        </div>
        <div class="feature">
          <div class="feature-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><path d="M6 10V6l5 2-5 2z" fill="currentColor"/></svg>
          </div>
          <span>Video Chat</span>
        </div>
        <div class="feature">
          <div class="feature-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          </div>
          <span>CSV Export</span>
        </div>
      </div>
    </div>

    <!-- Decorative elements -->
    <div class="deco-line deco-1"></div>
    <div class="deco-line deco-2"></div>
    <div class="deco-accent"></div>
  </div>

  <!-- Right panel: form -->
  <div class="form-panel">
    <div class="form-container">
      <div class="form-header">
        <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
        <p class="form-sub">
          {mode === "login"
            ? "Enter your credentials to access the dashboard."
            : "Create an account. An administrator will review your request."}
        </p>
      </div>

      {#if success}
        <div class="success-banner">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 7l2 2 3.5-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>{success}</span>
        </div>
      {/if}

      {#if error}
        <div class="error-banner">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.2"/><path d="M7 4v3M7 9v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <span>{error}</span>
        </div>
      {/if}

      <form onsubmit={handleSubmit}>
        {#if mode === "signup"}
          <div class="field">
            <label for="name">Full Name</label>
            <input id="name" type="text" bind:value={name} placeholder="Dr. Jane Smith" required />
          </div>
        {/if}

        <div class="field">
          <label for="email">Email</label>
          <input id="email" type="email" bind:value={email} placeholder="researcher@university.ac.uk" required />
        </div>

        <div class="field">
          <label for="password">Password</label>
          <input id="password" type="password" bind:value={password} placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" required />
        </div>


        <button type="submit" class="submit-btn" disabled={loading}>
          {#if loading}
            <span class="spinner"></span>
          {:else}
            <span>{mode === "login" ? "Sign In" : "Create Account"}</span>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 7h12M8 2l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          {/if}
        </button>
      </form>

      <div class="divider">
        <span>or</span>
      </div>

      <button class="toggle-btn" onclick={() => { mode = mode === "login" ? "signup" : "login"; error = ""; }}>
        {mode === "login" ? "Create a new account" : "Sign in to existing account"}
      </button>
    </div>
  </div>
</div>

<style>
  .login-page {
    display: grid;
    grid-template-columns: 1fr 1fr;
    min-height: 100vh;
    position: relative;
  }

  /* Load animation */
  .login-page .brand-content,
  .login-page .form-container {
    opacity: 0;
    transform: translateY(16px);
    transition: opacity 500ms ease, transform 500ms ease;
  }
  .login-page.loaded .brand-content {
    opacity: 1; transform: translateY(0); transition-delay: 100ms;
  }
  .login-page.loaded .form-container {
    opacity: 1; transform: translateY(0); transition-delay: 250ms;
  }

  .grain {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 100;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
    background-repeat: repeat;
    background-size: 256px 256px;
  }

  /* Brand panel */
  .brand-panel {
    position: relative;
    background: var(--black);
    color: var(--white);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3rem;
    overflow: hidden;
  }

  .brand-content {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    height: 100%;
    max-width: 380px;
  }

  .brand-hero {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .brand-badge {
    font-family: var(--font-display);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.2em;
    color: var(--accent);
    margin-bottom: 1.5rem;
  }

  .brand-hero h1 {
    font-family: var(--font-display);
    font-size: 56px;
    font-weight: 700;
    line-height: 0.95;
    letter-spacing: -0.03em;
    margin: 0 0 1.5rem;
  }

  .brand-hero p {
    font-size: 14px;
    line-height: 1.7;
    color: rgba(255,255,255,0.5);
    max-width: 300px;
  }

  .brand-footer {
    display: flex;
    gap: 1.5rem;
  }
  .feature {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 11px;
    color: rgba(255,255,255,0.35);
  }
  .feature-icon {
    color: rgba(255,255,255,0.25);
  }

  /* Decorative lines */
  .deco-line {
    position: absolute;
    background: rgba(255,255,255,0.06);
  }
  .deco-1 {
    width: 1px;
    height: 100%;
    right: 60px;
    top: 0;
  }
  .deco-2 {
    width: 1px;
    height: 100%;
    right: 120px;
    top: 0;
  }
  .deco-accent {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 3px;
    background: var(--accent);
  }

  /* Form panel */
  .form-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3rem;
    background: var(--white);
  }

  .form-container {
    width: 100%;
    max-width: 380px;
  }

  .form-header {
    margin-bottom: 2rem;
  }

  h2 {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin: 0 0 0.5rem;
  }

  .form-sub {
    font-size: 13px;
    color: var(--gray-500);
    margin: 0;
  }

  .success-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 0.75rem;
    background: var(--success-dim);
    border-left: 3px solid var(--success);
    color: var(--success);
    font-size: 13px;
    margin-bottom: 1.5rem;
    border-radius: 0 var(--radius) var(--radius) 0;
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 0.75rem;
    background: var(--accent-dim);
    border-left: 3px solid var(--accent);
    color: var(--accent);
    font-size: 13px;
    margin-bottom: 1.5rem;
    border-radius: 0 var(--radius) var(--radius) 0;
  }

  .field {
    margin-bottom: 1.25rem;
  }

  .field label {
    display: block;
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--gray-500);
    margin-bottom: 0.4rem;
  }

  .field input {
    width: 100%;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    font-size: 14px;
    background: var(--white);
    color: var(--black);
    transition: border-color var(--transition), box-shadow var(--transition);
  }
  .field input::placeholder {
    color: var(--gray-300);
  }
  .field input:focus {
    outline: none;
    border-color: var(--black);
    box-shadow: 0 0 0 3px rgba(10, 10, 10, 0.06);
  }

  .submit-btn {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--black);
    color: var(--white);
    border: none;
    border-radius: var(--radius);
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition: background var(--transition), transform var(--transition);
    margin-top: 0.5rem;
  }
  .submit-btn:hover:not(:disabled) {
    background: var(--accent);
    transform: translateY(-1px);
  }
  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: var(--white);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .divider {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 1.5rem 0;
    color: var(--gray-300);
    font-size: 12px;
  }
  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--gray-200);
  }

  .toggle-btn {
    width: 100%;
    padding: 0.65rem;
    background: none;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--gray-600);
    cursor: pointer;
    transition: all var(--transition);
  }
  .toggle-btn:hover {
    border-color: var(--black);
    color: var(--black);
  }

  @media (max-width: 768px) {
    .login-page {
      grid-template-columns: 1fr;
    }
    .brand-panel {
      display: none;
    }
  }
</style>
