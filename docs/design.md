# The Relay OS website

Live site: https://riyadadlani02.github.io/relay-agent-os/

## Visual direction

The user's reference was [Władysław / Zajno's retro-futuristic cassette player concept](https://dribbble.com/shots/25961667-Retro-Futuristic-Website-Concept-for-a-Cassette-Player). The adaptation uses muted olive surfaces, condensed oversized type, transparent hardware, industrial markings, and a tactile orange transport control. The composition and code are original; no Dribbble artwork or product branding is included.

Palette: olive paper `#b5bea0`, graphite `#20241c`, orange `#f37543`, light panel `#d6dac6`, LCD `#1d2516`, and screen lettering `#bdca94`.

Type: locally bundled Anton for display lettering and Space Mono for controls. Text is rendered as HTML; the hero hardware is an image. Keyboard focus, a skip link, an explicit motion control, and reduced-motion support are included.

The first screen now explains the customer workflow and exposes three one-click refund outcomes. The cassette is a supporting image. Measured hosted-model results, raw evidence and the deployment case study have direct links from the hero/navigation. The product film remains available below the evidence.

## Original image asset

- Final asset: [`public/images/agent-core.png`](../public/images/agent-core.png)
- Method: built-in image-generation tool, transparent PNG; the output was copied unchanged into the project.
- Purpose: an original fictional device representing an AI agent core. This is illustrative product imagery, not real manufactured hardware.

Generation prompt:

> Use case: product-mockup. Asset type: transparent cutout for the hero of a retro-futuristic AI agent operating system website. Create an original premium photorealistic 3D render of a single portable cassette-shaped AI computing device floating in space. Genuine transparent alpha background, no floor, no backdrop, no drop shadow outside the object. The entire object fits inside the frame with 10% padding. Centered, oblique front view showing the front and right side, rotated about 13 degrees clockwise. A thick transparent slightly smoky olive-tinted polycarbonate enclosure, precisely machined metal fasteners, very realistic reflections and refractive edge highlights. Under the transparent shell: lime/olive printed circuit boards, twin circular metallic computational reels reminiscent of tape spools with fine radial details, a small vivid orange mechanical switch on the right edge, dark graphite top-edge playback buttons. A small black rectangular LCD near the top with tiny olive status glyphs, and an off-white industrial adhesive label on the lower front with only 'RELAY' and 'AGENT CORE / 001' in small condensed technical print. The visual should feel like a collectible late-1990s translucent electronics product interpreted as future AI hardware. Sophisticated realistic studio product rendering with crisp micro-details and soft directional illumination; olive, graphite, aged silver, tiny safety-orange accents. No cables, hands, people, decorative objects, extra words, logos of other brands, or watermarks. Square composition. This image is an isolated object to be composited over big typography on a muted pale olive webpage.

## Operating modes

The primary playground at `?playground=1` runs a real Qwen model in a WebGPU worker, with a bounded tool loop and IndexedDB business records. Model weights download on demand; conversation contents stay on-device in browser mode. See [live playground](live-playground.md).

The landing page also retains an explicitly labeled deterministic walkthrough. That console runs the same `Runtime` class as the server with a browser persistence adapter. It makes no backend or model requests and supports four fixed scenarios, approvals, pause/resume, cancellation before commit, trace export, and local-session recovery.

Browser state is local, user-editable demonstration data. It is not authenticated or an audit boundary, and is intended for one active tab. If storage is unavailable, the demo continues in memory and reports that the session is temporary. The SQLite backend remains the server implementation for the local operations workspace.

Local URLs:

- `/`: retro website and browser sandbox
- `/?playground=1`: real model inference, free-text requests, tool execution, and persisted records
- `/?workspace=1`: original API-backed operations workspace
- `/?payments=1`: local-only Razorpay test checkout and refund readback
- GitHub Pages builds intentionally omit access to the API-backed workspace.

## Publishing

```bash
npm run build:pages
npm run test:pages
npm run deploy:pages
```

`deploy:pages` builds and pushes **only compiled static files** to `gh-pages`, without force-pushing or changing the main checkout. Configure GitHub Pages to deploy from the root of that branch. Source changes should be committed and pushed to `main` separately.

The Vite Pages mode sets the asset prefix to `/relay-agent-os/`. Change that prefix if you rename the repository. Views use query parameters and fragments, so deep-link refreshes do not require server routing.
