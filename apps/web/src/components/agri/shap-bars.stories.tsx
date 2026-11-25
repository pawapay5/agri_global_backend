import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { sampleShap } from "@/stories/fixtures";
import { ShapBars } from "./shap-bars";

const meta = {
  title: "Agri/ShapBars", component: ShapBars, tags: ["autodocs"],
  args: { features: sampleShap, insight: "Lean-season supply is the main reason prices are expected to rise (sample text)." },
  decorators: [(S) => <div className="max-w-xl rounded-2xl bg-card p-4"><S /></div>],
} satisfies Meta<typeof ShapBars>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
export const NoInsight: Story = { args: { insight: undefined } };
