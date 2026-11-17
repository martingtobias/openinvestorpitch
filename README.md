# Open Investor Pitch

Landing page for [openinvestorpitch.org](https://openinvestorpitch.org).

A nonprofit, still forming, building an open standard so a startup can pitch opted-in investors once — and those investors can contribute pipeline back in the same format. Working short name: OIP.

## Cloudflare Pages

The domain already lives on Cloudflare. Connect this repo:

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git.
2. Repository: `martingtobias/openinvestorpitch`. Production branch: `main`.
3. Build command: leave empty. Build output directory: `/`.
4. Custom domain: `openinvestorpitch.org`.

No build step. `index.html` is the site.

## The list

Join and Sign in store emails in the visitor’s browser (`localStorage`) until an email provider is connected. Nothing is sent to a server.

To hand signups to a provider, set `LIST_ENDPOINT` near the top of the script in `index.html` to a URL that accepts `POST` JSON:

```json
{ "email": "ada@fund.com", "role": "investor", "name": "Ada" }
```

Roles are `founder`, `investor`, and `partner`.
