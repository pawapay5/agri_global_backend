import Image from "next/image";
import { cn } from "@/lib/utils";

const SIZES = { sm: 28, md: 40, lg: 56 } as const;

/**
 * Commodity image from the catalogue (`imageUrl`, served from our storage), or initials on a neutral tint when
 * there's none. Decorative next to a visible name (default); pass `labelled` when it stands alone.
 */
export function CommodityAvatar({ name, imageUrl, size = "md", labelled = false, className }: {
  name: string; imageUrl?: string | null; size?: keyof typeof SIZES; labelled?: boolean; className?: string;
}) {
  const px = SIZES[size];
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
  const box = cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-brand", className);
  // Only real http(s) URLs: anything else (empty, relative, malformed) falls back to initials instead of a broken image.
  if (imageUrl && /^https?:\/\/[^/]+\//.test(imageUrl)) {
    return (
      <span className={box} style={{ width: px, height: px }}>
        <Image src={imageUrl} alt={labelled ? name : ""} width={px} height={px} className="size-full object-cover" sizes={`${px}px`} />
      </span>
    );
  }
  return (
    <span className={box} style={{ width: px, height: px, fontSize: px * 0.38 }} role={labelled ? "img" : undefined} aria-label={labelled ? name : undefined} aria-hidden={labelled ? undefined : true}>
      <span className="font-semibold">{initials}</span>
    </span>
  );
}
