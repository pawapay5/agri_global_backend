# AgriPrice design system

The source of truth is the code:
- tokens in `apps/web/src/app/globals.css`;
- base components in `apps/web/src/components/ui`;
- domain components in `apps/web/src/components/agri`.

Every component has Storybook stories in light, dark and RTL (`ar`). Run `pnpm --filter @agriprice/web storybook` to browse them, and `build-storybook` then `test:stories` to check them with axe.

## Colour tokens

Every colour does one job. Chart colours were validated with the dataviz palette validator, and text colours were checked for WCAG 2.2 AA contrast.

| Token | Light | Dark | Job | Check |
|---|---|---|---|---|
| `--brand` | #0F5132 | #3BB54A | primary actions, headings | text 9.4:1 / 6.7:1 |
| `--up` / `--down` | #15803D / #DC2626 | #22C55E / #F87171 | price direction text and icons | 5.0:1 / 4.8:1 on card |
| `--up-ink` / `--down-ink` | #166534 / #B91C1C | as `--up`/`--down` | direction text on its own 10% wash (pills, badges) | 6.2:1 / 5.5:1 |
| `--ring` | #15803D | #3BB54A | focus ring | ≥ 3:1 (WCAG 2.2) |
| `--chart-history` | #15803D | #15803D | price history (solid line) | see below |
| `--chart-forecast` | #F59E0B (brand) | #D97706 | forecast (dashed line) and P10–P90 band | see below |
| `--forecast-ink` | #92400E | #FBBF24 | forecast-coloured *text* | 6.3:1 on its wash |
| `--shap-up` / `--shap-down` | #E34948 / #2A78D6 | #E66767 / #3987E5 | SHAP drivers that raise or lower the forecast (diverging, warm/cool) | the reference diverging pair |
| `--heat-1…5` | #22C55E → #0F3F22 | #15803D → #86EFAC | heatmap price levels, low to high | ordinal checks pass |

### Validator results (`validate_palette.js`)

- **History vs forecast, light** (`#15803d,#f59e0b` on #fff):
  - lightness band: PASS;
  - colour-blind separation: PASS, worst case ΔE 17.4 (protanopia; target ≥ 8);
  - normal-vision separation: PASS, ΔE 31.0;
  - contrast: WARN, the orange is 2.15:1.

  The method's *relief rule* applies: every forecast line carries a direct label in text ink, and every chart has a table view.
- **History vs forecast, dark** (`#15803d,#d97706` on #0f1a14):
  - lightness band: PASS;
  - contrast: PASS;
  - colour-blind separation: ΔE 6.5, in the 6–8 band that is legal only with secondary encoding.

  The forecast always has secondary encoding: a dashed line, a position after the "Today" divider, and a direct label.
- **Why not the raw brand pair** (`#3bb54a,#f59e0b`): ΔE 2.7 under protanopia, a FAIL. Red-green colour-blind readers couldn't tell history from forecast.
- **Heatmap ramps:** both pass the ordinal checks (monotone lightness, step gap ≥ 0.06, light end ≥ 2:1 on the surface, one hue). In dark mode the ramp is anchored the other way round: low prices sit nearest the surface.

## Rules every component follows

- **Numbers come from the API's display fields.** Components format them with `Intl` (`src/lib/format.ts`) and never compute, convert or invent them. Missing values render "—", never 0.
- **Direction is never colour alone:** an arrow, a sign and screen-reader text ("up +4.2% vs 7d").
- **Charts:**
  - 2 px lines, hairline grid, end dots with a 2 px surface ring;
  - a legend for 2 or more series, plus a direct label on the forecast;
  - a crosshair tooltip that also works from the keyboard (←/→/Home/End/Esc, announced in a live region);
  - an `aria-describedby` summary with the real low, high and latest values;
  - a "View as table" twin.
- **No chart library on public pages.** The charts are hand-built SVG with no dependencies. Recharts remains only in the signed-in market comparison, and MapLibre loads only where a map is shown.
- **Not enough data:** `EmptyState` lists the API's own reason codes in plain language. A horizon the API marks unavailable is skipped, never drawn as a guess.
- **Freshness:** `DataFreshness` shows "Updated … ago", with the absolute UTC time in the tooltip, next to prices and forecasts. Sources appear only when the API reports them (see the open contract question below).
- **RTL:**
  - layout uses logical properties (`ms-`, `start-`, `text-start`);
  - direction arrows mirror;
  - `RangeTabs` arrow keys follow reading direction.
- **Reduced motion:** there are no essential animations, and `prefers-reduced-motion` disables transitions globally.
- **Forced colours:** chart strokes switch to `CanvasText`, and the dash pattern keeps the two series distinct.

## Components (`src/components/agri`)

| Component | Notes |
|---|---|
| PriceCell | price and unit from the display fields; proportional figures at `lg`, tabular figures in tables |
| ChangeBadge | `upIsGood` for buyer views; inline or pill |
| StatCard | label, value, delta vs a named period, and a 12-point trend in the de-emphasis hue with an accented latest point |
| CommodityAvatar | catalogue image via `next/image`, or initials |
| RangeTabs | WAI-ARIA radiogroup with a roving tabindex |
| PriceChart / ForecastChart | shared `TimeSeriesChart` SVG engine, plus `ChartTable` |
| ShapBars | diverging bars from a centre baseline; the list is its own table view |
| MarketMap | MapLibre with the free OpenFreeMap style; markers are buttons, and the list below is the accessible equivalent. Load it with `next/dynamic` |
| RegionHeatmap | SVG choropleth from region GeoJSON with no map library; 5 bins with a legend in display units; "No data" regions are neutral; table twin |
| InsightCard, EmptyState, DataFreshness | text from the API |
| AlertForm | React Hook Form and zod with inline errors; the outcome goes to the app-wide feedback dialog |
| CurrencyUnitSwitcher | `?currency=&unit=` in the URL plus a local preference; the API converts |
| LocaleSwitcher | each language named in itself; keeps the path and query |

## Public-page JavaScript (measured, gzipped, production build)

| Page | Before step 2 | After |
|---|---|---|
| `/en` landing | 205 KB* | 191 KB |
| `/en/gh/prices` | 205 KB* | 191 KB |
| `/en/gh/prices/{commodity}` | 343 KB | 205 KB |

\* Mid-step the landing page reached 230 KB: the feedback dialog added Radix to every page until providers moved out of the root layout.

Where the KB go on `/en`:
- **Framework, about 150 KB:** React DOM, Next's App Router and segment cache, and the React runtime. No page can go below it.
- **Ours, about 40 KB:** next-intl, theme, icons, the header and the chart engine.

**What changed:**
- No chart library on public pages.
- TanStack Query, nuqs and the feedback dialog load only in the auth and signed-in layouts (`components/app-providers.tsx`, a separate module because Next ships a client module whole).

**Open:** a total budget of 150 KB is below the Next 16 framework floor. A realistic gate is **framework + ≤ 50 KB first-party** per public page, enforced in CI.

## Open questions

1. **Data source attribution.** The contract has no source field on `MarketPrice`, `PriceHistory`, `Forecast` or `Choropleth`, so "Source: …" can't be shown yet. Proposal: add an optional `sources: [{ code, name }]` to those schemas, filled from `data_sources`.
2. **Arabic catalogue.** `ar.json` doesn't exist yet. The RTL stories check layout, mirroring and Arabic number formatting, with English text.
3. **JS budget definition.** See above: a total of 150 KB isn't achievable on Next 16; framework + ≤ 50 KB first-party is proposed.
