from datetime import datetime, timezone

from scheduler import next_run


def test_next_run_later_today():
    now = datetime(2026, 11, 26, 0, 10, tzinfo=timezone.utc)
    assert next_run(now, "01:30") == datetime(2026, 11, 26, 1, 30, tzinfo=timezone.utc)


def test_next_run_rolls_to_tomorrow_when_passed_or_exact():
    assert next_run(datetime(2026, 11, 26, 9, 0, tzinfo=timezone.utc), "01:30") == datetime(2026, 11, 27, 1, 30, tzinfo=timezone.utc)
    assert next_run(datetime(2026, 11, 26, 1, 30, tzinfo=timezone.utc), "01:30") == datetime(2026, 11, 27, 1, 30, tzinfo=timezone.utc)
