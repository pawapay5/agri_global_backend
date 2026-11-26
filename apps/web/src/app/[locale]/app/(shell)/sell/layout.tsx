import type { ReactNode } from "react";
import { SellerNav } from "@/features/seller";

/** Every seller-centre page shares the sub-navigation. */
export default function Layout({ children }: { children: ReactNode }) {
  return <><SellerNav />{children}</>;
}
