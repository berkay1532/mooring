# Mooring brand

The mark is a double-bitt mooring bollard: two posts with mushroom caps, and the mooring rope
between them draws the "M". The rope is always amber (`#f2b44a`); the posts take the ink colour
of the surface they sit on.

| File | Use |
|---|---|
| `mooring-mark-dark.svg` | cream posts (`#f2eee4`) for dark surfaces (app header, dark hero) |
| `mooring-mark-light.svg` | navy posts (`#0a1522`) for light surfaces (docs, X avatar) |
| `mooring-icon-tile.svg` | cream rounded tile + navy mark: favicon / app icon (`apps/web/app/icon.svg`) |

Wordmark: "Mooring" in Instrument Serif; body copy Manrope; mono IBM Plex Mono (the app's tokens).

## Bitt — the mascot

Bitt is the bollard from the mark, given a face: a cream post with a mushroom cap, two navy eyes,
and the amber rope as its arm (the loop at the end is the hand). Bitt is the bosun of the mooring
pier: the one who ties a runaway agent to the dock. Name from "double bitt", the two-post bollard.

| File | Use |
|---|---|
| `bitt/bitt.svg` | idle, rope coiled — the default, avatars, empty states |
| `bitt/bitt-hello.svg` | rope arm raised — greetings, docs |
| `bitt/bitt-throw.svg` | lasso out — the mooring moment (story videos) |
| `bitt/bitt-card.svg` | holding a Mooring card — onboarding |
| `bitt/bitt-captain.svg` | captain hat — announcements, releases, changelog only |
| `bitt/bitt-light.svg` | navy body for light surfaces (docs, stickers) |
| `bitt/bitt-states.svg` | six expressions mapped to card states: active, paid, refused, frozen, expired, cancelled |
| `bitt/bitt.js` + `bitt/sheet.html` | the parametric generator and the character sheet (open the HTML in a browser) |

Rules: the rope is always amber and is the only limb; the body is cream on dark, navy on light;
frozen is the only state that recolours the body (seaglass). The captain hat is reserved for
announcements, never for the everyday Bitt.
