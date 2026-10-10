import { init } from "ghostty-web";
import { startApp } from "./app.ts";
import { createGhosttyTerminal, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from "./ghostty-adapter.ts";
import { resolveToken } from "./token.ts";

const TOAST_DURATION_MS = 4000;

/**
 * Show a transient, non-blocking notice. Used for host errors (editor
 * conflicts, missing editor, protocol errors) and the already-open notice, so
 * feedback never blocks the terminal like alert().
 */
function createToast(element: HTMLElement): (message: string) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (message: string) => {
    element.dataset.visible = "true";
    queueMicrotask(() => {
      element.textContent = message;
    });
    clearTimeout(timer);
    timer = setTimeout(() => {
      element.dataset.visible = "false";
    }, TOAST_DURATION_MS);
  };
}

/**
 * Load the font CSS and the default font before the terminal measures its
 * cells. Fonts are kept out of Bun's CSS bundler (it inlines small woff2
 * subsets as base64, bun#24599), so the stylesheet is linked at runtime.
 */
function loadFonts(): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/fonts/fonts.css";
    link.onload = () => {
      document.fonts
        .load(`${DEFAULT_FONT_SIZE}px ${DEFAULT_FONT_FAMILY}`)
        .then(() => resolve())
        .catch(() => resolve());
    };
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} element not found`);
  return element;
}

async function main() {
  const container = requireElement("terminal");
  const token = resolveToken({
    location: window.location,
    history: window.history,
    storage: () => window.sessionStorage,
  });
  if (!token) {
    const notice = document.createElement("p");
    notice.className = "notice";
    notice.textContent = "No access token. Open the URL printed by kastty.";
    container.replaceChildren(notice);
    return;
  }

  await loadFonts();
  await init();

  const overlay = requireElement("editor-overlay");
  const overlaySurface = requireElement("editor-overlay-surface");
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";

  const app = startApp({
    token,
    attachUrl: (sessionId) => `${scheme}://${window.location.host}/attach/${encodeURIComponent(sessionId)}`,
    createTerminal(target, config) {
      if (target === "main") return createGhosttyTerminal(container, config);
      // A fresh element per editor session: ghostty-web 0.4.0 leaves its wheel
      // listener on the element after dispose(), and the overlay clears it on close.
      const mount = document.createElement("div");
      mount.className = "editor-mount";
      overlaySurface.replaceChildren(mount);
      return createGhosttyTerminal(mount, config);
    },
    setOverlayVisible(visible) {
      overlay.dataset.active = String(visible);
      if (!visible) overlaySurface.replaceChildren();
    },
    showToast: createToast(requireElement("toast")),
    setTitle(title) {
      document.title = title;
    },
  });

  // Capture phase: intercept the editor shortcut before either terminal
  // consumes the keystroke; all other keys fall through untouched.
  window.addEventListener(
    "keydown",
    (event) => {
      if (!app.handleKeydown(event)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true },
  );
}

main().catch(console.error);
