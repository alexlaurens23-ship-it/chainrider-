// Wallet sign-in for CHAINRIDER. The wallet IS the account and the payout
// address — no passwords, no email. We use the Phantom injected provider
// (window.solana) directly: the app is vanilla TS with no React, so the heavier
// @solana/wallet-adapter stack buys nothing — we only need connect + signMessage.
// The private key never leaves the wallet; we send only the public address and a
// detached ed25519 signature, which the server verifies (hard rule: client never
// trusted). JWT is stored in localStorage and attached as Bearer by net.ts.
import bs58 from "bs58";
import { ApiError, postNonce, postRegister, postVerify } from "./net";

const TOKEN_KEY = "cr_jwt";
const NAME_KEY = "cr_username";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function getUsername(): string | null {
  return localStorage.getItem(NAME_KEY);
}
function setSession(token: string, username: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(NAME_KEY, username);
}
function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NAME_KEY);
}

// ── Phantom provider ─────────────────────────────────────────────────────────

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array }>;
}

function getProvider(): PhantomProvider | null {
  const sol = (window as unknown as { solana?: PhantomProvider }).solana;
  return sol?.isPhantom ? sol : null;
}

async function signMessage(provider: PhantomProvider, message: string): Promise<string> {
  const { signature } = await provider.signMessage(new TextEncoder().encode(message), "utf8");
  return bs58.encode(signature);
}

// ── Flow ─────────────────────────────────────────────────────────────────────

let busy = false;

async function connectFlow(): Promise<void> {
  if (busy) return;
  const provider = getProvider();
  if (!provider) {
    window.open("https://phantom.app/", "_blank");
    return;
  }
  busy = true;
  render();
  try {
    const { publicKey } = await provider.connect();
    const address = publicKey.toString();
    const { message } = await postNonce(address);
    const signature = await signMessage(provider, message);
    const verify = await postVerify(address, signature);
    if (verify.needsUsername) {
      openUsernameModal(provider, address);
    } else {
      setSession(verify.token, verify.username);
    }
  } catch (err) {
    // User rejected the connect/sign, or the verify failed — stay logged out.
    console.warn("wallet connect failed", err);
  } finally {
    busy = false;
    render();
  }
}

async function registerFlow(
  provider: PhantomProvider,
  address: string,
  username: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // A fresh nonce + re-sign — /verify burned the previous one.
  const { message } = await postNonce(address);
  const signature = await signMessage(provider, message);
  try {
    const session = await postRegister(address, signature, username);
    setSession(session.token, session.username);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      return { ok: false, error: "That username is taken." };
    }
    if (err instanceof ApiError && err.status === 400) {
      return { ok: false, error: "3–16 chars: a–z, 0–9, _" };
    }
    return { ok: false, error: "Could not register — try again." };
  }
}

function disconnect(): void {
  getProvider()
    ?.disconnect()
    .catch(() => undefined);
  clearSession();
  render();
}

// ── UI ───────────────────────────────────────────────────────────────────────

let bar: HTMLElement | null = null;

function render(): void {
  if (!bar) return;
  const name = getUsername();
  if (name) {
    bar.innerHTML = `<span class="wb-name">@${name}</span><button class="wb-btn" id="wb-disconnect">Disconnect</button>`;
    bar.querySelector<HTMLButtonElement>("#wb-disconnect")!.addEventListener("click", disconnect);
  } else {
    const label = busy ? "Connecting…" : "Connect Wallet";
    bar.innerHTML = `<button class="wb-btn wb-connect" id="wb-connect" ${busy ? "disabled" : ""}>${label}</button>`;
    bar.querySelector<HTMLButtonElement>("#wb-connect")!.addEventListener("click", () => {
      void connectFlow();
    });
  }
}

function openUsernameModal(provider: PhantomProvider, address: string): void {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-title">PICK A USERNAME</div>
      <div class="modal-sub">This is your rider name on the leaderboards.</div>
      <input class="modal-input" id="wb-username" maxlength="16" autocomplete="off"
             placeholder="3–16: a–z 0–9 _" />
      <div class="modal-error" id="wb-error"></div>
      <div class="modal-buttons">
        <button class="btn-secondary" id="wb-cancel">Cancel</button>
        <button class="btn-primary" id="wb-create">Create</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector<HTMLInputElement>("#wb-username")!;
  const errorEl = overlay.querySelector<HTMLDivElement>("#wb-error")!;
  const createBtn = overlay.querySelector<HTMLButtonElement>("#wb-create")!;
  input.focus();

  const close = (): void => overlay.remove();

  const submit = async (): Promise<void> => {
    const username = input.value.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,16}$/.test(username)) {
      errorEl.textContent = "3–16 chars: a–z, 0–9, _";
      return;
    }
    createBtn.disabled = true;
    createBtn.textContent = "Signing…";
    const res = await registerFlow(provider, address, username);
    if (res.ok) {
      close();
      render();
    } else {
      errorEl.textContent = res.error;
      createBtn.disabled = false;
      createBtn.textContent = "Create";
    }
  };

  createBtn.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void submit();
  });
  overlay.querySelector<HTMLButtonElement>("#wb-cancel")!.addEventListener("click", close);
}

/**
 * Mount the persistent Connect-Wallet bar. Appended to <body> (NOT inside #app),
 * so it survives the router's per-screen replaceChildren(). Call once at boot.
 */
export function mountWalletButton(): void {
  if (bar) return;
  bar = document.createElement("div");
  bar.id = "wallet-bar";
  document.body.appendChild(bar);
  render();
}
