# Painted classroom icon

The user requested a richly colored, artistic icon with visible paint texture and delicate lines, without a glossy plastic appearance. The final artwork combines a watercolor book and sound wave on warm matte paper.

- Source: [painted-master.png](painted-master.png).
- Production UI asset: [extension/brand.png](../../extension/brand.png).
- Toolbar/notification PNG sizes: 16, 32, 48, 128 and 512 pixels in `extension/icons/`.
- Created with the built-in image_gen tool. No external stock artwork was used.
- `scripts/generate_icon.ps1` downsamples the approved master using native System.Drawing; it does not regenerate or repaint the design.

## Generation prompt

Use case: logo-brand. Create one finished square app icon for a thoughtful classroom transcription and learning assistant. An artistic, richly multicolored hand-painted emblem: two airy curved brush gestures subtly suggest an open book and a flowing sound wave, elegantly interlaced with a few exquisitely fine, tapering charcoal-ink contour lines. Genuine matte watercolor and gouache pigment texture, translucent color blooms, dry-brush grain, softly irregular natural edges. Many sophisticated colors visible across the emblem: ultramarine, teal, emerald, vermilion, magenta, violet and warm yellow ochre, with luminous spaces between them; harmonious painterly color rather than a regular digital rainbow gradient. A clear memorable silhouette readable as a small browser toolbar icon, central symbol occupies about 80 percent of the square, generous clean negative space. Subtle warm off-white watercolor-paper rounded-square tile, completely transparent pixels outside its gently rounded corners; flat front-on icon artwork, no surrounding scene. The fine lines add delicacy but the underlying painted silhouette stays clear at 32 pixels. No lettering, no numbers, no watermark, no mockup, no metallic edges, no 3D extrusion, no plastic, no glass, no gloss, no bevel, no shadows. Premium contemporary art-publishing identity, quiet and expressive. Output a single icon, not a contact sheet. High-quality square PNG.

## Final background edit

The initial output simulated transparency with a visible checkerboard. A second built-in edit replaced that background; the shipped master uses opaque ivory paper, not simulated transparency.

Edit this icon. Keep the multicolored watercolor open book and flowing sound-wave artwork, delicate ink lines, composition, scale, all pigment colors and matte paper texture unchanged. Change only the background: remove ALL gray checkerboard completely and extend the warm ivory watercolor paper seamlessly to fill the entire square canvas, right out to all four edges and all corners. A single flat paper square with the artwork on it, no rounded-square tile edge, no border, no drop shadow, no transparency simulation, no checker pattern anywhere. Do not add text or gloss. Deliver the finished square app icon artwork.
