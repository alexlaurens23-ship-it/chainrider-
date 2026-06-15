// Account UI for CHAINRIDER: username + 4-digit PIN + a pasted Solana payout
// address. No wallet extension, no message signing — users only ever paste a
// PUBLIC address (never a private key). The JWT from login/signup is stored in
// localStorage and attached as Bearer by net.ts. The wallet is bound once at
// signup and is permanently immutable, so the signup UI makes the user confirm
// it (clipboard-swap malware is a real risk for pasted crypto addresses).
import bs58 from "bs58";
import { ApiError, postLogin, postSignup } from "./net";

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

/** Decode a JWT's `exp` (seconds) and report whether it's past. Malformed → expired. */
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as { exp?: number };
    return typeof payload.exp === "number" && Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

/** Logged in = a JWT that exists and hasn't expired. Expired tokens self-clear. */
export function isLoggedIn(): boolean {
  const token = getToken();
  if (!token) return false;
  if (isTokenExpired(token)) {
    clearSession();
    return false;
  }
  return true;
}

/**
 * Run `onSuccess` if already logged in; otherwise open the login modal and run
 * it once the user logs in (or signs up). The gate for riding: browsing is free,
 * riding/submitting needs an account.
 */
export function requireLogin(onSuccess: () => void): void {
  if (isLoggedIn()) {
    onSuccess();
    return;
  }
  openLoginModal(onSuccess);
}

// ── Client-side pre-checks (server re-validates authoritatively) ─────────────

function isValidWallet(addr: string): boolean {
  if (addr.length < 32 || addr.length > 44) return false;
  try {
    return bs58.decode(addr).length === 32;
  } catch {
    return false;
  }
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

// ── Persistent bar ───────────────────────────────────────────────────────────

let bar: HTMLElement | null = null;

function render(): void {
  if (!bar) return;
  const name = isLoggedIn() ? getUsername() : null;
  if (name) {
    bar.innerHTML = `<span class="wb-name">@${name}</span><button class="wb-btn" id="wb-logout">Log Out</button>`;
    bar.querySelector<HTMLButtonElement>("#wb-logout")!.addEventListener("click", () => {
      clearSession();
      render();
    });
  } else {
    // Value prop is visible to logged-out browsers: the reason to sign up.
    bar.innerHTML = `
      <span class="wb-tagline">Log in to ride &amp; win SOL</span>
      <button class="wb-btn" id="wb-login">Log In</button>
      <button class="wb-btn wb-connect" id="wb-signup">Sign Up</button>`;
    bar.querySelector<HTMLButtonElement>("#wb-login")!.addEventListener("click", () => openLoginModal());
    bar.querySelector<HTMLButtonElement>("#wb-signup")!.addEventListener("click", () => openSignupModal());
  }
}

/** The auth bar overlaps the in-game HUD/minimap — hide it during a ride. */
function isRideRoute(): boolean {
  return location.hash.startsWith("#/ride/");
}
function updateBarVisibility(): void {
  if (bar) bar.style.display = isRideRoute() ? "none" : "";
}

function modalShell(inner: string): { overlay: HTMLElement; close: () => void } {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  overlay.innerHTML = `<div class="modal-card">${inner}</div>`;
  document.body.appendChild(overlay);
  return { overlay, close: () => overlay.remove() };
}

// ── Login ────────────────────────────────────────────────────────────────────

function openLoginModal(onSuccess?: () => void): void {
  const { overlay, close } = modalShell(`
    <div class="modal-title">LOG IN</div>
    <div class="modal-sub">Username + your 4-digit PIN.</div>
    <input class="modal-input" id="lg-user" maxlength="16" autocomplete="off" placeholder="username" />
    <input class="modal-input" id="lg-pin" inputmode="numeric" maxlength="4" type="password"
           autocomplete="off" placeholder="PIN (4 digits)" style="margin-top:8px" />
    <div class="modal-error" id="lg-error"></div>
    <div class="modal-buttons">
      <button class="btn-secondary" id="lg-cancel">Cancel</button>
      <button class="btn-primary" id="lg-submit">Log In</button>
    </div>
    <div class="modal-switch">No account? <a id="lg-to-signup">Sign Up</a></div>`);

  const user = overlay.querySelector<HTMLInputElement>("#lg-user")!;
  const pin = overlay.querySelector<HTMLInputElement>("#lg-pin")!;
  const errorEl = overlay.querySelector<HTMLDivElement>("#lg-error")!;
  const submit = overlay.querySelector<HTMLButtonElement>("#lg-submit")!;
  user.focus();

  const go = async (): Promise<void> => {
    const username = user.value.trim().toLowerCase();
    const pinVal = pin.value.trim();
    if (!/^[a-z0-9_]{3,16}$/.test(username) || !/^\d{4}$/.test(pinVal)) {
      errorEl.textContent = "Enter your username and 4-digit PIN.";
      return;
    }
    submit.disabled = true;
    submit.textContent = "…";
    try {
      const res = await postLogin({ username, pin: pinVal });
      setSession(res.token, res.username);
      close();
      render();
      onSuccess?.();
    } catch (err) {
      errorEl.textContent = errorText(err, "Login failed — try again.");
      submit.disabled = false;
      submit.textContent = "Log In";
    }
  };

  submit.addEventListener("click", () => void go());
  pin.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void go();
  });
  overlay.querySelector<HTMLButtonElement>("#lg-cancel")!.addEventListener("click", close);
  // Switch to signup, carrying the same post-auth continuation.
  overlay.querySelector<HTMLAnchorElement>("#lg-to-signup")!.addEventListener("click", () => {
    close();
    openSignupModal(onSuccess);
  });
}

// ── Signup (2 steps: form → review/confirm) ──────────────────────────────────

