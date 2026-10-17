import { SITE_NAME } from "@campus/lib/site";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "brand brand-compact" : "brand"} aria-label={SITE_NAME}>
      {compact
        ? <img className="brand-mark" src="/logo.png" alt="" width={80} height={80} />
        : <img className="brand-logo" src="/logo.png" alt={SITE_NAME} width={720} height={360} />}
    </span>
  );
}
