/**
 * db-manifest.js
 * Data access layer — Preview/Manifest page
 * Handles: full manifest query for a trip
 */

const DBManifest = (() => {

  /**
   * Get full manifest for a trip by booking code.
   * Returns trip info + all passengers in one object.
   */
  function getManifest(bookingCode) {
    // Trip info
    const trip = DB.query(`
      SELECT
        t.id,
        t.booking_code,
        t.vehicle_no,
        t.has_ac,
        t.booked_at,
        dep.name  AS departure,
        dest.name AS destination,
        v.type    AS vehicle_type,
        v.capacity,
        d.name    AS driver_name,
        d.phone   AS driver_phone,
        CASE t.has_ac
          WHEN 1 THEN r.price_ac
          ELSE r.price_no_ac
        END AS fare,
        c.name AS company
      FROM trips t
      JOIN routes   r    ON t.route_id       = r.id
      JOIN places   dep  ON r.departure_id   = dep.id
      JOIN places   dest ON r.destination_id = dest.id
      JOIN vehicles v    ON r.vehicle_id     = v.id
      JOIN drivers  d    ON t.driver_id      = d.id
      LEFT JOIN company c ON 1=1
      WHERE t.booking_code = ?
    `, [bookingCode])[0] || null;

    if (!trip) return null;

    // Passengers on this trip
    const passengers = DB.query(`
      SELECT id, name, phone, gender
      FROM passengers
      WHERE trip_id = ?
      ORDER BY id ASC
    `, [trip.id]);

    return { ...trip, passengers };
  }

  /**
   * Get the most recent trip (for auto-loading manifest page)
   */
  function getLatestManifest() {
    const latest = DB.query(`
      SELECT booking_code FROM trips ORDER BY id DESC LIMIT 1
    `)[0];
    return latest ? getManifest(latest.booking_code) : null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return { getManifest, getLatestManifest };

})();
