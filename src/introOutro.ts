/**
 * Intro and outro full-screen pages for video (e.g. /intro and /outro).
 * Black background, white text; intro shows subtitle, outro animates the eye logo.
 */

const APP_NAME = "Polyoracle";
const SUBTITLE =
  "Assessing Multi-criteria Regional Climate Uncertainty through Agent-assisted Visual Analysis";

function isIntroOrOutroPath(): "intro" | "outro" | null {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path.endsWith("/intro") || path === "intro") return "intro";
  if (path.endsWith("/outro") || path === "outro") return "outro";
  return null;
}

const introOutroStyles = `
  .intro-outro-root {
    position: fixed;
    inset: 0;
    background: #000;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    box-sizing: border-box;
    font-family: var(--font-geist-sans);
  }
  .intro-outro-brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.25rem;
    margin-bottom: 2rem;
  }
  .intro-outro-logo {
    width: 120px;
    height: 80px;
    flex-shrink: 0;
  }
  .intro-outro-logo.outro-animated .intro-outro-eye-blink {
    animation: intro-outro-blink 10s ease-in-out infinite;
    transform-origin: center center;
  }
  .intro-outro-logo.outro-animated .intro-outro-eye-blink svg {
    animation: intro-outro-eye-pulse 2.5s ease-in-out infinite;
  }
  .intro-outro-logo.outro-animated .intro-outro-eye-pupil {
    animation: intro-outro-pupil 3s ease-in-out infinite;
  }
  @keyframes intro-outro-blink {
    0%, 96% { transform: scaleY(1); }
    97% { transform: scaleY(0.08); }
    98% { transform: scaleY(0.08); }
    99%, 100% { transform: scaleY(1); }
  }
  @keyframes intro-outro-eye-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.92; transform: scale(1.02); }
  }
  @keyframes intro-outro-pupil {
    0%, 100% { transform: translate(0, 0); }
    25% { transform: translate(2px, -1px); }
    75% { transform: translate(-1px, 1px); }
  }
  .intro-outro-title {
    font-size: clamp(2.5rem, 6vw, 4rem);
    font-weight: 400;
    letter-spacing: 0.6px;
    margin: 0;
  }
  .intro-outro-subtitle {
    font-size: clamp(1rem, 2.2vw, 1.35rem);
    font-weight: 300;
    max-width: 28em;
    text-align: center;
    line-height: 1.5;
    margin: 0;
    opacity: 0.92;
  }
`;

const eyeLogoSvg = (animated: boolean) => `
  <svg class="${animated ? "outro-eye" : ""}" viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" fill="none">
    <path
      d="M10 40c10-15 30-30 50-30s40 15 50 30c-10 15-30 30-50 30S20 55 10 40Z"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <circle cx="60" cy="40" r="20" stroke="currentColor" stroke-width="3" />
    <circle class="${animated ? "intro-outro-eye-pupil" : ""}" cx="60" cy="40" r="10" fill="currentColor" />
    <circle cx="72" cy="30" r="4" fill="currentColor" />
  </svg>
`;

function injectStyles() {
  if (document.getElementById("intro-outro-styles")) return;
  const style = document.createElement("style");
  style.id = "intro-outro-styles";
  style.textContent = introOutroStyles;
  document.head.appendChild(style);
}

export function maybeRenderIntroOrOutro(root: HTMLElement): boolean {
  const route = isIntroOrOutroPath();
  if (!route) return false;

  injectStyles();

  const isOutro = route === "outro";
  root.innerHTML = `
    <div class="intro-outro-root">
      <div class="intro-outro-brand">
        <div class="intro-outro-logo ${isOutro ? "outro-animated" : ""}">
          ${isOutro ? `<div class="intro-outro-eye-blink">${eyeLogoSvg(isOutro)}</div>` : eyeLogoSvg(false)}
        </div>
        <h1 class="intro-outro-title">${APP_NAME}</h1>
      </div>
      ${!isOutro ? `<p class="intro-outro-subtitle">${SUBTITLE}</p>` : ""}
    </div>
  `;

  return true;
}
