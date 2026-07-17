// ---------------------------------------------------------------------------
// MOCK DATA
// This is fake data that stands in for a real backend + database.
// Later, when we build the backend, we replace these with real API calls.
// Keeping all fake data in ONE file makes that swap easy.
// ---------------------------------------------------------------------------

// The people who can log in.
// Two roles: "employee" books cabs; "admin" assigns cabs to bookings.
// (Passwords are plain text ONLY because this is a fake front-end demo.
//  Real login with hashed passwords comes with the backend.)
export const employees = [
  {
    id: 'u1',
    empId: '1399', // employee id shown on the home page
    name: 'Abhilasha K',
    email: 'employee@demo.com',
    password: '1234',
    role: 'employee',
    phone: '9000000001',
  },
  {
    id: 'u2',
    empId: '900000001',
    name: 'Transport Desk',
    email: 'admin@demo.com',
    password: '1234',
    role: 'admin',
    phone: '9000000002',
  },
];

// The company's cabs + their drivers.
export const cabs = [
  { id: 'c1', cabNumber: 'TS 09 AB 1234', driverName: 'Ramesh', driverPhone: '9111111111' },
  { id: 'c2', cabNumber: 'TS 09 CD 5678', driverName: 'Suresh', driverPhone: '9222222222' },
  { id: 'c3', cabNumber: 'TS 09 EF 9012', driverName: 'Mahesh', driverPhone: '9333333333' },
];

// A couple of bookings that already exist, so the admin screen isn't empty
// the very first time you open it.
export const initialBookings = [
  {
    id: 'b1',
    employeeId: 'u1',
    employeeName: 'Roopa Y',
    date: '2026-07-15',
    shift: 'Morning (9:00 AM)',
    direction: 'Home → Office',
    pickup: 'Gachibowli',
    status: 'Booked', // Booked → Cab assigned  (more statuses come later)
    assignedCabId: null,
    source: 'roster',
  },
];

// This is a NIGHT-SHIFT cab service: cabs run 9:00 PM → 6:00 AM only.
// The choices shown in the booking forms all fall inside that window.
export const SHIFT_OPTIONS = [
  'Night (09:00 PM)',
  'Late Night (12:00 AM)',
  'Early Morning (06:00 AM)',
];

export const DIRECTION_OPTIONS = ['Home → Office', 'Office → Home'];

// A single fixed OTP for the demo. Later, the backend sends a real code by SMS.
export const TEST_OTP = '123456';

// Times shown in the Weekly Schedule table (night-shift service: 9 PM → 6 AM).
// "Pickup" = cab picks you up from home to office → start of the night shift
//            (late evening: 9-11 PM).
// "Drop"   = cab drops you home from office → end of the night shift
//            (early morning of the next day: 4-6 AM).
// "NA" is the default (no ride that leg).
export const NONE = 'NA';
export const PICKUP_TIMES = [NONE, '09:00 PM', '10:00 PM', '11:00 PM'];
export const DROP_TIMES = [NONE, '04:00 AM', '05:00 AM', '06:00 AM'];

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// --- Ad-hoc request form options ---
export const OFFICE_LOCATIONS = ['Vamsiram building'];

export const REASONS = [
  'Extended Shift Hours',
  'Personal Emergency',
  'Roaster not updated',
  'Other',
];

// Pick = cab picks you up from home (Home → Office).
// Drop = cab drops you home from office (Office → Home).
export const REQUEST_TYPES = ['Pick', 'Drop'];

// All times a one-time ride can choose from — the full 9 PM → 6 AM window.
export const SHIFT_TIMES = [
  '09:00 PM',
  '10:00 PM',
  '11:00 PM',
  '12:00 AM',
  '01:00 AM',
  '02:00 AM',
  '03:00 AM',
  '04:00 AM',
  '05:00 AM',
  '06:00 AM',
];

// Where a booking came from — used by the home "My ORS" / "My Adhoc" lists.
export const SOURCE = { ROSTER: 'roster', ADHOC: 'adhoc' };

// The stages a booking moves through. Used for coloring status chips.
export const STATUS = {
  BOOKED: 'Booked',
  ASSIGNED: 'Cab assigned',
  CANCELLED: 'Cancelled',
};
