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
      <rect x="8" y="10" width="84" height="14" rx="3" fill="#78350f" />

      {/* Body (both doors, before the center seam splits them visually) */}
      <rect x="14" y="24" width="72" height="100" rx="3" fill="#92400e" />

      {/* Mirror recess, inset into the body - the light recess tone,
          same trick as the castle's windows. */}
      <rect x="22" y="34" width="56" height="78" rx="2" fill="#fef3e2" />

      {/* Center seam between the two doors - plays a brief "swinging
          shut" settle on mount (see index.css's door-seam-close),
          echoing kuvert's flap-closing flourish with the same
          scaleY-from-the-hinge technique. */}
      <rect className="schrank-door-seam" x="47" y="24" width="6" height="100" fill="#78350f" />

      {/* Signature handle - schloss's own violet, a small cross-service
          wink tying the illustration family together (same color
          kuvert/tafel/zettel use for theirs). */}
      <circle cx="56" cy="72" r="4" fill="#863bff" />
    </svg>
  )
}
