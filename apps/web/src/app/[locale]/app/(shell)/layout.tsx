import { AppShell } from "@/components/shell/app-shell";

/** Sidebar on desktop, bottom nav on mobile, for every signed-in page except full-screen flows. */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
