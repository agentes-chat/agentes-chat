import { EventScreen } from "@/features/calendar/EventScreen";

/** One event of the calendar's list (`?key=` its item, `?from=` and `?to=` the range the list read), pushed from its row. */
export default function CalendarEventRoute() {
  return <EventScreen />;
}
