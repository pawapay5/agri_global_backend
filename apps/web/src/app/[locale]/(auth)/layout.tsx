import { AuthShell } from "@/components/shell/auth-shell";

/** Static shell: no params read here; each auth page sets its own request locale. */
export default function AuthLayout({ children }: LayoutProps<"/[locale]">) {
  return <AuthShell>{children}</AuthShell>;
}
