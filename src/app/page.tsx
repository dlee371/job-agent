// Phase 0 placeholder: proves the Next.js app can read the database on the server.
// The real review queue arrives in Phase 6.
import { db } from "@/lib/db";

export const dynamic = "force-dynamic"; // always read fresh counts

async function count(table: string) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  return error ? `error: ${error.message}` : count;
}

export default async function Home() {
  const [jobs, applications, calls] = await Promise.all([count("jobs"), count("applications"), count("llm_calls")]);
  const { data: costRows } = await db.from("llm_calls").select("cost_usd");
  const totalCost = (costRows ?? []).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Job Agent</h1>
      <p className="mt-1 text-sm text-gray-500">Database connected. The review queue comes in Phase 6.</p>
      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Jobs", jobs],
          ["Applications", applications],
          ["Claude calls", calls],
          ["Total spend", `$${totalCost.toFixed(4)}`],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border bg-white p-4">
            <dt className="text-xs uppercase text-gray-500">{label}</dt>
            <dd className="mt-1 text-lg font-medium">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
