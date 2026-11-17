# Open Investor Pitch

Landing page for [openinvestorpitch.org](https://openinvestorpitch.org).

A nonprofit, still forming. A founder pitches once. Investors and partners use the same format to find the right match, or to pass a company on. Free. No account yet.

## Hosting

This is a **Cloudflare Worker**, not a Pages project. Do not create a Pages project.

`worker.js` serves `index.html` and writes signups to D1 (`DB`). The admin list is `/admin`.

1. On the existing Worker, add a D1 database with the binding name `DB`. Do not create a Pages project.
2. Set the Worker secret `ADMIN_PASSWORD`. `/admin` uses it.
3. Deploy this directory with Wrangler onto that same Worker, and keep `openinvestorpitch.org` on it.

`wrangler.jsonc` binds that database as `DB` (`openinvestorpitch`, id `f2a5693d-d9d1-41ba-9855-464f6aee6ce7`). A deploy that omits the binding will drop it.

`POST /api/join` with `{ "email": "ada@fund.com" }` inserts one row. The page does not store the address in the browser. The list is at `/admin`.

