import type { Side } from "@/lib/holdings/positions";

// 台股一般券商牌告費率;使用者若有折扣可在表單覆寫。
const FEE_RATE = 0.001425;
const MIN_FEE = 20;
const TAX_RATE = 0.003;

export function estimateFee(price: number, quantity: number): number {
  return Math.max(MIN_FEE, Math.round(price * quantity * FEE_RATE));
}

export function estimateTax(price: number, quantity: number): number {
  return Math.round(price * quantity * TAX_RATE);
}

// 二代健保補充保費:單筆股利 ≥ 2 萬課 2.11%
const NHI_RATE = 0.0211;
const NHI_THRESHOLD = 20000;
// 現金股利匯費常見預設(可在表單覆寫)
export const DIV_TRANSFER_FEE = 10;

export function estimateNhi(amount: number): number {
  return amount >= NHI_THRESHOLD ? Math.round(amount * NHI_RATE) : 0;
}

// 缺省費用補值;DIV_STOCK 無現金流,費稅一律歸零(防呆優先於報錯)。
export function resolveFees(
  side: Side, quantity: number, price: number, fee?: number, tax?: number,
): { fee: number; tax: number } {
  if (side === "DIV_STOCK") return { fee: 0, tax: 0 };
  const defaultFee = side === "DIV_CASH" ? DIV_TRANSFER_FEE : estimateFee(price, quantity);
  const defaultTax =
    side === "SELL" ? estimateTax(price, quantity)
    : side === "DIV_CASH" ? estimateNhi(price * quantity)
    : 0;
  return { fee: fee ?? defaultFee, tax: tax ?? defaultTax };
}
