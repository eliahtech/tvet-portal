import { id, one, rows, fail, audit } from "../util.js";
import { notify } from "./notifications.js";
export async function impact(db, seriesId) {
  const resources = await rows(
    db,
    "SELECT id,title FROM resources WHERE series_id=$1 AND status<>'deleted'",
    [seriesId],
  );
  const buyers = await rows(
    db,
    "SELECT DISTINCT e.user_id FROM entitlements e JOIN resources r ON r.id=e.resource_id WHERE r.series_id=$1",
    [seriesId],
  );
  const pending = await rows(
    db,
    "SELECT DISTINCT o.id FROM orders o JOIN order_items i ON i.order_id=o.id JOIN resources r ON r.id=i.resource_id WHERE r.series_id=$1 AND o.status IN ('initiated','pending','needs_review')",
    [seriesId],
  );
  return { resources, buyers: buyers.length, pending_orders: pending.length };
}
export async function scheduleDeletion(
  db,
  actor,
  seriesId,
  { reason, execute_after, confirmation },
) {
  return db.tx(async (t) => {
    const s = await one(
      t,
      "SELECT * FROM assessment_series WHERE id=$1 FOR UPDATE",
      [seriesId],
    );
    if (!s) fail(404, "Series not found");
    if (!["open", "closed"].includes(s.status))
      fail(
        409,
        "This series already has an active deletion or has been deleted",
      );
    if (confirmation !== s.name)
      fail(400, "Type the exact series name to confirm");
    const policy = await one(
      t,
      "SELECT value FROM settings WHERE key='policy'",
    );
    const days = policy.value.notice_days;
    const when = new Date(execute_after);
    if (!Number.isFinite(+when) || +when < Date.now() + days * 86400000)
      fail(400, "Deletion must be at least " + days + " days from now");
    const i = await impact(t, seriesId);
    if (i.pending_orders)
      fail(409, "Resolve pending orders before scheduling deletion");
    const job = id();
    await t.query(
      "INSERT INTO deletion_jobs(id,series_id,reason,execute_after,created_by) VALUES($1,$2,$3,$4,$5)",
      [job, seriesId, reason, when.toISOString(), actor],
    );
    await t.query(
      "UPDATE assessment_series SET status='deleting' WHERE id=$1",
      [seriesId],
    );
    await t.query(
      "INSERT INTO deletion_resources(job_id,resource_id) SELECT $1,id FROM resources WHERE series_id=$2 AND status<>'deleted'",
      [job, seriesId],
    );
    await t.query(
      "INSERT INTO deletion_recipients(job_id,user_id) SELECT DISTINCT $1,e.user_id FROM entitlements e JOIN resources r ON r.id=e.resource_id WHERE r.series_id=$2",
      [job, seriesId],
    );
    const buyers = await rows(
      t,
      "SELECT user_id FROM deletion_recipients WHERE job_id=$1",
      [job],
    );
    const titles = i.resources.map((r) => r.title).join(", ");
    await notify(t, {
      users: buyers.map((u) => u.user_id),
      title: "Paper deletion notice: " + s.name,
      message:
        s.name +
        " " +
        s.year +
        " papers are scheduled for permanent deletion on " +
        when.toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }) +
        " (Africa/Nairobi). Affected papers: " +
        titles +
        ". Download your purchased copies before this date. Reason: " +
        reason,
      priority: "urgent",
      link: "/account/papers",
      actor,
    });
    await audit(t, actor, "series.deletion.scheduled", seriesId, {
      job,
      execute_after: when.toISOString(),
      buyers: i.buyers,
    });
    return { id: job, ...i };
  });
}
export async function cancelDeletion(db, actor, jobId) {
  return db.tx(async (t) => {
    const j = await one(
      t,
      "SELECT * FROM deletion_jobs WHERE id=$1 FOR UPDATE",
      [jobId],
    );
    if (j?.status !== "scheduled")
      fail(409, "Only a scheduled deletion can be cancelled");
    await t.query("UPDATE deletion_jobs SET status='cancelled' WHERE id=$1", [
      jobId,
    ]);
    await t.query("UPDATE assessment_series SET status='closed' WHERE id=$1", [
      j.series_id,
    ]);
    const buyers = await rows(
      t,
      "SELECT user_id FROM deletion_recipients WHERE job_id=$1",
      [jobId],
    );
    await notify(t, {
      users: buyers.map((u) => u.user_id),
      title: "Scheduled deletion cancelled",
      message:
        "The scheduled deletion has been cancelled. Your purchased papers remain available.",
      link: "/account/papers",
      actor,
    });
    await audit(t, actor, "series.deletion.cancelled", j.series_id);
  });
}
export async function executeDeletion(db, files, actor, jobId, confirmation) {
  const j = await db.tx(async (t) => {
    const j = await one(
      t,
      "SELECT j.*,s.name FROM deletion_jobs j JOIN assessment_series s ON s.id=j.series_id WHERE j.id=$1 FOR UPDATE",
      [jobId],
    );
    if (!j || !["scheduled", "running"].includes(j.status))
      fail(409, "Deletion is not scheduled");
    if (confirmation !== j.name)
      fail(400, "Type the exact series name to confirm");
    if (new Date(j.execute_after) > new Date())
      fail(409, "The notice period has not ended");
    if ((await impact(t, j.series_id)).pending_orders)
      fail(409, "Resolve pending orders before deletion");
    await t.query("UPDATE deletion_jobs SET status='running' WHERE id=$1", [
      jobId,
    ]);
    return j;
  });
  // Retry-safe removal: failure leaves a visible running job for administrator retry.
  const resources = await rows(
    db,
    "SELECT r.* FROM resources r JOIN deletion_resources d ON d.resource_id=r.id WHERE d.job_id=$1",
    [jobId],
  );
  for (const r of resources) {
    const versions = await rows(
      db,
      "SELECT file_key FROM resource_versions WHERE resource_id=$1",
      [r.id],
    );
    for (const key of new Set(
      [r.file_key, r.preview_key, ...versions.map((v) => v.file_key)].filter(
        Boolean,
      ),
    ))
      await files.remove(key);
  }
  await db.tx(async (t) => {
    await t.query(
      "UPDATE resources SET status='deleted',file_key=NULL,preview_key=NULL,updated_at=now() WHERE id IN (SELECT resource_id FROM deletion_resources WHERE job_id=$1)",
      [jobId],
    );
    await t.query("UPDATE assessment_series SET status='deleted' WHERE id=$1", [
      j.series_id,
    ]);
    await t.query("UPDATE deletion_jobs SET status='completed' WHERE id=$1", [
      jobId,
    ]);
    await audit(t, actor, "series.deletion.completed", j.series_id);
  });
}
