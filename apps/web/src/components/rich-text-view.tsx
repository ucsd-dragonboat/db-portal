const isHtml = (s: string) => /^\s*</.test(s);

/** Renders ALREADY-SANITIZED rich text — or legacy plain text with linkified URLs.
 * Client-safe (no sanitize-html in the bundle): only pass HTML that was cleaned at
 * write time (cleanHtml in the save actions) or by the server-side <RichText>. */
export default function RichTextView({ html, className = "" }: { html: string; className?: string }) {
  if (isHtml(html)) {
    return <div className={`rich text-sm leading-relaxed ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  const parts = html.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <div className={`whitespace-pre-wrap text-sm leading-relaxed ${className}`}>
      {parts.map((p, i) => /^https?:\/\//.test(p)
        ? <a key={i} href={p} target="_blank" rel="noreferrer" className="text-sky-700 underline break-all">{p}</a>
        : <span key={i}>{p}</span>)}
    </div>
  );
}
