# AI StudyMate, chat centre and app guide — version 1.1

## Upgrade an existing installation

Back up the database and private files first. Deploy the new source and run `npm ci`. Using the migration-owner database connection, run:

```bash
npm run db:migrate
npm run db:runtime-role
```

Migration `003_ai_community_tour.sql` adds the AI/community tables and guide state. Existing papers, purchases, accounts and receipts remain in place. Existing student accounts with a password become eligible for the new first-use guide; it is displayed on their next account-page visit. New members become eligible after saving their profile and setting a password; setting the password also confirms the basic profile already supplied at registration.

The runtime-role helper grants the new table access and usage of the AI-message ordering sequence to `tvet_app`. Run it again even if that role already exists. Then restore the restricted runtime database connection and restart the web server and scheduled jobs. Local development applies migrations on startup; stop the local server before running separate setup commands against PGlite.

## Configure Gemini and Groq

Add the following to the private server environment, never to frontend JavaScript:

```text
GEMINI_API_KEY=
GROQ_API_KEY=
GEMINI_MODEL=gemini-flash-latest
GROQ_MODEL=llama-3.3-70b-versatile
AI_PRIMARY_PROVIDER=gemini
AI_DAILY_LIMIT=30
```

Use keys issued to your own provider projects/accounts. Choose model IDs currently available to those accounts; model access, quotas and billing are controlled by the providers. The supplied model names are configurable examples, not a guarantee of free or universal access. Restart after changing server configuration. No API keys were supplied for this delivery, so real provider authentication and billing/quota behavior remain to be verified.

StudyMate is a private, authenticated text-chat interface. It stores conversations and supports recent history, multi-turn context, copying answers, retrying failed questions and deleting owned conversations. Questions have a 4,000-character limit; replies are requested with a 1,500-token output budget. Each conversation caps at 400 stored messages, and the history list shows the latest 100 conversations.

Provider choices:

- **Gemini:** use only Gemini; an error does not silently transfer the conversation to Groq.
- **Groq:** use only Groq.
- **Automatic:** try the configured primary provider first, then the other configured provider on eligible availability/quota/network errors. The actual answering provider appears on each answer.

The implementation uses Gemini's supported `generateContent` REST endpoint and Groq's chat-completions endpoint. Answers arrive after completion, with a waiting indicator; this release does not stream response tokens. API keys are sent in server-side request headers, not browser code or URL query strings. Returned provider diagnostic bodies are not exposed to users or logged by the adapter.

Only the user's own recent conversation text is sent. The assistant has no tools for changing accounts, querying purchases, reading private PDFs, unlocking papers or viewing another person's conversations. No purchased documents are automatically attached. Before the first message, the user acknowledges which services may process the conversation; automatic mode may send it to either configured service. Publish your actual AI data-processing and retention policy before launch.

Conversation ownership applies to every read, send and delete operation, including attempts from staff accounts. Staff have no endpoint for reading users' private AI messages. Suspension blocks the new routes through the normal session middleware.

The default daily allowance is 30 requests per user, reset at midnight UTC. The maximum configured allowance is 500. Failed provider calls count toward the allowance because an upstream request may already have consumed resources. This is an application request limit, not a provider spending cap. Configure spending/quota limits with each provider too. A database-backed per-conversation lease blocks concurrent replies; client request IDs prevent duplicate sends from issuing a second provider request. A timed-out conversation can be retried after its lease expires.

## Chat centre

The shared chat centre is a course-filtered, searchable discussion and question board for signed-in members. It supports:

- General or course-specific topics, labelled as questions or discussions.
- Paginated replies, author names, timestamps, staff labels and solved status.
- In-app notifications to topic owners when someone replies.
- A report action on topics and individual replies.
- A 15-second visible-page refresh check while reading a topic; it avoids refreshing during typing/submission. Pagination or a manual page refresh loads older/newer replies as needed.

Posts are shared with signed-in members, not publicly indexed. Email addresses, phone numbers, sessions and purchase records are excluded from member-facing discussion responses. The composer reminds members to keep private information out of posts.

Basic abuse limits are persisted in the database: ten topics, sixty replies and ten reports per account per hour. The normal CSRF and account-status checks apply. This release is a discussion centre, not private direct messaging, voice/video chat, or file sharing.

## Moderator permissions

Super admins automatically have moderation access. For normal admins, the super admin must grant the new **community** permission under Administrators. Other permissions do not imply access to moderation tools.

Community moderation lets staff review reports, lock or hide topics, hide individual replies, restore previously hidden content and resolve reports. A reason is required for moderation changes and is recorded in the audit log. Hidden content disappears from member APIs; locked topics stay readable but reject new replies. Moderation does not delete financial records or alter purchased-paper permissions.

## Bottom navigation

The fixed icon navigation provides Home, Papers, AI, Chats and Profile/Account. It appears on desktop and mobile with an active-page indicator. On mobile, additional actions such as browsing resources, purchase history, support, paper requests, wishlist and sign-out remain available in the horizontal shortcut row. Staff retain their administration navigation.

## Automatic app guide

After basic profile/password setup, the six-step guide appears automatically on an account page. It introduces resource discovery, My Papers, AI StudyMate, the chat centre, notifications and Profile/security.

Controls are **Previous**, **Next**, **Skip**, and **Finish** on the final step. Closing with the X or Escape records a skip. Progress is stored per account, so an interrupted guide resumes and completed/skipped guides do not reappear automatically on another device. Use **App guide** in Profile to replay it. This is a native dialog with labelled controls, keyboard focus behavior and progress indicators.

## Validation

Automated checks cover provider payloads/headers, explicit provider selection, automatic fallback, error handling, private-history ownership, server-owned context, consent, daily limits, leases and duplicate request IDs. Community checks cover access, reports, reply/topic correlation, moderation, suspension and audit events. DOM tests render AI/discussion/moderation pages and exercise the guide's Next/Previous/Skip controls and safe AI formatting. Existing payment, private-download and deletion tests remain part of the regression suite.

Real Gemini/Groq calls, provider-side retention settings and load behavior have not been verified without your keys and deployment environment.

Official API references: [Gemini generation](https://ai.google.dev/api/generate-content), [Gemini models](https://ai.google.dev/gemini-api/docs/models), [Groq chat API](https://console.groq.com/docs/api-reference), [Groq supported models](https://console.groq.com/docs/models).
