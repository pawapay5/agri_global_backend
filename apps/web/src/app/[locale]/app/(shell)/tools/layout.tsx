import type { ReactNode } from "react";
import { ToolsNav } from "@/features/tools";

/** Every farmer tool shares the sub-navigation. */
export default function Layout({ children }: { children: ReactNode }) {
  return <><ToolsNav />{children}</>;
}
