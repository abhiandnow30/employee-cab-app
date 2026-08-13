// ---------------------------------------------------------------------------
// useRideOtp — the ride-start code for one booking, live.
//
// Used by the rider (it's their code to read out) and by the desk (who read it
// down the phone when a rider's battery has died). NOT by the driver: the rules
// refuse them, and a screen that asked would just render an error.
//
// LIVE rather than a one-off read because re-assigning a ride to another cab
// issues a new code. A rider standing at the kerb reciting the previous one, to a
// driver whose app keeps saying "didn't match", is a support call that costs more
// than the listener does.
//
// The subscription is only opened while the code is still needed — a cab is
// assigned and nobody has boarded yet. Ride history doesn't hold a listener open
// for a code nobody will be asked for.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { subscribeRideOtp } from '../services/rideOtp';
import { STATUS } from '../data/mockData';

// The statuses where the code still has a job to do.
const AWAITING_BOARDING = [STATUS.ASSIGNED, STATUS.ON_THE_WAY, STATUS.ARRIVED];

export function useRideOtp(booking) {
  const [code, setCode] = useState(null);
  const bookingId = booking?.id || null;
  const status = booking?.status || null;
  const hasCab = !!booking?.assignedCabId;
  const wanted = !!bookingId && hasCab && AWAITING_BOARDING.includes(status);

  useEffect(() => {
    if (!wanted) {
      setCode(null);
      return undefined;
    }
    // A ride assigned before this feature shipped simply has no code document;
    // subscribeRideOtp reports that as null and the screen shows nothing, which
    // is the honest answer — the driver's app lets those through.
    const unsub = subscribeRideOtp(
      bookingId,
      (value) => setCode(value),
      () => setCode(null)
    );
    return unsub;
  }, [bookingId, wanted]);

  return code;
}

export default useRideOtp;
