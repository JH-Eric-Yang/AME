import { writable, derived } from "svelte/store";

interface Experimenter {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  token: string | null;
  experimenter: Experimenter | null;
}

function createAuthStore() {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem("ame-auth") : null;
  const initial: AuthState = stored ? JSON.parse(stored) : { token: null, experimenter: null };

  const { subscribe, set, update } = writable<AuthState>(initial);

  return {
    subscribe,
    login(token: string, experimenter: Experimenter) {
      const state = { token, experimenter };
      localStorage.setItem("ame-auth", JSON.stringify(state));
      set(state);
    },
    logout() {
      localStorage.removeItem("ame-auth");
      set({ token: null, experimenter: null });
    },
    getToken(): string | null {
      let token: string | null = null;
      subscribe((s) => (token = s.token))();
      return token;
    },
  };
}

export const auth = createAuthStore();
export const isAuthenticated = derived(auth, ($auth) => $auth.token !== null);
