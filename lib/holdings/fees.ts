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
