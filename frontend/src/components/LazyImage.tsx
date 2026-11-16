import Image, { ImageProps } from "next/image";

type LazyImageProps = Omit<ImageProps, "loading"> & { blurDataURL?: string };

/** Drop-in Next.js Image wrapper with lazy loading and blur-up placeholder. */
export default function LazyImage({ blurDataURL, ...props }: LazyImageProps) {
  return (
    <Image
      loading="lazy"
      placeholder={blurDataURL ? "blur" : "empty"}
      blurDataURL={blurDataURL}
      {...props}
    />
  );
}
