// 把 public/taidex_assets/ 原始 PNG 處理成正式素材:
// 亮度轉 alpha(透明底,可浮在任何深色上)+ 邊緣淡出 + 分類輸出 WebP。
// 用法:pnpm assets:prepare
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { lumaToAlpha, edgeFade } from "./asset-pipeline.lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "public/taidex_assets");

// crop: 1024x1536 直式空狀態圖取上方 1024x1024 內容區(下方留白給 UI 文案,不要)
const STATUS_CROP = { left: 0, top: 128, width: 1024, height: 1024 };
const JOBS = [
  { src: "logo.png",            out: "public/brand/logo.webp",           width: 512, alpha: true },
  { src: "logo_with_name.png",  out: "public/brand/logo-name.webp",      width: 768, alpha: true },
  { src: "app_icon.png",        out: "app/icon.png",                     width: 512, png: true },
  { src: "status_自選股.png",     out: "public/empty/watchlist.webp",     width: 640, alpha: true, fade: 48, crop: STATUS_CROP },
  { src: "status_無持股.png",     out: "public/empty/holdings.webp",      width: 640, alpha: true, fade: 48, crop: STATUS_CROP },
  { src: "status_選股無結果.png", out: "public/empty/screener.webp",      width: 640, alpha: true, fade: 48, crop: STATUS_CROP },
  { src: "status_休市.png",       out: "public/empty/market-closed.webp", width: 640, alpha: true, fade: 48, crop: STATUS_CROP },
  { src: "等高地紋圖.png",        out: "public/textures/contour.webp",    width: 1024 },
  { src: "header.png",          out: "public/textures/header.webp",      width: 1024, alpha: true },
];

for (const job of JOBS) {
  const dst = path.join(ROOT, job.out);
  await mkdir(path.dirname(dst), { recursive: true });

  let img = sharp(path.join(SRC, job.src));
  if (job.crop) img = img.extract(job.crop);
  img = img.resize({ width: job.width, withoutEnlargement: true });

  if (job.alpha) {
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    lumaToAlpha(data);
    if (job.fade) edgeFade(data, info.width, info.height, job.fade);
    img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  }

  const { size } = job.png
    ? await img.png().toFile(dst)
    : await img.webp({ quality: 82 }).toFile(dst);
  console.log(`done  ${job.src} → ${job.out}  ${(size / 1024).toFixed(0)}KB`);
}
