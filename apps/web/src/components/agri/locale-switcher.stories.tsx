import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LocaleSwitcher } from "./locale-switcher";

const meta = { title: "Agri/LocaleSwitcher", component: LocaleSwitcher, tags: ["autodocs"] } satisfies Meta<typeof LocaleSwitcher>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
