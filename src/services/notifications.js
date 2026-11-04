import { id, rows } from "../util.js";
export async function notify(
  db,
  {
    users,
    title,
    message,
    priority = "normal",
    link = "/account/notifications",
    actor = null,
  },
) {
  const n = id();
  await db.query(
    "INSERT INTO notifications(id,title,message,priority,link,created_by) VALUES($1,$2,$3,$4,$5,$6)",
    [n, title, message, priority, link, actor],
  );
  for (const u of [...new Set(users)])
    await db.query(
      "INSERT INTO notification_recipients(notification_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [n, u],
    );
  return n;
}
export async function staffNotify(
  db,
  title,
  message,
  link = "/admin/payments",
) {
  const users = await rows(
    db,
    "SELECT id FROM users WHERE role IN ('admin','super_admin') AND status='active'",
  );
  return notify(db, { users: users.map((u) => u.id), title, message, link });
}
