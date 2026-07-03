export type Quote = {
  symbol: string;
  name: string;
  price: number;      // 現價 / 收盤
  change: number;     // 漲跌額(相對前一日收盤)
  changePct: number;  // 漲跌幅 %
  volume: number;     // 成交量(張;MIS 原生張,DB 由股換算)
  asOf: string;       // ISO 時間戳
};
