import { LifeBuoy, Mail, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/content/page-header";
import { alternates } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { buttonVariants, Card } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";

type P = PageProps<"/[locale]/contact">;
// Public support channels, set at build (NEXT_PUBLIC_SUPPORT_EMAIL / NEXT_PUBLIC_SUPPORT_WHATSAPP). Unset = not shown.
const EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
const WHATSAPP = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP?.replace(/[^\d]/g, "");

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pub" });
  return { title: t("contactTitle"), description: t("contactDescription"), alternates: alternates("/contact", locale) };
}

async function Body({ params }: Pick<P, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pub");
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("contactTitle") }]} title={t("contactTitle")} description={t("contactDescription")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="space-y-3">
          <LifeBuoy aria-hidden className="size-6 text-brand" />
          <p>{t("contactHelp")}</p>
          <Link href="/help" className={buttonVariants({ variant: "outline", size: "sm" })}>{t("helpTitle")}</Link>
        </Card>
        <Card className="space-y-3">
          <MessageCircle aria-hidden className="size-6 text-brand" />
          <p>{t("contactSignedIn")}</p>
          <Link href="/login" prefetch={false} className={buttonVariants({ variant: "outline", size: "sm" })}>{t("openApp")}</Link>
        </Card>
        {EMAIL ? (
          <Card className="flex items-center gap-3">
            <Mail aria-hidden className="size-6 text-brand" />
            <div><p className="text-sm text-muted-fg">{t("contactEmail")}</p><a href={`mailto:${EMAIL}`} className="font-medium text-brand hover:underline">{EMAIL}</a></div>
          </Card>
        ) : null}
        {WHATSAPP ? (
          <Card className="flex items-center gap-3">
            <MessageCircle aria-hidden className="size-6 text-brand" />
            <div><p className="text-sm text-muted-fg">{t("contactWhatsapp")}</p><a href={`https://wa.me/${WHATSAPP}`} rel="noopener noreferrer" target="_blank" className="font-medium text-brand hover:underline">+{WHATSAPP}</a></div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

export default function ContactPage({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
