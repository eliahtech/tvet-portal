const $ = (s) => document.querySelector(s),
  app = $("#app"),
  modal = $("#modal");
const state = {
  user: null,
  csrf: "",
  settings: { public: {}, policy: {} },
  data: {},
  courses: [],
  tax: { units: [], series: [], taxonomy: [] },
};
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(Number(n || 0) / 100);
const date = (x) =>
  x
    ? new Intl.DateTimeFormat("en-KE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Nairobi",
      }).format(new Date(x))
    : "—";
const icon = (n) => '<i class="bi bi-' + n + '" aria-hidden="true"></i>';
const staff = () => ["admin", "super_admin"].includes(state.user?.role);
const permitted = (p) =>
  state.user?.role === "super_admin" || state.user?.permissions?.includes(p);
const empty = (
  title = "Nothing here yet",
  message = "New items will appear here when available.",
  symbol = "inbox",
) =>
  '<div class="empty">' +
  icon(symbol) +
  "<strong>" +
  esc(title) +
  "</strong>" +
  esc(message) +
  "</div>";
const chip = (label, color = "") =>
  '<span class="chip ' + color + '">' + esc(label) + "</span>";
const btn = (label, action, id = "", style = "light") =>
  '<button class="btn btn-' +
  style +
  ' btn-sm" type="button" data-action="' +
  action +
  '" data-id="' +
  esc(id) +
  '">' +
  label +
  "</button>";
const link = (label, url, style = "primary") =>
  '<a class="btn btn-' + style + '" href="' + esc(url) + '">' + label + "</a>";
const field = (name, label, value = "", type = "text", extra = "") =>
  '<div class="mb-3"><label class="form-label" for="f-' +
  name +
  '">' +
  label +
  '</label><input class="form-control" id="f-' +
  name +
  '" name="' +
  name +
  '" type="' +
  type +
  '" value="' +
  esc(value) +
  '" ' +
  extra +
  "></div>";
const area = (name, label, value = "", extra = "required") =>
  '<div class="mb-3"><label class="form-label" for="f-' +
  name +
  '">' +
  label +
  '</label><textarea class="form-control" id="f-' +
  name +
  '" name="' +
  name +
  '" rows="3" ' +
  extra +
  ">" +
  esc(value) +
  "</textarea></div>";
const select = (name, label, options, value = "", extra = "") =>
  '<div class="mb-3"><label class="form-label" for="f-' +
  name +
  '">' +
  label +
  '</label><select class="form-select" id="f-' +
  name +
  '" name="' +
  name +
  '" ' +
  extra +
  ">" +
  options
    .map((o) => {
      const [v, t] = Array.isArray(o) ? o : [o, o];
      return (
        '<option value="' +
        esc(v) +
        '" ' +
        (String(v) === String(value) ? "selected" : "") +
        ">" +
        esc(t) +
        "</option>"
      );
    })
    .join("") +
  "</select></div>";
const form = (type, body, label = "Save changes", id = "", extra = "") =>
  '<form data-form="' +
  type +
  '" data-id="' +
  esc(id) +
  '" ' +
  extra +
  '><div class="form-error" role="alert"></div>' +
  body +
  '<button type="submit" class="btn btn-primary">' +
  label +
  "</button></form>";
const table = (headers, body) =>
  '<div class="table-wrap"><table class="table"><thead><tr>' +
  headers.map((h) => '<th scope="col">' + h + "</th>").join("") +
  "</tr></thead><tbody>" +
  body +
  "</tbody></table></div>";
const stat = (title, value, symbol) =>
  '<div class="stat">' +
  icon(symbol) +
  "<strong>" +
  esc(value === null ? "Restricted" : value) +
  "</strong><small>" +
  esc(title) +
  "</small></div>";
const notice = (message, style = "info") =>
  '<div class="notice ' +
  style +
  '">' +
  icon(style === "info" ? "info-circle" : "exclamation-triangle") +
  "<p>" +
  message +
  "</p></div>";
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 5000);
}
async function api(url, { method = "GET", body } = {}) {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "x-csrf-token": state.csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const j = await r.json();
  if (!r.ok) {
    const e = Error(j.error || "Request failed");
    e.status = r.status;
    throw e;
  }
  if (j.csrf) state.csrf = j.csrf;
  return j;
}
async function refresh() {
  Object.assign(state, await api("/api/bootstrap"));
  if (state.settings.public.has_favicon) {
    const favicon = document.querySelector('link[rel="icon"]');
    favicon.href = "/api/branding/favicon";
    favicon.type = "image/png";
  }
}
async function catalogueData() {
  if (!state.courses.length) state.courses = await api("/api/courses");
  state.tax = await api("/api/taxonomy");
}
function openModal(title, content) {
  $("#modal-body").innerHTML =
    '<button class="modal-close" data-action="close" aria-label="Close dialog">×</button><h2 id="modal-title">' +
    esc(title) +
    "</h2>" +
    content;
  modal.showModal();
}
function header() {
  const p = location.pathname,
    u = state.user;
  return (
    '<header class="site-header"><div class="container d-flex justify-content-between align-items-center gap-3"><a class="brand" href="/"><img src="/api/branding/logo" alt=""><span>' +
    esc(state.settings.public.name || "TVET Study Hub") +
    '<small>Papers. Knowledge. Progress.</small></span></a><nav class="top-nav" aria-label="Main navigation">' +
    [
      ["Browse papers", "/resources"],
      ["Courses", "/courses"],
      ["Free resources", "/free"],
    ]
      .map(
        ([t, h]) =>
          '<a class="' +
          (p === h ? "active" : "") +
          '" href="' +
          h +
          '">' +
          t +
          "</a>",
      )
      .join("") +
    '</nav><div class="nav-actions">' +
    (u
      ? '<a class="icon-button" href="/account/notifications" aria-label="Notifications' +
        (state.unread ? ", " + state.unread + " unread" : "") +
        '">' +
        icon("bell") +
        (state.unread
          ? '<span class="unread">' + state.unread + "</span>"
          : "") +
        '</a><a class="icon-button" href="/account/cart" aria-label="Shopping cart">' +
        icon("bag") +
        '</a><a href="' +
        (staff() ? "/admin" : "/account") +
        '" class="avatar" aria-label="My dashboard">' +
        esc(
          u.name
            .split(" ")
            .map((s) => s[0])
            .slice(0, 2)
            .join(""),
        ) +
        "</a>"
      : '<a href="/login" class="btn btn-light">Sign in</a><a href="/register" class="btn btn-primary"><span class="label">Create account</span><span class="mobile-only">Join</span></a>') +
    "</div></div></header>" +
    bottomNav() +
    (state.local
      ? '<div class="demo-note">Local development mode · Sample documents are labelled DEMO · No simulated payment can unlock paid papers</div>'
      : "")
  );
}
function footer() {
  return (
    '<footer class="site-footer"><div class="container"><div class="d-flex justify-content-between gap-4 flex-wrap"><div><a class="brand mb-2" href="/"><img src="/api/branding/logo" alt="">' +
    esc(state.settings.public.name) +
    '</a><p class="mb-0">Study with purpose. Prepare with confidence.</p></div><div class="footer-links"><a href="/about">About</a><a href="/contact">Contact</a><a href="/faq">FAQs</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/refunds">Purchase policy</a><a href="/access-policy">Access policy</a></div></div><div class="footer-bottom"><span>© ' +
    new Date().getFullYear() +
    " " +
    esc(state.settings.public.name) +
    ". Independent study resources portal.</span><span>Developed by " +
    esc(state.settings.public.developer) +
    ' · <a href="/staff/login">Staff sign in</a></span></div></div></footer>'
  );
}
const studentMenu = [
  ["Overview", "/account", "grid"],
  ["My Papers", "/account/papers", "collection"],
  ["AI StudyMate", "/account/ai", "stars"],
  ["Chat centre", "/account/chats", "chat-dots"],
  ["Wishlist", "/account/wishlist", "heart"],
  ["Cart", "/account/cart", "bag"],
  ["Purchase history", "/account/orders", "receipt"],
  ["Notifications", "/account/notifications", "bell"],
  ["Request a paper", "/account/requests", "file-earmark-plus"],
  ["Support", "/account/support", "chat-left-text"],
  ["My profile", "/account/profile", "person"],
];
const adminMenu = [
  ["Overview", "/admin", "grid"],
  ["My subscription", "/admin/subscription", "credit-card"],
  ["Subscriptions", "/admin/subscriptions", "wallet2", "super"],
  ["Resources", "/admin/resources", "files", "resources"],
  ["Upload papers", "/admin/upload", "cloud-arrow-up", "resources"],
  ["Courses & units", "/admin/catalogue", "diagram-3", "catalogue"],
  ["Assessment series", "/admin/series", "calendar3", "catalogue"],
  ["Bundles", "/admin/bundles", "box", "resources"],
  ["Users", "/admin/users", "people", "users"],
  ["Payments", "/admin/payments", "credit-card", "payments"],
  ["Paper requests", "/admin/requests", "file-earmark-plus", "support"],
  ["Support tickets", "/admin/support", "chat-left-text", "support"],
  ["Send notifications", "/admin/notifications", "bell", "notifications"],
  ["Reports", "/admin/reports", "bar-chart", "reports"],
  ["Community", "/admin/community", "chat-square-text", "community"],
  ["Deletions", "/admin/deletions", "trash3", "deletion"],
  ["Administrators", "/admin/staff", "shield-lock", "super"],
  ["Settings", "/admin/settings", "gear", "super"],
  ["Activity log", "/admin/audit", "clock-history", "super"],
];
function dashboard(body, title, subtitle, admin = false, action = "") {
  if (title === "My profile" && state.user.role === "student")
    action = btn("App guide", "tour-replay", "", "outline-primary");
  const menu = (admin ? adminMenu : studentMenu).filter((m) =>
    !m[3] || m[3] === "super"
      ? !m[3] || state.user.role === "super_admin"
      : permitted(m[3]),
  );
  return (
    header() +
    '<div class="dash-shell"><aside class="dash-sidebar' +
    (admin ? " admin-sidebar" : "") +
    '"><div class="nav-label">' +
    (admin ? "MANAGEMENT" : "MY STUDY SPACE") +
    "</div>" +
    menu
      .map(
        ([t, h, i]) =>
          '<a href="' +
          h +
          '" class="' +
          (location.pathname === h ? "active" : "") +
          '">' +
          icon(i) +
          t +
          "</a>",
      )
      .join("") +
    (admin
      ? '<a href="/account/notifications">' +
        icon("bell") +
        "My notifications</a>"
      : "") +
    '<a href="/resources">' +
    icon("arrow-up-right") +
    'Browse papers</a><a href="#" data-action="logout">' +
    icon("box-arrow-left") +
    'Sign out</a></aside><main id="main" class="dash-content"><div class="dash-title"><div><div class="eyebrow mb-2">' +
    (admin ? "Admin workspace" : "My study space") +
    "</div><h1>" +
    esc(title) +
    "</h1><p>" +
    esc(subtitle) +
    "</p></div>" +
    action +
    "</div>" +
    (!admin ? mobileTools() : "") +
    (admin && state.user.role === "admin" && state.subscription?.enabled
      ? subscriptionBanner()
      : "") +
    (state.needsPassword
      ? notice(
          'Complete your account by <a href="/account/profile">setting a password</a> before purchasing. Your account is already created.',
          "",
        )
      : "") +
    body +
    "</main></div>"
  );
}
function publicPage(body) {
  return header() + '<main id="main">' + body + "</main>" + footer();
}
function sectionTitle(title, sub = "", action = "") {
  return (
    '<div class="section-head"><div><h2 class="mb-0">' +
    title +
    "</h2>" +
    (sub ? "<p>" + sub + "</p>" : "") +
    "</div>" +
    action +
    "</div>"
  );
}
function paperCard(r) {
  return (
    '<article class="paper-card"><div class="paper-top"><div>' +
    chip(r.type, "gray") +
    '<small class="mt-2">' +
    esc(r.body) +
    " · " +
    esc(r.level) +
    '</small></div><span class="paper-symbol">' +
    icon("file-earmark-text") +
    '</span></div><div class="paper-body">' +
    chip(r.course) +
    (r.demo ? " " + chip("DEMO", "gold") : "") +
    '<h3><a href="/paper/' +
    r.id +
    '">' +
    esc(r.title) +
    '</a></h3><div class="text-muted small">' +
    esc(r.unit_code) +
    " · " +
    esc(r.unit) +
    '</div><div class="paper-meta"><span>' +
    icon("calendar3") +
    " " +
    r.year +
    "</span><span>" +
    icon("files") +
    " " +
    r.pages +
    ' pages</span><span>PDF</span></div></div><div class="paper-bottom"><a class="price" href="/paper/' +
    r.id +
    '">' +
    (r.price_minor
      ? "<small>KES</small>" +
        new Intl.NumberFormat("en-KE").format(r.price_minor / 100)
      : "Free") +
    "</a>" +
    link(
      r.owned
        ? "My Papers"
        : r.price_minor
          ? "View paper " + icon("arrow-right")
          : "Get resource " + icon("arrow-right"),
      r.owned ? "/account/papers" : "/paper/" + r.id,
      "outline-primary",
    ) +
    "</div></article>"
  );
}
function courseCard(c) {
  return (
    '<a class="course-card" href="/course/' +
    c.id +
    '"><span class="course-icon">' +
    icon(c.icon || "book") +
    "</span><strong>" +
    esc(c.name) +
    "</strong><small>" +
    c.paper_count +
    " resources " +
    icon("arrow-up-right") +
    "</small></a>"
  );
}
const courseOptions = () => [
  ["", "Choose course"],
  ...state.courses.map((c) => [c.id, c.name]),
];
const taxOptions = (kind) =>
  state.tax.taxonomy
    .filter((t) => t.kind === kind)
    .map((t) => [t.name, t.name]);
