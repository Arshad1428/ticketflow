# REST API

Base path `/api`. Responses are JSON except attachment downloads. Errors: `{ "error": "message" }`. Login sets an HTTP-only `session` cookie; same-origin clients automatically reuse it. State-changing browser requests must match APP_ORIGIN. No public signup.

| Method | Route                    | Permission / request                                                                |
| ------ | ------------------------ | ----------------------------------------------------------------------------------- |
| GET    | /health                  | Database connectivity; public                                                       |
| POST   | /auth/login              | `{email,password,otp?}`                                                             |
| GET    | /auth/me                 | Signed-in user                                                                      |
| POST   | /auth/logout             | Clears session cookie                                                               |
| POST   | /auth/password           | `{current,password}`; new password >=12 characters                                  |
| POST   | /auth/mfa/enroll         | Password confirmation; returns secret for authenticator app                         |
| POST   | /auth/mfa/confirm        | `{otp}`; enables MFA and invalidates sessions                                       |
| POST   | /auth/mfa/disable        | `{password,otp}`; disables MFA and invalidates sessions                             |
| GET    | /bootstrap               | Configuration, packages and permitted organisations; staff users list               |
| GET    | /license                 | Validated installation licence metadata                                             |
| GET    | /tickets                 | Optional `search`, `status`; newest 500 permitted tickets                           |
| POST   | /tickets                 | `{title,description,category,priority,organisation_id?,custom_fields?}`             |
| GET    | /tickets/:id             | Ticket, permitted comments, safe history, attachments and links                     |
| PATCH  | /tickets/:id             | `{status?,assignee_id?,rating?}`; assignment lead/manager/admin; rating client only |
| POST   | /tickets/:id/comments    | `{body,internal?}`; private notes staff only                                        |
| POST   | /tickets/:id/attachments | Multipart `file`; PDF/PNG/JPEG/text, 10 MB                                          |
| GET    | /attachments/:id         | Authenticated organisation-checked download                                         |
| POST   | /tickets/:id/links       | Staff; `{related_id}`; same organisation                                            |
| GET    | /notifications           | Latest 100 personal notifications                                                   |
| POST   | /notifications/read      | Mark personal notifications read                                                    |
| GET    | /reports                 | Staff; detailed data for client-side CSV/PDF/grouped reports                        |
| GET    | /admin/audit             | Admin; latest 500 immutable audit entries                                           |
| PUT    | /admin/settings/:key     | Admin; `{value}`; validated JSON settings                                           |
| POST   | /admin/packages          | Admin; `{name,targets}`; same name updates package                                  |
| POST   | /admin/organisations     | Admin; `{name,package_id}`                                                          |
| PATCH  | /admin/organisations/:id | Admin; `{package_id}`                                                               |
| POST   | /admin/users             | Admin; `{name,email,password,role,organisation_id}`                                 |
| PATCH  | /admin/users/:id         | Admin; `{active?,password?}`; cannot deactivate self                                |
| POST   | /integrations/email      | Secret header; `{messageId,from,subject,text}`                                      |

Client-supplied organisation IDs are ignored for client ticket creation: the authenticated organisation controls ownership. Client access is organisation-wide, so contacts in the same organisation share tickets. Staff have installation-wide access. Owner has staff ticket access and reporting, but assignment and admin configuration remain restricted to the appropriate roles.

Statuses cannot remove the six core states; add custom states through configuration. Closing requires Resolved. Client reopening must use New and fall within the configured window. SLA timers stop for Waiting on Client, Resolved and Closed; other custom states consume business time.

Package target shape:

```json
{
  "name": "Premium",
  "targets": {
    "Critical": { "response": 30, "resolution": 240 },
    "High": { "response": 120, "resolution": 960 },
    "Medium": { "response": 480, "resolution": 2880 },
    "Low": { "response": 960, "resolution": 5760 }
  }
}
```

Use curl cookie jars (`-c session.txt`, `-b session.txt`) for API experiments. Protect cookie files and do not commit them.
