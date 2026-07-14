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
    name: 'Roopa Y',
    email: 'employee@demo.com',
    password: '1234',
    role: 'employee',
    phone: '9000000001',
  },
  {
    id: 'u2',
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
  },
];

// The choices shown in the "Book a Cab" form.
export const SHIFT_OPTIONS = [
  'Morning (9:00 AM)',
  'Afternoon (2:00 PM)',
  'Evening (6:00 PM)',
  'Night (9:00 PM)',
];

export const DIRECTION_OPTIONS = ['Home → Office', 'Office → Home'];

// The stages a booking moves through. Used for coloring status chips.
export const STATUS = {
  BOOKED: 'Booked',
  ASSIGNED: 'Cab assigned',
};
