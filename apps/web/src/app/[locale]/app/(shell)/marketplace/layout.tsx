import type { ReactNode } from "react";
import { MarketplaceNav } from "@/features/marketplace";

/** Every buyer marketplace page shares the sub-navigation (Browse · Saved · Cart · Orders · Offers). */
export default function Layout({ children }: { children: ReactNode }) {
  return <><MarketplaceNav />{children}</>;
}
