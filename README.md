# Employee Cab Facility App

A corporate cab booking app for employees (company-owned cabs; shift-based & on-demand rides).

## Project structure

```
employee-cab-app/
├── app/          ← React Native (Expo) mobile app  — FRONT END
├── backend/      ← Node.js + Express server         — (later)
└── database/     ← PostgreSQL setup & migrations     — (later)
```

## Tech stack

- **App:** React Native (Expo) + React Navigation + React Native Paper
- **Backend:** Node.js + Express *(not built yet)*
- **Database:** PostgreSQL *(not built yet)*

## Current phase: Front-end with mock data

We are building all the screens first, using fake/mock data (no backend yet).
When the screens work, we wire them to the real backend.

### Run the app (front-end)

```bash
cd app
npm install
npx expo start
```

Then scan the QR code with the **Expo Go** app on your phone.

## Build roadmap

See the plan in the project notes. Current thin slice:

1. Employee logs in
2. Employee books a cab (date, shift, direction, pickup)
3. Booking shows as "Booked"
4. Admin sees the booking and assigns a cab
5. Employee sees the assigned cab number + driver
