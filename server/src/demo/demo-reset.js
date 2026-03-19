function resetDemoUser(db) {
  const DEMO_EMAIL = 'demo@nomad.app';

  const demo = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL);
  if (!demo) {
    console.log('[Demo Reset] Demo user not found, skipping');
    return;
  }

  const demoId = Number(demo.id);

  // Delete all trips OWNED by demo user (shared trips from admin stay)
  const demoTrips = db.prepare('SELECT id FROM trips WHERE user_id = ?').all(demoId);
  for (const trip of demoTrips) {
    // CASCADE handles days, places, assignments, packing, budget, reservations, photos, files, day_notes
    db.prepare('DELETE FROM trips WHERE id = ?').run(trip.id);
  }

  // Delete demo user's custom categories and tags
  db.prepare('DELETE FROM categories WHERE user_id = ?').run(demoId);
  db.prepare('DELETE FROM tags WHERE user_id = ?').run(demoId);

  // Reset demo user's settings
  db.prepare('DELETE FROM settings WHERE user_id = ?').run(demoId);

  const deletedCount = demoTrips.length;
  if (deletedCount > 0) {
    console.log(`[Demo Reset] Cleaned ${deletedCount} trips from demo user`);
  } else {
    console.log('[Demo Reset] No demo user trips to clean');
  }
}

module.exports = { resetDemoUser };