function openSignupModal(onSuccess?: () => void): void {
  const { overlay, close } = modalShell("");
  const card = overlay.querySelector<HTMLDivElement>(".modal-card")!;

  const renderForm = (prefill?: {
    username: string;
    pin: string;
    wallet: string;
    confirm: string;
  }): void => {
    card.innerHTML = `
      <div class="modal-title">CREATE ACCOUNT</div>
      <div class="modal-sub">Username, a 4-digit PIN, and your Solana payout wallet.</div>
      <input class="modal-input" id="su-user" maxlength="16" autocomplete="off" placeholder="username (a–z 0–9 _)" />
      <input class="modal-input" id="su-pin" inputmode="numeric" maxlength="4" type="password"
             autocomplete="off" placeholder="PIN (4 digits)" style="margin-top:8px" />
      <input class="modal-input" id="su-wallet" autocomplete="off" placeholder="Solana wallet address" style="margin-top:8px" />
      <input class="modal-input" id="su-confirm" autocomplete="off" placeholder="confirm wallet address" style="margin-top:8px" />
      <div class="modal-error" id="su-error"></div>
      <div class="modal-buttons">
        <button class="btn-secondary" id="su-cancel">Cancel</button>
        <button class="btn-primary" id="su-next">Review →</button>
      </div>
      <div class="modal-switch">Have an account? <a id="su-to-login">Log In</a></div>`;
    const user = card.querySelector<HTMLInputElement>("#su-user")!;
    const pin = card.querySelector<HTMLInputElement>("#su-pin")!;
    const wallet = card.querySelector<HTMLInputElement>("#su-wallet")!;
    const confirm = card.querySelector<HTMLInputElement>("#su-confirm")!;
    const errorEl = card.querySelector<HTMLDivElement>("#su-error")!;
    if (prefill) {
      user.value = prefill.username;
      pin.value = prefill.pin;
      wallet.value = prefill.wallet;
      confirm.value = prefill.confirm;
    }
    user.focus();

    card.querySelector<HTMLButtonElement>("#su-cancel")!.addEventListener("click", close);
    card.querySelector<HTMLAnchorElement>("#su-to-login")!.addEventListener("click", () => {
      close();
      openLoginModal(onSuccess);
    });
    card.querySelector<HTMLButtonElement>("#su-next")!.addEventListener("click", () => {
      const username = user.value.trim().toLowerCase();
      const pinVal = pin.value.trim();
      const walletVal = wallet.value.trim();
      const confirmVal = confirm.value.trim();
      if (!/^[a-z0-9_]{3,16}$/.test(username)) {
        errorEl.textContent = "Username: 3–16 chars of a–z, 0–9, _";
        return;
      }
      if (!/^\d{4}$/.test(pinVal)) {
        errorEl.textContent = "PIN must be exactly 4 digits.";
        return;
      }
      if (walletVal !== confirmVal) {
        errorEl.textContent = "Wallet addresses don't match.";
        return;
      }
      if (!isValidWallet(walletVal)) {
        errorEl.textContent = "That doesn't look like a Solana wallet address.";
        return;
      }
      renderReview({ username, pin: pinVal, wallet: walletVal, confirm: confirmVal });
    });
  };

  const renderReview = (data: {
    username: string;
    pin: string;
    wallet: string;
    confirm: string;
  }): void => {
    card.innerHTML = `
      <div class="modal-title">CONFIRM YOUR WALLET</div>
      <div class="modal-sub">Payout address for <b>@${data.username}</b>. This is permanent.</div>
      <div class="wallet-review">${data.wallet}</div>
      <div class="modal-warning">
        Paste your wallet address, then check the <b>first and last 4 characters</b> match your
        real wallet — clipboard malware can swap addresses. <b>This is permanent and can never be changed.</b>
      </div>
      <label class="modal-check">
        <input type="checkbox" id="su-ack" /> I've checked my wallet address
      </label>
      <div class="modal-error" id="su-error"></div>
      <div class="modal-buttons">
        <button class="btn-secondary" id="su-back">← Back</button>
        <button class="btn-primary" id="su-create" disabled>Create account</button>
      </div>`;
    const ack = card.querySelector<HTMLInputElement>("#su-ack")!;
    const create = card.querySelector<HTMLButtonElement>("#su-create")!;
    const errorEl = card.querySelector<HTMLDivElement>("#su-error")!;

    ack.addEventListener("change", () => {
      create.disabled = !ack.checked;
    });
    card.querySelector<HTMLButtonElement>("#su-back")!.addEventListener("click", () => renderForm(data));
    create.addEventListener("click", async () => {
      if (!ack.checked) return;
      create.disabled = true;
      create.textContent = "Creating…";
      try {
        const res = await postSignup({
          username: data.username,
          pin: data.pin,
          walletAddress: data.wallet,
          walletAddressConfirm: data.confirm,
        });
        setSession(res.token, res.username);
        close();
        render();
        onSuccess?.();
      } catch (err) {
        errorEl.textContent = errorText(err, "Could not create the account.");
        create.disabled = false;
        create.textContent = "Create account";
      }
    });
  };

  renderForm();
}

/**
 * Mount the persistent account bar. Appended to <body> (NOT inside #app) so it
 * survives the router's per-screen replaceChildren(). Call once at boot.
 */
export function mountWalletButton(): void {
  if (bar) return;
  // Drop an expired JWT on load so a stale session shows as logged-out.
  isLoggedIn();
  bar = document.createElement("div");
  bar.id = "wallet-bar";
  document.body.appendChild(bar);
  render();
  updateBarVisibility();
  // Reappear/disappear with the route (hidden only during a ride).
  window.addEventListener("hashchange", updateBarVisibility);
}
