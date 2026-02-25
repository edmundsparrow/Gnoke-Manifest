/**
 * db-history.js
 * Data access layer — History page
 * Handles: trip history, filtering, totals
 */

const DBHistory = (() => {

  /**
   * Get all trips with summary info.
   * Optional filters: date (YYYY-MM-DD), routeId
   */
  function getTrips({ date, routeId } = {}) {
    let sql = `
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
        CASE t.has_ac
          WHEN 1 THEN r.price_ac
          ELSE r.price_no_ac
        END AS fare,
        COUNT(p.id) AS passenger_count,
        CASE t.has_ac
          WHEN 1 THEN r.price_ac * COUNT(p.id)
          ELSE r.price_no_ac * COUNT(p.id)
        END AS total_revenue
      FROM trips t
      JOIN routes   r    ON t.route_id       = r.id
      JOIN places   dep  ON r.departure_id   = dep.id
      JOIN places   dest ON r.destination_id = dest.id
      JOIN vehicles v    ON r.vehicle_id     = v.id
      JOIN drivers  d    ON t.driver_id      = d.id
      LEFT JOIN passengers p ON p.trip_id = t.id
    `;

    const params = [];
    const where  = [];

    if (date) {
      where.push(`date(t.booked_at) = ?`);
      params.push(date);
    }

    if (routeId) {
      where.push(`t.route_id = ?`);
      params.push(routeId);
    }

    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' GROUP BY t.id ORDER BY t.booked_at DESC';

    return DB.query(sql, params);
  }

  /**
   * Get distinct dates that have trips (for date filter dropdown)
   */
  function getTripDates() {
    return DB.query(`
      SELECT DISTINCT date(booked_at) AS date
      FROM trips
      ORDER BY date DESC
    `).map(r => r.date);
  }

  /**
   * Get total revenue across filtered trips
   */
  function getTotalRevenue(trips) {
    return trips.reduce((sum, t) => sum + (t.total_revenue || 0), 0);
  }

  /**
   * Delete a trip and all its passengers
   */
  async function deleteTrip(tripId) {
    await DB.transaction(async ({ run }) => {
      run('DELETE FROM passengers WHERE trip_id = ?', [tripId]);
      run('DELETE FROM trips WHERE id = ?', [tripId]);
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return { getTrips, getTripDates, getTotalRevenue, deleteTrip };

})();
