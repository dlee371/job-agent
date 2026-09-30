// Tests the Postgres trigger that guards application statuses (ARCHITECTURE.md §5, §11).
// Needs local Supabase running (npm run db:start) and a valid .env; otherwise it is skipped.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

let db: SupabaseClient | null = null;
try {
  db = (await import("@/lib/db")).db;
  const { error } = await db.from("applications").select("id", { head: true });
  if (error) db = null;
} catch {
  db = null;
}

describe.skipIf(!db)("applications status trigger", () => {
  const sb = db!;
  let jobId: string;

  beforeAll(async () => {
    const { data, error } = await sb
      .from("jobs")
      .insert({ source: "test", external_id: `trigger-test-${Date.now()}`, dedupe_key: "test", title: "Test", company: "Test" })
      .select("id")
      .single();
    if (error) throw error;
    jobId = data.id;
  });

  afterAll(async () => {
    await sb.from("jobs").delete().eq("id", jobId); // cascades to applications + events
  });

  async function newApplication(): Promise<string> {
    // one application per job, so clear any previous one first
    await sb.from("applications").delete().eq("job_id", jobId);
    const { data, error } = await sb.from("applications").insert({ job_id: jobId }).select("id").single();
    if (error) throw error;
    return data.id;
  }

  async function setStatus(id: string, status: string, extra: Record<string, unknown> = {}) {
    return sb.from("applications").update({ status, ...extra }).eq("id", id).select("*").single();
  }

  it("rejects creating an application that is already approved", async () => {
    await sb.from("applications").delete().eq("job_id", jobId);
    const { error } = await sb.from("applications").insert({ job_id: jobId, status: "approved" });
    expect(error?.message).toMatch(/must start as drafting/);
  });

  it("rejects skipping review: drafting -> submitting", async () => {
    const id = await newApplication();
    const { error } = await setStatus(id, "submitting");
    expect(error?.message).toMatch(/Illegal application status change: drafting -> submitting/);
  });

  it("rejects awaiting_review -> submitting (not approved)", async () => {
    const id = await newApplication();
    await setStatus(id, "ready_to_fill");
    await setStatus(id, "awaiting_review");
    const { error } = await setStatus(id, "submitting");
    expect(error?.message).toMatch(/Illegal application status change/);
  });

  it("records approved_at + approved_hash, then allows approved -> submitting", async () => {
    const id = await newApplication();
    await setStatus(id, "ready_to_fill", { form_answers: [{ field_id: "q1", value: "yes" }] });
    await setStatus(id, "awaiting_review");
    const approved = await setStatus(id, "approved");
    expect(approved.error).toBeNull();
    expect(approved.data.approved_at).not.toBeNull();
    expect(approved.data.approved_hash).toMatch(/^[0-9a-f]{32}$/);

    const submitting = await setStatus(id, "submitting");
    expect(submitting.error).toBeNull();
  });

  it("sends an approved application back to review when its content is edited", async () => {
    const id = await newApplication();
    await setStatus(id, "ready_to_fill", { form_answers: [{ field_id: "q1", value: "yes" }] });
    await setStatus(id, "awaiting_review");
    await setStatus(id, "approved");

    const edited = await sb
      .from("applications")
      .update({ form_answers: [{ field_id: "q1", value: "no" }] })
      .eq("id", id)
      .select("*")
      .single();
    expect(edited.data.status).toBe("awaiting_review");
    expect(edited.data.approved_hash).toBeNull();
  });

  it("logs every status change in application_events", async () => {
    const id = await newApplication();
    await setStatus(id, "ready_to_fill");
    await setStatus(id, "awaiting_review");
    const { data } = await sb.from("application_events").select("from_status, to_status").eq("application_id", id).order("id");
    expect(data).toEqual([
      { from_status: "drafting", to_status: "ready_to_fill" },
      { from_status: "ready_to_fill", to_status: "awaiting_review" },
    ]);
  });
});
