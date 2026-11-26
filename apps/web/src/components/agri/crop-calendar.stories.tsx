import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CropCalendar } from "./crop-calendar";

const meta = {
  title: "Agri/CropCalendar", component: CropCalendar, tags: ["autodocs"],
  args: { plantingMonths: [3, 4, 9], harvestMonths: [6, 7, 12], leanMonths: [1, 2] },
  decorators: [(S) => <div className="max-w-md"><S /></div>],
} satisfies Meta<typeof CropCalendar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
/** Out-of-range months are ignored; with nothing valid the calendar renders nothing. */
export const InvalidMonths: Story = { args: { plantingMonths: [0], harvestMonths: [13], leanMonths: [] } };
