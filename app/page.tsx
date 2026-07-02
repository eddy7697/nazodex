import AppShell from "@/components/layout/AppShell";
import WatchlistView from "@/components/watchlist/WatchlistView";
export default function Home() {
  return <AppShell title="台股看板"><WatchlistView /></AppShell>;
}
