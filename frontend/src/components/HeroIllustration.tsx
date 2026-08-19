// A flat-vector wardrobe, in the same construction style as schloss's
// own castle illustration (flat filled shapes, no strokes, one light
// recess tone, one small signature accent mark borrowed from a sibling
// app's color rather than this app's own accent) - part of the same
// visual family, different subject and color.
export function HeroIllustration({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size * (100 / 140)}
      height={size}
      viewBox="0 0 100 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Schrank"
      className={className}
    >
      {/* Cornice - the darker tone, same "cap over body" trick as the
          castle's darker roof triangles and kuvert's darker flap. */}
      <rect x="10" y="8" width="80" height="12" rx="3" fill="#78350f" />

      {/* Body (both doors) - kept as the dominant fill so the shape
          reads as solid wood rather than mostly the pale recess below;
          the two mirror panels are inset well within it on all sides,
          not stretched edge-to-edge. */}
      <rect x="16" y="20" width="68" height="106" rx="3" fill="#92400e" />

      {/* Mirror recesses, one inset per door - the light recess tone,
          same trick as the castle's windows. Two separate panels
          (rather than one recess spanning the full width) so the
          center seam below reads as a real gap between doors, not a
          line drawn over a single continuous panel. */}
      <rect x="23" y="30" width="22" height="52" rx="2" fill="#fef3e2" />
      <rect x="55" y="30" width="22" height="52" rx="2" fill="#fef3e2" />

      {/* Center seam between the two doors - plays a brief "swinging
          shut" settle on mount (see index.css's door-seam-close),
          echoing kuvert's flap-closing flourish with the same
          scaleY-from-the-hinge technique. */}
      <rect className="schrank-door-seam" x="47" y="20" width="6" height="106" fill="#78350f" />

      {/* Signature handle - schloss's own violet, a small cross-service
          wink tying the illustration family together (same color
          kuvert/tafel/zettel use for theirs). */}
      <circle cx="56" cy="73" r="4" fill="#863bff" />
    </svg>
  )
}