async function home() {
  await catalogueData();
  const papers = await api("/api/catalogue");
  return publicPage(
    '<section class="hero"><div class="container"><div class="row align-items-center"><div class="col-lg-7"><span class="hero-badge">' +
      icon("mortarboard") +
      ' YOUR TVET STUDY COMPANION</span><h1>Better preparation.<br><em>Bigger possibilities.</em></h1><p>Find the papers, notes and revision resources you need. Explore your course, prepare for your assessment, and keep your purchases in one place.</p><form class="hero-search" action="/resources">' +
      icon("search") +
      '<input name="q" aria-label="Search papers or units" placeholder="Search a unit, course or paper…"><button class="btn btn-primary">Find papers ' +
      icon("arrow-right") +
      '</button></form><div class="trust-list"><span>' +
      icon("check-circle") +
      " Browse before you buy</span><span>" +
      icon("shield-check") +
      " Pesapal checkout</span><span>" +
      icon("collection") +
      ' Your personal library</span></div><div class="pill-row">' +
      state.courses
        .slice(0, 4)
        .map((c) => '<a href="/course/' + c.id + '">' + esc(c.name) + "</a>")
        .join("") +
      '</div></div><div class="col-lg-5"><div class="study-art" aria-hidden="true"><div class="art-label">MAKE EVERY STUDY SESSION COUNT</div><div class="art-heading">A little more prepared.<br>Every single day.</div><div class="mini-paper"><div class="paper-stamp">TVET · REVISION RESOURCE</div><div class="bar"></div><div class="bar"></div><div class="bar"></div><p class="small mt-3 mb-0">Knowledge builds<br><strong>your next chapter.</strong></p></div><div class="art-card">' +
      icon("check-circle-fill") +
      ' YOUR STUDY SPACE<strong>Discover. Prepare. Progress.</strong></div></div></div></div></div></section><section class="section"><div class="container">' +
      sectionTitle(
        "Find your course",
        "A focused starting point for your next assessment.",
        '<a href="/courses" class="small fw-semibold">All courses ' +
          icon("arrow-right") +
          "</a>",
      ) +
      '<div class="course-grid">' +
      state.courses.slice(0, 6).map(courseCard).join("") +
      '</div></div></section><section class="section pt-2"><div class="container">' +
      sectionTitle(
        "Fresh resources, ready for you",
        "Explore the latest additions to the catalogue.",
        '<a href="/resources" class="small fw-semibold">Browse all papers ' +
          icon("arrow-right") +
          "</a>",
      ) +
      '<div class="paper-grid">' +
      (papers.items.slice(0, 6).map(paperCard).join("") ||
        empty(
          "The catalogue is getting ready",
          "Published papers will appear here.",
        )) +
      '</div></div></section><section class="section bg-white border-top border-bottom"><div class="container">' +
      sectionTitle(
        "From finding a paper to feeling prepared",
        "Simple steps. Your resources in one place.",
      ) +
      '<div class="step-grid">' +
      [
        [
          "01",
          "Find your resource",
          "Search by course or unit. Check the details and preview a sample before buying.",
        ],
        [
          "02",
          "Complete your purchase",
          "Create an account in a few steps, then complete payment through Pesapal.",
        ],
        [
          "03",
          "Build your study library",
          "After payment confirmation, open My Papers to view or download your purchases.",
        ],
      ]
        .map(
          ([n, t, p]) =>
            '<div class="step"><div class="step-number">' +
            n +
            "</div><h3>" +
            t +
            "</h3><p>" +
            p +
            "</p></div>",
        )
        .join("") +
      '</div></div></section><section class="section"><div class="container"><div class="cta"><div><span class="eyebrow text-white-50">CAN’T FIND A PARTICULAR UNIT?</span><h2 class="mt-2">Let us know what you need.</h2><p>Request a paper and receive an update when the resource is available.</p></div>' +
      link(
        "Request a paper " + icon("arrow-right"),
        "/account/requests",
        "light",
      ) +
      "</div></div></section>",
  );
}
async function catalogue() {
  await catalogueData();
  const q = new URLSearchParams(location.search);
  if (location.pathname === "/free") q.set("free", "true");
  if (location.pathname.startsWith("/course/"))
    q.set("course", location.pathname.split("/")[2]);
  const data = await api("/api/catalogue?" + q);
  const title =
    location.pathname === "/free"
      ? "Free study resources"
      : q.get("course")
        ? state.courses.find((c) => c.id === q.get("course"))?.name ||
          "Course resources"
        : "Find your next study resource";
  const filters =
    '<form action="/resources" class="filter-stack">' +
    field("q", "Search papers or units", q.get("q") || "", "search") +
    select(
      "course",
      "Course",
      [["", "All courses"], ...state.courses.map((c) => [c.id, c.name])],
      q.get("course"),
    ) +
    select(
      "level",
      "Level",
      [["", "All levels"], ...taxOptions("level")],
      q.get("level"),
    ) +
    select(
      "type",
      "Resource type",
      [["", "All types"], ...taxOptions("type")],
      q.get("type"),
    ) +
    select(
      "body",
      "Examining body",
      [["", "All bodies"], ...taxOptions("body")],
      q.get("body"),
    ) +
    select(
      "series",
      "Assessment series",
      [
        ["", "All series"],
        ...state.tax.series
          .filter((s) => s.status === "open")
          .map((s) => [s.id, s.name + " " + s.year]),
      ],
      q.get("series"),
    ) +
    field(
      "year",
      "Year",
      q.get("year") || "",
      "number",
      'min="2000" max="2100"',
    ) +
    field(
      "max_price",
      "Maximum price (KES)",
      q.get("max_price") || "",
      "number",
      'min="0"',
    ) +
    '<label class="small"><input type="checkbox" name="free" value="true" ' +
    (q.get("free") === "true" ? "checked" : "") +
    '> Free resources only</label><button class="btn btn-primary">Apply filters</button><a href="/resources" class="text-center small">Clear filters</a></form>';
  let pages = "";
  for (
    let p = Math.max(1, data.page - 2);
    p <= Math.min(data.pages, data.page + 2);
    p++
  ) {
    const next = new URLSearchParams(q);
    next.set("page", p);
    pages +=
      '<a class="' +
      (data.page === p ? "current" : "") +
      '" href="/resources?' +
      esc(next) +
      '">' +
      p +
      "</a>";
  }
  return publicPage(
    '<div class="container"><div class="page-head"><div class="breadcrumb-line"><a href="/">Home</a> / Resources</div><h1>' +
      esc(title) +
      '</h1><p class="text-muted mb-0">Search by unit. Discover what you need. Prepare at your pace.</p></div><div class="catalogue-layout pb-5"><aside class="filters"><h3 class="mb-3">Refine your search</h3>' +
      filters +
      '</aside><section><div class="result-toolbar"><span class="small text-muted">' +
      data.total +
      ' resources found</span><label class="d-flex align-items-center gap-2 small">Sort <select class="form-select" id="sort"><option value="newest">Newest first</option><option value="price" ' +
      (q.get("sort") === "price" ? "selected" : "") +
      '>Price: low to high</option><option value="title" ' +
      (q.get("sort") === "title" ? "selected" : "") +
      '>Title A–Z</option></select></label></div><div class="paper-grid">' +
      (data.items.map(paperCard).join("") ||
        empty(
          "No matching papers",
          "Try another unit code or clear some filters.",
        )) +
      '</div><nav class="pagination" aria-label="Results pages">' +
      pages +
      '</nav><div class="mt-4 small"><a href="/bundles">Explore resource bundles ' +
      icon("arrow-right") +
      "</a></div></section></div></div>",
  );
}
async function detail() {
  const r = await api("/api/resources/" + location.pathname.split("/")[2]);
  return publicPage(
    '<div class="container py-4"><div class="breadcrumb-line"><a href="/resources">Browse papers</a> / ' +
      esc(r.course) +
      " / " +
      esc(r.unit_code) +
      '</div><div class="detail-layout pb-4"><section class="panel">' +
      chip(r.type) +
      " " +
      (r.demo ? chip("DEMO RESOURCE", "gold") : "") +
      '<h1 class="mt-3">' +
      esc(r.title) +
      '</h1><p class="text-muted wrap-text">' +
      esc(r.description) +
      '</p><div class="detail-info">' +
      [
        ["Course", r.course],
        ["Unit", r.unit + " (" + r.unit_code + ")"],
        ["Level", r.level],
        ["Examining body", r.body],
        ["Assessment series", r.series + " " + r.year],
        [
          "Document",
          r.pages + " pages · " + (r.file_size / 1024).toFixed(0) + " KB · PDF",
        ],
      ]
        .map(
          ([k, v]) =>
            "<div><small>" +
            k +
            "</small><strong>" +
            esc(v) +
            "</strong></div>",
        )
        .join("") +
      '</div><div class="preview-placeholder">' +
      icon("file-earmark-pdf") +
      '<h3 class="mt-3">Take a look before you buy</h3><p class="small text-muted">The preview shows part of the first page. The full document stays protected.</p>' +
      (r.has_preview
        ? link(
            "Open limited preview",
            "/viewer?id=" + r.id + "&preview=1",
            "outline-primary",
          )
        : "<p>Preview unavailable.</p>") +
      '</div></section><aside class="panel buy-panel"><div class="eyebrow">Your study resource</div><div class="buy-price my-3">' +
      (r.price_minor
        ? "<small>KES</small>" + (r.price_minor / 100).toLocaleString("en-KE")
        : "Free") +
      "</div>" +
      (r.owned
        ? link("Open My Papers", "/account/papers")
        : r.price_minor
          ? '<div class="d-grid gap-2">' +
            btn(
              "Buy with Pesapal " + icon("arrow-right"),
              "buy",
              r.id,
              "primary",
            ) +
            btn("Add to cart", "cart", r.id, "outline-primary") +
            "</div>"
          : link("Download free PDF", "/api/files/" + r.id + "?download=1")) +
      '<div class="mt-3 d-grid">' +
      btn(icon("heart") + " Save to wishlist", "wishlist", r.id) +
      '</div><hr><p class="small text-muted">' +
      icon("shield-check") +
      ' Payment is completed through Pesapal. Papers appear in your account after payment confirmation.</p><p class="small text-muted">' +
      esc(state.settings.policy.purchase_terms) +
      '</p><a class="small" href="/access-policy">Read the access policy</a><div class="mt-3">' +
      link("Need help?", "/account/support", "light") +
      "</div></aside></div></div>",
  );
}
async function authPage() {
  const staffLogin = location.pathname === "/staff/login",
    register = location.pathname === "/register",
    reset = location.pathname === "/reset";
  const title = reset
    ? "Set a new password"
    : register
      ? "Start your study journey"
      : staffLogin
        ? "Staff sign in"
        : "Welcome back";
  let body;
  if (reset)
    body = form(
      "reset",
      field(
        "password",
        "New password",
        "",
        "password",
        'required minlength="12" maxlength="128" autocomplete="new-password"',
      ) + '<p class="form-hint mb-3">Use at least 12 characters.</p>',
      "Reset password",
    );
  else
    body = form(
      register ? "register" : staffLogin ? "staff-login" : "login",
      (register
        ? field(
            "name",
            "Full name",
            "",
            "text",
            'required minlength="2" maxlength="100" autocomplete="name"',
          )
        : "") +
        field(
          "email",
          "Email address",
          "",
          "email",
          'required autocomplete="email"',
        ) +
        (register
          ? field(
              "phone",
              "Phone number",
              "",
              "tel",
              'required placeholder="+254712345678" autocomplete="tel"',
            )
          : field(
              "password",
              "Password",
              "",
              "password",
              'required autocomplete="current-password"',
            )) +
        (register
          ? '<p class="form-hint mb-3">No verification or approval required. You’ll set a password after your account is created.</p>'
          : ""),
      register ? "Create my account" : "Sign in",
    );
  return publicPage(
    '<div class="container"><div class="auth-layout"><div class="auth-aside">' +
      icon(staffLogin ? "shield-lock" : "mortarboard") +
      '<div class="eyebrow text-white-50 mb-3">' +
      (staffLogin ? "ADMINISTRATION" : "YOUR NEXT CHAPTER") +
      '</div><h2>A focused place<br>to prepare.</h2><p class="mt-3">Find your resources, build your library, and make every study session count.</p></div><div class="auth-form"><h1>' +
      title +
      '</h1><p class="text-muted small">' +
      (staffLogin
        ? "Use the staff account issued by your super admin."
        : register
          ? "One account. Your own study library."
          : "Sign in to access your purchased papers.") +
      "</p>" +
      body +
      (!register && !reset
        ? '<div class="mt-3">' + btn("Forgot password?", "recover") + "</div>"
        : "") +
      (!staffLogin && !reset
        ? '<p class="mt-4 small">' +
          (register
            ? 'Already have an account? <a href="/login">Sign in</a>'
            : 'New here? <a href="/register">Create an account</a>') +
          "</p>"
        : "") +
      "</div></div></div>",
  );
}
async function generalPage() {
  const p = location.pathname;
  await catalogueData();
  if (p === "/courses")
    return publicPage(
      '<section class="section"><div class="container">' +
        sectionTitle(
          "Every course. A place to begin.",
          "Explore the catalogue by your field of study.",
        )
          .replace("<h2", "<h1")
          .replace("</h2>", "</h1>") +
        '<div class="course-grid">' +
        state.courses.map(courseCard).join("") +
        "</div></div></section>",
    );
  if (p === "/bundles") {
    const list = await api("/api/bundles");
    return publicPage(
      '<section class="section"><div class="container">' +
        sectionTitle(
          "Prepare with a resource bundle",
          "Related papers, together in one purchase.",
        )
          .replace("<h2", "<h1")
          .replace("</h2>", "</h1>") +
        '<div class="paper-grid">' +
        (list
          .map(
            (b) =>
              '<article class="panel"><h3>' +
              esc(b.title) +
              '</h3><p class="text-muted small">' +
              esc(b.description) +
              '</p><ul class="small">' +
              b.items
                .map(
                  (r) =>
                    '<li><a href="/paper/' +
                    r.id +
                    '">' +
                    esc(r.title) +
                    "</a></li>",
                )
                .join("") +
              '</ul><div class="price mb-3">' +
              money(b.price_minor) +
              "</div>" +
              btn("Add bundle to cart", "bundle-cart", b.id, "primary") +
              "</article>",
          )
          .join("") ||
          empty(
            "No bundles yet",
            "Browse individual papers while bundles are being prepared.",
          )) +
        "</div></div></section>",
    );
  }
  const faq = [
    [
      "Can I browse without an account?",
      "Yes. Browse courses, search units, check prices and open limited previews before registering.",
    ],
    [
      "How do I pay?",
      "Choose a paper or add resources to your cart. Sign in, review the terms and continue to Pesapal. Your papers unlock after the backend verifies payment.",
    ],
    [
      "Where are my purchased papers?",
      "Sign in and open My Papers. If payment is pending, open Purchase History and check the payment status.",
    ],
    [
      "What happens when a series closes?",
      "Closing a series removes it from the public catalogue. Existing buyers retain access unless permanent deletion is separately scheduled and announced.",
    ],
    [
      "Will I be notified before deletion?",
      "Yes. Affected buyers receive an in-app notice with the deletion date. Download your copies before that date.",
    ],
    [
      "Are these official examining-body services?",
      "This is an independent study resources platform. Each listing identifies its resource type and examining body where applicable.",
    ],
    [
      "What if a paper is missing or incorrect?",
      "Use Request a Paper for missing resources. Use Support to report an incorrect file, payment issue or download problem.",
    ],
  ];
  let title, content;
  if (p === "/faq") {
    title = "A little clarity before you begin";
    content = faq
      .map(
        ([q, a]) =>
          '<details class="faq-item"><summary>' +
          q +
          "</summary><p>" +
          a +
          "</p></details>",
      )
      .join("");
  } else if (p === "/contact") {
    title = "We’re here to help";
    const pub = state.settings.public;
    content =
      "<p>For payment, download or account problems, create a support ticket so your request stays connected to your account.</p>" +
      link("Open Support", "/account/support") +
      '<div class="mt-4">' +
      (pub.support_email
        ? '<p>Email: <a href="mailto:' +
          esc(pub.support_email) +
          '">' +
          esc(pub.support_email) +
          "</a></p>"
        : "<p>Direct email contact is being configured. Account support tickets are available.</p>") +
      (pub.support_phone
        ? "<p>Phone: " + esc(pub.support_phone) + "</p>"
        : "") +
      "</div>";
  } else if (p === "/about") {
    title = "A more focused way to prepare";
    content =
      "<p>" +
      esc(state.settings.public.name) +
      " helps TVET students find study documents across courses and levels. Browse by unit, preview available resources, and keep confirmed purchases in your own library.</p><h2>Built around your studies</h2><p>The catalogue can include past papers, revision papers, marking schemes, notes and free learning materials. Check each listing for its course, unit, year and document type.</p><p>This is an independent platform. Publication here does not imply approval or affiliation by any institution or examining body.</p>" +
      link("Explore the catalogue", "/resources");
  } else {
    const names = {
      "/privacy": "Privacy policy",
      "/terms": "Terms of use",
      "/refunds": "Purchase and refund policy",
      "/access-policy": "Resource access and deletion policy",
    };
    title = names[p] || "Page";
    content =
      '<p class="wrap-text">' +
      esc(
        p === "/privacy"
          ? state.settings.policy.privacy_terms
          : p === "/refunds"
            ? state.settings.policy.refund_terms
            : state.settings.policy.purchase_terms,
      ) +
      "</p>" +
      (p === "/access-policy"
        ? "<h2>Closure and permanent deletion</h2><p>Closing a series ends public sales while preserving purchased access. Permanent deletion requires advance notice to affected buyers, a deletion date, and administrator confirmation after the notice period. The current minimum notice is " +
          state.settings.policy.notice_days +
          " days.</p><p>After permanent deletion, online access ends. Keep downloaded copies for personal study. Transaction and receipt history remains available.</p>"
        : p === "/terms"
          ? "<h2>Personal study use</h2><p>Use resources for your own learning. Review previews, document details, price and access terms before purchase. Do not upload or distribute materials without the necessary rights.</p>"
          : "") +
      '<p>For questions, <a href="/contact">contact the administrator</a>.</p>';
  }
  if (p === "/privacy")
    content +=
      "<h2>AI and community conversations</h2><p>Private AI conversations are stored in your account. When you send a question, its recent conversation context is sent to your selected Gemini or Groq service; automatic mode may use either configured service. No purchased PDF is attached automatically. You can delete your own AI conversations. Provider-side retention is governed by the provider and the platform operator’s configured account settings.</p><p>Discussion-centre posts are visible to signed-in members and may be reviewed by moderators. Avoid posting private contact, account or payment details. Ask the administrator about the applicable retention policy before sharing sensitive information.</p>";
  return publicPage(
    '<section class="section"><div class="container legal"><div class="breadcrumb-line"><a href="/">Home</a> / Information</div><h1 class="mb-4">' +
      esc(title) +
      '</h1><div class="panel">' +
      content +
      "</div></div></section>",
  );
}
async function accountPage() {
  if (location.pathname === "/account/ai") return aiPage();
  if (location.pathname === "/account/chats") return communityPage();
  const path = location.pathname;
  await catalogueData();
  if (path === "/account") {
    const s = await api("/api/account/summary");
    const papers = await api("/api/account/papers");
    return dashboard(
      '<div class="stats">' +
        stat("Papers in your library", s.papers, "collection") +
        stat("Total purchases", money(s.spent), "receipt") +
        stat("Unread notifications", s.unread, "bell") +
        stat("Paper requests", s.requests, "file-earmark-plus") +
        '</div><div class="panel">' +
        sectionTitle(
          "Your study library",
          "Your latest purchased resources.",
          link("View all papers", "/account/papers", "light"),
        ) +
        '<div class="paper-grid">' +
        (papers.items.slice(0, 3).map(ownedCard).join("") ||
          empty(
            "Your library starts with your first paper",
            "Find a resource for your course and make it yours.",
          )) +
        '</div></div><div class="cta"><div><h2>What are you working on next?</h2><p>Explore papers and notes for your next study session.</p></div>' +
        link("Browse resources", "/resources", "light") +
        "</div>",
      "Welcome, " + state.user.name.split(" ")[0] + " 👋",
      "Your papers, progress and updates in one place.",
    );
  }
  if (path === "/account/papers") {
    const data = await api("/api/account/papers" + location.search);
    return dashboard(
      data.notices
        .map((n) =>
          notice(
            "<strong>" +
              esc(n.series) +
              " — scheduled removal</strong><br>Download your papers before " +
              date(n.execute_after) +
              " (Africa/Nairobi). " +
              esc(n.reason),
            "",
          ),
        )
        .join("") +
        '<form class="mb-4 d-flex gap-2" action="/account/papers"><input class="form-control" name="q" aria-label="Search your papers" placeholder="Search your library…" value="' +
        esc(new URLSearchParams(location.search).get("q") || "") +
        '"><button class="btn btn-primary">Search</button></form><div class="paper-grid">' +
        (data.items.map(ownedCard).join("") ||
          empty("No papers found", "Confirmed purchases appear here.")) +
        "</div>",
      "My Papers",
      "Your purchased documents, ready when you are.",
    );
  }
  if (path === "/account/wishlist") {
    const items = await api("/api/account/wishlist");
    return dashboard(
      '<div class="paper-grid">' +
        (items
          .map(
            (r) =>
              "<div>" +
              paperCard(r) +
              '<div class="mt-2">' +
              btn("Remove from wishlist", "unwishlist", r.id) +
              "</div></div>",
          )
          .join("") ||
          empty(
            "Save something for later",
            "Use the wishlist button on a paper to save it here.",
          )) +
        "</div>",
      "Wishlist",
      "Resources you’re keeping an eye on.",
    );
  }
  if (path === "/account/cart") {
    const items = await api("/api/account/cart");
    const total = items.reduce((s, i) => s + i.price_minor, 0);
    return dashboard(
      items.length
        ? '<div class="profile-columns"><div class="panel">' +
            table(
              ["Resource", "Price", ""],
              items
                .map(
                  (i) =>
                    "<tr><td><strong>" +
                    esc(i.title) +
                    '</strong><div class="small text-muted">' +
                    (i.kind === "bundle" ? "Bundle" : "Individual paper") +
                    "</div></td><td>" +
                    money(i.price_minor) +
                    "</td><td>" +
                    btn("Remove", "uncart", i.item_id) +
                    "</td></tr>",
                )
                .join(""),
            ) +
            '</div><div class="panel"><h3>Order summary</h3><div class="d-flex justify-content-between my-4"><span>Total</span><strong>' +
            money(total) +
            '</strong></div><p class="small text-muted wrap-text">' +
            esc(state.settings.policy.purchase_terms) +
            "</p>" +
            form(
              "checkout",
              '<label class="small d-flex align-items-start gap-2 mb-3"><input type="checkbox" name="accept_terms" required><span>I accept the <a href="/terms">terms</a>, <a href="/refunds">purchase policy</a> and <a href="/access-policy">access/deletion policy</a>.</span></label>',
              total ? "Continue to Pesapal" : "Get free resources",
            ) +
            '<p class="form-hint mt-3">' +
            icon("shield-check") +
            " The final price is checked before payment.</p></div></div>"
        : empty(
            "Your cart is empty",
            "Add a paper or bundle from the catalogue.",
          ),
      "Your cart",
      "Review your resources before checkout.",
    );
  }
  if (path === "/account/orders") {
    const orders = await api("/api/account/orders");
    state.data.orders = orders;
    const rows = orders
      .map(
        (o) =>
          "<tr><td><strong>" +
          esc(o.items.map((i) => i.title).join(", ")) +
          '</strong><div class="text-muted small">Order ' +
          o.id.slice(0, 8) +
          " · " +
          date(o.created_at) +
          "</div></td><td>" +
          money(o.amount_minor) +
          "</td><td>" +
          chip(
            o.status,
            o.status === "completed"
              ? ""
              : o.status === "needs_review"
                ? "red"
                : "gray",
          ) +
          '</td><td><div class="actions">' +
          (o.receipt_id ? btn("Receipt", "receipt", o.receipt_id) : "") +
          (["initiated", "pending", "failed"].includes(o.status)
            ? btn(
                o.status === "pending" ? "Resume checkout" : "Pay",
                "pay-order",
                o.id,
                "primary",
              ) + btn("Check status", "check-order", o.id)
            : "") +
          (o.status === "initiated"
            ? btn("Cancel", "cancel-order", o.id)
            : "") +
          (o.status === "needs_review"
            ? link("Contact Support", "/account/support", "light")
            : "") +
          "</div></td></tr>",
      )
      .join("");
    return dashboard(
      notice(
        "If you paid and access is pending, select <strong>Check status</strong>. An order is confirmed only after the payment provider verifies it.",
      ) +
        '<div class="panel">' +
        (orders.length
          ? table(["Resource / order", "Amount", "Status", "Actions"], rows)
          : empty(
              "No purchases yet",
              "Orders and receipts appear here after checkout.",
            )) +
        "</div>",
      "Purchase history",
      "Track payments, resume checkout and view receipts.",
    );
  }
  if (path === "/account/notifications") {
    const list = await api("/api/account/notifications" + location.search);
    return (
      dashboard(
        list
          .map(
            (n) =>
              '<article class="notification ' +
              (!n.read_at ? "unseen" : "") +
              '"><div class="d-flex justify-content-between gap-3"><h3>' +
              esc(n.title) +
              " " +
              (n.priority === "urgent" ? chip("URGENT", "red") : "") +
              "</h3><small>" +
              date(n.created_at) +
              "</small></div><p>" +
              esc(n.message) +
              '</p><div class="d-flex gap-2">' +
              (n.read_at ? "" : btn("Mark as read", "read", n.id)) +
              link("Open related page", n.link, "light") +
              "</div></article>",
          )
          .join("") ||
          empty(
            "You’re all caught up",
            "Announcements and purchase updates will appear here.",
          ),
        "Notifications",
        "Important updates for your account.",
        false,
        btn("Mark all as read", "read-all"),
      ) +
      '<div class="container py-3 text-end"><a href="/account/notifications?page=' +
      ((Number(new URLSearchParams(location.search).get("page")) || 1) + 1) +
      '">Older notifications →</a></div>'
    );
  }
  if (path === "/account/profile") {
    const sessions = await api("/api/account/sessions"),
      u = state.user;
    return dashboard(
      '<div class="profile-head"><span class="avatar">' +
        esc(
          u.name
            .split(" ")
            .map((s) => s[0])
            .slice(0, 2)
            .join(""),
        ) +
        "</span><div><h2>" +
        esc(u.name) +
        ' <span class="badge-role">' +
        esc(u.role.replace("_", " ")) +
        "</span></h2><p>Member since " +
        new Date(u.created_at).toLocaleDateString("en-KE", {
          year: "numeric",
          month: "long",
        }) +
        '</p></div></div><div class="profile-columns"><div><div class="panel"><h3 class="mb-4">Personal information</h3>' +
        form(
          "profile",
          field("name", "Full name", u.name, "text", "required") +
            field("email", "Email address", u.email, "email", "required") +
            field("phone", "Phone number", u.phone, "tel", "required") +
            field("institution", "Institution (optional)", u.institution) +
            select(
              "course_id",
              "Course (optional)",
              courseOptions(),
              u.course_id,
            ) +
            select(
              "level",
              "Level (optional)",
              [["", "Choose level"], ...taxOptions("level")],
              u.level,
            ) +
            field(
              "current_password",
              "Current password (required to change email or phone)",
              "",
              "password",
              'autocomplete="current-password"',
            ),
        ) +
        '</div><div class="panel"><h3>Profile photo</h3><p class="form-hint mb-3">PNG or JPEG, up to 2 MB. Your photo is private to your account.</p>' +
        form(
          "avatar",
          field(
            "file",
            "Choose photo",
            "",
            "file",
            'accept="image/png,image/jpeg" required',
          ),
          "Upload photo",
        ) +
        '</div></div><div><div class="panel"><h3>' +
        (state.needsPassword ? "Set your password" : "Change password") +
        '</h3><p class="form-hint mb-3">Use 12–128 characters. Password changes sign out your other sessions.</p>' +
        form(
          "password",
          (!state.needsPassword
            ? field(
                "current_password",
                "Current password",
                "",
                "password",
                'required autocomplete="current-password"',
              )
            : "") +
            field(
              "password",
              "New password",
              "",
              "password",
              'required minlength="12" maxlength="128" autocomplete="new-password"',
            ),
          "Save password",
        ) +
        '</div><div class="panel"><h3 class="mb-3">Active sessions</h3>' +
        sessions
          .map(
            (s) =>
              '<div class="border-bottom py-3"><strong class="small">' +
              (s.current
                ? "This session"
                : esc(s.user_agent.slice(0, 80) || "Browser session")) +
              '</strong><p class="small text-muted mb-2">Started ' +
              date(s.created_at) +
              "</p>" +
              btn("Sign out session", "revoke-session", s.id) +
              "</div>",
          )
          .join("") +
        "</div></div></div>",
      "My profile",
      "Manage your details and keep your account secure.",
    );
  }
  if (path === "/account/requests") {
    const list = await api("/api/account/requests");
    return dashboard(
      '<div class="profile-columns"><div class="panel"><h3 class="mb-4">Request a missing resource</h3>' +
        form(
          "request",
          select("course_id", "Course", courseOptions()) +
            field(
              "unit",
              "Unit name or code",
              "",
              "text",
              'required maxlength="200"',
            ) +
            area(
              "details",
              "Which paper do you need?",
              "",
              'required minlength="5" maxlength="2000"',
            ),
          "Send request",
        ) +
        '</div><div class="panel"><h3 class="mb-4">Your requests</h3>' +
        (list
          .map(
            (r) =>
              '<div class="border-bottom mb-3 pb-3"><strong>' +
              esc(r.unit) +
              "</strong> " +
              chip(r.status, "gray") +
              '<p class="small text-muted mb-1">' +
              esc(r.details) +
              "</p><small>" +
              date(r.created_at) +
              "</small>" +
              (r.resource_id
                ? '<div class="mt-2">' +
                  link(
                    "View available paper",
                    "/paper/" + r.resource_id,
                    "light",
                  ) +
                  "</div>"
                : "") +
              "</div>",
          )
          .join("") ||
          empty(
            "No requests yet",
            "Tell us which resource you’re looking for.",
          )) +
        "</div></div>",
      "Request a paper",
      "Help us understand what your next study session needs.",
    );
  }
  if (path === "/account/support") {
    const tickets = await api("/api/account/tickets");
    return dashboard(
      '<div class="panel"><h3 class="mb-4">How can we help?</h3>' +
        form(
          "ticket",
          field(
            "subject",
            "Subject",
            "",
            "text",
            'required minlength="3" maxlength="200"',
          ) +
            area(
              "message",
              "Describe the issue",
              "",
              'required minlength="5" maxlength="4000"',
            ),
          "Create support ticket",
        ) +
        "</div>" +
        tickets
          .map(
            (t) =>
              '<div class="panel"><h3>' +
              esc(t.subject) +
              " " +
              chip(t.status, "gray") +
              '</h3><p class="small text-muted">Ticket ' +
              t.id.slice(0, 8) +
              " · " +
              date(t.created_at) +
              "</p>" +
              t.messages
                .map(
                  (m) =>
                    '<div class="message ' +
                    (m.role !== "student" ? "staff" : "") +
                    '"><small>' +
                    esc(m.name) +
                    " · " +
                    date(m.created_at) +
                    "</small>" +
                    esc(m.message) +
                    "</div>",
                )
                .join("") +
              form(
                "ticket-reply",
                area("message", "Your reply", "", 'required maxlength="4000"'),
                "Send reply",
                t.id,
              ) +
              "</div>",
          )
          .join(""),
      "Support",
      "Get help with payments, papers and your account.",
    );
  }
  return dashboard(
    empty("Page not found", "Choose an item from your dashboard navigation."),
    "My account",
    "Your study space.",
  );
}
function ownedCard(r) {
  const available = r.status !== "deleted" && r.access_state === "active";
  return (
    '<article class="paper-card"><div class="paper-top">' +
    chip(r.type, "gray") +
    '<span class="paper-symbol">' +
    icon("file-earmark-pdf") +
    '</span></div><div class="paper-body">' +
    chip(r.course) +
    "<h3>" +
    esc(r.title) +
    '</h3><p class="small text-muted mb-0">' +
    esc(r.unit) +
    " · " +
    esc(r.series) +
    " " +
    r.year +
    '</p><div class="paper-meta">Purchased ' +
    date(r.purchased_at) +
    '</div></div><div class="paper-bottom">' +
    (available
      ? link("View paper", "/viewer?id=" + r.id, "primary") +
        link("Download", "/api/files/" + r.id + "?download=1", "light")
      : chip(
          r.status === "deleted" ? "Permanently removed" : "Access revoked",
          "red",
        )) +
    "</div></article>"
  );
}
async function adminPage() {
  if (location.pathname === "/admin/subscription")
    return adminSubscriptionPage();
  if (location.pathname === "/admin/subscriptions")
    return ownerSubscriptionsPage();
  if (location.pathname === "/admin/community") return moderationPage();
  const path = location.pathname;
  await catalogueData();
  if (path === "/admin") {
    const s = await api("/api/admin/summary");
    return dashboard(
      '<div class="stats">' +
        stat("Published resources", s.papers, "files") +
        stat("Student accounts", s.users, "people") +
        stat(
          "Confirmed revenue",
          s.revenue === null ? null : money(s.revenue),
          "credit-card",
        ) +
        stat("Unresolved payments", s.pending, "clock") +
        '</div><div class="panel">' +
        sectionTitle(
          "Keep the study hub moving",
          "Manage resources and help students find their next paper.",
        ) +
        '<div class="row g-3">' +
        [
          [
            "Upload new papers",
            "Create clear listings with prices and limited previews.",
            "/admin/upload",
            "resources",
            "cloud-arrow-up",
          ],
          [
            "Support students",
            "Review requests and resolve file or account problems.",
            "/admin/support",
            "support",
            "chat-left-text",
          ],
          [
            "Review payments",
            "Reconcile unresolved transactions with Pesapal.",
            "/admin/payments",
            "payments",
            "credit-card",
          ],
        ]
          .filter((x) => permitted(x[3]))
          .map(
            ([t, p, h, _, i]) =>
              '<div class="col-md-4"><a class="course-card h-100" href="' +
              h +
              '"><span class="course-icon">' +
              icon(i) +
              "</span><h3>" +
              t +
              '</h3><p class="small text-muted mb-0">' +
              p +
              "</p></a></div>",
          )
          .join("") +
        "</div></div>" +
        notice(
          "Publish only documents you are authorized to distribute. Confirm prices, course/unit details and previews before publishing.",
        ),
      "Overview",
      "A clear view of your portal’s activity.",
      true,
    );
  }
  if (path === "/admin/upload") {
    const fields =
      field(
        "title",
        "Paper title / bulk title prefix",
        "",
        "text",
        'required minlength="3" maxlength="200"',
      ) +
      area("description", "Description", "", 'maxlength="4000"') +
      '<div class="row"><div class="col-md-6">' +
      select(
        "course_id",
        "Course",
        courseOptions(),
        "",
        "required data-unit-course",
      ) +
      '</div><div class="col-md-6">' +
      select(
        "unit_id",
        "Unit",
        [["", "Choose a course first"]],
        "",
        "required data-unit-target",
      ) +
      '</div><div class="col-md-6">' +
      select(
        "series_id",
        "Assessment series",
        [
          ["", "Select series"],
          ...state.tax.series
            .filter((s) => s.status === "open")
            .map((s) => [s.id, s.name + " " + s.year]),
        ],
        "",
        "required",
      ) +
      '</div><div class="col-md-6">' +
      field(
        "year",
        "Paper year",
        new Date().getFullYear(),
        "number",
        'required min="2000" max="2100"',
      ) +
      '</div><div class="col-md-4">' +
      select("level", "Level", taxOptions("level")) +
      '</div><div class="col-md-4">' +
      select("body", "Examining body", taxOptions("body")) +
      '</div><div class="col-md-4">' +
      select("type", "Resource type", taxOptions("type")) +
      '</div><div class="col-md-6">' +
      field(
        "price",
        "Price per paper (KES)",
        "50",
        "number",
        'required min="0" max="1000000" step="0.01"',
      ) +
      '</div><div class="col-md-6">' +
      select("status", "Publication status", [
        ["draft", "Save as draft"],
        ["published", "Publish now"],
      ]) +
      "</div></div>" +
      field(
        "files",
        "PDF documents",
        "",
        "file",
        'accept="application/pdf,.pdf" multiple required',
      ) +
      '<p class="form-hint mb-3">Up to 20 PDFs per batch. A limited preview is generated automatically. All files receive these categories and the per-paper price. For multiple PDFs, filenames are appended to the title prefix.</p><progress id="upload-progress" max="100" value="0" hidden aria-label="Upload progress"></progress><div id="upload-results" role="status"></div>';
    return dashboard(
      '<div class="panel">' +
        form("upload", fields, "Upload documents") +
        "</div>",
      "Upload papers",
      "Create accurate listings students can find and trust.",
      true,
    );
  }
  if (path === "/admin/resources") {
    const items = await api("/api/admin/resources");
    state.data.resources = items;
    return dashboard(
      '<div class="panel"><input class="form-control mb-3" type="search" data-table-search aria-label="Search resources" placeholder="Filter resources by title, course or unit…">' +
        (items.length
          ? table(
              ["Resource", "Course / unit", "Price", "Status", "Actions"],
              items
                .map(
                  (r) =>
                    "<tr><td><strong>" +
                    esc(r.title) +
                    '</strong><div class="small text-muted">' +
                    esc(r.type) +
                    " · " +
                    r.pages +
                    " pages " +
                    (r.demo ? chip("DEMO", "gold") : "") +
                    "</div></td><td>" +
                    esc(r.course) +
                    '<div class="small text-muted">' +
                    esc(r.unit_code) +
                    " · " +
                    esc(r.series) +
                    "</div></td><td>" +
                    money(r.price_minor) +
                    "</td><td>" +
                    chip(r.status, "gray") +
                    '</td><td><div class="actions">' +
                    (r.status !== "deleted"
                      ? btn("Edit", "edit-resource", r.id) +
                        btn("Replace PDF", "replace-resource", r.id) +
                        link("View", "/viewer?id=" + r.id, "light")
                      : "") +
                    "</div></td></tr>",
                )
                .join(""),
            )
          : empty(
              "No resources yet",
              "Upload your first document to get started.",
            )) +
        "</div>",
      "Resources",
      "Review listings, update prices and replace incorrect files.",
      true,
      link("Upload papers", "/admin/upload"),
    );
  }
  if (path === "/admin/catalogue") {
    const d = await api("/api/admin/catalogue");
    state.data.catalogue = d;
    return dashboard(
      '<div class="panel"><div class="d-flex flex-wrap gap-2 mb-4">' +
        btn("Add course", "new-course", "", "primary") +
        btn("Add unit", "new-unit") +
        btn("Add level / body / type", "new-taxonomy") +
        '</div><h3 class="mb-3">Courses</h3>' +
        table(
          ["Course", "Description", ""],
          d.courses
            .map(
              (c) =>
                "<tr><td><strong>" +
                esc(c.name) +
                "</strong></td><td>" +
                esc(c.description) +
                "</td><td>" +
                btn("Rename", "rename-course", c.id) +
                "</td></tr>",
            )
            .join(""),
        ) +
        '</div><div class="panel"><h3>Units</h3><input data-table-search class="form-control my-3" placeholder="Filter units…" aria-label="Filter units">' +
        table(
          ["Course", "Unit code", "Unit", ""],
          d.units
            .map(
              (u) =>
                "<tr><td>" +
                esc(u.course) +
                "</td><td>" +
                esc(u.code) +
                "</td><td>" +
                esc(u.name) +
                "</td><td>" +
                btn("Rename", "rename-unit", u.id) +
                "</td></tr>",
            )
            .join(""),
        ) +
        '</div><div class="panel"><h3>Levels, examining bodies and resource types</h3>' +
        table(
          ["Category", "Name", ""],
          d.taxonomy
            .map(
              (t) =>
                "<tr><td>" +
                esc(t.kind) +
                "</td><td>" +
                esc(t.name) +
                "</td><td>" +
                btn("Rename", "rename-taxonomy", t.id) +
                "</td></tr>",
            )
            .join(""),
        ) +
        "</div>",
      "Courses & units",
      "Maintain a catalogue that can cover every TVET discipline.",
      true,
    );
  }
  if (path === "/admin/series") {
    const list = state.tax.series;
    state.data.series = list;
    return dashboard(
      notice(
        "Closing a series hides its papers from public browsing. Existing buyers keep access. Permanent file deletion is a separate action with advance notice.",
      ) +
        '<div class="panel">' +
        table(
          ["Assessment series", "Year", "Status", "Actions"],
          list
            .map(
              (s) =>
                "<tr><td><strong>" +
                esc(s.name) +
                "</strong></td><td>" +
                s.year +
                "</td><td>" +
                chip(s.status, "gray") +
                '</td><td><div class="actions">' +
                (s.status === "open"
                  ? btn("Close series", "close-series", s.id)
                  : s.status === "closed"
                    ? btn("Reopen", "reopen-series", s.id)
                    : "") +
                (permitted("deletion") && ["open", "closed"].includes(s.status)
                  ? btn(
                      "Schedule deletion",
                      "schedule-deletion",
                      s.id,
                      "outline-danger",
                    )
                  : "") +
                "</div></td></tr>",
            )
            .join(""),
        ) +
        "</div>",
      "Assessment series",
      "Organize resources around each assessment period.",
      true,
      btn("Create series", "new-series", "", "primary"),
    );
  }
  if (path === "/admin/deletions") {
    const list = await api("/api/admin/deletions");
    state.data.deletions = list;
    return dashboard(
      notice(
        "Permanent deletion ends purchased online access. Review impact and send notices before scheduling. The final action remains blocked until the notice period ends.",
        "",
      ) +
        '<div class="panel">' +
        (list.length
          ? table(
              ["Series", "Deletion date (Nairobi)", "Status", "Actions"],
              list
                .map(
                  (j) =>
                    "<tr><td><strong>" +
                    esc(j.name) +
                    " " +
                    j.year +
                    '</strong><div class="small text-muted">' +
                    esc(j.reason) +
                    "</div></td><td>" +
                    date(j.execute_after) +
                    "</td><td>" +
                    chip(j.status, j.status === "running" ? "red" : "gray") +
                    '</td><td><div class="actions">' +
                    (j.status === "scheduled"
                      ? btn("Cancel deletion", "cancel-deletion", j.id)
                      : "") +
                    (["scheduled", "running"].includes(j.status)
                      ? btn(
                          "Permanently delete",
                          "execute-deletion",
                          j.id,
                          "outline-danger",
                        )
                      : "") +
                    "</div></td></tr>",
                )
                .join(""),
            )
          : empty(
              "No scheduled deletions",
              "Open Assessment Series to review and schedule removal.",
            )) +
        "</div>",
      "Deletion management",
      "Protect buyers with clear notice and explicit confirmation.",
      true,
    );
  }
  if (path === "/admin/users") {
    const users = await api("/api/admin/users");
    state.data.users = users;
    return dashboard(
      '<div class="panel"><input data-table-search class="form-control mb-3" type="search" placeholder="Search name, email, phone, course or status…" aria-label="Search users">' +
        table(
          ["Student", "Contact", "Course / level", "Status", "Actions"],
          users
            .map(
              (u) =>
                "<tr><td><strong>" +
                esc(u.name) +
                '</strong><div class="small text-muted">Joined ' +
                date(u.created_at) +
                "</div></td><td>" +
                esc(u.email) +
                '<div class="small text-muted">' +
                esc(u.phone) +
                "</div></td><td>" +
                esc(
                  state.courses.find((c) => c.id === u.course_id)?.name ||
                    "Not selected",
                ) +
                '<div class="small text-muted">' +
                esc(u.level) +
                "</div></td><td>" +
                chip(u.status, u.status === "suspended" ? "red" : "") +
                '</td><td><div class="actions">' +
                btn("View", "view-user", u.id) +
                btn("Manage", "edit-user", u.id) +
                btn("Recovery email", "recover-user", u.id) +
                (state.user.role === "super_admin"
                  ? btn("Anonymize", "anonymize", u.id, "outline-danger")
                  : "") +
                "</div></td></tr>",
            )
            .join(""),
        ) +
        "</div>",
      "User management",
      "Support student accounts while preserving their purchase records.",
      true,
    );
  }
  if (path === "/admin/payments") {
    const list = await api("/api/admin/payments");
    state.data.payments = list;
    return dashboard(
      notice(
        "A browser redirect never confirms a purchase. Reconciliation checks the provider’s records. Refund requests require provider or manual resolution; this portal does not pretend to issue refunds.",
      ) +
        '<div class="panel"><input data-table-search class="form-control mb-3" placeholder="Filter orders, buyers or payment status…" aria-label="Filter payments">' +
        (list.length
          ? table(
              ["Buyer / order", "Amount", "Status", "Reference / actions"],
              list
                .map(
                  (o) =>
                    "<tr><td><strong>" +
                    esc(o.name) +
                    '</strong><div class="text-muted small">' +
                    esc(o.email) +
                    "<br>" +
                    o.id.slice(0, 8) +
                    " · " +
                    date(o.created_at) +
                    "</div></td><td>" +
                    money(o.amount_minor) +
                    "</td><td>" +
                    chip(
                      o.status,
                      o.status === "needs_review" ? "red" : "gray",
                    ) +
                    '</td><td><div class="small text-muted">' +
                    esc(o.tracking_id || o.failure || "Payment not submitted") +
                    '</div><div class="actions mt-2">' +
                    (o.tracking_id
                      ? btn("Reconcile", "reconcile", o.attempt_id)
                      : o.attempt_id && state.user.role === "super_admin"
                        ? btn(
                            "Recover tracking reference",
                            "link-payment",
                            o.attempt_id,
                          )
                        : "") +
                    "</div></td></tr>",
                )
                .join(""),
            )
          : empty(
              "No transactions yet",
              "Submitted orders will appear here.",
            )) +
        "</div>",
      "Payments",
      "Track orders and resolve pending or interrupted payments.",
      true,
    );
  }
  if (path === "/admin/requests") {
    const list = await api("/api/admin/requests");
    state.data.requests = list;
    return dashboard(
      '<div class="panel">' +
        (list.length
          ? table(
              ["Student", "Requested resource", "Status", ""],
              list
                .map(
                  (r) =>
                    "<tr><td><strong>" +
                    esc(r.name) +
                    '</strong><div class="small text-muted">' +
                    esc(r.email) +
                    "</div></td><td>" +
                    esc(r.unit) +
                    '<div class="small text-muted wrap-text">' +
                    esc(r.details) +
                    "</div></td><td>" +
                    chip(r.status, "gray") +
                    "</td><td>" +
                    btn("Update", "update-request", r.id) +
                    "</td></tr>",
                )
                .join(""),
            )
          : empty(
              "No requests yet",
              "Students can request missing papers from their dashboard.",
            )) +
        "</div>",
      "Paper requests",
      "Connect students with the resources they need.",
      true,
    );
  }
  if (path === "/admin/support") {
    const list = await api("/api/admin/tickets");
    return dashboard(
      list
        .map(
          (t) =>
            '<div class="panel"><h3>' +
            esc(t.subject) +
            " " +
            chip(t.status, "gray") +
            '</h3><p class="small text-muted">' +
            esc(t.name) +
            " · Ticket " +
            t.id.slice(0, 8) +
            "</p>" +
            t.messages
              .map(
                (m) =>
                  '<div class="message ' +
                  (m.role !== "student" ? "staff" : "") +
                  '"><small>' +
                  esc(m.name) +
                  " · " +
                  date(m.created_at) +
                  "</small>" +
                  esc(m.message) +
                  "</div>",
              )
              .join("") +
            form(
              "admin-ticket",
              area("message", "Reply", "", 'required maxlength="4000"') +
                select(
                  "status",
                  "Ticket status",
                  [
                    ["open", "Keep open"],
                    ["closed", "Close ticket"],
                  ],
                  t.status,
                ),
              "Send reply",
              t.id,
            ) +
            "</div>",
        )
        .join("") ||
        empty(
          "No support tickets",
          "New student support requests will appear here.",
        ),
      "Support tickets",
      "Resolve payment, document and account problems.",
      true,
    );
  }
  if (path === "/admin/notifications") {
    const papers = permitted("resources")
      ? await api("/api/admin/resources")
      : [];
    state.data.resources = papers;
    return dashboard(
      '<div class="panel">' +
        form(
          "notification",
          field(
            "title",
            "Notification title",
            "",
            "text",
            'required maxlength="200"',
          ) +
            area("message", "Message", "", 'required maxlength="10000"') +
            select("priority", "Priority", [
              ["normal", "Normal"],
              ["urgent", "Urgent"],
            ]) +
            select("target", "Recipients", [
              ["all", "All students"],
              ["users", "One or more users"],
              ["course", "Students in a course"],
              ["resource", "Buyers of a paper"],
              ["series", "Buyers in an assessment series"],
            ]) +
            '<div data-audience-extra></div><p class="form-hint mb-3">Messages appear in the notification bell and inbox. Recipient counts are confirmed after sending.</p>',
          "Send notification",
        ) +
        "</div>",
      "Send notifications",
      "Share useful updates with the right audience.",
      true,
    );
  }
  if (path === "/admin/bundles") {
    const [bundles, papers] = await Promise.all([
      api("/api/admin/bundles"),
      api("/api/admin/resources"),
    ]);
    state.data.resources = papers;
    return dashboard(
      '<div class="panel">' +
        (bundles.length
          ? table(
              ["Bundle", "Price", "Papers", "Status", ""],
              bundles
                .map(
                  (b) =>
                    "<tr><td><strong>" +
                    esc(b.title) +
                    "</strong></td><td>" +
                    money(b.price_minor) +
                    "</td><td>" +
                    b.items.length +
                    "</td><td>" +
                    chip(b.active ? "Active" : "Hidden", "gray") +
                    "</td><td>" +
                    btn(
                      b.active ? "Hide" : "Activate",
                      b.active ? "hide-bundle" : "show-bundle",
                      b.id,
                    ) +
                    "</td></tr>",
                )
                .join(""),
            )
          : empty(
              "No bundles yet",
              "Group related papers into a discounted package.",
            )) +
        "</div>",
      "Resource bundles",
      "Create helpful combinations for a unit or course.",
      true,
      btn("Create bundle", "new-bundle", "", "primary"),
    );
  }
  if (path === "/admin/reports") {
    const d = await api("/api/admin/reports");
    return dashboard(
      '<div class="panel"><h3 class="mb-4">Resource performance</h3>' +
        table(
          ["Resource", "Course", "Purchases", "Revenue"],
          d.sales
            .map(
              (r) =>
                "<tr><td>" +
                esc(r.title) +
                "</td><td>" +
                esc(r.course) +
                "</td><td>" +
                r.purchases +
                "</td><td>" +
                money(r.revenue) +
                "</td></tr>",
            )
            .join(""),
        ) +
        '</div><div class="panel"><h3 class="mb-4">Monthly sales</h3>' +
        table(
          ["Month (Nairobi)", "Orders", "Revenue"],
          d.monthly
            .map(
              (r) =>
                "<tr><td>" +
                esc(r.month) +
                "</td><td>" +
                r.orders +
                "</td><td>" +
                money(r.revenue) +
                "</td></tr>",
            )
            .join(""),
        ) +
        "</div>",
      "Reports",
      "See which resources and courses students purchase.",
      true,
      link("Export orders CSV", "/api/admin/reports.csv", "light"),
    );
  }
  if (path === "/admin/staff") {
    const d = await api("/api/admin/staff");
    state.data.staff = d;
    return dashboard(
      '<div class="panel">' +
        table(
          ["Administrator", "Role", "Permissions", "Status", ""],
          d.users
            .map(
              (u) =>
                "<tr><td><strong>" +
                esc(u.name) +
                '</strong><div class="small text-muted">' +
                esc(u.email) +
                "</div></td><td>" +
                chip(u.role.replace("_", " "), "gray") +
                "</td><td>" +
                esc(
                  u.role === "super_admin"
                    ? "All permissions"
                    : u.permissions.join(", "),
                ) +
                "</td><td>" +
                chip(u.status, "gray") +
                "</td><td>" +
                btn("Manage", "edit-staff", u.id) +
                "</td></tr>",
            )
            .join(""),
        ) +
        "</div>",
      "Administrators",
      "Only super admins can create and control staff accounts.",
      true,
      btn("Create admin", "new-staff", "", "primary"),
    );
  }
  if (path === "/admin/settings") {
    const s = await api("/api/admin/settings");
    return dashboard(
      '<div class="panel">' +
        form(
          "settings",
          '<h3 class="mb-4">Brand and support</h3>' +
            field("name", "Platform name", s.public.name, "text", "required") +
            field("tagline", "Tagline", s.public.tagline, "text", "required") +
            field(
              "support_email",
              "Support email",
              s.public.support_email,
              "email",
            ) +
            field(
              "support_phone",
              "Support phone",
              s.public.support_phone,
              "tel",
            ) +
            field(
              "developer",
              "Developer credit",
              s.public.developer,
              "text",
              "required",
            ) +
            '<h3 class="my-4">Access and policies</h3>' +
            field(
              "notice_days",
              "Minimum deletion notice (days)",
              s.policy.notice_days,
              "number",
              'required min="1" max="365"',
            ) +
            '<p class="form-hint mb-3">Default: 7 days. Confirm your chosen business policy before launch.</p>' +
            area(
              "purchase_terms",
              "Purchase and access terms",
              s.policy.purchase_terms,
            ) +
            area("refund_terms", "Refund policy", s.policy.refund_terms) +
            area("privacy_terms", "Privacy policy", s.policy.privacy_terms),
        ) +
        '</div><div class="panel"><h3 class="mb-4">Logo and favicon</h3>' +
        form(
          "branding",
          select("kind", "Image type", [
            ["logo", "Logo"],
            ["favicon", "Favicon"],
          ]) +
            field(
              "file",
              "PNG image (up to 2 MB)",
              "",
              "file",
              'accept="image/png" required',
            ),
          "Upload image",
        ) +
        "</div>" +
        notice(
          "Payment and mail credentials are configured securely on the server. They are never displayed in browser settings. " +
            (state.paymentsConfigured
              ? "Pesapal credentials are configured."
              : "Pesapal has not been configured."),
        ),
      "Platform settings",
      "Manage the identity, support contacts and policies of your portal.",
      true,
    );
  }
  if (path === "/admin/audit") {
    const list = await api("/api/admin/audit");
    return dashboard(
      '<div class="panel"><input class="form-control mb-3" data-table-search placeholder="Filter activity…" aria-label="Filter activity">' +
        table(
          ["Time (Nairobi)", "Actor", "Action", "Target / detail"],
          list
            .map(
              (a) =>
                "<tr><td>" +
                date(a.created_at) +
                "</td><td>" +
                esc(a.actor || "System") +
                "</td><td>" +
                esc(a.action) +
                "</td><td><small>" +
                esc(a.target) +
                "<br>" +
                esc(JSON.stringify(a.detail)) +
                "</small></td></tr>",
            )
            .join(""),
        ) +
        "</div>",
      "Activity log",
      "A record of account, payment and resource management actions.",
      true,
    );
  }
  return dashboard(
    empty("Page not found", "Choose an item from the administration menu."),
    "Administration",
    "Manage the study portal.",
    true,
  );
}
const checked = (name, values, selected = []) =>
  '<div class="check-list">' +
  values
    .map(
      ([v, l]) =>
        '<label><input type="checkbox" name="' +
        name +
        '" value="' +
        esc(v) +
        '" ' +
        (selected.includes(v) ? "checked" : "") +
        "> " +
        esc(l) +
        "</label>",
    )
    .join("") +
  "</div>";
