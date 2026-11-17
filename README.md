# Open Investor Pitch

Landing page for [openinvestorpitch.org](https://openinvestorpitch.org).

A nonprofit, still forming, building an open standard so a startup can pitch opted-in investors once — and those investors can contribute pipeline back in the same format. Working short name: OIP.

## Hosting

This is a **Cloudflare Worker**, not a Pages project. The Worker serves `index.html` and `favicon.svg` for `openinvestorpitch.org`. Do not create a Pages project for this repo.

The signup list will be **D1 on this same Worker** (`DB` binding). There is no Pages project to bind, and the site does not need to move to Fly.

## The list

Join currently stores emails in the visitor’s browser (`localStorage`). Nothing is sent to a server yet. Sign-in is going away. The form will `POST` a row the admin can read.
