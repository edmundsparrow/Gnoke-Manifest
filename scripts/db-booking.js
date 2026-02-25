/**
 * db-booking.js
 * Data access layer — Booking page
 * Handles: drivers, trips, passengers
 */

const DBBooking = (() => {

  // ── Route lookup (for booking dropdowns) ──────────────────────────────────

  function getRouteBySelection(departureId, destinationId, vehicleId) {
    return DB.query(`
      SELECT
        r.id,
        r.price_ac,
        r.price_no_ac,
        v.capacity,
        v.type AS vehicle_type,
        dep.name AS departure,
        dest.name AS destination
      FROM routes r
      JOIN vehicles v   ON r.vehicle_id     = v.id
      JOIN places  dep  ON r.departure_id   = dep.id
      JOIN places  dest ON r.destination_id = dest.id
      WHERE r.departure_id   = ?
        AND r.destination_id = ?
        AND r.vehicle_id     = ?
      LIMIT 1
    `, [departureId, destinationId, vehicleId])[0] || null;
  }

  // ── Seats remaining for a trip ─────────────────────────────────────────────

  function getSeatsRemaining(tripId) {
    const result = DB.query(`
      SELECT
        v.capacity - COUNT(p.id) AS remaining
      FROM trips t
      JOIN routes   r ON t.route_id   = r.id
      JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN passengers p ON p.trip_id = t.id
      WHERE t.id = ?
      GROUP BY v.capacity
    `, [tripId]);
    return result[0]?.remaining ?? null;
  }

  // ── Drivers ────────────────────────────────────────────────────────────────

  function getDriverByPhone(phone) {
    return DB.query('SELECT * FROM drivers WHERE phone = ?', [phone])[0] || null;
  }

  async function upsertDriver(name, phone, vehicleNo) {
    const existing = getDriverByPhone(phone);
    if (existing) {
      // Update name and vehicle plate if changed
      await DB.run(
        'UPDATE drivers SET name = ?, vehicle_no = ? WHERE id = ?',
        [name, vehicleNo, existing.id]
      );
      return existing.id;
    } else {
      const result = await DB.run(
        'INSERT INTO drivers (name, phone, vehicle_no) VALUES (?, ?, ?)',
        [name, phone, vehicleNo]
      );
      return result.lastInsertRowid;
    }
  }

  // ── Trips ──────────────────────────────────────────────────────────────────

  function getTripByBookingCode(bookingCode) {
    return DB.query(`
      SELECT
        t.*,
        dep.name  AS departure,
        dest.name AS destination,
        v.type    AS vehicle_type,
        v.capacity,
        d.name    AS driver_name,
        d.phone   AS driver_phone,
        r.price_ac,
        r.price_no_ac
      FROM trips t
      JOIN routes   r    ON t.route_id   = r.id
      JOIN places   dep  ON r.departure_id   = dep.id
      JOIN places   dest ON r.destination_id = dest.id
      JOIN vehicles v    ON r.vehicle_id  = v.id
      JOIN drivers  d    ON t.driver_id   = d.id
      WHERE t.booking_code = ?
    `, [bookingCode])[0] || null;
  }

  async function createTrip({ bookingCode, routeId, driverId, vehicleNo, hasAc }) {
    const result = await DB.run(`
      INSERT INTO trips (booking_code, route_id, driver_id, vehicle_no, has_ac, booked_at)
      VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
    `, [bookingCode, routeId, driverId, vehicleNo, hasAc ? 1 : 0]);
    return result.lastInsertRowid;
  }

  // ── Passengers ─────────────────────────────────────────────────────────────

  function getPassengersByTrip(tripId) {
    return DB.query(`
      SELECT * FROM passengers WHERE trip_id = ? ORDER BY id ASC
    `, [tripId]);
  }

  /**
   * Book a passenger onto a trip.
   * The DB trigger enforces seat capacity automatically.
   * If vehicle is full the trigger throws and we catch it here.
   */
  async function bookPassenger(tripId, name, phone, gender) {
    try {
      const result = await DB.run(`
        INSERT INTO passengers (trip_id, name, phone, gender)
        VALUES (?, ?, ?, ?)
      `, [tripId, name.trim(), phone.trim(), gender]);
      return { success: true, passengerId: result.lastInsertRowid };
    } catch (err) {
      if (err.message.includes('fully booked')) {
        return { success: false, reason: 'full', message: 'Vehicle is fully booked. No seats remaining.' };
      }
      throw err;
    }
  }

  async function removePassenger(passengerId) {
    await DB.run('DELETE FROM passengers WHERE id = ?', [passengerId]);
  }

  // ── Full booking flow ──────────────────────────────────────────────────────

  /**
   * The main booking action. Called from the booking page.
   * Upserts driver, creates or reuses trip, books passenger.
   *
   * @param {Object} data
   * @returns {{ success: boolean, tripId, passengerId, bookingCode, seatsRemaining }}
   */
  async function bookTrip({
    bookingCode,
    routeId,
    vehicleNo,
    hasAc,
    driverName,
    driverPhone,
    passengerName,
    passengerPhone,
    gender,
  }) {
    // 1. Upsert driver
    const driverId = await upsertDriver(driverName, driverPhone, vehicleNo);

    // 2. Create trip if booking code is new
    let trip = getTripByBookingCode(bookingCode);
    let tripId;

    if (!trip) {
      tripId = await createTrip({ bookingCode, routeId, driverId, vehicleNo, hasAc });
    } else {
      tripId = trip.id;
    }

    // 3. Book passenger (trigger enforces seat cap)
    const booking = await bookPassenger(tripId, passengerName, passengerPhone, gender);
    if (!booking.success) return booking;

    // 4. Return fresh state
    const remaining = getSeatsRemaining(tripId);
    return {
      success: true,
      tripId,
      passengerId: booking.passengerId,
      bookingCode,
      seatsRemaining: remaining,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    getRouteBySelection,
    getSeatsRemaining,
    getDriverByPhone,
    upsertDriver,
    getTripByBookingCode,
    createTrip,
    getPassengersByTrip,
    bookPassenger,
    removePassenger,
    bookTrip,
  };

})();
