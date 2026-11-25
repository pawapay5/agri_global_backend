import ReactMarkdown, { type Components } from "react-markdown";

/**
 * Markdown from the content API (help articles, crop guides, stories), rendered on the server: no client JS.
 * Raw HTML in the source is ignored (react-markdown's default), so content can't inject scripts or styles.
 */
const components: Components = {
  h1: ({ children }) => <h2 className="mt-8 text-2xl font-bold">{children}</h2>,
  h2: ({ children }) => <h2 className="mt-8 text-xl font-bold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-6 text-lg font-semibold">{children}</h3>,
  p: ({ children }) => <p className="mt-3 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mt-3 list-disc space-y-1 ps-6">{children}</ul>,
  ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1 ps-6">{children}</ol>,
  a: ({ href, children }) => {
    const external = !!href && /^https?:\/\//.test(href);
    return <a href={href} className="font-medium text-brand underline underline-offset-2" {...(external ? { rel: "noopener noreferrer", target: "_blank" } : {})}>{children}</a>;
  },
  blockquote: ({ children }) => <blockquote className="mt-4 border-s-4 border-border ps-4 text-muted-fg">{children}</blockquote>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm">{children}</code>,
  img: ({ src, alt }) => (typeof src === "string" ? <img src={src} alt={alt ?? ""} loading="lazy" className="mt-4 h-auto max-w-full rounded-xl" /> : null),
  hr: () => <hr className="my-8 border-border" />,
};

export function Markdown({ source, className }: { source: string; className?: string }) {
  return <div className={className}><ReactMarkdown components={components}>{source}</ReactMarkdown></div>;
}
