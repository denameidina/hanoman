import React from "react";
import {
  ILLUSTRATIONS,
  type IllustrationId,
  type IllustrationRatio,
  type MascotIllustrationId,
  type ProductStateIllustrationId,
  type SpotIllustrationId,
  type StickerIllustrationId,
} from "./illustration-registry";

const ASPECT_RATIO: Partial<Record<IllustrationRatio, string>> = {
  "1x1": "1 / 1",
  "4x3": "4 / 3",
  "4x5": "4 / 5",
  "16x9": "16 / 9",
  "9x16": "9 / 16",
};

export type IllustrationProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "src" | "alt" | "loading" | "decoding"
> & {
  id: IllustrationId;
  alt?: string;
  decorative?: boolean;
  priority?: boolean;
  fit?: React.CSSProperties["objectFit"];
};

export function Illustration({
  id,
  alt,
  decorative = false,
  priority = false,
  fit = "contain",
  style,
  ...imageProps
}: IllustrationProps) {
  const asset = ILLUSTRATIONS[id];
  // React 18 only forwards the lowercase spelling without a development warning.
  // Browsers expose the same attribute as HTMLImageElement.fetchPriority.
  const priorityAttribute = priority ? { fetchpriority: "high" } : {};
  return (
    <img
      {...imageProps}
      {...priorityAttribute}
      src={asset.src}
      alt={decorative ? "" : (alt ?? asset.alt)}
      aria-hidden={decorative || undefined}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      data-testid={`illustration-${id}`}
      data-illustration-id={id}
      data-illustration-family={asset.family}
      style={{
        display: "block",
        width: "100%",
        height: "auto",
        objectFit: fit,
        aspectRatio: ASPECT_RATIO[asset.ratio],
        ...style,
      }}
    />
  );
}

type FamilyIllustrationProps<Id extends IllustrationId> = Omit<IllustrationProps, "id"> & { id: Id };

export type ProductStateIllustrationProps = FamilyIllustrationProps<ProductStateIllustrationId>;
export type MascotIllustrationProps = FamilyIllustrationProps<MascotIllustrationId>;
export type StickerIllustrationProps = FamilyIllustrationProps<StickerIllustrationId>;
export type SpotIllustrationProps = FamilyIllustrationProps<SpotIllustrationId>;

export function ProductStateIllustration(props: ProductStateIllustrationProps) {
  return <Illustration {...props} />;
}

export function MascotIllustration(props: MascotIllustrationProps) {
  return <Illustration {...props} />;
}

export function StickerIllustration(props: StickerIllustrationProps) {
  return <Illustration {...props} />;
}

export function SpotIllustration(props: SpotIllustrationProps) {
  return <Illustration {...props} />;
}
