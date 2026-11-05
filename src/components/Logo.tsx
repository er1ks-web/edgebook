/** The Edgebook logo. The bars are separate shapes so the startup animation can move each one. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={className ? `logo ${className}` : "logo"} role="img" aria-label="Edgebook">
      <svg className="logo-mark" viewBox="0 0 370 222" aria-hidden="true" focusable="false">
        <polygon className="logo-bar logo-bar-1" points="153,0 370,0 331,56 113,56" />
        <polygon className="logo-bar logo-bar-2" points="97,83 318,83 278,139 57,139" />
        <polygon className="logo-bar logo-bar-3" points="41,166 319,166 279,222 0,222" />
      </svg>
      <span className="logo-word" aria-hidden="true">Edgebook</span>
    </span>
  );
}