async function action(name, rid) {
  if (await billingAction(name, rid)) return;
  if (await socialAction(name, rid)) return;
  if (name === "close") {
    modal.close();
    return;
  }
  if (name === "logout") {
    await api("/api/auth/logout", { method: "POST", body: {} });
    state.courses = [];
    location.assign("/");
    return;
  }
  if (["buy", "cart", "wishlist", "bundle-cart"].includes(name)) {
    if (!state.user) {
      location.assign("/login?next=" + encodeURIComponent("/paper/" + rid));
      return;
    }
    if (name === "wishlist") {
      await api("/api/account/wishlist/" + rid, { method: "POST", body: {} });
      toast("Saved to your wishlist");
      return;
    }
    await api("/api/account/cart", {
      method: "POST",
      body: {
        item_id: rid,
        kind: name === "bundle-cart" ? "bundle" : "resource",
      },
    });
    if (name === "buy") location.assign("/account/cart");
    else toast("Added to your cart");
    return;
  }
  if (name === "recover-user") {
    const u = state.data.users.find((u) => u.id === rid);
    const r = await api("/api/auth/recover", {
      method: "POST",
      body: { email: u.email },
    });
    toast(r.message);
    return;
  }
  if (name === "recover") {
    openModal(
      "Recover your account",
      form(
        "recover",
        field("email", "Account email", "", "email", "required"),
        "Send recovery link",
      ) +
        '<p class="form-hint mt-3">Recovery emails are sent to the existing account email. If delivery is unavailable, contact Support.</p>',
    );
    return;
  }
  if (name === "receipt") {
    const r = await api("/api/account/receipts/" + rid);
    openModal(
      "Purchase receipt",
      '<div class="receipt"><div class="receipt-top"><strong>' +
        esc(state.settings.public.name) +
        "</strong><span>" +
        chip(r.status) +
        "</span></div><p><strong>" +
        esc(r.name) +
        "</strong><br>" +
        date(r.created_at) +
        ' (Africa/Nairobi)</p><p class="small text-muted">Receipt ' +
        esc(r.id) +
        "<br>Order " +
        esc(r.order_id) +
        "</p>" +
        table(
          ["Resource", "Amount"],
          r.items
            .map(
              (i) =>
                "<tr><td>" +
                esc(i.title) +
                "</td><td>" +
                money(i.price_minor) +
                "</td></tr>",
            )
            .join(""),
        ) +
        '<p class="text-end fw-bold">Total ' +
        money(r.amount_minor) +
        "</p>" +
        btn("Print / save PDF", "print", "", "primary") +
        "</div>",
    );
    return;
  }
  if (name === "print") {
    window.print();
    return;
  }
  if (name === "view-user") {
    const d = await api("/api/admin/users/" + rid);
    openModal(
      d.user.name,
      "<p>" +
        esc(d.user.email) +
        " · " +
        esc(d.user.phone) +
        "</p><h3>Purchase history</h3>" +
        table(
          ["Order", "Amount", "Status"],
          d.orders
            .map(
              (o) =>
                "<tr><td>" +
                o.id.slice(0, 8) +
                "</td><td>" +
                money(o.amount_minor) +
                "</td><td>" +
                chip(o.status, "gray") +
                "</td></tr>",
            )
            .join(""),
        ) +
        "<h3>Purchased papers</h3>" +
        table(
          ["Paper", "Access"],
          d.papers
            .map(
              (p) =>
                "<tr><td>" +
                esc(p.title) +
                "</td><td>" +
                chip(p.state, "gray") +
                "</td></tr>",
            )
            .join(""),
        ),
    );
    return;
  }
  if (name === "edit-user") {
    const u = state.data.users.find((u) => u.id === rid);
    openModal(
      "Manage student",
      form(
        "edit-user",
        field("name", "Full name", u.name, "text", "required") +
          field("email", "Email", u.email, "email", "required") +
          field("phone", "Phone", u.phone, "tel", "required") +
          select(
            "status",
            "Account status",
            [
              ["active", "Active"],
              ["suspended", "Suspended"],
            ],
            u.status,
          ) +
          area(
            "reason",
            "Reason for this change",
            "",
            'required minlength="3"',
          ) +
          '<p class="form-hint mb-3">Saving signs out the user’s existing sessions. Purchase history is preserved.</p>',
        "Save account",
        rid,
      ),
    );
    return;
  }
  if (name === "edit-resource") {
    const r = state.data.resources.find((r) => r.id === rid);
    openModal(
      "Edit paper",
      form(
        "edit-resource",
        field("title", "Paper title", r.title, "text", "required") +
          area(
            "description",
            "Description",
            r.description,
            'maxlength="4000"',
          ) +
          field(
            "price",
            "Price (KES)",
            r.price_minor / 100,
            "number",
            'required min="0" step="0.01"',
          ) +
          select(
            "status",
            "Status",
            [
              ["draft", "Draft"],
              ["published", "Published"],
              ["archived", "Archived"],
            ],
            r.status,
          ),
        "Save paper",
        rid,
      ),
    );
    return;
  }
  if (name === "replace-resource") {
    openModal(
      "Replace document",
      notice(
        "Existing buyers keep access. The previous PDF is retained in the version history until permanent series deletion.",
      ) +
        form(
          "replace-resource",
          field(
            "file",
            "New PDF",
            "",
            "file",
            'accept=".pdf,application/pdf" required',
          ),
          "Replace PDF",
          rid,
        ),
    );
    return;
  }
  if (name.startsWith("rename-")) {
    const kind = name.slice(7),
      key =
        kind === "course" ? "courses" : kind === "unit" ? "units" : "taxonomy",
      item = state.data.catalogue[key].find((x) => x.id === rid);
    openModal(
      "Rename " + kind,
      form(
        "rename-" + kind,
        field("name", "Name", item.name, "text", "required"),
        "Save name",
        rid,
      ),
    );
    return;
  }
  if (name === "new-course") {
    openModal(
      "Add course",
      form(
        "new-course",
        field("name", "Course name", "", "text", "required") +
          area("description", "Description", "", 'maxlength="2000"'),
        "Create course",
      ),
    );
    return;
  }
  if (name === "new-unit") {
    openModal(
      "Add unit",
      form(
        "new-unit",
        select("course_id", "Course", courseOptions(), "", "required") +
          field("name", "Unit name", "", "text", "required") +
          field("code", "Unit code", "", "text", "required"),
        "Create unit",
      ),
    );
    return;
  }
  if (name === "new-taxonomy") {
    openModal(
      "Add catalogue category",
      form(
        "new-taxonomy",
        select("kind", "Category", [
          ["level", "Level"],
          ["body", "Examining body"],
          ["type", "Resource type"],
        ]) + field("name", "Name", "", "text", "required"),
        "Create category",
      ),
    );
    return;
  }
  if (name === "new-series") {
    openModal(
      "Create assessment series",
      form(
        "new-series",
        field(
          "name",
          "Series name",
          "",
          "text",
          'required placeholder="November/December"',
        ) +
          field(
            "year",
            "Year",
            new Date().getFullYear(),
            "number",
            'required min="2000" max="2100"',
          ),
        "Create series",
      ),
    );
    return;
  }
  if (name === "schedule-deletion") {
    const s = state.data.series.find((s) => s.id === rid),
      impact = await api("/api/admin/series/" + rid + "/impact");
    openModal(
      "Schedule permanent deletion",
      notice(
        "<strong>" +
          impact.resources.length +
          " papers · " +
          impact.buyers +
          " affected buyers · " +
          impact.pending_orders +
          " unresolved orders</strong><br>This removes purchased online access after the notice period. Affected buyers will be notified.",
        "",
      ) +
        '<details class="mb-3"><summary>View affected papers</summary><ul>' +
        impact.resources.map((r) => "<li>" + esc(r.title) + "</li>").join("") +
        "</ul></details>" +
        form(
          "schedule-deletion",
          field(
            "execute_after",
            "Deletion date and time (Nairobi)",
            "",
            "datetime-local",
            "required",
          ) +
            area(
              "reason",
              "Reason for deletion",
              "",
              'required minlength="5"',
            ) +
            field(
              "confirmation",
              "Type “" + esc(s.name) + "” to confirm",
              "",
              "text",
              "required",
            ) +
            '<p class="form-hint mb-3">Allow at least ' +
            state.settings.policy.notice_days +
            " days. New purchases stop when deletion is scheduled. A final confirmation is required on or after the deletion date.</p>",
          "Notify buyers and schedule",
          rid,
        ),
    );
    return;
  }
  if (name === "execute-deletion") {
    const j = state.data.deletions.find((j) => j.id === rid);
    openModal(
      "Confirm permanent deletion",
      notice(
        "This deletes the stored PDFs and ends online access for existing buyers. Financial records remain.",
        "",
      ) +
        form(
          "execute-deletion",
          field(
            "confirmation",
            "Type “" + esc(j.name) + "” to confirm",
            "",
            "text",
            "required",
          ),
          "Permanently delete files",
          rid,
        ),
    );
    return;
  }
  if (name === "anonymize") {
    const u = state.data.users.find((u) => u.id === rid);
    openModal(
      "Anonymize student account",
      notice(
        "The account will be disabled and identifying profile fields removed. Financial and audit records are retained under the account identifier.",
        "",
      ) +
        form(
          "anonymize",
          field(
            "confirmation",
            "Type the user’s email to confirm",
            "",
            "email",
            "required",
          ) + area("reason", "Reason", "", 'required minlength="5"'),
          "Anonymize account",
          rid,
        ),
    );
    return;
  }
  if (name === "update-request") {
    const r = state.data.requests.find((r) => r.id === rid);
    const papers = await api("/api/admin/request-resources");
    openModal(
      "Update paper request",
      form(
        "update-request",
        select(
          "status",
          "Status",
          [
            ["open", "Open"],
            ["reviewing", "Reviewing"],
            ["fulfilled", "Fulfilled"],
            ["unavailable", "Unavailable"],
          ],
          r.status,
        ) +
          select(
            "resource_id",
            "Available resource (required for fulfillment)",
            [
              ["", "Choose a published paper"],
              ...papers.map((p) => [p.id, p.title]),
            ],
            r.resource_id,
          ),
        "Update and notify student",
        rid,
      ),
    );
    return;
  }
  if (name === "new-bundle") {
    const papers = state.data.resources.filter(
      (r) => r.status === "published" && r.series_status === "open",
    );
    openModal(
      "Create resource bundle",
      form(
        "new-bundle",
        field("title", "Bundle title", "", "text", "required") +
          area("description", "Description", "", 'maxlength="2000"') +
          field(
            "price",
            "Bundle price (KES)",
            "",
            "number",
            'required min="0" step="0.01"',
          ) +
          '<label class="form-label">Included papers (choose at least two)</label>' +
          checked(
            "resource_ids",
            papers.map((p) => [p.id, p.title + " · " + money(p.price_minor)]),
          ) +
          '<p class="form-hint mb-3">The bundle price cannot exceed the sum of the individual papers.</p>',
        "Create bundle",
      ),
    );
    return;
  }
  if (name === "new-staff") {
    openModal(
      "Create administrator",
      form(
        "new-staff",
        field("name", "Full name", "", "text", "required") +
          field("email", "Email", "", "email", "required") +
          field(
            "phone",
            "Phone",
            "",
            "tel",
            'required placeholder="+254712345678"',
          ) +
          field(
            "password",
            "Initial password",
            "",
            "password",
            'required minlength="12" maxlength="128" autocomplete="new-password"',
          ) +
          '<label class="form-label">Permissions</label>' +
          checked(
            "permissions",
            state.data.staff.permissions.map((p) => [p, p]),
          ) +
          '<p class="form-hint mb-3">Share the password securely. The admin can change it from their profile.</p>',
        "Create admin",
      ),
    );
    return;
  }
  if (name === "edit-staff") {
    const u = state.data.staff.users.find((u) => u.id === rid);
    openModal(
      "Manage staff account",
      form(
        "edit-staff",
        select(
          "status",
          "Account status",
          [
            ["active", "Active"],
            ["suspended", "Disabled"],
          ],
          u.status,
        ) +
          (u.role === "super_admin"
            ? notice(
                "Super admins have all permissions. The last active super admin cannot be disabled.",
              )
            : '<label class="form-label">Permissions</label>' +
              checked(
                "permissions",
                state.data.staff.permissions.map((p) => [p, p]),
                u.permissions,
              )),
        "Save staff account",
        rid,
      ),
    );
    return;
  }
  if (name === "link-payment") {
    openModal(
      "Recover provider reference",
      notice(
        "Use the tracking ID from Pesapal’s merchant records for this exact submission. The server checks the merchant reference, amount, currency and payment status before granting access.",
      ) +
        form(
          "link-payment",
          field("tracking_id", "Pesapal tracking ID", "", "text", "required"),
          "Verify and link",
          rid,
        ),
    );
    return;
  }
  const mutations = {
    unwishlist: ["DELETE", "/api/account/wishlist/" + rid],
    uncart: ["DELETE", "/api/account/cart/" + rid],
    read: ["POST", "/api/account/notifications/read", { id: rid }],
    "read-all": ["POST", "/api/account/notifications/read", {}],
    "revoke-session": ["DELETE", "/api/account/sessions/" + rid],
    "cancel-order": ["POST", "/api/account/orders/" + rid + "/cancel", {}],
    "check-order": ["POST", "/api/account/orders/" + rid + "/check", {}],
    "close-series": ["POST", "/api/admin/series/" + rid + "/close", {}],
    "reopen-series": ["POST", "/api/admin/series/" + rid + "/reopen", {}],
    "cancel-deletion": ["POST", "/api/admin/deletions/" + rid + "/cancel", {}],
    reconcile: ["POST", "/api/admin/payments/" + rid + "/reconcile", {}],
    "hide-bundle": ["PATCH", "/api/admin/bundles/" + rid, { active: false }],
    "show-bundle": ["PATCH", "/api/admin/bundles/" + rid, { active: true }],
  };
  if (name === "pay-order") {
    const j = await api("/api/account/orders/" + rid + "/pay", {
      method: "POST",
      body: {},
    });
    location.assign(j.redirect_url);
    return;
  }
  const m = mutations[name];
  if (m) {
    if (
      [
        "close-series",
        "cancel-deletion",
        "cancel-order",
        "revoke-session",
      ].includes(name) &&
      !confirm("Continue with this action?")
    )
      return;
    const j = await api(m[1], { method: m[0], body: m[2] });
    toast(j.status ? "Payment status: " + j.status : "Changes saved");
    await refresh();
    await render();
    return;
  }
}
async function uploadForm(f, url, plural = false) {
  const data = new FormData(f);
  if (data.has("price")) {
    data.set("price_minor", Math.round(Number(data.get("price")) * 100));
    data.delete("price");
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("x-csrf-token", state.csrf);
    const progress = $("#upload-progress");
    if (progress) {
      progress.hidden = false;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) progress.value = (e.loaded / e.total) * 100;
      };
    }
    xhr.onload = () => {
      let j;
      try {
        j = JSON.parse(xhr.responseText);
      } catch {
        return reject(Error("Upload failed. Check your connection."));
      }
      if (xhr.status >= 400) reject(Error(j.error || "Upload failed"));
      else resolve(j);
    };
    xhr.onerror = () =>
      reject(
        Error("Connection interrupted. Check your files before retrying."),
      );
    xhr.send(data);
  });
}
async function submit(f) {
  if (await billingSubmit(f)) return;
  if (await socialSubmit(f)) return;
  const type = f.dataset.form,
    rid = f.dataset.id,
    fd = new FormData(f),
    b = Object.fromEntries(fd);
  let url,
    method = "POST",
    body = b,
    j;
  if (type === "register" || type === "login" || type === "staff-login") {
    url = "/api/auth/" + (type === "staff-login" ? "staff" : type);
    j = await api(url, { method, body });
    if (j.user) state.user = j.user;
    const next = new URLSearchParams(location.search).get("next");
    location.assign(
      type === "register"
        ? "/account/profile"
        : type === "staff-login"
          ? "/admin"
          : next && next.startsWith("/") && !next.startsWith("//")
            ? next
            : "/account",
    );
    return;
  }
  if (type === "recover") {
    j = await api("/api/auth/recover", { method, body });
    f.innerHTML = notice(esc(j.message));
    return;
  }
  if (type === "reset") {
    await api("/api/auth/reset", {
      method,
      body: { ...b, token: new URLSearchParams(location.search).get("token") },
    });
    location.assign("/login");
    return;
  }
  if (["upload", "replace-resource", "avatar", "branding"].includes(type)) {
    url =
      type === "upload"
        ? "/api/admin/resources"
        : type === "avatar"
          ? "/api/account/avatar"
          : type === "branding"
            ? "/api/admin/branding/" + b.kind
            : "/api/admin/resources/" + rid + "/replace";
    j = await uploadForm(f, url);
    if (j.results) {
      $("#upload-results").innerHTML = j.results
        .map(
          (r) =>
            '<p class="small ' +
            (r.success ? "text-success" : "text-danger") +
            '">' +
            esc(r.file) +
            ": " +
            (r.success ? "Uploaded successfully" : esc(r.error)) +
            "</p>",
        )
        .join("");
      toast("Upload finished. Review the file results.");
      state.courses = [];
      return;
    }
    modal.close();
    toast("File saved");
    await refresh();
    await render();
    return;
  }
  const map = {
    profile: ["PUT", "/api/account/profile"],
    password: ["POST", "/api/account/password"],
    request: ["POST", "/api/account/requests"],
    ticket: ["POST", "/api/account/tickets"],
    "ticket-reply": ["POST", "/api/account/tickets/" + rid + "/reply"],
    "admin-ticket": ["POST", "/api/admin/tickets/" + rid],
    "edit-user": ["PATCH", "/api/admin/users/" + rid],
    "edit-resource": ["PATCH", "/api/admin/resources/" + rid],
    "new-course": ["POST", "/api/admin/catalogue/course"],
    "new-unit": ["POST", "/api/admin/catalogue/unit"],
    "new-series": ["POST", "/api/admin/catalogue/series"],
    "new-taxonomy": ["POST", "/api/admin/catalogue/taxonomy"],
    "schedule-deletion": ["POST", "/api/admin/series/" + rid + "/deletion"],
    "execute-deletion": ["POST", "/api/admin/deletions/" + rid + "/execute"],
    "update-request": ["POST", "/api/admin/requests/" + rid],
    "new-bundle": ["POST", "/api/admin/bundles"],
    "new-staff": ["POST", "/api/admin/staff"],
    "edit-staff": ["PATCH", "/api/admin/staff/" + rid],
    anonymize: ["POST", "/api/admin/users/" + rid + "/anonymize"],
    "link-payment": ["POST", "/api/admin/payments/" + rid + "/link"],
    notification: ["POST", "/api/admin/notifications"],
  };
  if (type.startsWith("rename-")) {
    method = "PATCH";
    url = "/api/admin/catalogue/" + type.slice(7) + "/" + rid;
  } else if (map[type]) {
    [method, url] = map[type];
  }
  if (fd.has("price")) {
    body.price_minor = Math.round(Number(b.price) * 100);
    delete body.price;
  }
  if (type === "new-bundle") body.resource_ids = fd.getAll("resource_ids");
  if (["new-staff", "edit-staff"].includes(type))
    body.permissions = fd.getAll("permissions");
  if (type === "schedule-deletion")
    body.execute_after = new Date(b.execute_after + ":00+03:00").toISOString();
  if (type === "notification") body.user_ids = fd.getAll("user_ids");
  if (type === "settings") {
    method = "PUT";
    url = "/api/admin/settings";
    body = {
      public: {
        name: b.name,
        tagline: b.tagline,
        support_email: b.support_email,
        support_phone: b.support_phone,
        developer: b.developer,
      },
      policy: {
        notice_days: Number(b.notice_days),
        purchase_terms: b.purchase_terms,
        refund_terms: b.refund_terms,
        privacy_terms: b.privacy_terms,
      },
    };
  }
  if (type === "checkout") {
    j = await api("/api/account/checkout", {
      method,
      body: { accept_terms: fd.get("accept_terms") === "on" },
    });
    location.assign(j.free ? "/account/papers" : j.redirect_url);
    return;
  }
  if (!url) throw Error("Unknown form action");
  j = await api(url, { method, body });
  if (modal.open) modal.close();
  toast(
    j.recipients
      ? "Notification delivered to " + j.recipients + " accounts"
      : "Changes saved",
  );
  state.courses = [];
  await refresh();
  await render();
}
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-action]");
  if (!t) return;
  e.preventDefault();
  t.disabled = true;
  try {
    await action(t.dataset.action, t.dataset.id);
  } catch (error) {
    toast(error.message);
  } finally {
    t.disabled = false;
  }
});
document.addEventListener("submit", async (e) => {
  const f = e.target.closest("[data-form]");
  if (!f) return;
  e.preventDefault();
  const button = f.querySelector('[type="submit"]'),
    label = button.textContent,
    error = f.querySelector(".form-error");
  button.disabled = true;
  button.textContent = "Please wait…";
  error.textContent = "";
  try {
    await submit(f);
  } catch (e) {
    error.textContent = e.message;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
});
document.addEventListener("input", (e) => {
  if (e.target.matches("[data-table-search]")) {
    const q = e.target.value.toLowerCase();
    e.target
      .closest(".panel")
      .querySelectorAll("tbody tr")
      .forEach((r) => (r.hidden = !r.textContent.toLowerCase().includes(q)));
  }
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.id === "sort") {
    const q = new URLSearchParams(location.search);
    q.set("sort", t.value);
    q.delete("page");
    location.assign("/resources?" + q);
  }
  if (t.matches("[data-unit-course]")) {
    const target = $("[data-unit-target]");
    target.innerHTML =
      '<option value="">Choose unit</option>' +
      state.tax.units
        .filter((u) => u.course_id === t.value)
        .map(
          (u) =>
            '<option value="' +
            u.id +
            '">' +
            esc(u.code + " · " + u.name) +
            "</option>",
        )
        .join("");
  }
  if (t.name === "target" && t.closest('[data-form="notification"]')) {
    try {
      const data = await api("/api/admin/notification-options"),
        container = $("[data-audience-extra]");
      container.innerHTML =
        t.value === "all"
          ? ""
          : t.value === "users"
            ? '<label class="form-label">Select users</label>' +
              checked(
                "user_ids",
                data.users.map((u) => [u.id, u.name + " · " + u.email]),
              )
            : t.value === "course"
              ? select("target_id", "Course", courseOptions(), "", "required") +
                select("level", "Optional level", [
                  ["", "All levels"],
                  ...taxOptions("level"),
                ])
              : t.value === "resource"
                ? select(
                    "target_id",
                    "Paper",
                    [
                      ["", "Choose paper"],
                      ...data.resources.map((r) => [r.id, r.title]),
                    ],
                    "",
                    "required",
                  )
                : select(
                    "target_id",
                    "Series",
                    [
                      ["", "Choose series"],
                      ...state.tax.series.map((s) => [
                        s.id,
                        s.name + " " + s.year,
                      ]),
                    ],
                    "",
                    "required",
                  );
    } catch (e) {
      toast(e.message);
    }
  }
});
window.addEventListener("offline", () => {
  if (!$(".offline"))
    app.insertAdjacentHTML(
      "afterbegin",
      '<div class="offline" role="alert">You’re offline. Reconnect before submitting forms or making payments.</div>',
    );
});
window.addEventListener("online", () => $(".offline")?.remove());
async function render() {
  const p = location.pathname;
  try {
    if (p.startsWith("/account") && !state.user) {
      location.replace(
        "/login?next=" + encodeURIComponent(p + location.search),
      );
      return;
    }
    if (p.startsWith("/admin") && !staff()) {
      if (!state.user) {
        location.replace("/staff/login");
        return;
      }
      throw Error("Staff access required");
    }
    if (
      p.startsWith("/admin") &&
      state.user?.role === "admin" &&
      state.subscription?.enabled &&
      !state.subscription.active &&
      p !== "/admin/subscription"
    ) {
      location.replace("/admin/subscription");
      return;
    }
    app.innerHTML =
      p === "/"
        ? await home()
        : p.startsWith("/admin")
          ? await adminPage()
          : p.startsWith("/account")
            ? await accountPage()
            : p.startsWith("/paper/")
              ? await detail()
              : ["/resources", "/free"].includes(p) || p.startsWith("/course/")
                ? await catalogue()
                : ["/login", "/register", "/staff/login", "/reset"].includes(p)
                  ? await authPage()
                  : await generalPage();
    await maybeGuide();
    if (p === "/account/profile" && state.user) {
      const img = new Image();
      img.onload = () => {
        const avatar = $(".profile-head .avatar");
        if (avatar) avatar.replaceWith(img);
      };
      img.alt = "Your profile photo";
      img.src = "/api/account/avatar";
    }
  } catch (e) {
    app.innerHTML = publicPage(
      '<div class="container py-5">' +
        empty("Unable to open this page", e.message, "exclamation-circle") +
        '<div class="text-center mt-4">' +
        link("Back to home", "/") +
        " " +
        btn("Try again", "reload") +
        "</div></div>",
    );
  }
}
document.addEventListener("click", (e) => {
  if (e.target.closest('[data-action="reload"]')) location.reload();
});
const billingState = { mine: null, owner: null };
function subscriptionBanner() {
  const s = state.subscription;
  return notice(
    (s.active
      ? "Admin subscription active until <strong>" +
        date(s.expires_at) +
        "</strong>. " +
        s.days_remaining +
        " days remaining."
      : "Your admin subscription requires renewal. Management tools are currently restricted.") +
      ' <a href="/admin/subscription">Manage subscription</a>',
    s.active && s.days_remaining > 3 ? "info" : "",
  );
}
function subscriptionRows(list, owner = false) {
  return table(
    owner
      ? ["Administrator / order", "Amount / period", "Status", "Actions"]
      : ["Payment / period", "Amount", "Status", "Actions"],
    list
      .map(
        (o) =>
          "<tr><td><strong>" +
          esc(owner ? o.name : o.plan_name) +
          '</strong><div class="small text-muted">' +
          (owner ? esc(o.email) + "<br>" : "") +
          "Order " +
          o.id.slice(0, 8) +
          " · " +
          date(o.created_at) +
          (o.ends_at
            ? "<br>" + date(o.starts_at) + " → " + date(o.ends_at)
            : "") +
          "</div></td><td>" +
          money(o.amount_minor) +
          '<div class="small text-muted">' +
          o.period_days +
          " days</div></td><td>" +
          chip(
            o.status,
            o.status === "completed"
              ? ""
              : o.status === "reversed" || o.status === "needs_review"
                ? "red"
                : "gray",
          ) +
          '</td><td><div class="actions">' +
          (o.receipt_id
            ? btn("Receipt", "subscription-receipt", o.receipt_id)
            : "") +
          (owner
            ? o.tracking_id
              ? btn("Reconcile", "owner-sub-check", o.id)
              : o.attempt_id
                ? btn("Recover reference", "owner-sub-link", o.id)
                : ""
            : (["initiated", "pending", "failed"].includes(o.status)
                ? btn("Resume checkout", "subscription-pay", o.id, "primary")
                : "") +
              (o.tracking_id && !["completed", "reversed"].includes(o.status)
                ? btn("Check status", "subscription-check", o.id)
                : "")) +
          "</div>" +
          (o.status === "submission_unknown"
            ? '<p class="form-hint mt-2">Submission unresolved; contact the super admin before another payment.</p>'
            : "") +
          "</td></tr>",
      )
      .join(""),
  );
}
async function adminSubscriptionPage() {
  const d = await api("/api/subscriptions/me");
  billingState.mine = d;
  if (d.exempt)
    return dashboard(
      notice("Super admins are exempt from admin subscription fees.") +
        link("Manage admin subscriptions", "/admin/subscriptions"),
      "My subscription",
      "Your platform account and billing access.",
      true,
    );
  const p = d.plan,
    unresolved = d.orders.some((o) =>
      [
        "initiated",
        "pending",
        "submission_unknown",
        "failed",
        "needs_review",
      ].includes(o.status),
    );
  const status =
    d.active && d.enabled
      ? "Active"
      : !d.enabled
        ? "Not required"
        : d.status === "expired"
          ? "Expired"
          : "Payment required";
  const plan =
    '<div class="billing-plan"><div class="d-flex justify-content-between align-items-center mb-3"><span class="eyebrow">ADMIN PLATFORM ACCESS</span>' +
    chip(status, d.active ? "" : "gold") +
    "</div><h2>" +
    esc(p.name) +
    '</h2><div class="billing-price">' +
    money(p.amount_minor) +
    "<small> / " +
    p.period_days +
    ' days</small></div><p class="small text-muted">Pay the platform owner through Pesapal. The fee and billing period are controlled by the super admin.</p><hr><dl class="billing-details"><div><dt>Current access</dt><dd>' +
    esc(status) +
    "</dd></div><div><dt>Access ends</dt><dd>" +
    date(d.expires_at) +
    "</dd></div><div><dt>Days remaining</dt><dd>" +
    d.days_remaining +
    "</dd></div></dl>" +
    (d.next_starts_at
      ? notice(
          "Your next prepaid period begins on " +
            date(d.next_starts_at) +
            ". Contact the super admin if a reversed period interrupted access.",
          "",
        )
      : "") +
    '<p class="small wrap-text text-muted">' +
    esc(p.terms) +
    "</p>" +
    (!d.enabled
      ? notice(
          "Subscriptions are currently disabled. Your assigned admin permissions remain available.",
        )
      : !d.owner_configured
        ? notice(
            "The owner’s payment account is not connected. Contact the super admin.",
            "",
          )
        : unresolved
          ? notice(
              "An existing payment needs attention. Use Resume checkout or Check status in the history below.",
              "",
            )
          : form(
              "subscription-checkout",
              '<label class="ai-consent"><input type="checkbox" name="accept_terms" required><span>I agree to the fee, ' +
                p.period_days +
                "-day billing period and subscription terms shown above.</span></label>",
              d.active ? "Renew with Pesapal" : "Pay with Pesapal",
            )) +
    "</div>";
  return dashboard(
    '<div class="billing-layout"><div>' +
      plan +
      '</div><div><div class="panel"><h3>How renewal works</h3><ol class="billing-steps"><li>Review the owner-set subscription fee and period.</li><li>Complete your payment in Pesapal checkout.</li><li>After backend verification, your admin access is renewed.</li></ol><p class="small text-muted">Renewing early adds time after your current paid access. These are admin-initiated renewals; this feature does not automatically deduct money.</p><p class="small text-muted">Your profile, notifications and subscription history remain accessible when management access expires. Student purchases and papers remain intact.</p></div></div></div><div class="panel"><h3 class="mb-4">Subscription payment history</h3>' +
      (d.orders.length
        ? subscriptionRows(d.orders)
        : empty(
            "No subscription payments yet",
            "Your renewal history and receipts will appear here.",
          )) +
      "</div>",
    "My subscription",
    "Keep your admin workspace active with a verified renewal.",
    true,
  );
}
async function ownerSubscriptionsPage() {
  const d = await api("/api/subscriptions/manage");
  billingState.owner = d;
  const p = d.plan,
    active = d.admins.filter(
      (a) => a.subscription.enabled && a.subscription.active,
    ).length,
    expired = d.admins.filter(
      (a) => a.subscription.enabled && !a.subscription.active,
    ).length;
  return dashboard(
    '<div class="stats">' +
      stat("Administrator accounts", d.admins.length, "people") +
      stat("Active subscriptions", active, "shield-check") +
      stat("Need payment / renewal", expired, "clock") +
      stat(
        "Confirmed fees (listed history)",
        money(
          d.orders
            .filter((o) => o.status === "completed")
            .reduce((n, o) => n + o.amount_minor, 0),
        ),
        "wallet2",
      ) +
      "</div>" +
      notice(
        d.owner_configured
          ? "The owner’s Pesapal connection is configured. Verify the merchant identity in sandbox before accepting live payments."
          : "Connect the owner’s Pesapal account on the server before enabling paid admin access.",
        "",
      ) +
      '<div class="billing-layout"><div class="panel"><h3 class="mb-4">Subscription plan</h3>' +
      form(
        "subscription-plan",
        field("name", "Plan name", p.name, "text", 'required maxlength="100"') +
          field(
            "price",
            "Subscription fee (KES)",
            p.amount_minor / 100,
            "number",
            'required min="0" max="1000000" step="0.01"',
          ) +
          field(
            "period_days",
            "Billing period (days)",
            p.period_days,
            "number",
            'required min="1" max="366"',
          ) +
          area(
            "terms",
            "Subscription terms",
            p.terms,
            'required minlength="10" maxlength="3000"',
          ) +
          '<label class="ai-consent"><input type="checkbox" name="enabled" ' +
          (p.enabled ? "checked" : "") +
          '><span>Require an active paid subscription for normal admin management tools.</span></label><p class="form-hint mb-3">Only super admins can change this plan. Enabling it restricts unpaid admins immediately; renewal access remains open. Existing paid periods and quoted orders keep their original terms.</p>',
        "Save subscription plan",
      ) +
      '</div><div class="panel"><h3 class="mb-4">Admin access status</h3>' +
      table(
        ["Administrator", "Account", "Subscription", "Access ends"],
        d.admins
          .map(
            (a) =>
              "<tr><td><strong>" +
              esc(a.name) +
              '</strong><div class="small text-muted">' +
              esc(a.email) +
              "</div></td><td>" +
              chip(a.status, "gray") +
              "</td><td>" +
              chip(a.subscription.status, a.subscription.active ? "" : "gold") +
              "</td><td>" +
              date(a.subscription.expires_at) +
              "</td></tr>",
          )
          .join(""),
      ) +
      '</div></div><div class="panel"><h3 class="mb-4">Owner subscription receipts</h3><p class="small text-muted">Subscription payments are recorded separately from student paper purchases.</p>' +
      (d.orders.length
        ? subscriptionRows(d.orders, true)
        : empty(
            "No subscription orders yet",
            "Admins’ payments will appear here after you enable the plan.",
          )) +
      "</div>",
    "Admin subscriptions",
    "Set the fee and billing period, and monitor owner-account payments.",
    true,
  );
}
async function billingAction(name, rid) {
  if (name === "subscription-receipt") {
    const o = await api("/api/subscriptions/receipts/" + rid);
    openModal(
      "Admin subscription receipt",
      '<div class="receipt"><div class="receipt-top"><strong>' +
        esc(state.settings.public.name) +
        "</strong>" +
        chip(o.status) +
        "</div><h3>" +
        esc(o.plan_name) +
        "</h3><p>" +
        esc(o.name) +
        "<br>" +
        date(o.updated_at) +
        ' (Africa/Nairobi)</p><p class="small text-muted">Receipt ' +
        esc(o.receipt_id) +
        "<br>Subscription order " +
        esc(o.id) +
        "</p>" +
        table(
          ["Item", "Amount"],
          "<tr><td>" +
            esc(o.plan_name) +
            " · " +
            o.period_days +
            " days</td><td>" +
            money(o.amount_minor) +
            "</td></tr>",
        ) +
        '<p class="small">Access period: ' +
        date(o.starts_at) +
        " → " +
        date(o.ends_at) +
        '</p><p class="text-end fw-bold">Total ' +
        money(o.amount_minor) +
        "</p>" +
        btn("Print / save PDF", "print", "", "primary") +
        "</div>",
    );
    return true;
  }
  if (name === "subscription-pay") {
    const r = await api("/api/subscriptions/orders/" + rid + "/pay", {
      method: "POST",
      body: {},
    });
    location.assign(r.redirect_url);
    return true;
  }
  if (name === "subscription-check" || name === "owner-sub-check") {
    const r = await api(
      name === "subscription-check"
        ? "/api/subscriptions/orders/" + rid + "/check"
        : "/api/subscriptions/manage/orders/" + rid + "/check",
      { method: "POST", body: {} },
    );
    toast("Subscription payment: " + r.status);
    await refresh();
    await render();
    return true;
  }
  if (name === "owner-sub-link") {
    openModal(
      "Recover subscription payment reference",
      notice(
        "Use the tracking ID from the owner’s Pesapal merchant dashboard for this exact subscription attempt. The server verifies the reference, currency and amount.",
      ) +
        form(
          "owner-sub-link",
          field("tracking_id", "Pesapal tracking ID", "", "text", "required"),
          "Verify and link",
          rid,
        ),
    );
    return true;
  }
  return false;
}
async function billingSubmit(f) {
  const type = f.dataset.form,
    b = Object.fromEntries(new FormData(f));
  if (type === "subscription-plan") {
    await api("/api/subscriptions/plan", {
      method: "PUT",
      body: {
        name: b.name,
        amount_minor: Math.round(Number(b.price) * 100),
        period_days: Number(b.period_days),
        terms: b.terms,
        enabled: b.enabled === "on",
      },
    });
    toast("Subscription plan updated");
    await refresh();
    await render();
    return true;
  }
  if (type === "subscription-checkout") {
    const r = await api("/api/subscriptions/checkout", {
      method: "POST",
      body: {
        plan_version: billingState.mine.plan.version,
        accept_terms: b.accept_terms === "on",
      },
    });
    location.assign(r.redirect_url);
    return true;
  }
  if (type === "owner-sub-link") {
    const r = await api(
      "/api/subscriptions/manage/orders/" + f.dataset.id + "/link",
      { method: "POST", body: b },
    );
    modal.close();
    toast("Verified subscription status: " + r.status);
    await refresh();
    await render();
    return true;
  }
  return false;
}
const socialState = {
  ai: null,
  thread: null,
  moderation: null,
  modThread: null,
  pollTimer: null,
  touring: false,
};
function bottomNav() {
  const u = state.user,
    p = location.pathname;
  const items = [
    ["Home", u ? (staff() ? "/admin" : "/account") : "/", "house"],
    ["Papers", u ? "/account/papers" : "/resources", "collection"],
    ["AI", "/account/ai", "stars"],
    ["Chats", "/account/chats", "chat-dots"],
    [
      u ? "Profile" : "Account",
      u ? "/account/profile" : "/login",
      "person-circle",
    ],
  ];
  return (
    '<nav class="bottom-nav" aria-label="App navigation">' +
    items
      .map(
        ([label, url, symbol]) =>
          '<a href="' +
          url +
          '" ' +
          (p === url ? 'aria-current="page" class="active"' : "") +
          ">" +
          icon(symbol) +
          "<span>" +
          label +
          "</span></a>",
      )
      .join("") +
    "</nav>"
  );
}
function mobileTools() {
  return (
    '<div class="mobile-tools">' +
    link("Browse papers", "/resources", "light") +
    link("Orders", "/account/orders", "light") +
    link("Support", "/account/support", "light") +
    link("Requests", "/account/requests", "light") +
    link("Wishlist", "/account/wishlist", "light") +
    (state.user?.role === "student" ? btn("App guide", "tour-replay") : "") +
    btn("Sign out", "logout") +
    "</div>"
  );
}
function safeAnswer(value) {
  const parts = String(value || "").split(/```(?:[\w+-]+)?\n([\s\S]*?)```/g);
  return parts
    .map((part, i) =>
      i % 2
        ? "<pre><code>" + esc(part) + "</code></pre>"
        : esc(part)
            .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
            .replace(/`([^`\n]+)`/g, "<code>$1</code>"),
    )
    .join("");
}
function initials(name) {
  return esc(
    String(name || "?")
      .split(" ")
      .map((x) => x[0])
      .slice(0, 2)
      .join(""),
  );
}
function aiBubble(m) {
  return (
    '<article class="ai-bubble ' +
    (m.role === "user" ? "from-user" : "from-ai") +
    '"><div class="bubble-heading">' +
    (m.role === "user"
      ? icon("person-circle") + " You"
      : icon("stars") + " StudyMate") +
    "<small>" +
    (m.role === "assistant"
      ? esc(m.provider || "AI") + " · " + date(m.created_at)
      : date(m.created_at)) +
    '</small></div><div class="ai-content">' +
    safeAnswer(m.content) +
    "</div>" +
    (m.state === "failed"
      ? '<p class="small text-danger mt-2 mb-0">Reply unavailable. ' +
        btn("Try this question again", "ai-retry", m.id) +
        "</p>"
      : "") +
    (m.role === "assistant"
      ? '<div class="mt-2">' +
        btn(icon("copy") + " Copy", "ai-copy", m.id) +
        "</div>"
      : "") +
    "</article>"
  );
}
async function aiPage() {
  const [config, list] = await Promise.all([
    api("/api/social/ai/config"),
    api("/api/social/ai/conversations"),
  ]);
  const q = new URLSearchParams(location.search),
    cid = q.get("chat") || (!q.has("new") ? list[0]?.id : null);
  const chat = cid
    ? await api("/api/social/ai/conversations/" + encodeURIComponent(cid))
    : null;
  socialState.ai = { config, list, chat };
  const providers = [
    ["auto", "Automatic · Gemini / Groq"],
    ...config.providers.map((p) => [p, p === "gemini" ? "Gemini" : "Groq"]),
  ];
  const side =
    '<aside class="ai-history"><div class="history-head"><strong>Your conversations</strong>' +
    link(icon("plus-lg") + " New", "/account/ai?new=1", "light") +
    "</div>" +
    (list
      .map(
        (c) =>
          '<a href="/account/ai?chat=' +
          c.id +
          '" class="history-item ' +
          (c.id === cid ? "active" : "") +
          '">' +
          icon("chat-left-text") +
          "<span>" +
          esc(c.title) +
          "<small>" +
          date(c.updated_at) +
          "</small></span></a>",
      )
      .join("") ||
      '<p class="small text-muted p-3">Your first study chat starts here.</p>') +
    "</aside>";
  const welcome =
    '<div class="ai-welcome"><div class="ai-orb">' +
    icon("stars") +
    '</div><div class="eyebrow mt-3">YOUR PERSONAL STUDY COMPANION</div><h2>What would you like to understand?</h2><p>Work through a concept, build a revision plan, or find your way around the portal.</p><div class="ai-suggestions">' +
    [
      "Explain a topic step by step",
      "Help me make a revision plan",
      "How do I find my purchased papers?",
    ]
      .map((x) => btn(esc(x), "ai-suggestion", x))
      .join("") +
    "</div></div>";
  const composer = form(
    "ai-message",
    select("provider", "AI provider", providers, chat?.provider || "auto") +
      area(
        "message",
        "Your question",
        "",
        'required maxlength="4000" placeholder="Ask a question or describe what you are studying…"',
      ) +
      (!chat?.consent_at
        ? '<label class="ai-consent"><input type="checkbox" name="accept_ai" required> <span>I understand this conversation’s messages are sent to the selected AI provider. Automatic mode may use Gemini or Groq. Avoid sharing passwords or sensitive personal details.</span></label>'
        : '<p class="form-hint mb-3">Messages are sent to the selected provider; automatic mode may use either. AI answers can contain mistakes.</p>'),
    "Send question " + icon("arrow-up"),
    chat?.id || "",
  );
  return dashboard(
    '<div class="ai-workspace">' +
      side +
      '<section class="ai-chat"><div class="ai-chat-head"><div><strong>' +
      esc(chat?.title || "New study conversation") +
      "</strong><small>" +
      icon("lock") +
      " Private to your account</small></div>" +
      (chat ? btn(icon("trash3"), "ai-delete", chat.id) : "") +
      "</div>" +
      (!config.providers.length
        ? notice(
            "The AI assistant is waiting for administrator configuration. Your existing chat history remains available.",
            "",
          )
        : "") +
      '<div class="chat-messages" aria-live="polite">' +
      (chat?.messages.length ? chat.messages.map(aiBubble).join("") : welcome) +
      '</div><div class="ai-composer">' +
      (config.providers.length
        ? composer
        : '<p class="text-muted mb-0">Gemini and Groq can be enabled by the platform administrator.</p>') +
      '<div class="quota-note">' +
      config.used +
      " / " +
      config.daily_limit +
      " requests used today · Resets at midnight UTC</div></div></section></div>",
    "AI StudyMate",
    "A focused space for explanations, revision and study support.",
  );
}
function threadCard(t) {
  return (
    '<article class="discussion-card"><div class="d-flex justify-content-between gap-2"><span>' +
    chip(t.kind === "question" ? "QUESTION" : "DISCUSSION") +
    " " +
    (t.solved ? chip("SOLVED") : "") +
    " " +
    (t.status === "locked" ? chip("LOCKED", "gray") : "") +
    '</span><small class="text-muted">' +
    date(t.updated_at) +
    '</small></div><h3 class="mt-3"><a href="/account/chats?thread=' +
    t.id +
    '">' +
    esc(t.title) +
    '</a></h3><p class="discussion-excerpt">' +
    esc(t.body.slice(0, 230)) +
    (t.body.length > 230 ? "…" : "") +
    '</p><div class="discussion-meta"><span class="avatar">' +
    initials(t.author) +
    "</span><span><strong>" +
    esc(t.author) +
    "</strong><small>" +
    esc(t.course || "General study room") +
    '</small></span><span class="ms-auto">' +
    icon("chat-left") +
    " " +
    t.reply_count +
    " replies</span></div></article>"
  );
}
function replyCard(p, threadId, moderation = false) {
  return (
    '<article class="discussion-reply"><div class="discussion-meta mb-2"><span class="avatar">' +
    initials(p.author) +
    "</span><span><strong>" +
    esc(p.author) +
    "</strong> " +
    (p.author_role !== "student" ? chip("STAFF", "gray") : "") +
    "<small>" +
    date(p.created_at) +
    "</small></span>" +
    (moderation
      ? chip(p.hidden ? "HIDDEN" : "VISIBLE", p.hidden ? "red" : "gray")
      : "") +
    '</div><div class="wrap-text">' +
    esc(p.body) +
    '</div><div class="mt-2">' +
    (moderation
      ? btn(p.hidden ? "Restore reply" : "Hide reply", "mod-reply", p.id)
      : btn("Report", "report-post", threadId + ":" + p.id)) +
    "</div></article>"
  );
}
async function communityPage() {
  if (socialState.pollTimer) {
    window.clearInterval(socialState.pollTimer);
    socialState.pollTimer = null;
  }
  await catalogueData();
  const q = new URLSearchParams(location.search),
    threadId = q.get("thread");
  if (threadId) {
    const data = await api(
        "/api/social/community/" +
          encodeURIComponent(threadId) +
          "?page=" +
          (q.get("page") || 1),
      ),
      t = data.thread;
    socialState.thread = data;
    const body =
      '<a class="small fw-semibold d-inline-block mb-3" href="/account/chats">' +
      icon("arrow-left") +
      ' Back to discussions</a><article class="panel"><div class="d-flex gap-2 mb-3">' +
      chip(t.kind === "question" ? "QUESTION" : "DISCUSSION") +
      " " +
      (t.solved ? chip("SOLVED") : "") +
      " " +
      chip(t.course || "General study room", "gray") +
      "</div><h2>" +
      esc(t.title) +
      '</h2><div class="discussion-meta mb-4"><span class="avatar">' +
      initials(t.author) +
      "</span><span><strong>" +
      esc(t.author) +
      "</strong><small>" +
      date(t.created_at) +
      '</small></span></div><div class="wrap-text">' +
      esc(t.body) +
      '</div><div class="d-flex gap-2 mt-4">' +
      (t.user_id === state.user.id || data.can_moderate
        ? btn(t.solved ? "Mark unsolved" : "Mark solved", "solve-thread", t.id)
        : "") +
      btn("Report topic", "report-post", t.id) +
      '</div></article><div class="d-flex justify-content-between mb-3"><h3><span id="reply-count">' +
      data.total +
      '</span> replies</h3><span class="small text-muted">Updates every 15 seconds ' +
      btn("Refresh", "community-refresh") +
      '</span></div><div class="thread-replies">' +
      (data.replies.map((p) => replyCard(p, t.id)).join("") ||
        empty(
          "Start the conversation",
          "Share a helpful explanation or ask a follow-up.",
        )) +
      "</div>" +
      communityPagination(data, "/account/chats?thread=" + t.id) +
      '<div class="panel reply-composer">' +
      (t.status === "locked"
        ? notice(
            "This topic is locked. You can read the discussion, but new replies are closed.",
            "",
          )
        : form(
            "community-reply",
            area(
              "body",
              "Add your reply",
              "",
              'required maxlength="4000" placeholder="Share something useful with the group…"',
            ),
            "Post reply",
            t.id,
          )) +
      "</div>";
    socialState.pollTimer = window.setInterval(async () => {
      if (
        document.hidden ||
        location.pathname !== "/account/chats" ||
        $(".reply-composer textarea")?.value.trim() ||
        $('.reply-composer button[type="submit"]')?.disabled ||
        modal.open
      )
        return;
      try {
        const fresh = await api(
          "/api/social/community/" + t.id + "?page=" + data.page,
        );
        if (!$(".thread-replies")) return;
        if (
          fresh.total !== socialState.thread.total ||
          fresh.thread.status !== socialState.thread.thread.status
        ) {
          socialState.thread = fresh;
          $(".thread-replies").innerHTML =
            fresh.replies.map((p) => replyCard(p, t.id)).join("") ||
            empty("No replies yet");
          $("#reply-count").textContent = fresh.total;
          if (fresh.thread.status === "locked")
            $(".reply-composer").innerHTML = notice(
              "This topic has been locked. New replies are closed.",
              "",
            );
        }
      } catch {
        window.clearInterval(socialState.pollTimer);
      }
    }, 15000);
    return dashboard(
      body,
      "Chat centre",
      "Ask, discuss and learn with other TVET students.",
    );
  }
  socialState.thread = null;
  const data = await api("/api/social/community?" + q);
  const filter =
    '<form action="/account/chats" class="community-filters"><input class="form-control" type="search" name="q" aria-label="Search discussions" placeholder="Search discussions or questions…" value="' +
    esc(q.get("q") || "") +
    '"><select class="form-select" name="course" aria-label="Filter by course"><option value="">All courses</option>' +
    state.courses
      .map(
        (c) =>
          '<option value="' +
          c.id +
          '" ' +
          (q.get("course") === c.id ? "selected" : "") +
          ">" +
          esc(c.name) +
          "</option>",
      )
      .join("") +
    '</select><button class="btn btn-light">Search</button></form>';
  return dashboard(
    '<div class="community-banner"><div class="community-symbol">' +
      icon("chat-dots") +
      '</div><div><div class="eyebrow">LEARN BETTER, TOGETHER</div><h2>A question can start something good.</h2><p>Share a challenge, explain a concept, or join a course discussion. Posts are visible to signed-in members. Keep personal and payment details private.</p></div></div>' +
      filter +
      '<p class="small text-muted">' +
      data.total +
      ' topics · Questions and discussions</p><div class="discussion-feed">' +
      (data.items.map(threadCard).join("") ||
        empty(
          "Start a useful discussion",
          "Ask your first question or share a study tip with your course.",
          "chat-dots",
        )) +
      "</div>" +
      communityPagination(
        data,
        "/account/chats?" +
          new URLSearchParams([...q].filter(([key]) => key !== "page")),
      ),
    "Chat centre",
    "A place for questions, useful answers and shared progress.",
    false,
    btn(icon("plus-lg") + " Start a topic", "new-topic", "", "primary"),
  );
}
function communityPagination(data, base) {
  return (
    '<nav class="pagination" aria-label="Discussion pages">' +
    (data.page > 1
      ? '<a href="' + esc(base) + "&page=" + (data.page - 1) + '">Previous</a>'
      : "") +
    '<span class="small text-muted">Page ' +
    data.page +
    " of " +
    Math.max(1, data.pages) +
    "</span>" +
    (data.page < data.pages
      ? '<a href="' + esc(base) + "&page=" + (data.page + 1) + '">Next</a>'
      : "") +
    "</nav>"
  );
}
async function moderationPage() {
  const data = await api("/api/social/moderation");
  socialState.moderation = data;
  return dashboard(
    '<div class="panel"><h3 class="mb-3">Reported posts</h3>' +
      (data.reports.length
        ? table(
            ["Topic / report", "Reason", "Status", "Actions"],
            data.reports
              .map(
                (r) =>
                  "<tr><td><strong>" +
                  esc(r.title) +
                  '</strong><div class="small text-muted">Reported by ' +
                  esc(r.reporter) +
                  (r.reply_body
                    ? "<br>Reply: " + esc(r.reply_body.slice(0, 200))
                    : "") +
                  "</div></td><td>" +
                  esc(r.reason) +
                  "</td><td>" +
                  chip(r.state, "gray") +
                  '</td><td><div class="actions">' +
                  btn("Review", "mod-inspect", r.thread_id) +
                  (r.state === "open"
                    ? btn("Resolve report", "resolve-report", r.id)
                    : "") +
                  "</div></td></tr>",
              )
              .join(""),
          )
        : empty("No reports", "Reported community posts will appear here.")) +
      '</div><div class="panel"><h3 class="mb-3">Discussion management</h3><input class="form-control mb-3" data-table-search placeholder="Filter discussions…" aria-label="Filter discussions">' +
      table(
        ["Topic", "Author", "Status", "Actions"],
        data.threads
          .map(
            (t) =>
              "<tr><td>" +
              esc(t.title) +
              "</td><td>" +
              esc(t.author) +
              "</td><td>" +
              chip(t.status, t.status === "hidden" ? "red" : "gray") +
              '</td><td><div class="actions">' +
              btn("Replies", "mod-inspect", t.id) +
              btn("Moderate topic", "mod-topic", t.id) +
              "</div></td></tr>",
          )
          .join(""),
      ) +
      "</div>",
    "Community moderation",
    "Review reports, hide inappropriate posts and manage discussions.",
    true,
  );
}
const tourSteps = [
  [
    "compass",
    "Find your next resource",
    "Open Browse Papers to search by unit name or code, filter by course and preview a document before buying.",
    "Browse papers",
  ],
  [
    "collection",
    "Your own paper library",
    "Confirmed purchases are saved in My Papers. View or download them here and check any removal notices before a series is deleted.",
    "Papers",
  ],
  [
    "stars",
    "Meet your AI study companion",
    "Ask StudyMate for explanations, examples or a revision plan. Choose Gemini, Groq or automatic selection. AI chats are private to your account.",
    "AI",
  ],
  [
    "chat-dots",
    "Learn with your community",
    "Open Chats to ask questions, join course discussions and reply to other students. Posts are shared with signed-in members.",
    "Chats",
  ],
  [
    "bell",
    "Keep up with important updates",
    "The notification bell shows replies, purchase updates, announcements and paper-deletion notices. Read notices so you do not miss a download deadline.",
    "Notification bell",
  ],
  [
    "person-circle",
    "Make this space yours",
    "Use Profile to update your details, manage security and replay this guide. Orders, requests, support and your wishlist remain easy to reach.",
    "Profile",
  ],
];
async function maybeGuide(force = false) {
  const guide = state.onboarding;
  if (
    !guide?.eligible ||
    !location.pathname.startsWith("/account") ||
    modal.open
  )
    return;
  if (!force && !["pending", "in_progress"].includes(guide.status)) return;
  if (force || guide.status === "pending")
    state.onboarding = await api("/api/social/onboarding", {
      method: "POST",
      body: { status: "in_progress", step: 0 },
    });
  showGuide();
}
function showGuide() {
  socialState.touring = true;
  const step = state.onboarding.step || 0,
    [symbol, title, copy, nav] = tourSteps[step];
  $("#modal-body").innerHTML =
    '<div class="tour-heading"><span class="eyebrow">WELCOME TO YOUR STUDY SPACE</span><button class="modal-close" data-action="tour-skip" aria-label="Skip app guide">×</button></div><div class="tour-dots">' +
    tourSteps
      .map(
        (_, i) => '<span class="' + (i <= step ? "active" : "") + '"></span>',
      )
      .join("") +
    '</div><div class="tour-symbol">' +
    icon(symbol) +
    '</div><div class="small text-muted mb-2" role="status">Step ' +
    (step + 1) +
    " of " +
    tourSteps.length +
    '</div><h2 id="modal-title">' +
    esc(title) +
    '</h2><p class="tour-copy">' +
    esc(copy) +
    '</p><div class="tour-feature">' +
    icon(symbol) +
    " " +
    esc(nav) +
    '</div><div class="form-error tour-error" role="alert"></div><div class="tour-actions"><button type="button" class="btn btn-light" data-action="tour-previous" ' +
    (step === 0 ? "disabled" : "") +
    '>Previous</button><button type="button" class="btn btn-link" data-action="tour-skip">Skip</button><button type="button" class="btn btn-primary" data-action="tour-next">' +
    (step === 5 ? "Finish" : "Next " + icon("arrow-right")) +
    "</button></div>";
  if (!modal.open) {
    if (typeof modal.showModal === "function") modal.showModal();
    else modal.setAttribute("open", "");
  }
}
async function tourMove(status, step) {
  state.onboarding = await api("/api/social/onboarding", {
    method: "POST",
    body: { status, step },
  });
  if (["completed", "skipped"].includes(status)) {
    socialState.touring = false;
    if (typeof modal.close === "function") modal.close();
    else modal.removeAttribute("open");
    toast(
      status === "completed"
        ? "You’re ready to explore. Replay the guide from Profile anytime."
        : "Guide skipped. You can replay it from Profile.",
    );
  } else showGuide();
}
modal.addEventListener("cancel", (e) => {
  if (socialState.touring) {
    e.preventDefault();
    tourMove("skipped", state.onboarding.step).catch((error) => {
      $(".tour-error").textContent = error.message;
    });
  }
});
async function socialAction(name, rid) {
  if (name === "community-refresh") {
    await render();
    return true;
  }
  if (name.startsWith("tour-")) {
    if (name === "tour-replay") {
      if (!state.onboarding?.eligible) {
        toast("Finish your profile and set a password to start the guide.");
        return true;
      }
      await maybeGuide(true);
      return true;
    }
    const step = state.onboarding.step || 0;
    if (name === "tour-skip") await tourMove("skipped", step);
    else if (name === "tour-next")
      await tourMove(
        step === 5 ? "completed" : "in_progress",
        Math.min(5, step + 1),
      );
    else if (name === "tour-previous")
      await tourMove("in_progress", Math.max(0, step - 1));
    return true;
  }
  if (name === "ai-suggestion" || name === "ai-retry") {
    const input = $('[data-form="ai-message"] textarea');
    if (input) {
      input.value =
        name === "ai-retry"
          ? socialState.ai.chat.messages.find((m) => m.id === rid)?.content ||
            ""
          : rid;
      input.focus();
    }
    return true;
  }
  if (name === "ai-copy") {
    const m = socialState.ai.chat.messages.find((m) => m.id === rid);
    try {
      await navigator.clipboard.writeText(m.content);
      toast("Answer copied");
    } catch {
      toast(
        "Your browser could not copy the answer. Select its text to copy it.",
      );
    }
    return true;
  }
  if (name === "ai-delete") {
    if (!confirm("Delete this private AI conversation and its messages?"))
      return true;
    await api("/api/social/ai/conversations/" + rid, { method: "DELETE" });
    location.assign("/account/ai?new=1");
    return true;
  }
  if (name === "new-topic") {
    await catalogueData();
    openModal(
      "Start a useful conversation",
      form(
        "new-topic",
        select("kind", "Topic type", [
          ["question", "Ask a question"],
          ["discussion", "Start a discussion"],
        ]) +
          select("course_id", "Course (optional)", [
            ["", "General study room"],
            ...state.courses.map((c) => [c.id, c.name]),
          ]) +
          field(
            "title",
            "Title",
            "",
            "text",
            'required minlength="5" maxlength="180" placeholder="What would you like to discuss?"',
          ) +
          area(
            "body",
            "Your question or discussion",
            "",
            'required minlength="5" maxlength="6000"',
          ) +
          '<p class="form-hint mb-3">Your post will be visible to signed-in members. Do not include private contact, account or payment information.</p>',
        "Publish topic",
      ),
    );
    return true;
  }
  if (name === "report-post") {
    const [thread, reply] = rid.split(":");
    openModal(
      "Report this post",
      form(
        "report-post",
        area(
          "reason",
          "Why should a moderator review this?",
          "",
          'required minlength="5" maxlength="1000"',
        ) +
          (reply
            ? '<input type="hidden" name="reply_id" value="' + esc(reply) + '">'
            : ""),
        "Send report",
        thread,
      ),
    );
    return true;
  }
  if (name === "solve-thread") {
    await api("/api/social/community/" + rid + "/solved", {
      method: "PATCH",
      body: { solved: !socialState.thread.thread.solved },
    });
    await render();
    return true;
  }
  if (name === "mod-inspect") {
    const d = await api("/api/social/moderation/" + rid);
    socialState.modThread = d;
    openModal(
      "Replies: " + d.thread.title,
      d.replies.map((p) => replyCard(p, rid, true)).join("") ||
        empty("No replies yet"),
    );
    return true;
  }
  if (name === "mod-topic") {
    openModal(
      "Moderate discussion",
      form(
        "mod-topic",
        select("status", "Visibility / replies", [
          ["open", "Visible and open"],
          ["locked", "Visible but locked"],
          ["hidden", "Hide this topic"],
        ]) +
          area(
            "reason",
            "Reason for this action",
            "",
            'required minlength="5" maxlength="1000"',
          ),
        "Save moderation action",
        rid,
      ),
    );
    return true;
  }
  if (name === "mod-reply") {
    const p = socialState.modThread.replies.find((p) => p.id === rid);
    openModal(
      p.hidden ? "Restore reply" : "Hide reply",
      form(
        "mod-reply",
        '<input type="hidden" name="thread_id" value="' +
          socialState.modThread.thread.id +
          '"><input type="hidden" name="hidden" value="' +
          String(!p.hidden) +
          '">' +
          area(
            "reason",
            "Reason for this action",
            "",
            'required minlength="5" maxlength="1000"',
          ),
        "Confirm action",
        rid,
      ),
    );
    return true;
  }
  if (name === "resolve-report") {
    await api("/api/social/reports/" + rid + "/resolve", {
      method: "POST",
      body: {},
    });
    toast("Report resolved");
    await render();
    return true;
  }
  return false;
}
async function socialSubmit(f) {
  const type = f.dataset.form,
    rid = f.dataset.id,
    b = Object.fromEntries(new FormData(f));
  if (type === "ai-message") {
    let cid = rid;
    if (!cid) {
      cid = (
        await api("/api/social/ai/conversations", {
          method: "POST",
          body: { provider: b.provider },
        })
      ).id;
      f.dataset.id = cid;
    }
    const waiting = document.createElement("div");
    waiting.className = "ai-thinking";
    waiting.setAttribute("role", "status");
    waiting.textContent = "StudyMate is preparing your answer…";
    $(".chat-messages").appendChild(waiting);
    try {
      await api("/api/social/ai/conversations/" + cid + "/messages", {
        method: "POST",
        body: {
          message: b.message,
          provider: b.provider,
          accept_ai: b.accept_ai === "on",
          request_id: crypto.randomUUID(),
        },
      });
      if (new URLSearchParams(location.search).get("chat") !== cid)
        location.assign("/account/ai?chat=" + cid);
      else {
        await render();
        const messages = $(".chat-messages");
        if (messages) messages.scrollTop = messages.scrollHeight;
      }
    } finally {
      waiting.remove();
    }
    return true;
  }
  const mappings = {
    "new-topic": ["/api/social/community", b],
    "community-reply": ["/api/social/community/" + rid + "/replies", b],
    "report-post": ["/api/social/community/" + rid + "/report", b],
    "mod-topic": ["/api/social/moderation/" + rid, b],
    "mod-reply": [
      "/api/social/moderation/" + b.thread_id,
      { reply_id: rid, hidden: b.hidden === "true", reason: b.reason },
    ],
  };
  if (!mappings[type]) return false;
  const [url, body] = mappings[type],
    r = await api(url, { method: "POST", body });
  if (modal.open) modal.close();
  if (type === "new-topic") location.assign("/account/chats?thread=" + r.id);
  else if (type === "report-post") toast("Report sent to the moderation team");
  else {
    toast("Changes saved");
    await render();
  }
  return true;
}
try {
  await refresh();
  await render();
} catch (e) {
  app.innerHTML =
    '<main class="container py-5"><h1>Unable to connect</h1><p>' +
    esc(e.message) +
    "</p><p>Check your connection and refresh this page.</p></main>";
}
