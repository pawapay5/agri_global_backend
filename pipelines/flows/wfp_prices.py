"""WFP VAM market prices (HDX) → AgriPrice CSV import.

Rows are mapped to our market/commodity/unit codes through the country pack aliases and the
source's unit_map, then posted to /v1/admin/prices/import so they go through the same
validation, normalisation and rolling-MAD outlier checks as every other source.
Unmapped rows are counted and reported, never guessed.
"""

from __future__ import annotations

import csv
import io
import re
from collections import Counter

from prefect import flow, get_run_logger, task

from .common import API, api_token, db, http, run_log

HDX_API = "https://data.humdata.org/api/3/action/package_show"
OUT_COLUMNS = ["observed_at", "market_code", "commodity_code", "price_type", "amount", "currency", "unit", "source_ref"]


def _norm(s: str) -> str:
    return " ".join(s.strip().lower().split())


_N_KG = re.compile(r"(\d+(?:\.\d+)?)\s*kg", re.I)
_N_COUNT = re.compile(r"(\d+)\s*(pcs|pieces?|units?|tubers?)", re.I)


def unit_and_divisor(raw: str, unit_map: dict[str, str]) -> tuple[str | None, float]:
    """WFP unit string → (our unit code, divisor for the price). Explicit unit_map entries win. Otherwise a stated
    weight ("93 KG") becomes a per-kg price and a stated count ("100 Tubers", "30 pcs") a per-tuber/per-piece price:
    exact conversions from what WFP states, never an assumed bag size."""
    raw = raw.strip()
    if raw in unit_map:
        return unit_map[raw], 1.0
    m = _N_KG.fullmatch(raw)
    if m and float(m.group(1)) > 0:
        return "kg", float(m.group(1))
    m = _N_COUNT.fullmatch(raw)
    if m and int(m.group(1)) > 0:
        return ("tuber" if m.group(2).lower().startswith("tuber") else "piece"), float(m.group(1))
    return None, 1.0


def transform(rows: list[dict], markets: dict[str, str], commodities: dict[str, str], unit_map: dict[str, str],
              price_type_map: dict[str, str], since: str | None = None) -> tuple[list[dict], Counter]:
    """Pure mapping step (unit-tested). Returns importable rows and skip reasons."""
    out, skipped = [], Counter()
    for r in rows:
        if r.get("date", "").startswith("#"):  # HXL hashtag row
            continue
        if since and r["date"] < since:
            skipped["before_since"] += 1
            continue
        if (r.get("priceflag") or "actual").lower() not in ("actual", "aggregate"):
            skipped["not_actual"] += 1
            continue
        m = markets.get(_norm(r.get("market", "")))
        c = commodities.get(_norm(r.get("commodity", "")))
        u, per = unit_and_divisor(r.get("unit", ""), unit_map)
        pt = price_type_map.get(r.get("pricetype", "").strip())
        if not m: skipped["unmapped_market"] += 1; continue
        if not c: skipped["unmapped_commodity"] += 1; continue
        if not u: skipped["unmapped_unit"] += 1; continue
        if not pt: skipped["unmapped_price_type"] += 1; continue
        try:
            price = float(r["price"]) / per
        except (KeyError, ValueError):
            skipped["bad_price"] += 1; continue
        if price <= 0:
            skipped["bad_price"] += 1; continue
        ref = f"wfp:{r['date']}:{_norm(r['market'])}:{_norm(r['commodity'])}:{r['unit'].strip()}:{pt}"
        out.append({"observed_at": f"{r['date']}T12:00:00Z", "market_code": m, "commodity_code": c, "price_type": pt,
                    "amount": f"{price:.4f}", "currency": r["currency"].strip().upper(), "unit": u, "source_ref": ref})
    return out, skipped


@task(retries=3, retry_delay_seconds=120)
def download(package_id: str) -> list[dict]:
    with http() as c:
        meta = c.get(HDX_API, params={"id": package_id}).raise_for_status().json()
        res = next((x for x in meta["result"]["resources"] if x.get("format", "").upper() == "CSV" and "food_prices" in x.get("name", "").lower()),
                   None) or next(x for x in meta["result"]["resources"] if x.get("format", "").upper() == "CSV")
        body = c.get(res["url"]).raise_for_status().text
    return list(csv.DictReader(io.StringIO(body)))


@flow(name="wfp-prices")
def wfp_prices(country: str = "GH", source_code: str = "wfp_hdx_gh", since: str | None = None, dry_run: bool = False) -> dict:
    log = get_run_logger()
    with run_log("wfp-prices", country) as stats:
        with db() as conn, conn.cursor() as cur:
            cur.execute("SELECT id, config FROM data_sources WHERE code = %s AND active", (source_code,))
            src_id, cfg = cur.fetchone()
            cur.execute("SELECT code, aliases, name->>'en' FROM markets WHERE country_iso2 = %s AND active", (country,))
            markets = {}
            for code, aliases, name in cur.fetchall():
                for a in [*aliases, name, code]:
                    if a: markets[_norm(a)] = code
            cur.execute("""SELECT c.code, p.aliases, c.name->>'en' FROM commodity_country_profiles p JOIN commodities c ON c.id = p.commodity_id
                           WHERE p.country_iso2 = %s AND p.tracked""", (country,))
            commodities = {}
            for code, aliases, name in cur.fetchall():
                for a in [*aliases, name]:
                    if a: commodities[_norm(a)] = code
            if since is None:
                cur.execute("SELECT to_char(max(observed_at) - interval '45 days', 'YYYY-MM-DD') FROM price_observations WHERE source_id = %s", (src_id,))
                since = cur.fetchone()[0]

        raw = download(cfg["hdx_package_id"])
        rows, skipped = transform(raw, markets, commodities, cfg.get("unit_map", {}), cfg.get("price_type_map", {}), since)
        stats.update(downloaded=len(raw), mapped=len(rows), skipped=dict(skipped), since=since)
        log.info("WFP %s: %d rows mapped, skipped %s", country, len(rows), dict(skipped))
        if not rows:
            return stats

        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=OUT_COLUMNS)
        w.writeheader()
        w.writerows(rows)
        with http() as c:
            token = api_token(c)
            # The API caps one import at 50k rows.
            r = c.post(f"{API}/v1/admin/prices/import", headers={"Authorization": f"Bearer {token}"},
                       data={"country": country, "source_id": str(src_id), "dry_run": str(dry_run).lower()},
                       files={"file": ("wfp.csv", buf.getvalue().encode(), "text/csv")}, timeout=600)
            r.raise_for_status()
            report = r.json()
        stats.update(import_report={k: report[k] for k in ("batchId", "accepted", "flagged", "rejected", "totalRows")})
        return stats


if __name__ == "__main__":
    wfp_prices()
