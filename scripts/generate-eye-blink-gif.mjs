/**
 * One-off utility: export a looping GIF of the Polyoracle eye blink.
 * Not used by the website — safe to delete when done.
 *
 * Usage:  npm run generate:eye-blink-gif
 * Output: scripts/eye-blink.gif
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import gifenc from "gifenc";

const { GIFEncoder, quantize, applyPalette } = gifenc;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(__dirname, "eye-blink.gif");
const LOGO_SVG_PATH = path.resolve(__dirname, "../src/assets/eye-logo.svg");

/** Eye open for this long, then one blink, then loop. */
const HOLD_MS = 4000;
/** Faster than the live site (350 ms) for presentation. */
const BLINK_MS = 220;
const BLINK_KEYFRAMES = [
    { t: 0, v: 1 },
    { t: 0.16, v: 0.08 },
    { t: 0.26, v: 0.02 },
    { t: 0.4, v: 1 },
];
const FPS = 30;
const FRAME_MS = 1000 / FPS;

/** 3× viewBox (120×80) for a crisp GIF. */
const WIDTH = 360;
const HEIGHT = 240;

const logoSource = fs.readFileSync(LOGO_SVG_PATH, "utf8");
const logoInner = logoSource
    .replace(/<\?xml[^?]*\?>/i, "")
    .replace(/<svg[^>]*>/i, "")
    .replace(/<\/svg>\s*$/i, "")
    .trim();

/** Same blink structure as renderBranding() / setupBrandEyeTracking() in src/main.ts. */
function buildEyeSvg(blinkOpen) {
    const lid = `translate(60 40) scale(1 ${blinkOpen}) translate(-60 -40)`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" width="${WIDTH}" height="${HEIGHT}" fill="none" overflow="visible">
  <defs>
    <filter id="brand-shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="8" stdDeviation="6" flood-color="#000000" flood-opacity="0.42"/>
    </filter>
    <clipPath id="brand-eye-clip">
      <rect x="0" y="0" width="120" height="80" transform="${lid}"/>
    </clipPath>
  </defs>
  <g filter="url(#brand-shadow)">
    <g transform="${lid}">
      ${extractOutlinePath(logoInner)}
    </g>
    <g clip-path="url(#brand-eye-clip)">
      ${extractInnerEye(logoInner)}
    </g>
  </g>
</svg>`;
}

function extractOutlinePath(svgInner) {
    const match = svgInner.match(/<path[\s\S]*?\/>/i);
    if (!match) {
        throw new Error("Could not find outline <path> in eye-logo.svg");
    }
    return match[0];
}

function extractInnerEye(svgInner) {
    const circles = [...svgInner.matchAll(/<circle[\s\S]*?\/>/gi)].map((m) => m[0]);
    if (circles.length < 3) {
        throw new Error("Expected 3 circles in eye-logo.svg");
    }
    return circles.join("\n      ");
}

function blinkOpenAt(progress) {
    let lower = BLINK_KEYFRAMES[0];
    let upper = BLINK_KEYFRAMES[BLINK_KEYFRAMES.length - 1];
    for (let i = 0; i < BLINK_KEYFRAMES.length - 1; i++) {
        const a = BLINK_KEYFRAMES[i];
        const b = BLINK_KEYFRAMES[i + 1];
        if (progress >= a.t && progress <= b.t) {
            lower = a;
            upper = b;
            break;
        }
    }
    const localRange = upper.t - lower.t || 1;
    const localT = Math.min(
        1,
        Math.max(0, (progress - lower.t) / localRange),
    );
    const eased = 1 - (1 - localT) ** 2;
    return lower.v + (upper.v - lower.v) * eased;
}

function blinkOpenForTime(msInCycle) {
    if (msInCycle < HOLD_MS) return 1;
    const blinkElapsed = msInCycle - HOLD_MS;
    return blinkOpenAt(Math.min(1, blinkElapsed / BLINK_MS));
}

async function renderFrame(blinkOpen) {
    const resvg = new Resvg(buildEyeSvg(blinkOpen), {
        background: "rgba(0,0,0,0)",
        fitTo: { mode: "width", value: WIDTH },
    });
    const png = resvg.render().asPng();
    const { data, info } = await sharp(png)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
}

async function main() {
    if (!fs.existsSync(LOGO_SVG_PATH)) {
        throw new Error(`Missing logo: ${LOGO_SVG_PATH}`);
    }

    const cycleMs = HOLD_MS + BLINK_MS;
    const frameCount = Math.ceil(cycleMs / FRAME_MS);

    console.log(`Logo: ${path.relative(process.cwd(), LOGO_SVG_PATH)}`);
    console.log(
        `Rendering ${frameCount} frames (${(cycleMs / 1000).toFixed(2)}s loop @ ${FPS} fps, blink ${BLINK_MS} ms)...`,
    );

    const frames = [];
    for (let i = 0; i < frameCount; i++) {
        const ms = i * FRAME_MS;
        frames.push(await renderFrame(blinkOpenForTime(ms)));
        if ((i + 1) % 30 === 0 || i === frameCount - 1) {
            process.stdout.write(`  ${i + 1}/${frameCount}\r`);
        }
    }
    console.log();

    const gif = GIFEncoder();
    const delayCs = Math.max(1, Math.round(FRAME_MS / 10));

    for (const frame of frames) {
        const palette = quantize(frame.data, 256, {
            format: "rgba4444",
            oneBitAlpha: true,
        });
        const index = applyPalette(frame.data, palette);
        gif.writeFrame(index, frame.width, frame.height, {
            palette,
            delay: delayCs,
            transparent: true,
        });
    }

    gif.finish();
    fs.writeFileSync(OUTPUT, Buffer.from(gif.bytes()));
    const kb = (fs.statSync(OUTPUT).size / 1024).toFixed(1);
    console.log(`Wrote ${OUTPUT} (${kb} KB)`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
