import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

/** Public page heading with visible breadcrumbs (the JSON-LD BreadcrumbList is emitted separately). */
export function PageHeader({ crumbs, title, description, children }: {
  crumbs: { label: string; href?: string }[]; title: string; description?: string; children?: ReactNode;
}) {
  return (
    <header className="mb-8 space-y-3">
      {crumbs.length ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-fg">
            {crumbs.map((c, i) => (
              <li key={i} className="flex items-center gap-1.5">
                {i > 0 ? <span aria-hidden>/</span> : null}
                {c.href ? <Link href={c.href} className="hover:text-brand hover:underline">{c.label}</Link> : <span aria-current="page">{c.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <h1 className="text-3xl font-bold md:text-4xl">{title}</h1>
      {description ? <p className="max-w-3xl text-muted-fg">{description}</p> : null}
      {children}
    </header>
  );
}
