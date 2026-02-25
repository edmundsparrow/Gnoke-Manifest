/**
 * db-config.js
 * Data access layer — Config page
 * Handles: company, places, vehicles, routes
 */

const DBConfig = (() => {

  // ── Company ────────────────────────────────────────────────────────────────

  function getCompany() {
    return DB.query('SELECT * FROM company LIMIT 1')[0] || null;
  }

  async function saveCompany(name) {
    const existing = getCompany();
    if (existing) {
      await DB.run('UPDATE company SET name = ? WHERE id = ?', [name, existing.id]);
    } else {
      await DB.run('INSERT INTO company (name) VALUES (?)', [name]);
    }
    return getCompany();
  }

  // ── Countries & States ─────────────────────────────────────────────────────

  function getCountries() {
    return DB.query('SELECT * FROM countries ORDER BY name');
  }

  function getStates(countryId) {
    return DB.query(
      'SELECT * FROM states WHERE country_id = ? ORDER BY name',
      [countryId]
    );
  }

  function getAllStates() {
    return DB.query(`
      SELECT s.*, c.name AS country, c.code AS country_code
      FROM states s
      JOIN countries c ON s.country_id = c.id
      ORDER BY c.name, s.name
    `);
  }

  // ── Places ─────────────────────────────────────────────────────────────────

  function getPlaces() {
    return DB.query(`
      SELECT p.*, s.name AS state_name, s.code AS state_code, c.name AS country
      FROM places p
      LEFT JOIN states   s ON p.state_id   = s.id
      LEFT JOIN countries c ON s.country_id = c.id
      ORDER BY p.name
    `);
  }

  async function addPlace(name, stateId = null) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Place name cannot be empty.');
    await DB.run(
      'INSERT INTO places (name, state_id) VALUES (?, ?)',
      [trimmed, stateId]
    );
    return getPlaces();
  }

  async function updatePlaceState(placeId, stateId) {
    await DB.run('UPDATE places SET state_id = ? WHERE id = ?', [stateId, placeId]);
    return getPlaces();
  }

  // ── Vehicles ───────────────────────────────────────────────────────────────

  function getVehicles() {
    return DB.query('SELECT * FROM vehicles ORDER BY type ASC');
  }

  async function addVehicle(type, capacity) {
    const t = type.trim();
    const c = parseInt(capacity);
    if (!t) throw new Error('Vehicle type cannot be empty.');
    if (isNaN(c) || c < 1) throw new Error('Capacity must be a positive number.');
    await DB.run('INSERT INTO vehicles (type, capacity) VALUES (?, ?)', [t, c]);
    return getVehicles();
  }

  async function updateVehicle(id, type, capacity) {
    const t = type.trim();
    const c = parseInt(capacity);
    if (!t) throw new Error('Vehicle type cannot be empty.');
    if (isNaN(c) || c < 1) throw new Error('Capacity must be a positive number.');
    await DB.run('UPDATE vehicles SET type = ?, capacity = ? WHERE id = ?', [t, c, id]);
    return getVehicles();
  }

  async function deleteVehicle(id) {
    // Check if vehicle is used in any route
    const inUse = DB.query('SELECT id FROM routes WHERE vehicle_id = ? LIMIT 1', [id]);
    if (inUse.length) throw new Error('Cannot delete — vehicle is assigned to existing routes.');
    await DB.run('DELETE FROM vehicles WHERE id = ?', [id]);
    return getVehicles();
  }

  // ── Routes ─────────────────────────────────────────────────────────────────

  function getRoutes() {
    return DB.query(`
      SELECT
        r.id,
        dep.id   AS departure_id,
        dep.name AS departure,
        dest.id  AS destination_id,
        dest.name AS destination,
        v.id     AS vehicle_id,
        v.type   AS vehicle_type,
        v.capacity,
        r.price_ac,
        r.price_no_ac
      FROM routes r
      JOIN places  dep  ON r.departure_id   = dep.id
      JOIN places  dest ON r.destination_id = dest.id
      JOIN vehicles v   ON r.vehicle_id     = v.id
      ORDER BY dep.name, dest.name, v.type
    `);
  }

  function getRoute(id) {
    return DB.query(`
      SELECT
        r.id,
        dep.id   AS departure_id,
        dep.name AS departure,
        dest.id  AS destination_id,
        dest.name AS destination,
        v.id     AS vehicle_id,
        v.type   AS vehicle_type,
        v.capacity,
        r.price_ac,
        r.price_no_ac
      FROM routes r
      JOIN places  dep  ON r.departure_id   = dep.id
      JOIN places  dest ON r.destination_id = dest.id
      JOIN vehicles v   ON r.vehicle_id     = v.id
      WHERE r.id = ?
    `, [id])[0] || null;
  }

  async function saveRoute({ departureId, destinationId, vehicleId, priceAc, priceNoAc }) {
    if (departureId === destinationId) throw new Error('Departure and destination cannot be the same.');

    // Upsert forward route
    await _upsertRoute(departureId, destinationId, vehicleId, priceAc, priceNoAc);

    // Auto-create reverse route if it doesn't exist
    const reverse = DB.query(`
      SELECT id FROM routes
      WHERE departure_id = ? AND destination_id = ? AND vehicle_id = ?
    `, [destinationId, departureId, vehicleId]);

    if (!reverse.length) {
      await _upsertRoute(destinationId, departureId, vehicleId, priceAc, priceNoAc);
    }

    return getRoutes();
  }

  async function _upsertRoute(depId, destId, vehicleId, priceAc, priceNoAc) {
    const existing = DB.query(`
      SELECT id FROM routes
      WHERE departure_id = ? AND destination_id = ? AND vehicle_id = ?
    `, [depId, destId, vehicleId]);

    if (existing.length) {
      await DB.run(`
        UPDATE routes SET price_ac = ?, price_no_ac = ? WHERE id = ?
      `, [priceAc ?? null, priceNoAc ?? null, existing[0].id]);
    } else {
      await DB.run(`
        INSERT INTO routes (departure_id, destination_id, vehicle_id, price_ac, price_no_ac)
        VALUES (?, ?, ?, ?, ?)
      `, [depId, destId, vehicleId, priceAc ?? null, priceNoAc ?? null]);
    }
  }

  async function deleteRoute(id) {
    // Check if route is used in any trip
    const inUse = DB.query('SELECT id FROM trips WHERE route_id = ? LIMIT 1', [id]);
    if (inUse.length) throw new Error('Cannot delete — route has existing trip records.');
    // Delete both directions
    const route = getRoute(id);
    if (!route) throw new Error('Route not found.');
    await DB.run(`
      DELETE FROM routes
      WHERE (departure_id = ? AND destination_id = ? AND vehicle_id = ?)
         OR (departure_id = ? AND destination_id = ? AND vehicle_id = ?)
    `, [
      route.departure_id, route.destination_id, route.vehicle_id,
      route.destination_id, route.departure_id, route.vehicle_id
    ]);
    return getRoutes();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    getCompany, saveCompany,
    getCountries, getStates, getAllStates,
    getPlaces, addPlace, updatePlaceState,
    getVehicles, addVehicle, updateVehicle, deleteVehicle,
    getRoutes, getRoute, saveRoute, deleteRoute,
  };

})();
