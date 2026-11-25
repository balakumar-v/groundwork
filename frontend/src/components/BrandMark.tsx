import { APP_NAME } from "../brand";

/** Three lines of text, the middle one highlighted: a source being marked. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <rect x="7" y="8.5" width="18" height="3" rx="1.5" fill="#fff" opacity="0.9" />
      <rect x="6" y="14" width="20" height="5.5" rx="1.8" fill="#FFE66D" />
      <rect x="7" y="22" width="11" height="3" rx="1.5" fill="#fff" opacity="0.9" />
    </svg>
  );
}

export function Wordmark({ size = 30 }: { size?: number }) {
  return (
    <span className="brand">
      <BrandMark size={size} />
      <span className="brand-name">{APP_NAME}</span>
    </span>
  );
}
