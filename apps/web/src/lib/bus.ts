/** One row of my_bus_status(): the parent's view of one child's bus. Positions are the BUS's, and only present while the parent may see them. */
export interface BusStatus {
  student_id: string; first_name: string; route_name: string; vehicle_label: string | null; stop_name: string | null;
  consent: boolean; saferoute_on: boolean; trip_id: string | null; direction: string | null; trip_started_at: string | null;
  last_event: 'boarded' | 'alighted' | null; last_event_at: string | null;
  lat: number | null; lng: number | null; accuracy_m: number | null; position_at: string | null;
}

/** HH:MM in the school's timezone, digits kept left-to-right by the caller. */
export function clock(iso: string | null, timezone: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: timezone || 'Asia/Karachi' }).format(new Date(iso));
}
