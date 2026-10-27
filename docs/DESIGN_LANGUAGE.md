# PAPLens design language

PAPLens is read in two places: a clinician's office, where it has to look like a
medical instrument, and a bedroom at 7am, where it has to be readable by someone
who has not had coffee. This document defines the visual system that serves both.

The system has a name: **Clinical Calm**.

## Principles

1. **The data is the interface.** Chrome recedes. Borders are hairlines, surfaces
   are flat, and nothing competes with a number for attention.
2. **Color means something clinical or it does not appear.** Green, amber and red
   mark a value's position against a clinical range. They are never used to
   decorate a heading, a card edge, or a button.
3. **Group with space and rules, not with boxes.** A page of equally weighted
   bordered cards has no hierarchy. Related things sit close together; unrelated
   things are separated by space, then by a hairline, and only then by a surface.
4. **Numbers get a typographic system.** Every figure is tabular, aligned on its
   decimal, and paired with a unit set smaller and lighter than the value.
5. **Two weights, one accent.** The type system uses 400 and 600 with a 500 for
   labels. The accent is one ink blue, reserved for interaction.
6. **Both themes are first-class.** Every rule resolves through a token. No
   component hardcodes a color.

## Tokens

All tokens live in `src/renderer/styles.css`. Dark is the `:root` default; light
is applied by `body.light-mode`. Use the semantic token, not the raw ramp.

### Neutrals

A near-achromatic ramp at hue 215. It reads as paper and graphite, not as navy.
The previous palette's blue-tinted surfaces are what made the app read as a
generic dashboard rather than an instrument.

| Token | Role |
| --- | --- |
| `--bg` | Page background, one step back from a card |
| `--card` | The default surface for content |
| `--surface` | Inset wells inside a card (metric groups, footers) |
| `--surface-raised` | Popovers, tooltips, menus |
| `--text` | Primary text and all figures |
| `--text-2` | Secondary prose |
| `--muted` | Labels, units, axis text |
| `--border` | The hairline. Default separator between anything |
| `--border-strong` | Hover and focus edges, modal edges |

### Accent

`--accent` is the only interactive color: the active nav item, the primary
button, focus rings, selected states, links. `--accent-on` is the text color
that sits on an accent fill. `--accent-soft` is a low-alpha tint for selected
backgrounds.

Do not use the accent for a chart series, a heading, a card border, or an icon
that is not interactive.

### Clinical status

| Token | Meaning |
| --- | --- |
| `--ok` | Value is inside the clinical target range |
| `--watch` | Value is outside target but not clinically urgent |
| `--alert` | Value crosses a clinical threshold |

Each has a `-soft` fill variant. A status color applies to a value, a badge that
labels a value, or a rule beside a flagged row. It never applies to a container
that holds a mix of values.

The AHI calendar uses a separate four-step severity ramp (`--sev-1` through
`--sev-4`) because it encodes an ordered scale, not a pass/fail state.

### Charts

Chart colors come from `src/renderer/charts/chartTheme.js`, never from a
component. `seriesPalette(theme)` returns the per-theme series hues; the named
keys (`blue`, `clay`, `sage`, `plum`, `ochre`, `teal`, `slate`) are stable, so
the same metric keeps the same color in every chart.

The series palette is desaturated on purpose. A chart of five fully saturated
hues reads as decoration; a chart of five muted hues reads as measurement. Grid
lines sit at roughly 6% contrast against the surface — present when you look for
them, invisible when you are reading the line.

### Type

Base is 16px. The scale is deliberately short.

| Token | Size | Use |
| --- | --- | --- |
| `--text-2xs` | 11px | Units, micro-labels |
| `--text-xs` | 12px | Secondary labels, legends |
| `--text-sm` | 13px | Table cells, dense body |
| `--text-base` | 14px | Body |
| `--text-md` | 16px | Section headings |
| `--text-lg` | 20px | Page title |
| `--text-xl` | 28px | Display figure |
| `--text-2xl` | 40px | Hero figure |

Weights: 400 body, 500 labels, 600 headings and figures. Nothing is bolder than
600. Uppercase is reserved for micro-labels at `--text-2xs` with `0.07em`
tracking, and never for a heading.

### Space, radius, elevation

Space is a 4px scale, `--space-1` (4px) through `--space-9` (48px).

Radii are small: 3, 5, 7 and 10px. A clinical instrument is not pill-shaped. The
only `--radius-full` uses are the avatar and the status dot.

Elevation has three levels and inline cards use none. A card is distinguished by
its border and its background, not by a shadow. `--elev-1` is for popovers,
`--elev-2` for modals.

### Motion

State transitions run 120ms ease-out. Layout does not animate. Everything is
suppressed under `prefers-reduced-motion`.

## Component rules

**Cards.** One border, one background, no shadow, no hover lift, no colored
edge. A card that needs emphasis gets a heavier heading, not a glow.

**Headings.** A section heading is `--text-md` at weight 600 in `--text`. It
carries no bullet, no dot, no accent bar, and no eyebrow line above it.

**Buttons.** Flat fills only. The primary button is an accent fill; the secondary
is a card surface with a border. No gradients, no shadows, no translate on hover.

**Metrics.** Value in `--text` at weight 600 with tabular figures; unit in
`--muted` at `--text-2xs`; label in `--muted` at `--text-xs`. The status color
goes on the value, not on the label or the container.

**Tables.** Hairline row rules, no zebra striping, no row borders on the sides.
Numeric columns are right-aligned and tabular.

**Tooltips and popovers.** `--surface-raised`, `--border-strong`, `--elev-1`,
`--radius-md`. One style for all of them.

## When adding a component

1. Resolve every color through a token. If the token you want does not exist,
   add it to both themes before you use it.
2. Route chart styling through `chartTheme.js`.
3. Check the result in both themes and in the printed report before you call it
   done.
