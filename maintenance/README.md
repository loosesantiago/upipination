# Maintenance page (Cloudflare Worker)

When the PC is off, the site can't answer anything, so this page lives on Cloudflare instead.
`worker.js` sits in front of upipination.com: requests go to the site as usual, and only when the
site doesn't answer (PC off, tunnel down, restarting) visitors get a "en mantenimiento" page that
reloads itself once the site is back. The app's own requests get `503 {"error":"maintenance"}`.

It is **not** deployed by the GitHub auto-deploy. To deploy or update it (from this folder):

```
npx wrangler login     # once; opens the browser to sign in to Cloudflare
npx wrangler deploy
```

To turn it off: Cloudflare dashboard → Workers & Pages → upipination-maintenance → delete
(or remove its routes). The site keeps working without it.

The pirate GIF is embedded in the page, since nothing on the PC can be reached while it's off.
