import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation"
import { useEffect } from "react"
import { Focusable } from "./Focusable"

export type Route = { screen: "home" | "search" | "settings" } | { screen: "details"; mediaId: number }

export function Shell({ route, navigate, children }: { route: Route; navigate: (route: Route) => void; children: React.ReactNode }) {
  const { ref, focusKey } = useFocusable({ focusKey: "APP", trackChildren: true })
  useEffect(() => { setFocus(route.screen === "details" ? "DETAILS_BACK" : `NAV_${route.screen.toLocaleUpperCase()}`) }, [route])
  const revealScreenHeader = () => {
    const scroller = document.querySelector<HTMLElement>("main > .screen, main > .details-screen")
    if (scroller) scroller.scrollTop = 0
  }
  return <FocusContext.Provider value={focusKey}><div ref={ref} className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">S</span><span>Seanime <em>TV</em></span></div>
      <nav>
        <Focusable focusKey="NAV_HOME" onFocus={revealScreenHeader} className={route.screen === "home" ? "active" : ""} onEnter={() => navigate({ screen: "home" })}>Home</Focusable>
        <Focusable focusKey="NAV_SEARCH" onFocus={revealScreenHeader} className={route.screen === "search" ? "active" : ""} onEnter={() => navigate({ screen: "search" })}>Search</Focusable>
        <Focusable focusKey="NAV_SETTINGS" onFocus={revealScreenHeader} className={route.screen === "settings" ? "active" : ""} onEnter={() => navigate({ screen: "settings" })}>Settings</Focusable>
      </nav>
      <span className="connection-dot">● Connected</span>
    </header>
    <main>{children}</main>
  </div></FocusContext.Provider>
}
