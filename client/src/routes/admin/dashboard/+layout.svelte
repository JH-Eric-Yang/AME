<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { auth, isAuthenticated } from "$lib/stores/auth";
  import { onMount } from "svelte";
  import Logo from "$lib/components/Logo.svelte";

  let currentPath = $derived($page.url.pathname);
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
  let loaded = $state(false);

  onMount(() => {
    if (!$isAuthenticated) {
      goto("/admin/login");
      return;
    }
    requestAnimationFrame(() => { loaded = true; });
  });

  function handleLogout() {
    auth.logout();
    goto("/admin/login");
  }
</script>

{#if $isAuthenticated}
  <div class="dashboard" class:loaded>
    <header class="topbar">
      <div class="topbar-left">
        <a href="/admin/dashboard" class="brand" aria-label="AME dashboard">
          <Logo size={22} wordmark />
        </a>
        <a href="/admin/dashboard" class="nav-link" class:active={currentPath === '/admin/dashboard'}>Experiments</a>
        {#if $auth.experimenter?.role === "ADMIN"}
          <a href="/admin/dashboard/accounts" class="nav-link" class:active={currentPath === '/admin/dashboard/accounts'}>Accounts</a>
          <a href="/admin/dashboard/errors" class="nav-link" class:active={currentPath === '/admin/dashboard/errors'}>Errors</a>
        {/if}
      </div>
      <div class="topbar-right">
        <span class="user-name">{$auth.experimenter?.name ?? ""}</span>
        <button class="logout-btn" onclick={handleLogout}>Sign Out</button>
      </div>
    </header>

    <main class="main">
      {@render children()}
    </main>
  </div>
{/if}

<style>
  .dashboard {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--white);
  }

  .dashboard .main {
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 400ms ease, transform 400ms ease;
  }
  .dashboard.loaded .main {
    opacity: 1;
    transform: translateY(0);
    transition-delay: 80ms;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 2rem;
    height: 56px;
    background: var(--white);
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .topbar-left {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }

  .brand { display: flex; align-items: center; margin-right: 0.5rem; }

  .nav-link {
    position: relative;
    font-size: 13px;
    font-weight: 500;
    color: var(--gray-500);
    padding: 0.25rem 0;
    transition: color var(--transition);
  }
  .nav-link:hover { color: var(--black); }
  .nav-link.active { color: var(--black); font-weight: 600; }
  /* The active link carries a small orange dot under it, the page's one "you are here" mark. */
  .nav-link.active::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: -6px;
    width: 5px;
    height: 5px;
    margin-left: -2.5px;
    border-radius: 50%;
    background: var(--accent);
  }

  .topbar-right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .user-name {
    font-size: 13px;
    color: var(--gray-500);
  }

  .logout-btn {
    font-size: 12px;
    font-weight: 500;
    padding: 0.35rem 0.85rem;
    background: none;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-pill);
    color: var(--gray-500);
    cursor: pointer;
    transition: color var(--transition), border-color var(--transition);
  }
  .logout-btn:hover {
    border-color: var(--black);
    color: var(--black);
  }

  .main {
    flex: 1;
    padding: 2rem;
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
  }
</style>
