import { Router } from "express";
import { id, one, rows, fail, audit } from "./util.js";
import { requireUser, allow, has, text } from "./auth.js";
import { notify, staffNotify } from "./services/notifications.js";
export function socialRoutes({ db, ai }) {
  const r = Router();
  r.use(requireUser);
  const quota = () =>
    Math.min(500, Math.max(1, Number(process.env.AI_DAILY_LIMIT) || 30));
  r.get("/ai/config", async (req, res) =>
    res.json({
      providers: ai.available(),
      daily_limit: quota(),
      used:
        (
          await one(
            db,
            "SELECT requests FROM ai_usage WHERE user_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date",
            [req.user.id],
          )
        )?.requests || 0,
    }),
  );
  r.get("/ai/conversations", async (req, res) =>
    res.json(
      await rows(
        db,
        "SELECT id,title,provider,created_at,updated_at FROM ai_conversations WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100",
        [req.user.id],
      ),
    ),
  );
  r.post("/ai/conversations", async (req, res) => {
    const provider = req.body.provider || "auto";
    if (!["auto", "gemini", "groq"].includes(provider))
      fail(400, "Select an AI provider");
    const cid = id();
    await db.query(
      "INSERT INTO ai_conversations(id,user_id,title,provider) VALUES($1,$2,$3,$4)",
      [
        cid,
        req.user.id,
        text(req.body.title || "New study conversation", 2, 100),
        provider,
      ],
    );
    res.json({ id: cid });
  });
  r.get("/ai/conversations/:id", async (req, res) => {
    const c = await one(
      db,
      "SELECT id,title,provider,consent_at,busy_until FROM ai_conversations WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id],
    );
    if (!c) fail(404, "Conversation not found");
    res.json({
      ...c,
      messages: await rows(
        db,
        "SELECT id,role,content,state,provider,model,request_id,created_at FROM ai_messages WHERE conversation_id=$1 ORDER BY sequence_no LIMIT 500",
        [req.params.id],
      ),
    });
  });
  r.delete("/ai/conversations/:id", async (req, res) => {
    await db.tx(async (t) => {
      const c = await one(
        t,
        "SELECT * FROM ai_conversations WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [req.params.id, req.user.id],
      );
      if (!c) fail(404, "Conversation not found");
      if (c.busy_until && new Date(c.busy_until) > new Date())
        fail(409, "Wait until this reply finishes before deleting the chat");
      await t.query("DELETE FROM ai_conversations WHERE id=$1", [c.id]);
    });
    res.json({ ok: true });
  });
  r.post("/ai/conversations/:id/messages", async (req, res) => {
    const content = text(req.body.message, 1, 4000),
      requestId = text(req.body.request_id, 16, 100),
      provider = req.body.provider || "auto";
    if (!["auto", "gemini", "groq"].includes(provider))
      fail(400, "Select an AI provider");
    const claim = await db.tx(async (t) => {
      const c = await one(
        t,
        "SELECT * FROM ai_conversations WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [req.params.id, req.user.id],
      );
      if (!c) fail(404, "Conversation not found");
      const previous = await one(
        t,
        "SELECT id,role,content,state,request_id,provider,model,created_at FROM ai_messages WHERE conversation_id=$1 AND request_id=$2 AND role='assistant'",
        [c.id, requestId],
      );
      if (previous) return { previous };
      if (
        await one(
          t,
          "SELECT 1 FROM ai_messages WHERE conversation_id=$1 AND request_id=$2 AND role='user'",
          [c.id, requestId],
        )
      )
        fail(
          409,
          "This question was already submitted. Reload the chat or send a new question.",
        );
      if (c.busy_until && new Date(c.busy_until) > new Date())
        fail(409, "A reply is already being prepared in this chat");
      if (c.busy_token)
        await t.query(
          "UPDATE ai_messages SET state='failed' WHERE conversation_id=$1 AND state='pending'",
          [c.id],
        );
      if (!c.consent_at && req.body.accept_ai !== true)
        fail(
          400,
          "Accept the AI chat notice before sending your first question",
        );
      if (
        !ai.available().length ||
        (provider !== "auto" && !ai.available().includes(provider))
      )
        fail(503, "This AI provider has not been configured");
      if (
        (
          await one(
            t,
            "SELECT count(*)::int AS n FROM ai_messages WHERE conversation_id=$1",
            [c.id],
          )
        ).n >= 400
      )
        fail(409, "This conversation is full. Start a new chat.");
      await t.query(
        "INSERT INTO ai_usage(user_id,day,requests) VALUES($1,(now() AT TIME ZONE 'UTC')::date,0) ON CONFLICT DO NOTHING",
        [req.user.id],
      );
      const usage = await one(
        t,
        "SELECT requests FROM ai_usage WHERE user_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date FOR UPDATE",
        [req.user.id],
      );
      if (usage.requests >= quota())
        fail(
          429,
          "Your daily AI request limit has been reached. Try again tomorrow (UTC).",
        );
      await t.query(
        "UPDATE ai_usage SET requests=requests+1 WHERE user_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date",
        [req.user.id],
      );
      const lease = id();
      await t.query(
        "UPDATE ai_conversations SET busy_token=$2,busy_until=now()+interval '90 seconds',consent_at=coalesce(consent_at,now()),provider=$3,title=CASE WHEN title='New study conversation' THEN $4 ELSE title END,updated_at=now() WHERE id=$1",
        [c.id, lease, provider, content.slice(0, 80)],
      );
      const history = (
        await rows(
          t,
          "SELECT role,content FROM ai_messages WHERE conversation_id=$1 AND state='complete' ORDER BY sequence_no DESC LIMIT 12",
          [c.id],
        )
      ).reverse();
      while (history.reduce((n, m) => n + m.content.length, 0) > 16000)
        history.shift();
      while (history.length && history[0].role !== "user") history.shift();
      await t.query(
        "INSERT INTO ai_messages(id,conversation_id,role,content,state,request_id) VALUES($1,$2,'user',$3,'pending',$4)",
        [id(), c.id, content, requestId],
      );
      return { lease, history: [...history, { role: "user", content }] };
    });
    if (claim.previous)
      return res.json({ message: claim.previous, reused: true });
    try {
      const answer = await ai.generate(claim.history, provider);
      const message = await db.tx(async (t) => {
        const c = await one(
          t,
          "SELECT busy_token FROM ai_conversations WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [req.params.id, req.user.id],
        );
        if (c?.busy_token !== claim.lease)
          fail(409, "This response expired. Reload the conversation.");
        const message = { id: id(), role: "assistant", ...answer };
        await t.query(
          "UPDATE ai_messages SET state='complete' WHERE conversation_id=$1 AND request_id=$2 AND role='user'",
          [req.params.id, requestId],
        );
        await t.query(
          "INSERT INTO ai_messages(id,conversation_id,role,content,request_id,provider,model) VALUES($1,$2,'assistant',$3,$4,$5,$6)",
          [
            message.id,
            req.params.id,
            answer.content,
            requestId,
            answer.provider,
            answer.model,
          ],
        );
        await t.query(
          "UPDATE ai_conversations SET busy_token=NULL,busy_until=NULL,updated_at=now() WHERE id=$1",
          [req.params.id],
        );
        return message;
      });
      res.json({ message });
    } catch (e) {
      await db.tx(async (t) => {
        await t.query(
          "UPDATE ai_messages SET state='failed' WHERE conversation_id=$1 AND request_id=$2 AND role='user' AND state='pending'",
          [req.params.id, requestId],
        );
        await t.query(
          "UPDATE ai_conversations SET busy_token=NULL,busy_until=NULL WHERE id=$1 AND busy_token=$2",
          [req.params.id, claim.lease],
        );
      });
      throw e;
    }
  });
  r.get("/community", async (req, res) => {
    const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1)),
      params = [],
      where = ["t.status<>'hidden'", "u.status<>'anonymized'"];
    if (req.query.course) {
      params.push(String(req.query.course));
      where.push("t.course_id=$" + params.length);
    }
    if (req.query.q) {
      params.push("%" + String(req.query.q).slice(0, 150) + "%");
      where.push(
        "(t.title ILIKE $" +
          params.length +
          " OR t.body ILIKE $" +
          params.length +
          ")",
      );
    }
    if (req.query.kind === "question") where.push("t.kind='question'");
    const from =
      " FROM discussion_threads t JOIN users u ON u.id=t.user_id LEFT JOIN courses c ON c.id=t.course_id WHERE " +
      where.join(" AND ");
    const total = (await one(db, "SELECT count(*)::int AS n" + from, params)).n;
    const items = await rows(
      db,
      "SELECT t.id,t.user_id,t.title,t.body,t.kind,t.status,t.solved,t.created_at,t.updated_at,u.name AS author,u.role AS author_role,c.name AS course,(SELECT count(*)::int FROM discussion_replies p WHERE p.thread_id=t.id AND p.hidden=false) AS reply_count" +
        from +
        ` ORDER BY t.updated_at DESC,t.id LIMIT 20 OFFSET $${params.length + 1}`,
      [...params, (page - 1) * 20],
    );
    res.json({ items, page, pages: Math.ceil(total / 20), total });
  });
  r.post("/community", async (req, res) => {
    const tid = id(),
      body = text(req.body.body, 5, 6000),
      title = text(req.body.title, 5, 180);
    if (
      req.body.course_id &&
      !(await one(db, "SELECT id FROM courses WHERE id=$1", [
        req.body.course_id,
      ]))
    )
      fail(400, "Choose a valid course");
    await db.tx(async (t) => {
      await t.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        req.user.id,
      ]);
      if (
        (
          await one(
            t,
            "SELECT count(*)::int AS n FROM discussion_threads WHERE user_id=$1 AND created_at>now()-interval '1 hour'",
            [req.user.id],
          )
        ).n >= 10
      )
        fail(429, "You have reached the hourly topic limit. Try again later.");
      await t.query(
        "INSERT INTO discussion_threads(id,user_id,course_id,title,body,kind) VALUES($1,$2,$3,$4,$5,$6)",
        [
          tid,
          req.user.id,
          req.body.course_id || null,
          title,
          body,
          req.body.kind === "discussion" ? "discussion" : "question",
        ],
      );
    });
    res.json({ id: tid });
  });
  r.get("/community/:id", async (req, res) => {
    const thread = await one(
      db,
      "SELECT t.*,u.name AS author,u.role AS author_role,c.name AS course FROM discussion_threads t JOIN users u ON u.id=t.user_id LEFT JOIN courses c ON c.id=t.course_id WHERE t.id=$1 AND t.status<>'hidden'",
      [req.params.id],
    );
    if (!thread) fail(404, "Discussion not found");
    delete thread.moderation_reason;
    const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
    const total = (
      await one(
        db,
        "SELECT count(*)::int AS n FROM discussion_replies WHERE thread_id=$1 AND hidden=false",
        [thread.id],
      )
    ).n;
    const replies = await rows(
      db,
      "SELECT p.id,p.body,p.user_id,p.created_at,u.name AS author,u.role AS author_role FROM discussion_replies p JOIN users u ON u.id=p.user_id WHERE p.thread_id=$1 AND p.hidden=false ORDER BY p.created_at,p.id LIMIT 50 OFFSET $2",
      [thread.id, (page - 1) * 50],
    );
    res.json({
      thread,
      replies,
      total,
      page,
      pages: Math.ceil(total / 50),
      can_moderate: has(req.user, "community"),
    });
  });
  r.post("/community/:id/replies", async (req, res) => {
    const body = text(req.body.body, 1, 4000),
      replyId = id();
    await db.tx(async (t) => {
      const thread = await one(
        t,
        "SELECT * FROM discussion_threads WHERE id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!thread || thread.status === "hidden")
        fail(404, "Discussion not found");
      if (thread.status === "locked") fail(409, "This discussion is locked");
      await t.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        req.user.id,
      ]);
      if (
        (
          await one(
            t,
            "SELECT count(*)::int AS n FROM discussion_replies WHERE user_id=$1 AND created_at>now()-interval '1 hour'",
            [req.user.id],
          )
        ).n >= 60
      )
        fail(429, "You have reached the hourly reply limit");
      await t.query(
        "INSERT INTO discussion_replies(id,thread_id,user_id,body) VALUES($1,$2,$3,$4)",
        [replyId, thread.id, req.user.id, body],
      );
      await t.query(
        "UPDATE discussion_threads SET updated_at=now() WHERE id=$1",
        [thread.id],
      );
      if (thread.user_id !== req.user.id)
        await notify(t, {
          users: [thread.user_id],
          title: "New reply: " + thread.title,
          message: req.user.name + " replied to your discussion.",
          link: "/account/chats?thread=" + thread.id,
        });
    });
    res.json({ id: replyId });
  });
  r.patch("/community/:id/solved", async (req, res) => {
    await db.tx(async (t) => {
      const thread = await one(
        t,
        "SELECT * FROM discussion_threads WHERE id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!thread || thread.status === "hidden")
        fail(404, "Discussion not found");
      if (thread.user_id !== req.user.id && !has(req.user, "community"))
        fail(403, "Only the topic author or moderator can change this");
      await t.query(
        "UPDATE discussion_threads SET solved=$2,updated_at=now() WHERE id=$1",
        [thread.id, req.body.solved === true],
      );
    });
    res.json({ ok: true });
  });
  r.post("/community/:id/report", async (req, res) => {
    await db.tx(async (t) => {
      const thread = await one(
        t,
        "SELECT id FROM discussion_threads WHERE id=$1 AND status<>'hidden'",
        [req.params.id],
      );
      if (!thread) fail(404, "Discussion not found");
      const replyId = req.body.reply_id || null;
      if (
        replyId &&
        !(await one(
          t,
          "SELECT id FROM discussion_replies WHERE id=$1 AND thread_id=$2 AND hidden=false",
          [replyId, thread.id],
        ))
      )
        fail(404, "Reply not found");
      await t.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        req.user.id,
      ]);
      if (
        (
          await one(
            t,
            "SELECT count(*)::int AS n FROM discussion_reports WHERE reporter_id=$1 AND created_at>now()-interval '1 hour'",
            [req.user.id],
          )
        ).n >= 10
      )
        fail(429, "You have reached the hourly report limit");
      await t.query(
        "INSERT INTO discussion_reports(id,reporter_id,thread_id,reply_id,reason) VALUES($1,$2,$3,$4,$5)",
        [id(), req.user.id, thread.id, replyId, text(req.body.reason, 5, 1000)],
      );
      const mods = await rows(
        t,
        "SELECT id FROM users WHERE status='active' AND (role='super_admin' OR (role='admin' AND permissions ? 'community'))",
      );
      await notify(t, {
        users: mods.map((u) => u.id),
        title: "Discussion report received",
        message: "A community post needs moderator review.",
        link: "/admin/community",
      });
    });
    res.json({ ok: true });
  });
  r.get("/moderation", allow("community"), async (req, res) =>
    res.json({
      threads: await rows(
        db,
        "SELECT t.*,u.name AS author FROM discussion_threads t JOIN users u ON u.id=t.user_id ORDER BY t.updated_at DESC LIMIT 200",
      ),
      reports: await rows(
        db,
        "SELECT d.*,u.name AS reporter,t.title,p.body AS reply_body FROM discussion_reports d JOIN users u ON u.id=d.reporter_id JOIN discussion_threads t ON t.id=d.thread_id LEFT JOIN discussion_replies p ON p.id=d.reply_id ORDER BY d.created_at DESC LIMIT 200",
      ),
    }),
  );
  r.get("/moderation/:id", allow("community"), async (req, res) => {
    const thread = await one(
      db,
      "SELECT * FROM discussion_threads WHERE id=$1",
      [req.params.id],
    );
    if (!thread) fail(404, "Discussion not found");
    res.json({
      thread,
      replies: await rows(
        db,
        "SELECT p.*,u.name AS author,u.role AS author_role FROM discussion_replies p JOIN users u ON u.id=p.user_id WHERE thread_id=$1 ORDER BY created_at LIMIT 500",
        [thread.id],
      ),
    });
  });
  r.post("/moderation/:id", allow("community"), async (req, res) => {
    const reason = text(req.body.reason, 5, 1000);
    await db.tx(async (t) => {
      const thread = await one(
        t,
        "SELECT * FROM discussion_threads WHERE id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!thread) fail(404, "Discussion not found");
      if (req.body.reply_id) {
        const p = await one(
          t,
          "SELECT id FROM discussion_replies WHERE id=$1 AND thread_id=$2",
          [req.body.reply_id, thread.id],
        );
        if (!p) fail(404, "Reply not found");
        await t.query(
          "UPDATE discussion_replies SET hidden=$2,moderation_reason=$3 WHERE id=$1",
          [p.id, req.body.hidden !== false, reason],
        );
      } else {
        if (!["open", "locked", "hidden"].includes(req.body.status))
          fail(400, "Select a moderation action");
        await t.query(
          "UPDATE discussion_threads SET status=$2,moderation_reason=$3,updated_at=now() WHERE id=$1",
          [thread.id, req.body.status, reason],
        );
      }
      await audit(
        t,
        req.user.id,
        "community.moderated",
        req.body.reply_id || thread.id,
        { reason, status: req.body.status || "reply", hidden: req.body.hidden },
      );
    });
    res.json({ ok: true });
  });
  r.post("/reports/:id/resolve", allow("community"), async (req, res) => {
    const result = await db.query(
      "UPDATE discussion_reports SET state='resolved',resolved_by=$2,resolved_at=now() WHERE id=$1 RETURNING id",
      [req.params.id, req.user.id],
    );
    if (!result.rows.length) fail(404, "Report not found");
    await audit(db, req.user.id, "community.report.resolved", req.params.id);
    res.json({ ok: true });
  });
  r.get("/onboarding", async (req, res) =>
    res.json({
      status: req.user.tour_status,
      step: req.user.tour_step,
      eligible:
        req.user.role === "student" &&
        !!req.user.profile_completed_at &&
        !!req.user.password_hash,
    }),
  );
  r.post("/onboarding", async (req, res) => {
    if (
      req.user.role !== "student" ||
      !req.user.profile_completed_at ||
      !req.user.password_hash
    )
      fail(
        409,
        "Finish your profile and set your password before starting the guide",
      );
    const status = req.body.status,
      step = Number(req.body.step);
    if (
      !["in_progress", "completed", "skipped"].includes(status) ||
      !Number.isInteger(step) ||
      step < 0 ||
      step > 5
    )
      fail(400, "Invalid guide step");
    await db.query("UPDATE users SET tour_status=$2,tour_step=$3 WHERE id=$1", [
      req.user.id,
      status,
      step,
    ]);
    res.json({ status, step, eligible: true });
  });
  return r;
}
