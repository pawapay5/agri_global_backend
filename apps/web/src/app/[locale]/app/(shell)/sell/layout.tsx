import type { ReactNode } from "react";
import { SellerGate, SellerNav } from "@/features/seller";

/** Every seller-centre page shares the sub-navigation; most wait until the seller application is approved. */
export default function Layout({ children }: { children: ReactNode }) {
  return <><SellerNav /><SellerGate>{children}</SellerGate></>;
}
