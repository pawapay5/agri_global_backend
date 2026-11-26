"""Long-running scheduler for the `pipelines` service on Coolify (no Prefect server needed: flows run in-process).

Runs nightly_all() every day at PIPELINES_DAILY_AT (UTC, default 01:30; Ghana is UTC+0). The nightly flow itself
pulls FX every day, WFP prices on Mondays and weather on the 2nd of the month, then cleans, refreshes aggregates
and asks the ml service to retrain.

On start it also runs a full pass (WFP + weather + all-history aggregates + training) when the database has no
WFP prices yet, so a fresh deployment fills itself. PIPELINES_RUN_ON_START=true forces a full pass on every start;
=false never runs on start.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone

log = logging.getLogger("pipelines.scheduler")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def next_run(now: datetime, at: str) -> datetime:
    """Next occurrence of HH:MM (UTC) strictly after `now` (exported for tests)."""
    hh, mm = (int(x) for x in at.split(":"))
    candidate = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    return candidate if candidate > now else candidate + timedelta(days=1)


def needs_backfill() -> bool:
    from flows.common import db
    with db() as conn, conn.cursor() as cur:
        cur.execute("""SELECT count(*) FROM price_observations o JOIN data_sources s ON s.id = o.source_id
                       WHERE s.code LIKE 'wfp_hdx_%%'""")
        return int(cur.fetchone()[0]) == 0


def run(full: bool) -> None:
    from flows.nightly import nightly_all
    started = time.monotonic()
    try:
        result = nightly_all(full=full)
        log.info("nightly%s finished in %.0fs: %s", " (full)" if full else "", time.monotonic() - started, result)
    except Exception:  # keep the scheduler alive; the failure is also recorded in pipeline_runs
        log.exception("nightly run failed")


def main() -> None:
    at = os.environ.get("PIPELINES_DAILY_AT", "01:30")
    on_start = os.environ.get("PIPELINES_RUN_ON_START", "auto").strip().lower()
    if on_start in ("1", "true", "yes"):
        run(full=True)
    elif on_start == "auto":
        try:
            if needs_backfill():
                log.info("no WFP prices yet: running a full backfill now")
                run(full=True)
        except Exception:
            log.exception("start-up check failed; waiting for the daily run")
    while True:
        due = next_run(datetime.now(timezone.utc), at)
        log.info("next nightly run at %s UTC", due.isoformat(timespec="minutes"))
        time.sleep(max(1.0, (due - datetime.now(timezone.utc)).total_seconds()))
        run(full=False)


if __name__ == "__main__":
    main()
