import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { sampleRegionsGeo, sampleRegionValues } from "@/stories/fixtures";
import { RegionHeatmap } from "./region-heatmap";

const meta = {
  title: "Agri/RegionHeatmap", component: RegionHeatmap, tags: ["autodocs"],
  args: { geojson: sampleRegionsGeo, values: sampleRegionValues, currency: "GHS", unit: "kg", title: "Average tomato price by region (sample data)" },
  decorators: [(S) => <div className="max-w-md rounded-2xl bg-card p-4"><S /></div>],
} satisfies Meta<typeof RegionHeatmap>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Tab through the regions to read each value; the centre region has no data and says so. */
export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
