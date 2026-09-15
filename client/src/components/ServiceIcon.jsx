import { useEffect, useState } from "react";
import { catalogImageUrl } from "../data/serviceImages.js";

/** Artwork from the live catalog (`imageSrc`, `imageUrl`, or seed `image`). */
export default function ServiceIcon({ service, size = "md" }) {
  const accent = service.accent || "#0055ff";
  const id = service.id || "";
  const catalogSrc =
    service.imageSrc ||
    catalogImageUrl(service.image || service.imageUrl);
  const [src, setSrc] = useState(catalogSrc);
  const [failed, setFailed] = useState(false);
  const name = service.nameEn || id;

  useEffect(() => {
    setSrc(catalogSrc);
    setFailed(false);
  }, [catalogSrc]);

  return (
    <div
      className={`service-icon service-icon--${size}`}
      style={{ "--service-accent": accent }}
      aria-hidden="true"
    >
      <span className="service-icon-glow" />
      <span className="service-icon-mark" data-brand={id}>
        {src && !failed ? (
          <img
            className="service-icon-img"
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => {
              setFailed(true);
            }}
          />
        ) : null}
        <span hidden={Boolean(src) && !failed} className="service-icon-fallback">
          {renderFallback(id, accent, name)}
        </span>
      </span>
    </div>
  );
}

function iconInitials(name, id) {
  const words = String(name || "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  if (words[0]?.length >= 2) {
    return words[0].slice(0, 2).toUpperCase();
  }
  const fromId = String(id || "")
    .replace(/[^a-z0-9]+/gi, "")
    .slice(0, 2)
    .toUpperCase();
  return fromId || "??";
}

function renderFallback(id, accent, name) {
  const label = iconInitials(name, id);
  return (
    <svg viewBox="0 0 48 48" className="brand-svg">
      <rect width="48" height="48" rx="12" fill="#0b1220" />
      <rect x="4" y="4" width="40" height="40" rx="10" fill={accent} opacity="0.92" />
      <text
        x="24"
        y="29"
        textAnchor="middle"
        fill="#fff"
        fontSize="14"
        fontWeight="800"
        fontFamily="Sora,sans-serif"
      >
        {label}
      </text>
    </svg>
  );
}
