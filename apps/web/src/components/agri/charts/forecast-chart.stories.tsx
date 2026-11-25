import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NOW, sampleHistory, sampleHorizons } from "@/stories/fixtures";
import { ForecastChart } from "./forecast-chart";

const history = sampleHistory(26);
const last = Number(history[history.length - 1]!.avg);

const meta = {
  title: "Agri/Charts/ForecastChart", component: ForecastChart, tags: ["autodocs"],
  args: { history, horizons: sampleHorizons(last), currency: "GHS", unit: "kg", title: "Tomato forecast, Kumasi Central (sample data)", today: NOW },
  decorators: [(S) => <div className="max-w-3xl rounded-2xl bg-card p-4"><S /></div>],
} satisfies Meta<typeof ForecastChart>;
export default meta;
type Story = StoryObj<typeof meta>;

/** History solid green, forecast dashed orange with its P10 to P90 band, and a Today divider. */
export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
/** A horizon the API marks unavailable is skipped, never drawn as a guess. */
export const PartlyUnavailable: Story = {
  args: { horizons: sampleHorizons(last).map((h, i) => (i === 2 ? { ...h, status: "insufficient_data", p10: null, p50: null, p90: null } : h)) },
};
