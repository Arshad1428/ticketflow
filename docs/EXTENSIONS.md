# Architecture and extensions

React renders the client portal, staff queue, detail view, reports and administration. Vite proxies API traffic in development; Express serves the production build. Express enforces all permissions independently of the UI. PostgreSQL stores accounts, organisations, packages, SLA snapshots, comments, metadata, audit records, alerts and mail jobs. File bytes live in a persistent private upload volume and are downloaded only after access checks.

A worker in the Node process runs every 30 seconds. A PostgreSQL advisory lock prevents duplicate SLA processing across multiple app processes. Ticket state and elapsed business time are persisted transactionally. While Waiting on Client, ticks do not accrue time; a client reply or staff transition resumes from the current timestamp. The mail queue uses locked rows and retries after failures. Keeping work in PostgreSQL avoids requiring Redis for this installable release.

## Customer modules

Create separate files under `server/src/modules/`, import them into the registry in `index.js`, and register objects with a unique `name` and optional `ticketCreated` hook:

```js
export default {
  name: "customRouting",
  async ticketCreated({ client, ticket, user, config }) {
    // Validate custom data or perform parameterized SQL through client.
    // A thrown error rolls back the ticket transaction.
    // Enqueue external work instead of sending HTTP requests in the transaction.
  },
};
```

Enable the matching flag in configuration; licensed installations must include it in the signed licence's module list. Keep per-customer files out of core ticket/auth/SLA code. Custom-field definitions (`[{name,label}]`) create client form fields; values are stored as ticket JSON and displayed in details. The supplied hook is a starting extension point, not a full marketplace plugin platform.

## Database changes

Add a new numbered SQL file under migrations; never rewrite migrations already applied to customers. `npm run migrate` applies new files in sorted order under a transaction and advisory lock. Keep backwards-compatible changes where possible, back up before upgrading, and test on a restored copy before rollout.

## Licensing

Generate issuer keys with `node scripts/license.mjs keygen`, then issue a key using `node scripts/license.mjs issue customer-a 2027-10-06 100`. Keep the private issuer key outside the deployment. Set LICENSE_PUBLIC_KEY to the public PEM with `\n` escapes, LICENSE_KEY to the emitted signed token, INSTALLATION_ID to the exact issued ID and LICENSE_REQUIRED=true. Expiry and installation binding validate at startup; user creation/reactivation respects active-user limits, and enabling modules respects the signed entitlements. The worker rechecks the licence. Development mode is explicit and should not be used commercially.
