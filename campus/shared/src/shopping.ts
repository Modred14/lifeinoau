export interface ShopItem {
  id: string;
  name: string;
  category: "food" | "drinks";
  price: number;
  food: number;
  energy: number;
  fun: number;
  detail: string;
  image: string;
}

export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: "jollof", name: "Jollof rice & chicken", category: "food", price: 900, food: 55, energy: 12, fun: 6, detail: "A proper meal before your next class.", image: "/phone/food/jollof.webp" },
  { id: "shawarma", name: "Chicken shawarma", category: "food", price: 750, food: 40, energy: 8, fun: 5, detail: "Grilled chicken, vegetables and a warm wrap.", image: "/phone/food/shawarma.webp" },
  { id: "puff-puff", name: "Puff-puff", category: "food", price: 150, food: 18, energy: 3, fun: 4, detail: "A small snack for the walk to class.", image: "/phone/food/puff-puff.webp" },
  { id: "water", name: "Bottled water", category: "drinks", price: 100, food: 2, energy: 8, fun: 0, detail: "Take a break and drink some water.", image: "" },
  { id: "coffee", name: "Iced coffee", category: "drinks", price: 350, food: 3, energy: 28, fun: 2, detail: "A little energy for a long afternoon.", image: "" },
  { id: "juice", name: "Orange juice", category: "drinks", price: 250, food: 10, energy: 15, fun: 3, detail: "Something cold after a hot walk.", image: "" },
];

export interface BuyItemPayload {
  id: string;
  requestId: string;
}

export interface ShopReceipt {
  requestId: string;
  id: string;
  ok: boolean;
  message: string;
}

export const findShopItem = (id: unknown) => typeof id === "string" ? SHOP_ITEMS.find((item) => item.id === id) : undefined;
