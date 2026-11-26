import { Gavel, ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";

/** Admin home. Moderation and disputes ship with the marketplace; the rest of the console is the last build step. */
export default async function AdminHome() {
  const t = await getTranslations("mod");
  const items = [{ href: "/admin/moderation", label: t("title"), icon: ShieldAlert }, { href: "/admin/disputes", label: t("disputesTitle"), icon: Gavel }];
  return (
    <main id="main" className="mx-auto max-w-6xl space-y-5 p-4 lg:p-8">
      <h1 className="text-2xl font-bold">AgriPrice admin</h1>
      <ul className="grid gap-4 sm:grid-cols-2">
        {items.map(({ href, label, icon: Icon }) => (
          <li key={href}><Link href={href} className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"><Card className="flex items-center gap-3 hover:shadow-md"><Icon aria-hidden className="size-6 text-brand" /><span className="font-semibold">{label}</span></Card></Link></li>
        ))}
      </ul>
    </main>
  );
}
