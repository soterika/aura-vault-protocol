/**
 * Returns the best supported image format (avif > webp > original).
 * Use with <picture> or as a srcset helper for optimal LCP.
 */
export function getOptimizedSrc(base: string): { avif: string; webp: string; fallback: string } {
  const withoutExt = base.replace(/\.(png|jpg|jpeg)$/i, "");
  return {
    avif: `${withoutExt}.avif`,
    webp: `${withoutExt}.webp`,
    fallback: base,
  };
}

/**
 * Minimal <picture> props for a responsive, optimized image.
 * Adds width/height to prevent CLS (caller must supply intrinsic dimensions).
 */
export interface OptimizedImageProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  loading?: "lazy" | "eager";
  fetchpriority?: "high" | "low" | "auto";
}

export function OptimizedImage({
  src,
  alt,
  width,
  height,
  loading = "lazy",
  fetchpriority = "auto",
}: OptimizedImageProps) {
  const { avif, webp, fallback } = getOptimizedSrc(src);
  return (
    <picture>
      <source srcSet={avif} type="image/avif" />
      <source srcSet={webp} type="image/webp" />
      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
      <img
        src={fallback}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        // @ts-expect-error fetchpriority is not yet in React types
        fetchpriority={fetchpriority}
        decoding="async"
        style={{ contentVisibility: "auto" }}
      />
    </picture>
  );
}
