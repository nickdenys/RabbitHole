/**
 * The product mark: a rabbit, drawn from the worklist.
 *
 * Nothing here is new geometry. The two bars of unequal length that used to lie
 * beside a panel edge now stand up and splay 12 degrees into ears, and the edge
 * itself lies down under them as the head, arched so the mark sits on a curve
 * rather than a flat line. One continuous 4.6-unit stroke with round caps and
 * joins, so there is a single silhouette to keep legible and it survives being
 * cropped into a circle.
 *
 * Drawn on the same 32-unit grid as before, so the same geometry serves the
 * 22px drawer header, the 24px handle and the toolbar icon in `public/icons`.
 * Inside the panel it wears the tinted treatment (a translucent orange tile
 * rather than a solid one) so the logo never fights the pull request page for
 * attention; the solid tile is for everywhere the extension is not the thing
 * being looked at.
 *
 * The glyph is `currentColor`, so `.mark` in `panel.css` picks the one value
 * that differs between the two themes and everything else stays shared.
 */
export function Mark() {
  return (
    <svg class="mark" viewBox="0 0 32 32" width="24" height="24" aria-hidden="true">
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7.25"
        fill="#f0883e1f"
        stroke="#f0883e59"
        stroke-width="1"
      />
      <path
        d="M 10.4 7.8 L 12.3 21.8 M 21.6 7.8 L 19.7 21.8 M 8.4 23.6 Q 16 18.6 23.6 23.6"
        fill="none"
        stroke="currentColor"
        stroke-width="4.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
