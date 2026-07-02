import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  safelist: ["text-up", "text-down"],
  theme: {
    extend: {
      colors: {
        up: "var(--up)",     // 紅漲
        down: "var(--down)", // 綠跌
      },
    },
  },
  plugins: [],
} satisfies Config;
