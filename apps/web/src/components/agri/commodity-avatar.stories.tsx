import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CommodityAvatar } from "./commodity-avatar";

const meta = { title: "Agri/CommodityAvatar", component: CommodityAvatar, tags: ["autodocs"], args: { name: "Maize white", labelled: true } } satisfies Meta<typeof CommodityAvatar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const RTL: Story = { globals: { locale: "ar" } };
export const Sizes: Story = { render: (a) => <div className="flex items-center gap-3"><CommodityAvatar {...a} size="sm" /><CommodityAvatar {...a} /><CommodityAvatar {...a} size="lg" /></div> };
