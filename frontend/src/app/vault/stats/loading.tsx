export default function VaultStatsLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading vault statistics"
      className="mx-auto max-w-5xl px-4 py-8"
    >
      <div className="mb-6 animate-pulse space-y-2">
        <div className="h-9 w-64 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-4 w-96 rounded bg-zinc-100 dark:bg-zinc-900" />
      </div>
      <div className="animate-pulse rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6 h-7 w-56 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="h-24 rounded-xl bg-zinc-100 dark:bg-zinc-800"
            />
          ))}
        </div>
      </div>
    </main>
  );
}
