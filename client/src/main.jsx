import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Ticket,
  ChartNoAxesCombined,
  Settings,
  Bell,
  LogOut,
  Plus,
  Search,
  ArrowLeft,
  Clock,
  CheckCircle,
  TriangleAlert,
  MessageSquare,
  Paperclip,
  Shield,
  ChevronRight,
  LifeBuoy,
} from "lucide-react";
import "./style.css";
async function api(url, options = {}) {
  const r = await fetch("/api" + url, {
    credentials: "include",
    ...options,
    headers:
      options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json", ...options.headers },
  });
  const b = await r.json();
  if (!r.ok) throw Error(b.error || "Request failed");
  return b;
}
const send = (url, data, method = "POST") =>
  api(url, { method, body: JSON.stringify(data) });
const date = (s) => (s ? new Date(s).toLocaleString() : "—");
const duration = (m) =>
  m === null
    ? "Complete"
    : `${Math.floor(Math.abs(m) / 60)}h ${Math.round(Math.abs(m) % 60)}m ${m < 0 ? "overdue" : "left"}`;
function App() {
  const [user, U] = useState(null),
    [boot, B] = useState(null),
    [tickets, T] = useState([]),
    [page, P] = useState("Overview"),
    [selected, S] = useState(null),
    [detail, D] = useState(null),
    [error, E] = useState(""),
    [notice, N] = useState(""),
    [search, Q] = useState(""),
    [status, F] = useState(""),
    [creating, C] = useState(false),
    [notifications, NN] = useState([]),
    [showNotifications, SN] = useState(false),
    [reports, R] = useState([]),
    [loading, L] = useState(true);
  const staff = user && user.role !== "client";
  const reload = async () => {
    const [b, t, n] = await Promise.all([
      api("/bootstrap"),
      api("/tickets"),
      api("/notifications"),
    ]);
    B(b);
    T(t);
    NN(n);
    if (selected) D(await api("/tickets/" + selected));
  };
  const act = async (fn, msg) => {
    E("");
    try {
      await fn();
      if (msg) {
        N(msg);
        setTimeout(() => N(""), 4000);
      }
    } catch (e) {
      E(e.message);
    }
  };
  useEffect(() => {
    api("/auth/me")
      .then(U)
      .catch(() => {})
      .finally(() => L(false));
  }, []);
  useEffect(() => {
    if (user) {
      act(reload);
      const id = setInterval(() => act(reload), 30000);
      return () => clearInterval(id);
    }
  }, [user, selected]);
  useEffect(() => {
    if (page === "Reports" && staff) act(async () => R(await api("/reports")));
  }, [page]);
  if (loading) return <div className="loading">Loading TicketFlow…</div>;
  if (!user) return <Login onLogin={U} />;
  if (!boot)
    return (
      <div className="loading">
        {error || "Loading your workspace…"}
        <button onClick={() => act(reload)}>Retry</button>
      </div>
    );
  const filtered = tickets.filter(
    (t) =>
      (!status || t.status === status) &&
      `${t.title} ${t.number} ${t.organisation_name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const open = tickets.filter(
      (t) => !["Resolved", "Closed"].includes(t.status),
    ),
    risk = open.filter((t) => t.sla.state === "at-risk"),
    breached = open.filter((t) => t.sla.state === "breached");
  const select = async (id) => {
    S(id);
    D(await api("/tickets/" + id));
    P("Tickets");
  };
  return (
    <div className="shell" style={{ "--accent": boot.config.branding.colour }}>
      <aside>
        <div className="brand">
          <span className="brand-icon">
            <LifeBuoy size={24} />
          </span>
          {boot.config.branding.name}
        </div>
        <span className="nav-label">WORKSPACE</span>
        {[
          ["Overview", LayoutDashboard],
          ["Tickets", Ticket],
          ["Security", Shield],
          ...(staff ? [["Reports", ChartNoAxesCombined]] : []),
          ...(user.role === "admin" ? [["Administration", Settings]] : []),
        ].map(([name, Icon]) => (
          <button
            key={name}
            className={"nav " + (page === name ? "active" : "")}
            onClick={() => {
              P(name);
              S(null);
              D(null);
            }}
          >
            <Icon size={19} />
            {name}
            {name === "Tickets" && (
              <span className="nav-count">{open.length}</span>
            )}
          </button>
        ))}
        <div className="sidebar-bottom">
          <div className="mini-card">
            <Shield size={20} />
            <strong>Your dedicated workspace</strong>
            <p>
              Every issue tracked.
              <br />
              Every commitment visible.
            </p>
          </div>
          <div className="profile">
            <div className="avatar">{user.name[0]}</div>
            <div>
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </div>
            <button
              title="Sign out"
              onClick={() =>
                act(async () => {
                  await send("/auth/logout", {});
                  U(null);
                  B(null);
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} /> <strong>{page}</strong>
          </div>
          <div className="header-right">
            <span className="live">
              <i /> Live workspace
            </span>
            <button
              className="icon-button"
              onClick={() => SN(!showNotifications)}
            >
              <Bell size={20} />
              {notifications.some((n) => !n.read_at) && <i />}
            </button>
          </div>
        </header>
        {showNotifications && (
          <div className="notification-panel">
            <div className="row">
              <h3>Notifications</h3>
              <button
                onClick={() =>
                  act(async () => {
                    await send("/notifications/read", {});
                    await reload();
                  })
                }
              >
                Mark all read
              </button>
            </div>
            {notifications.length ? (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    SN(false);
                    act(() => select(n.ticket_id));
                  }}
                  className={n.read_at ? "" : "unread"}
                >
                  {n.message}
                  <small>{date(n.created_at)}</small>
                </button>
              ))
            ) : (
              <p>You're all caught up.</p>
            )}
          </div>
        )}
        <div className="content">
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button onClick={() => E("")}>×</button>
            </div>
          )}
          {notice && <div className="alert success">{notice}</div>}
          {creating ? (
            <NewTicket
              boot={boot}
              user={user}
              onCancel={() => C(false)}
              onCreate={(b) =>
                act(async () => {
                  const t = await send("/tickets", b);
                  C(false);
                  await reload();
                  await select(t.id);
                }, "Ticket created")
              }
            />
          ) : selected && detail ? (
            <TicketDetail
              t={detail}
              boot={boot}
              user={user}
              act={act}
              reload={reload}
              back={() => {
                S(null);
                D(null);
              }}
            />
          ) : page === "Administration" ? (
            <Admin boot={boot} act={act} reload={reload} />
          ) : page === "Reports" ? (
            <Reports rows={reports} />
          ) : page === "Security" ? (
            <Security
              user={user}
              act={act}
              signOut={() => {
                U(null);
                B(null);
              }}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {staff ? "SUPPORT OPERATIONS" : "CLIENT PORTAL"}
                  </div>
                  <h1>
                    {page === "Overview"
                      ? "Your support, at a glance."
                      : "Ticket workspace"}
                  </h1>
                  <p>
                    {page === "Overview"
                      ? "Stay on top of requests and deliver on every commitment."
                      : "A clear path from the first question to the final resolution."}
                  </p>
                </div>
                <button className="primary" onClick={() => C(true)}>
                  <Plus size={18} /> New ticket
                </button>
              </div>
              {page === "Overview" && (
                <>
                  <div className="stats">
                    <Stat
                      title="Open tickets"
                      value={open.length}
                      icon={Ticket}
                      sub="Active support requests"
                    />
                    <Stat
                      title="At risk"
                      value={risk.length}
                      icon={Clock}
                      sub="Approaching an SLA target"
                      colour="amber"
                    />
                    <Stat
                      title="SLA breached"
                      value={breached.length}
                      icon={TriangleAlert}
                      sub="Needs immediate attention"
                      colour="red"
                    />
                    <Stat
                      title="Resolved"
                      value={
                        tickets.filter((t) =>
                          ["Resolved", "Closed"].includes(t.status),
                        ).length
                      }
                      icon={CheckCircle}
                      sub="Requests brought to resolution"
                      colour="green"
                    />
                  </div>
                  <div className="overview-grid">
                    <section className="card">
                      <div className="card-heading">
                        <h3>Queue health</h3>
                        <span className="muted">By status</span>
                      </div>
                      {boot.config.statuses.map((s) => {
                        const count = tickets.filter(
                          (t) => t.status === s,
                        ).length;
                        return (
                          <div className="health-row" key={s}>
                            <span>{s}</span>
                            <div className="bar">
                              <i
                                style={{
                                  width:
                                    (count / Math.max(tickets.length, 1)) *
                                      100 +
                                    "%",
                                }}
                              />
                            </div>
                            <strong>{count}</strong>
                          </div>
                        );
                      })}
                    </section>
                    <section className="card attention">
                      <div className="card-heading">
                        <h3>Needs attention</h3>
                        <span className="pill at-risk">SLA monitor</span>
                      </div>
                      {[...breached, ...risk].slice(0, 4).map((t) => (
                        <button
                          key={t.id}
                          className="attention-item"
                          onClick={() => act(() => select(t.id))}
                        >
                          <TriangleAlert size={17} />
                          <div>
                            <strong>{t.title}</strong>
                            <small>
                              {t.number} · {duration(t.sla.remaining)}
                            </small>
                          </div>
                          <ChevronRight size={16} />
                        </button>
                      ))}
                      {!risk.length && !breached.length && (
                        <div className="empty-small">
                          <CheckCircle size={32} />
                          <strong>All clear</strong>
                          <p>No active tickets are at risk right now.</p>
                        </div>
                      )}
                    </section>
                  </div>
                  {!staff && boot.organisations[0] && (
                    <section className="package-banner">
                      <Shield />
                      <div>
                        <strong>
                          {boot.organisations[0].package_name} support package
                        </strong>
                        <p>
                          {Object.entries(boot.organisations[0].targets)
                            .map(
                              ([p, t]) =>
                                `${p}: ${t.response} min response / ${t.resolution} min resolution`,
                            )
                            .join(" • ")}
                        </p>
                      </div>
                    </section>
                  )}
                </>
              )}
              <section className="card ticket-card">
                <div className="card-heading">
                  <h3>
                    {page === "Overview" ? "Recent tickets" : "All tickets"}{" "}
                    <span className="count">{filtered.length}</span>
                  </h3>
                  <div className="filters">
                    <label className="search">
                      <Search size={17} />
                      <input
                        aria-label="Search tickets"
                        placeholder="Search tickets…"
                        value={search}
                        onChange={(e) => Q(e.target.value)}
                      />
                    </label>
                    <select value={status} onChange={(e) => F(e.target.value)}>
                      <option value="">All statuses</option>
                      {boot.config.statuses.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Status</th>
                        <th>Priority</th>
                        {staff && <th>Client</th>}
                        <th>Assigned to</th>
                        <th>SLA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered
                        .slice(0, page === "Overview" ? 8 : 500)
                        .map((t) => (
                          <tr
                            key={t.id}
                            onClick={() => act(() => select(t.id))}
                            tabIndex="0"
                            onKeyDown={(e) =>
                              e.key === "Enter" && act(() => select(t.id))
                            }
                          >
                            <td>
                              <small className="ticket-number">
                                {t.number}
                              </small>
                              <strong>{t.title}</strong>
                              <small>
                                {t.category} · {date(t.created_at)}
                              </small>
                            </td>
                            <td>
                              <span
                                className={
                                  "pill status-" + t.status.replaceAll(" ", "-")
                                }
                              >
                                {t.status}
                              </span>
                            </td>
                            <td>
                              <span className={"priority " + t.priority}>
                                <i />
                                {t.priority}
                              </span>
                            </td>
                            {staff && <td>{t.organisation_name}</td>}
                            <td>{t.assignee_name || "Unassigned"}</td>
                            <td>
                              <span className={"sla " + t.sla.state}>
                                <Clock size={13} />
                                {duration(t.sla.remaining)}
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!filtered.length && (
                  <div className="empty">
                    <Ticket size={40} />
                    <h3>No tickets here yet</h3>
                    <p>
                      Create a ticket to start a conversation with your support
                      team.
                    </p>
                    <button className="primary" onClick={() => C(true)}>
                      Create your first ticket
                    </button>
                  </div>
                )}
              </section>
              {!staff && boot.config.modules.knowledgeBase && (
                <section className="card faq">
                  <h3>Help & resources</h3>
                  {boot.config.articles.map((a, i) => (
                    <details key={i}>
                      <summary>{a.title}</summary>
                      <p>{a.body}</p>
                    </details>
                  ))}
                </section>
              )}
            </>
          )}
          <footer>TicketFlow · Client support with accountability</footer>
        </div>
      </main>
    </div>
  );
}
function Login({ onLogin }) {
  const [error, E] = useState(""),
    [busy, B] = useState(false);
  return (
    <div className="login">
      <div className="login-story">
        <div className="brand">
          <LifeBuoy /> TicketFlow
        </div>
        <div>
          <span className="eyebrow">SUPPORT THAT KEEPS ITS PROMISES</span>
          <h1>
            Better conversations.
            <br />
            Clearer commitments.
          </h1>
          <p>
            One place for your clients, your team, and every support request
            that matters.
          </p>
          <div className="login-features">
            <span>
              <CheckCircle /> Package-based SLAs
            </span>
            <span>
              <CheckCircle /> Complete ticket history
            </span>
            <span>
              <CheckCircle /> A shared view of progress
            </span>
          </div>
        </div>
        <small>Built for focused teams. Ready for your infrastructure.</small>
      </div>
      <div className="login-form">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            E("");
            B(true);
            try {
              onLogin(
                await send(
                  "/auth/login",
                  Object.fromEntries(new FormData(e.target)),
                ),
              );
            } catch (e) {
              E(e.message);
            } finally {
              B(false);
            }
          }}
        >
          <div className="brand-icon">
            <LifeBuoy size={30} />
          </div>
          <h2>Welcome back</h2>
          <p>Sign in to your support workspace.</p>
          {error && <div className="alert error">{error}</div>}
          <label>
            Email address
            <input
              name="email"
              type="email"
              placeholder="you@company.com"
              required
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              placeholder="Enter your password"
              required
              autoComplete="current-password"
            />
          </label>
          <label>
            Authenticator code (if enabled)
            <input
              name="otp"
              inputMode="numeric"
              pattern="[0-9]{6}"
              placeholder="Six-digit code"
              autoComplete="one-time-code"
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in to workspace"}{" "}
            <ChevronRight size={17} />
          </button>
          <small>
            Use the accounts created by the seed command.
            <br />
            Your administrator can help with account access.
          </small>
        </form>
      </div>
    </div>
  );
}
function Stat({ title, value, icon: Icon, sub, colour = "" }) {
  return (
    <section className="card stat">
      <div className="row">
        <span>{title}</span>
        <div className={"stat-icon " + colour}>
          <Icon size={20} />
        </div>
      </div>
      <strong>{value}</strong>
      <small>{sub}</small>
    </section>
  );
}
function NewTicket({ boot, user, onCancel, onCreate }) {
  const [files, FF] = useState([]),
    [busy, B] = useState(false);
  return (
    <>
      <button className="back" onClick={onCancel}>
        <ArrowLeft size={16} /> Back to workspace
      </button>
      <div className="page-heading">
        <div>
          <h1>How can we help?</h1>
          <p>Tell us what's happening. We'll take it from here.</p>
        </div>
      </div>
      <form
        className="card form-card"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.target));
          const custom_fields = {};
          boot.config.customFields.forEach((x) => {
            custom_fields[x.name] = f["custom_" + x.name];
            delete f["custom_" + x.name];
          });
          if (f.organisation_id) f.organisation_id = Number(f.organisation_id);
          B(true);
          await onCreate({ ...f, custom_fields });
          B(false);
        }}
      >
        <label>
          Ticket title
          <input
            name="title"
            required
            minLength="3"
            maxLength="200"
            placeholder="A short summary of your issue"
          />
        </label>
        <div className="two-col">
          <label>
            Category
            <select name="category">
              {boot.config.categories.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select name="priority" defaultValue="Medium">
              {["Low", "Medium", "High", "Critical"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        {user.role !== "client" && (
          <label>
            Client organisation
            <select name="organisation_id" required>
              {boot.organisations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Description
          <textarea
            name="description"
            required
            minLength="5"
            rows="7"
            placeholder="What happened? What did you expect? Include any steps that can help us reproduce the issue."
          />
        </label>
        {boot.config.customFields.map((f) => (
          <label key={f.name}>
            {f.label}
            <input name={"custom_" + f.name} />
          </label>
        ))}
        <p className="muted">
          You can add attachments after creating the ticket.
        </p>
        <div className="form-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Creating…" : "Submit ticket"}
            <ChevronRight size={17} />
          </button>
        </div>
      </form>
    </>
  );
}
function TicketDetail({ t, boot, user, act, reload, back }) {
  const staff = user.role !== "client";
  const [body, B] = useState(""),
    [internal, I] = useState(false),
    [busy, BB] = useState(false);
  const update = (b) =>
    act(async () => {
      await send("/tickets/" + t.id, b, "PATCH");
      await reload();
    }, "Ticket updated");
  return (
    <>
      <button className="back" onClick={back}>
        <ArrowLeft size={16} /> All tickets
      </button>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {t.number} · {t.category}
          </div>
          <h1>{t.title}</h1>
          <p>Created {date(t.created_at)}</p>
        </div>
        <span className={"pill status-" + t.status.replaceAll(" ", "-")}>
          {t.status}
        </span>
      </div>
      <div className="detail-grid">
        <div>
          <section className="card conversation">
            <h3>Conversation</h3>
            <div className="message">
              <div className="avatar">
                <Ticket size={18} />
              </div>
              <div>
                <strong>Original request</strong>
                <small>{date(t.created_at)}</small>
                <p>{t.description}</p>
                {Object.entries(t.custom_fields || {}).map(([k, v]) => (
                  <p key={k}>
                    <strong>{k}: </strong>
                    {v}
                  </p>
                ))}
              </div>
            </div>
            {t.comments.map((c) => (
              <div
                key={c.id}
                className={"message " + (c.internal ? "internal" : "")}
              >
                <div className="avatar">{c.author[0]}</div>
                <div>
                  <strong>
                    {c.author}{" "}
                    {c.internal && <span className="pill">Private note</span>}
                  </strong>
                  <small>{date(c.created_at)}</small>
                  <p>{c.body}</p>
                </div>
              </div>
            ))}
          </section>
          <form
            className="card reply"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                BB(true);
                try {
                  await send(`/tickets/${t.id}/comments`, { body, internal });
                  B("");
                  await reload();
                } finally {
                  BB(false);
                }
              }, "Reply added");
            }}
          >
            <div className="row">
              <h3>{internal ? "Internal note" : "Reply to ticket"}</h3>
              {staff && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={internal}
                    onChange={(e) => I(e.target.checked)}
                  />{" "}
                  Private note
                </label>
              )}
            </div>
            {staff && (
              <select
                aria-label="Canned response"
                defaultValue=""
                onChange={(e) => B(e.target.value)}
              >
                <option value="">Insert a saved response…</option>
                {boot.config.templates.map((s, i) => (
                  <option key={i}>{s}</option>
                ))}
              </select>
            )}
            <textarea
              value={body}
              onChange={(e) => B(e.target.value)}
              rows="5"
              required
              placeholder="Write your response…"
            />
            <div className="form-actions">
              <span className="muted">
                {internal
                  ? "Visible only to staff"
                  : "Visible to the client and support team"}
              </span>
              <button
                className="primary"
                disabled={busy || t.status === "Closed"}
              >
                <MessageSquare size={16} /> Send reply
              </button>
            </div>
          </form>
          <section className="card">
            <h3>Activity timeline</h3>
            {t.history.map((h) => (
              <div className="timeline" key={h.id}>
                <i />
                <div>
                  <strong>{h.action}</strong>
                  <small>
                    {h.actor || "System"} · {date(h.created_at)}
                  </small>
                </div>
              </div>
            ))}
          </section>
        </div>
        <div>
          <section className="card detail-side">
            <h3>Ticket details</h3>
            <label>
              Status
              {staff ? (
                <select
                  value={t.status}
                  onChange={(e) => update({ status: e.target.value })}
                >
                  {boot.config.statuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              ) : (
                <strong>{t.status}</strong>
              )}
            </label>
            {["admin", "manager", "lead"].includes(user.role) && (
              <label>
                Assignee
                <select
                  value={t.assignee_id || ""}
                  onChange={(e) =>
                    update({
                      assignee_id: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {boot.users
                    .filter(
                      (u) =>
                        u.role !== "client" && u.role !== "owner" && u.active,
                    )
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Priority
              <strong className={"priority " + t.priority}>{t.priority}</strong>
            </label>
            <div className={"sla-box " + t.sla.state}>
              <Clock size={20} />
              <div>
                <strong>{duration(t.sla.remaining)}</strong>
                <small>
                  {t.status === "Waiting on Client"
                    ? "Timer paused · waiting on client"
                    : t.sla.state.replace("-", " ")}
                </small>
              </div>
            </div>
            <small>
              Response target: {t.response_minutes} business minutes
              <br />
              Resolution target: {t.resolution_minutes} business minutes
            </small>
            {!staff && ["Resolved", "Closed"].includes(t.status) && (
              <>
                <button onClick={() => update({ status: "New" })}>
                  Reopen ticket
                </button>
                <label>
                  Rate your resolution
                  <select
                    value={t.rating || ""}
                    onChange={(e) => update({ rating: Number(e.target.value) })}
                  >
                    <option value="" disabled>
                      Choose a rating
                    </option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} / 5
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </section>
          <section className="card detail-side">
            <h3>Attachments</h3>
            {t.attachments.map((a) => (
              <a
                key={a.id}
                href={"/api/attachments/" + a.id}
                className="attachment"
              >
                <Paperclip size={15} />
                {a.name}
                <small>{Math.round(a.size / 1024)} KB</small>
              </a>
            ))}
            <label className="upload">
              Add attachment
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.txt"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file)
                    act(async () => {
                      const f = new FormData();
                      f.append("file", file);
                      await api("/tickets/" + t.id + "/attachments", {
                        method: "POST",
                        body: f,
                      });
                      await reload();
                    }, "Attachment uploaded");
                }}
              />
            </label>
            <small>PDF, images or text · maximum 10 MB</small>
          </section>
          <section className="card detail-side">
            <h3>Related tickets</h3>
            {t.links.map((l) => (
              <p key={l.id}>
                {l.number} · {l.title}
              </p>
            ))}
            {staff && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.target);
                  act(async () => {
                    await send("/tickets/" + t.id + "/links", {
                      related_id: Number(f.get("id")),
                    });
                    e.target.reset();
                    await reload();
                  });
                }}
              >
                <input
                  name="id"
                  type="number"
                  min="1"
                  required
                  placeholder="Related ticket ID"
                />
                <button>Link ticket</button>
              </form>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
function Reports({ rows }) {
  const [group, G] = useState("organisation");
  const resolved = rows.filter((t) => t.resolved_at);
  const rated = rows.filter((t) => t.rating);
  const avg = (a, k) =>
    a.length
      ? (a.reduce((s, t) => s + Number(t[k] || 0), 0) / a.length).toFixed(1)
      : "—";
  const groups = [...new Set(rows.map((t) => t[group] || "Unassigned"))];
  function csv() {
    const cols = [
      "number",
      "title",
      "organisation",
      "agent",
      "package",
      "priority",
      "status",
      "created_at",
      "responded_at",
      "resolved_at",
      "rating",
    ];
    const cell = (v) =>
      '"' +
      String(v ?? "")
        .replaceAll('"', '""')
        .replace(/^[=+@-]/, "'$&") +
      '"';
    const blob = new Blob(
      [
        "\uFEFF" +
          [
            cols.join(","),
            ...rows.map((t) => cols.map((k) => cell(t[k])).join(",")),
          ].join("\r\n"),
      ],
      { type: "text/csv" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ticketflow-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PERFORMANCE & INSIGHTS</div>
          <h1>Support performance</h1>
          <p>Understand volume, response times, and client satisfaction.</p>
        </div>
        <div className="row">
          <button onClick={csv}>Export CSV</button>
          <button onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </div>
      <div className="stats">
        <Stat
          title="Completed SLA compliance"
          value={
            rows.filter((t) => t.resolved_at).length
              ? Math.round(
                  (rows.filter(
                    (t) =>
                      t.resolved_at &&
                      !t.response_breached &&
                      !t.resolution_breached &&
                      t.responded_at,
                  ).length /
                    rows.filter((t) => t.resolved_at).length) *
                    100,
                ) + "%"
              : "—"
          }
          icon={Shield}
          sub={rows.length + " total tickets"}
        />
        <Stat
          title="Avg. response"
          value={avg(
            rows.filter((t) => t.responded_at),
            "response_wall_minutes",
          )}
          icon={Clock}
          sub="Calendar minutes"
        />
        <Stat
          title="Avg. resolution"
          value={avg(resolved, "resolution_wall_minutes")}
          icon={CheckCircle}
          sub="Calendar minutes"
        />
        <Stat
          title="Client satisfaction"
          value={avg(rated, "rating")}
          icon={MessageSquare}
          sub={`${rated.length} ratings · out of 5`}
        />
      </div>
      <section className="card">
        <div className="card-heading">
          <h3>Performance by group</h3>
          <select value={group} onChange={(e) => G(e.target.value)}>
            {["organisation", "agent", "package", "category"].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Tickets</th>
                <th>Avg response (min)</th>
                <th>Avg resolution (min)</th>
                <th>CSAT</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const a = rows.filter((t) => (t[group] || "Unassigned") === g);
                return (
                  <tr key={g}>
                    <td>{g}</td>
                    <td>{a.length}</td>
                    <td>
                      {avg(
                        a.filter((t) => t.responded_at),
                        "response_wall_minutes",
                      )}
                    </td>
                    <td>
                      {avg(
                        a.filter((t) => t.resolved_at),
                        "resolution_wall_minutes",
                      )}
                    </td>
                    <td>
                      {avg(
                        a.filter((t) => t.rating),
                        "rating",
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h3>Ticket volume · last 14 days</h3>
        <div className="trend">
          {Array.from({ length: 14 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - 13 + i);
            const key = d.toISOString().slice(0, 10),
              n = rows.filter((t) => t.created_at.slice(0, 10) === key).length;
            return (
              <div key={key}>
                <strong>{n}</strong>
                <i style={{ height: Math.max(4, n * 12) + "px" }} />
                <small>{key.slice(5)}</small>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
function Admin({ boot, act, reload }) {
  const [tab, S] = useState("Configuration"),
    [key, K] = useState("branding"),
    [value, V] = useState(JSON.stringify(boot.config.branding, null, 2)),
    [audit, A] = useState([]);
  const save = async (fn) => {
    await fn();
    await reload();
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">INSTALLATION SETTINGS</div>
          <h1>Make it your workspace.</h1>
          <p>Configure the product around your team and client commitments.</p>
        </div>
      </div>
      <div className="tabs">
        {["Configuration", "Packages", "Organisations", "Users", "Audit"].map(
          (t) => (
            <button
              className={tab === t ? "active" : ""}
              key={t}
              onClick={() => {
                S(t);
                if (t === "Audit")
                  act(async () => A(await api("/admin/audit")));
              }}
            >
              {t}
            </button>
          ),
        )}
      </div>
      {tab === "Configuration" && (
        <section className="card form-card">
          <h3>Configuration editor</h3>
          <p className="muted">
            Validated settings apply to new tickets. Existing SLA calendars and
            targets remain snapshotted.
          </p>
          <label>
            Setting
            <select
              value={key}
              onChange={(e) => {
                K(e.target.value);
                V(JSON.stringify(boot.config[e.target.value], null, 2));
              }}
            >
              {Object.keys(boot.config).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            JSON value
            <textarea
              className="code"
              rows="15"
              value={value}
              onChange={(e) => V(e.target.value)}
            />
          </label>
          <button
            className="primary"
            onClick={() =>
              act(
                () =>
                  save(() =>
                    send(
                      "/admin/settings/" + key,
                      { value: JSON.parse(value) },
                      "PUT",
                    ),
                  ),
                "Configuration saved",
              )
            }
          >
            Save configuration
          </button>
        </section>
      )}
      {tab === "Packages" && (
        <>
          <section className="card">
            <h3>Service packages</h3>
            {boot.packages.map((p) => (
              <details key={p.id}>
                <summary>{p.name}</summary>
                <pre>{JSON.stringify(p.targets, null, 2)}</pre>
              </details>
            ))}
          </section>
          <form
            className="card form-card"
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.target));
              act(
                () =>
                  save(() =>
                    send("/admin/packages", {
                      name: f.name,
                      targets: JSON.parse(f.targets),
                    }),
                  ),
                "Package saved",
              );
            }}
          >
            <h3>Create / update package</h3>
            <label>
              Package name
              <input name="name" required />
            </label>
            <label>
              SLA targets in business minutes
              <textarea
                name="targets"
                rows="12"
                defaultValue={JSON.stringify(boot.packages[0].targets, null, 2)}
              />
            </label>
            <button className="primary">Save package</button>
          </form>
        </>
      )}
      {tab === "Organisations" && (
        <>
          <section className="card">
            <h3>Client organisations</h3>
            {boot.organisations.map((o) => (
              <div className="admin-row" key={o.id}>
                <strong>{o.name}</strong>
                <select
                  value={o.package_id}
                  onChange={(e) =>
                    act(
                      () =>
                        save(() =>
                          send(
                            "/admin/organisations/" + o.id,
                            { package_id: Number(e.target.value) },
                            "PATCH",
                          ),
                        ),
                      "Package assigned",
                    )
                  }
                >
                  {boot.packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </section>
          <form
            className="card form-card"
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.target));
              act(
                () =>
                  save(() =>
                    send("/admin/organisations", {
                      name: f.name,
                      package_id: Number(f.package_id),
                    }),
                  ),
                "Organisation created",
              );
            }}
          >
            <h3>Add organisation</h3>
            <label>
              Name
              <input name="name" required />
            </label>
            <label>
              Package
              <select name="package_id">
                {boot.packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary">Add organisation</button>
          </form>
        </>
      )}
      {tab === "Users" && (
        <>
          <section className="card">
            <h3>Workspace users</h3>
            {boot.users.map((u) => (
              <div className="admin-row" key={u.id}>
                <div>
                  <strong>{u.name}</strong>
                  <small>
                    {u.email} · {u.role}
                  </small>
                </div>
                <button
                  onClick={() =>
                    act(() =>
                      save(() =>
                        send(
                          "/admin/users/" + u.id,
                          { active: !u.active },
                          "PATCH",
                        ),
                      ),
                    )
                  }
                >
                  {u.active ? "Deactivate" : "Activate"}
                </button>
              </div>
            ))}
          </section>
          <form
            className="card form-card"
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.target));
              act(
                () =>
                  save(() =>
                    send("/admin/users", {
                      ...f,
                      organisation_id: f.organisation_id
                        ? Number(f.organisation_id)
                        : null,
                    }),
                  ),
                "User created",
              );
            }}
          >
            <h3>Create user</h3>
            <label>
              Name
              <input name="name" required />
            </label>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Initial password
              <input name="password" type="password" minLength="12" required />
            </label>
            <label>
              Role
              <select name="role">
                {["client", "agent", "lead", "manager", "admin", "owner"].map(
                  (r) => (
                    <option key={r}>{r}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Organisation (required for clients)
              <select name="organisation_id">
                <option value="">None</option>
                {boot.organisations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary">Create user</button>
          </form>
        </>
      )}
      {tab === "Audit" && (
        <section className="card">
          <h3>Immutable audit log</h3>
          {audit.map((a) => (
            <div className="admin-row" key={a.id}>
              <div>
                <strong>{a.action}</strong>
                <small>
                  {a.actor || "System"} · {date(a.created_at)} · ticket{" "}
                  {a.ticket_id || "—"}
                </small>
              </div>
              <code>{JSON.stringify(a.details)}</code>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
function Security({ user, act, signOut }) {
  const [enrollment, S] = useState(null);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Account security</h1>
          <p>Manage your password and authenticator protection.</p>
        </div>
      </div>
      <form
        className="card form-card"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            await send(
              "/auth/password",
              Object.fromEntries(new FormData(e.target)),
            );
            signOut();
          });
        }}
      >
        <h3>Change password</h3>
        <label>
          Current password
          <input name="current" type="password" required />
        </label>
        <label>
          New password
          <input name="password" type="password" required minLength="12" />
        </label>
        <button className="primary">Change password and sign out</button>
      </form>
      <section className="card form-card">
        <h3>Two-factor authentication</h3>
        <p>
          Use a TOTP authenticator app. Status:{" "}
          {user.mfa_enabled ? "enabled" : "disabled"}. Store your enrollment
          secret safely; recovery codes are not supplied.
        </p>
        {!user.mfa_enabled && !enrollment && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(async () =>
                S(
                  await send(
                    "/auth/mfa/enroll",
                    Object.fromEntries(new FormData(e.target)),
                  ),
                ),
              );
            }}
          >
            <label>
              Confirm your password
              <input name="password" type="password" required />
            </label>
            <button className="primary">Set up authenticator</button>
          </form>
        )}
        {enrollment && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await send(
                  "/auth/mfa/confirm",
                  Object.fromEntries(new FormData(e.target)),
                );
                signOut();
              });
            }}
          >
            <p>Add this secret to your authenticator app:</p>
            <pre>{enrollment.secret}</pre>
            <label>
              Six-digit code
              <input
                name="otp"
                required
                pattern="[0-9]{6}"
                inputMode="numeric"
              />
            </label>
            <button className="primary">Enable and sign out</button>
          </form>
        )}
        {user.mfa_enabled && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await send(
                  "/auth/mfa/disable",
                  Object.fromEntries(new FormData(e.target)),
                );
                signOut();
              });
            }}
          >
            <label>
              Password
              <input name="password" type="password" required />
            </label>
            <label>
              Authenticator code
              <input name="otp" required pattern="[0-9]{6}" />
            </label>
            <button>Disable and sign out</button>
          </form>
        )}
      </section>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
