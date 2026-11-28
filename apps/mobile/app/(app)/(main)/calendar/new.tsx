import { NewEventRoute } from "@/features/calendar/EventForm";

/** "Novo evento", pushed from the calendar's "+" (`?day=`: the day chosen on its strip). */
export default function CalendarNewRoute() {
  return <NewEventRoute />;
}
