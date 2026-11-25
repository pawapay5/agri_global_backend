import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { RangeTabs } from "./range-tabs";

const RANGES = [{ value: "1M", label: "1M" }, { value: "3M", label: "3M" }, { value: "6M", label: "6M" }, { value: "1Y", label: "1Y" }] as const;
type R = (typeof RANGES)[number]["value"];

function Demo({ size }: { size?: "sm" | "md" }) {
  const [v, setV] = useState<R>("3M");
  return <RangeTabs label="Range" value={v} onChange={setV} options={RANGES} size={size} />;
}

const meta = { title: "Agri/RangeTabs", component: Demo, tags: ["autodocs"] } satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Tab in, then use the arrow keys (they follow reading direction in RTL), Home and End. */
export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
export const Small: Story = { args: { size: "sm" } };
