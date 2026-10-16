/** Shown by the loading.tsx files the moment a link is clicked, while the server loads
 * the page — so a click never looks like it did nothing. */
export default function PageSkeleton() {
  const block = { background: "var(--g-grey-100)" };
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-56 rounded" style={block} />
      <div className="h-4 w-80 max-w-full rounded" style={block} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-28 rounded-lg" style={block} />)}
      </div>
    </div>
  );
}
