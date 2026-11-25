// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOW, sampleHistory, sampleHorizons, sampleShap } from "@/stories/fixtures";
import { renderWithIntl } from "@/test/render";
import { AlertForm } from "./alert-form";
import { ChangeBadge } from "./change-badge";
import { ForecastChart } from "./charts/forecast-chart";
import { PriceChart } from "./charts/price-chart";
import { DataFreshness } from "./data-freshness";
import { EmptyState } from "./empty-state";
import { RangeTabs } from "./range-tabs";
import { ShapBars } from "./shap-bars";

afterEach(cleanup);

describe("ChangeBadge", () => {
  it("says the direction in words, not just colour", () => {
    renderWithIntl(<ChangeBadge value={4.2} period="7d" />);
    expect(screen.getByText("up +4.2% vs 7d")).toBeTruthy();
  });
  it("speaks a fall without a double minus", () => {
    renderWithIntl(<ChangeBadge value={-3} />);
    expect(screen.getByText("down 3.0%")).toBeTruthy();
  });
  it("shows a dash, never 0%, when there is no value", () => {
    renderWithIntl(<ChangeBadge value={null} />);
    expect(screen.getByText("No change data")).toBeTruthy();
  });
});

describe("RangeTabs", () => {
  function Demo() {
    const [v, setV] = useState<"1M" | "3M" | "6M">("3M");
    return <RangeTabs label="Range" value={v} onChange={setV} options={[{ value: "1M", label: "1M" }, { value: "3M", label: "3M" }, { value: "6M", label: "6M" }]} />;
  }
  it("uses a roving tabindex and moves selection with the arrow keys", async () => {
    renderWithIntl(<Demo />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    radios[1]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "6M" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("radio", { name: "1M" }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "1M" }));
  });
});

describe("PriceChart / ForecastChart", () => {
  const history = sampleHistory(10);
  const values = history.map((p) => Number(p.avg));

  it("describes the series for screen readers with real low/high/latest", () => {
    renderWithIntl(<PriceChart history={history} currency="GHS" unit="kg" title="Tomato" />);
    const fmt = (n: number) => `GHS ${n.toFixed(2)}`;
    const summary = screen.getByText((t) => t.startsWith("Tomato,"));
    expect(summary.textContent).toContain(`low ${fmt(Math.min(...values))}`);
    expect(summary.textContent).toContain(`high ${fmt(Math.max(...values))}`);
    expect(summary.textContent).toContain(`latest ${fmt(values[values.length - 1]!)}`);
    expect(screen.queryByText("Forecast")).toBeNull();
  });

  it("has a table view with every point", async () => {
    renderWithIntl(<PriceChart history={history} currency="GHS" unit="kg" title="Tomato" />);
    await userEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(screen.getAllByRole("row")).toHaveLength(history.length + 1);
  });

  it("reads points from the keyboard", () => {
    renderWithIntl(<PriceChart history={history} currency="GHS" unit="kg" title="Tomato" />);
    const chart = screen.getByRole("group", { name: "Tomato" });
    fireEvent.keyDown(chart, { key: "End" });
    expect(document.querySelector("[aria-live]")?.textContent).toContain(`Actual GHS ${values[values.length - 1]!.toFixed(2)}`);
  });

  it("draws the forecast and skips horizons the API marks unavailable", async () => {
    const horizons = sampleHorizons(15).map((h, i) => (i === 2 ? { ...h, status: "insufficient_data", p10: null, p50: null, p90: null } : h));
    renderWithIntl(<ForecastChart history={history} horizons={horizons} currency="GHS" unit="kg" title="Tomato" today={NOW} />);
    expect(screen.getAllByText("Forecast").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "View as table" }));
    // history rows + 2 available horizons + header (the last actual row doubles as the forecast start)
    expect(screen.getAllByRole("row")).toHaveLength(history.length + 2 + 1);
  });

  it("says there is no data instead of drawing an empty frame", () => {
    renderWithIntl(<PriceChart history={[]} currency="GHS" unit="kg" title="Tomato" />);
    expect(screen.getByText("No price data for this period.")).toBeTruthy();
  });
});

describe("ShapBars", () => {
  it("names each driver's direction and share", () => {
    renderWithIntl(<ShapBars features={sampleShap} />);
    expect(screen.getByLabelText("is lean season: Raises the forecast, Share of impact 31%")).toBeTruthy();
    expect(screen.getByLabelText("rain anomaly: Lowers the forecast, Share of impact 22%")).toBeTruthy();
  });
});

describe("DataFreshness", () => {
  it("shows relative time with the absolute time in the tooltip, and sources only when given", () => {
    const at = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const { rerender } = renderWithIntl(<DataFreshness at={at} sources={["WFP"]} />);
    expect(screen.getByText("Updated 2 hours ago").getAttribute("title")).toMatch(/UTC/);
    expect(screen.getByText("Source: WFP")).toBeTruthy();
    rerender(<DataFreshness at={at} />);
    expect(screen.queryByText(/Source/)).toBeNull();
  });
  it("renders nothing without a timestamp", () => {
    const { container } = renderWithIntl(<DataFreshness at={null} />);
    expect(container.textContent).toBe("");
  });
});

describe("EmptyState", () => {
  it("explains API reason codes in plain language and keeps unknown codes visible", () => {
    renderWithIntl(<EmptyState reasons={["insufficient_history", "new_code_x"]} />);
    expect(screen.queryByText("insufficient_history")).toBeNull();
    expect(screen.getByText("new code x")).toBeTruthy();
  });
});

describe("AlertForm", () => {
  const props = { commodities: [{ id: "c1", label: "Tomato" }], markets: [{ id: "m1", label: "Kumasi" }] };

  it("shows inline errors and doesn't submit when invalid", async () => {
    const onSubmit = vi.fn();
    renderWithIntl(<AlertForm {...props} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Create alert" }));
    await waitFor(() => expect(screen.getAllByText("Choose a commodity").length).toBeGreaterThan(1));
    expect(screen.getByText("Enter a number with up to 2 decimals")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits typed values", async () => {
    const onSubmit = vi.fn();
    renderWithIntl(<AlertForm {...props} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Commodity"), "c1");
    await userEvent.type(screen.getByLabelText(/Threshold/), "12.50");
    await userEvent.click(screen.getByRole("button", { name: "Create alert" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ commodityId: "c1", condition: "below", threshold: "12.50", channels: ["in_app", "push"] });
  });
});
