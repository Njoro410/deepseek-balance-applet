# DeepSeek Balance — Cinnamon applet

Shows your DeepSeek API account balance in the Cinnamon panel as a percentage
or a progress bar, with spend details on hover.

## Install

```sh
./install.sh
```

Then open the Applets dialog (right-click the panel → Applets), find
**DeepSeek Balance**, and add it to the panel. If it doesn't appear, restart
Cinnamon with `Ctrl+Alt+Esc` (or `cinnamon --replace &`).

## Configure

Right-click the applet → **Configure…**

| Option | What it does |
| --- | --- |
| API key | From platform.deepseek.com → API keys |
| Currency | Which balance to show if the account holds more than one |
| Refresh interval | Minutes between balance checks (default 5) |
| Show in panel | Percentage / Bar / Bar + percentage / Balance amount |
| Bar color | The bar's fill color; still turns red below the warning threshold |
| Peak-hours logo | Tint the panel logo while peak-rate hours apply |
| Peak logo color | Color the logo switches to during peak hours |
| Reference amount | The "100%" level — e.g. your last top-up |
| Turn red below | Warning threshold, in % of the reference |

## What it shows

- **Panel** — the DeepSeek logo and the chosen display mode; turns red below
  the warning threshold, and the logo is tinted during peak-rate hours.
- **Hover** — balance, paid/granted breakdown, whether the account can still
  make API calls, peak/off-peak rate and when it flips, percent of reference
  remaining, spend for today / last 7 days / last 30 days, and a rough
  "days left" estimate at the current rate.
- **Click** — a menu with the same summary, "Refresh now", and a link to the
  platform dashboard.

## Where the numbers come from

The only official API-key endpoint is
`GET https://api.deepseek.com/user/balance`, which reports the balance — not
token counts. Spend figures are therefore inferred from balance changes the
applet records over time in `~/.config/deepseek-balance/history.json`:

- only decreases count as spend (top-ups are ignored);
- the paid/granted split describes the *current* balance, not your original
  top-up total — the API doesn't report how much was ever topped up, which is
  why the percentage uses a reference amount you configure;
- coverage is limited to when the applet was running, so long gaps between
  refreshes can slightly under-count;
- token counts are not available from the API — the platform dashboard shows
  them per API key.

## Peak-hour pricing

DeepSeek bills API usage at 2× during peak hours — Monday to Friday,
09:00–12:00 and 14:00–18:00 Beijing time (01:00–04:00 and 06:00–10:00 UTC).
Everything else is off-peak at half price, including weekends. Chinese public
holidays are off-peak too, but the applet can't detect those, so it may show
peak on a holiday. The logo tint and the tooltip's "Peak hours" line follow
this schedule; DeepSeek can change it, so check platform.deepseek.com when in
doubt.

## Development

```sh
node --check deepseek-balance@njoro410/applet.js   # syntax
node test/history-test.js                       # history/spend math
./install.sh                                    # then remove + re-add the applet
```

The applet source of truth is this directory; `install.sh` copies it into
`~/.local/share/cinnamon/applets/`.

## License

GPL-2.0-or-later — see [LICENSE](LICENSE).

Copyright (C) 2026 njoro410

This program is free software; you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation; either version 2 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.
