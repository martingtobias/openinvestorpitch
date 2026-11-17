# Open Investor Pitch

Landing page for [openinvestorpitch.org](https://openinvestorpitch.org).

A nonprofit, still forming. A founder pitches once. Investors and partners use the same format to find the right match, or to pass a company on. Free. No account yet.

## Hosting

This is a **Cloudflare Worker**, not a Pages project. Do not create a Pages project.

`worker.js` serves `index.html` and writes signups to D1 (`DB`). The admin list is `/admin`.

1. On the existing Worker, add a D1 database with the binding name `DB`. Do not create a Pages project.
2. Set the Worker secret `ADMIN_PASSWORD`. `/admin` uses it.
3. Deploy this directory with Wrangler onto that same Worker, and keep `openinvestorpitch.org` on it.

Do not put the D1 id in this repo until the database exists. A deploy that omits the `DB` binding will drop it, so add the binding in `wrangler.jsonc` before you deploy:

```jsonc
"d1_databases": [{ "binding": "DB", "database_name": "openinvestorpitch", "database_id": "<id>" }]
```

`POST /api/join` with `{ "email": "ada@fund.com" }` inserts one row. The page does not store the address in the browser. The list is at `/admin`.

