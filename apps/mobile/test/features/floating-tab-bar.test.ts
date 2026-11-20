import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FLOATING_BAR, floatingBarRoom, tabHasNewAction } from "../../src/lib/nav";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const layout = read("app/(app)/(main)/(tabs)/_layout.tsx");
const bar = read("src/features/tab-bar/FloatingTabBar.tsx");

describe("Android's floating tab bar", () => {
  test("five tabs and the new button fit a 360 dp phone with 48 dp targets", () => {
    const { height, side, gap, inset } = FLOATING_BAR;
    const capsule = 360 - side * 2 - height - gap;
    expect((capsule - inset * 2) / 5).toBeGreaterThanOrEqual(48);
    expect(height - inset * 2).toBeGreaterThanOrEqual(48);
    expect(height).toBeGreaterThanOrEqual(48);
  });

  test("a tab root keeps the safe area, the bar and its gaps clear", () => {
    expect(floatingBarRoom(0)).toBe(72);
    expect(floatingBarRoom(48)).toBe(120);
  });

  test("only Conversas has the new button, and it does what the bar's + does", () => {
    expect(tabHasNewAction("(chats)")).toBe(true);
    for (const name of ["threads", "agents", "activity", "search", undefined])
      expect({ name, action: tabHasNewAction(name) }).toEqual({ name, action: false });
    expect(bar).toContain("tabHasNewAction(state.routes[state.index]?.name)");
    expect(bar).toContain("onPress={openNew}");
    expect(read("src/features/shared/tabHeader.tsx")).toContain("onPress: openNew }];");
    // One way to it on Android: Conversas' header gives its "+" up there alone.
    expect(read("src/features/chats/ChatsScreen.tsx")).toContain(
      '{...(Platform.OS === "android" ? { actions: [] } : {})}',
    );
  });

  test("iOS keeps the system's tabs; Android takes the router's with our bar, from the same list", () => {
    expect(layout).toContain('{Platform.OS === "android" ? (');
    expect(layout).toContain("<NativeTabs\n");
    expect(layout).toContain('minimizeBehavior="onScrollDown"');
    expect(layout).toContain("<NativeTabs.BottomAccessory>");
    expect(layout).toContain('<Tabs backBehavior="initialRoute" tabBar={renderFloatingBar} screenOptions={floating}>');
    expect(layout.match(/\{TABS\.map\(\(tab\) => \{/g)).toHaveLength(2);
    expect(layout.match(/factsOf\(tab\)/g)).toHaveLength(2);
  });

  test("each tab keeps its badge and a label with its count; the bar stays out of list refreshes", () => {
    expect(layout).toContain('accessibilityLabel: badge ? t("mobile.tabs.withCount", { label, count }) : label,');
    expect(layout).toContain("tabBarAccessibilityLabel: accessibilityLabel,");
    expect(layout).toContain("...(badge ? { tabBarBadge: count } : {}),");
    expect(bar).toContain("fill={TAB_BADGE.background}");
    expect(bar).toContain('accessibilityRole="tab"');
    expect(bar).toContain("accessibilityState={{ selected }}");
    // The counts are read by the leaf that draws nothing, never by the bar.
    expect(layout).toContain("<BarSources onChange={setBar} />");
    expect(bar).not.toContain("useUnread");
  });

  test("a tap on the tab in sight scrolls up, a tap on another switches, and the keyboard hides the bar", () => {
    expect(bar).toContain('emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true })');
    expect(bar).toContain("if (!selected && !press.defaultPrevented) navigateToTab(route.key);");
    expect(read("src/ui/LargeTitleScreen.tsx")).toContain("useScrollToTop(IOS ? NO_SCROLL : scroll.ref);");
    expect(bar).toContain("if (keyboardUp) return null;");
  });
});
