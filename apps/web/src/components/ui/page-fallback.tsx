import { Skeleton } from "./primitives";

/** Placeholder shown while a page's URL params resolve (keeps the shared shell instant on navigation). */
export function PageFallback() {
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-10" aria-busy="true">
      <Skeleton className="h-9 w-2/3 max-w-lg" />
      <Skeleton className="h-5 w-1/2 max-w-md" />
      <Skeleton className="h-64" />
    </div>
  );
}
