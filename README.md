# Stand.earth: files for Engaging Networks pages

This repository holds static CSS, JavaScript and HTML files that Stand.earth's Engaging Networks (EN) pages load. GitHub Pages serves them from the `main` branch at:

```
https://standearth.github.io/files/<path>
```

For example, `scroll_v2.js` is served at `https://standearth.github.io/files/scroll_v2.js`.

## Everything here is public

The repository is public, and the files are loaded by public web pages, so anyone can read them. Never commit:

- API keys, passwords or tokens;
- supporter or donor data, exports, or screenshots of donor accounts;
- internal documents or development kits.

## What's in it

| Path | What it is |
|---|---|
| `donor-portal/` | The Donor Portal: a CSS/JS wrapper over EN's Supporter Hub, one versioned file pair per release. See [`donor-portal/README.md`](donor-portal/README.md) for its rules and release steps. |
| `scroll.css`, `scroll.js` | Petition page styles and script (jQuery): the thank-you steps after signing and the share buttons (Facebook, Twitter, WhatsApp). |
| `scroll_eoy.css`, `scroll_eoy.js` | The end-of-year version of the petition files: adds a donation step after signing, with one-time or monthly giving and a donation link chosen by the supporter's country. |
| `scroll_v2.css`, `scroll_v2.js` | The current version of the petition files: adds a Bluesky share and builds the donation link from the EN page's own data (campaign page, appeal code, currency). |
| `tmx_table.html` | A standalone table page for the Un-insuring Trans Mountain (TMX) campaign, styled with stand.earth's site styles. |
| `hub-dashboard.css`, `hub-dashboard.js` | An earlier Supporter Hub dashboard wrapper, replaced by `donor-portal/`. Check that no EN page still loads it before removing it. |
| `index.html` | A placeholder page for the site's root address. |
| `.gitignore` | Keeps Mac `.DS_Store` files out of the repository. |

## Changing files

- **A change to an existing file goes live at once** on every EN page that loads it, as soon as GitHub Pages republishes (usually within a few minutes). Test on a test page first, and keep the previous version so you can roll back.
- **For new work, prefer a new file name per version** (as `donor-portal/` does), so pages can move to it one at a time and rolling back means pointing a page at the previous file.
- **Point EN pages only at `https://standearth.github.io/files/...` addresses.** Never use `raw.githubusercontent.com` links: browsers refuse to run scripts from them.
- **Put each project's files in its own folder** with a short README saying what it is, which pages load it, and how it's released.

---

© Stand.earth. All rights reserved.
