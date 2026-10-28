# Stand.earth Donor Portal: hosted files

This folder holds the published files for the Stand.earth Donor Portal, a CSS and JavaScript wrapper over Engaging Networks' (EN) Supporter Hub. EN's Hub page template on act.stand.earth loads them. Donors get a dashboard in Stand's design, while EN still signs them in, stores every record and makes every change.

GitHub Pages serves the files at:

```
https://standearth.github.io/files/donor-portal/stand-hub-<version>.css
https://standearth.github.io/files/donor-portal/stand-hub-<version>.js
```

## What the code does, and doesn't do

- It reads the same-origin data EN's own Hub script loads, shows it, and presses EN's own buttons. EN validates and records every change, after the donor confirms it.
- It sends data nowhere but EN: no analytics of its own, no third-party services, no ENS API, no API keys.
- Card fields stay in EN's secure (VGS) frames; the wrapper never reads or fills them.
- It never shows or logs transaction, supporter or gift IDs. Debug logs carry field names and counts only.
- If it fails to load, EN's own Hub shows instead.

## Rules for this folder

- **One file name per version; never overwrite or edit a published file.** Every change ships as a new pair, e.g. `stand-hub-1.4.2.css` and `.js`.
- **Keep old versions.** Rolling back means pasting the previous version's template blocks into EN, which only works if those files are still here.
- **Point EN only at `standearth.github.io` URLs with a version number.** Never use `raw.githubusercontent.com` (browsers refuse to run it) or a branch URL (every commit would go live).
- **Only the two release files belong here.** This repo is public, and these files are loaded by a public page, so anyone can read them. Never commit keys, donor data, exports, screenshots of donor accounts, or the development kit.

## Releasing a new version

The readable source, the build script and the automated checks live in the development kit, outside this repo.

1. In the kit, set the version in `build.py`, run `python3 build.py`, then `node test/run.js`. All checks must pass.
2. Review the changes, then commit the two new files from `dist/` to this folder and push.
3. Open both file URLs in a browser to check they load.
4. Paste the two template blocks from `dist/` (`stand-hub-HTML-HEADER.html` and `-FOOTER.html`) into the EN template of the test Hub page, then test.
5. After sign-off, paste the same blocks into the live Hub's template, keeping a copy of the previous template for rollback.
6. Add a line to the version list below.

## Troubleshooting on a Hub page

- Add `?standhub=debug` to the page URL and open the browser console (filter on `[StandHub]`). Each step logs a line with names and counts only, never personal data.
- Add `?standhub=off` to see EN's original Hub without the wrapper.

## Settings that live in EN, not here

**Yearly giving statement.** The text of the printable statement for US donors is an EN code block on the Hub's page 2, inside `<div id="sh-statement" style="display:none">`. Staff can edit the wording in EN without a new release; keep the `id`, the `style` and the two horizontal lines. The first line divides the header from the body, and the last line divides the body from the footer. The wrapper fills in these placeholders:

| Placeholder | Becomes |
|---|---|
| `{date}` | Today's date |
| `{year}` | The year chosen in Giving history |
| `{first_name}` | The donor's first name ("friend" if EN has none) |
| `{donor_address}` | On its own line: full name and mailing address |
| `{gift_count}` | "1 gift" or "12 gifts" |
| `{total}` | The year's USD total, e.g. US$600.00 |
| `{gifts}` | On its own line: the year's USD gifts and a total row |

A misspelt placeholder stays visible as typed, so it shows up in the print preview.

**Other copy** (welcome text, sign-in and sign-out messages, preferences labels) is set in EN's admin as usual.

## Versions

| Version | Date | Main changes |
|---|---|---|
| 1.4.1 | Oct 2026 | Upgrade offer by gift size (20% up to $25, 15% under $40, 10% from $40, rounded up); "Give a little more" link on gift cards; "Print or save as PDF" yearly statement for US donors |
| 1.4.0 | Oct 2026 | First hosted release: wrapper files moved from inline template blocks to this folder |

---

© Stand.earth. All rights reserved.
