# Country packs

Everything country-specific lives here and is loaded into the database by the seeder
(`pnpm db:seed gh`). Code never hard-codes a country.

```
_global/reference.yaml  shared reference data: currencies, units, categories, commodity
                        catalogue, export requirements by destination
<iso2>/
  country.yaml      currency, locales, units, timezone, phone prefix, admin levels, brand
  regions.yaml      admin regions (level 1..n). Polygons go in regions.geojson (optional, see below)
  markets.yaml      markets with coordinates, type and operating days
  commodities.yaml  which global commodities are tracked, plus local names, unit conversions, crop calendars
  sources.yaml      upstream price/FX data sources and their trust weights
  advice.yaml       weather → farming advice rules
  templates.yaml    notification templates per locale/channel
```

## Adding a country
1. Copy `gh/` to `<iso2>/` and edit every file. Use codes from `_global/` for commodities and units.
2. Add polygons: download ADM1 from geoBoundaries (CC BY 4.0) as `regions.geojson`. The seeder
   matches each feature's `shapeISO` (or `code`) property to `regions.yaml` `iso` / `code`.
3. Run `pnpm db:seed <iso2>`, then set `active: true` in `country.yaml` and seed again.

Seeding is idempotent (it upserts on natural keys).

## Data quality notes for `gh`
- Market coordinates are town or market-centre approximations, good enough for distance ranking.
  Enumerators should confirm them before the coordinates are used for routing.
- Local-unit kg factors (olonka, crate, bunch, tuber) are typical values. They vary by market
  and season, so refine them per market as enumerator data comes in.
- No FX rates or prices are seeded. They come from the real sources in `sources.yaml` through the pipelines.
