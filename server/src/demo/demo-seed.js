const bcrypt = require('bcryptjs');

function seedDemoData(db) {
  const ADMIN_USER = process.env.DEMO_ADMIN_USER || 'admin';
  const ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL || 'admin@nomad.app';
  const ADMIN_PASS = process.env.DEMO_ADMIN_PASS || 'admin12345';
  const DEMO_EMAIL = 'demo@nomad.app';
  const DEMO_PASS = 'demo12345';

  // Create admin user if not exists
  let admin = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
  if (!admin) {
    const hash = bcrypt.hashSync(ADMIN_PASS, 10);
    const r = db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run(ADMIN_USER, ADMIN_EMAIL, hash, 'admin');
    admin = { id: Number(r.lastInsertRowid) };
    console.log('[Demo] Admin user created');
  } else {
    admin.id = Number(admin.id);
  }

  // Create demo user if not exists
  let demo = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL);
  if (!demo) {
    const hash = bcrypt.hashSync(DEMO_PASS, 10);
    const r = db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run('demo', DEMO_EMAIL, hash, 'user');
    demo = { id: Number(r.lastInsertRowid) };
    console.log('[Demo] Demo user created');
  } else {
    demo.id = Number(demo.id);
  }

  // Disable registration in demo mode
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('allow_registration', 'false')").run();

  // Check if admin already has example trips
  const adminTrips = db.prepare('SELECT COUNT(*) as count FROM trips WHERE user_id = ?').get(admin.id);
  if (adminTrips.count > 0) {
    console.log('[Demo] Example trips already exist, ensuring demo membership');
    ensureDemoMembership(db, admin.id, demo.id);
    return { adminId: admin.id, demoId: demo.id };
  }

  console.log('[Demo] Seeding example trips...');
  seedExampleTrips(db, admin.id, demo.id);
  return { adminId: admin.id, demoId: demo.id };
}

function ensureDemoMembership(db, adminId, demoId) {
  const trips = db.prepare('SELECT id FROM trips WHERE user_id = ?').all(adminId);
  const insertMember = db.prepare('INSERT OR IGNORE INTO trip_members (trip_id, user_id, invited_by) VALUES (?, ?, ?)');
  for (const trip of trips) {
    insertMember.run(trip.id, demoId, adminId);
  }
}

function seedExampleTrips(db, adminId, demoId) {
  const insertTrip = db.prepare('INSERT INTO trips (user_id, title, description, start_date, end_date, currency) VALUES (?, ?, ?, ?, ?, ?)');
  const insertDay = db.prepare('INSERT INTO days (trip_id, day_number, date) VALUES (?, ?, ?)');
  const insertPlace = db.prepare('INSERT INTO places (trip_id, name, lat, lng, address, category_id, place_time, duration_minutes, notes, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertAssignment = db.prepare('INSERT INTO day_assignments (day_id, place_id, order_index) VALUES (?, ?, ?)');
  const insertPacking = db.prepare('INSERT INTO packing_items (trip_id, name, checked, category, sort_order) VALUES (?, ?, ?, ?, ?)');
  const insertBudget = db.prepare('INSERT INTO budget_items (trip_id, category, name, total_price, persons, note) VALUES (?, ?, ?, ?, ?, ?)');
  const insertReservation = db.prepare('INSERT INTO reservations (trip_id, day_id, title, reservation_time, confirmation_number, status, type, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertMember = db.prepare('INSERT OR IGNORE INTO trip_members (trip_id, user_id, invited_by) VALUES (?, ?, ?)');

  // ─── Trip 1: Tokyo & Kyoto ───
  const trip1 = insertTrip.run(adminId, 'Tokyo & Kyoto', 'Zwei Wochen Japan — von den neonbeleuchteten Strassen Tokyos bis zu den stillen Tempeln Kyotos.', '2026-04-15', '2026-04-21', 'EUR');
  const t1 = Number(trip1.lastInsertRowid);

  const t1days = [];
  for (let i = 0; i < 7; i++) {
    const d = insertDay.run(t1, i + 1, `2026-04-${15 + i}`);
    t1days.push(Number(d.lastInsertRowid));
  }

  // Places — cat IDs: 1=Hotel, 2=Restaurant, 3=Sehenswuerdigkeit, 5=Transport, 7=Bar/Cafe, 9=Natur
  const t1places = [
    [t1, 'Hotel Shinjuku Granbell', 35.6938, 139.7035, 'Shinjuku, Tokyo, Japan', 1, '15:00', 60, 'Check-in ab 15 Uhr. Nahe Shinjuku Station.', null],
    [t1, 'Senso-ji Tempel', 35.7148, 139.7967, 'Asakusa, Tokyo, Japan', 3, '09:00', 90, 'Aeltester Tempel Tokyos. Morgens weniger Touristen.', null],
    [t1, 'Shibuya Crossing', 35.6595, 139.7004, 'Shibuya, Tokyo, Japan', 3, '18:00', 45, 'Die beruehmteste Kreuzung der Welt. Abends am beeindruckendsten.', null],
    [t1, 'Tsukiji Outer Market', 35.6654, 139.7707, 'Tsukiji, Tokyo, Japan', 2, '08:00', 120, 'Frisches Sushi zum Fruehstueck! Strassenstaende erkunden.', null],
    [t1, 'Meiji-Schrein', 35.6764, 139.6993, 'Shibuya, Tokyo, Japan', 3, '10:00', 75, 'Ruhige Oase mitten in der Stadt. Durch den Wald zum Schrein.', null],
    [t1, 'Akihabara', 35.7023, 139.7745, 'Akihabara, Tokyo, Japan', 3, '14:00', 180, 'Electric Town — Anime, Manga, Elektronik. Retro-Gaming Shops!', null],
    [t1, 'Shinkansen nach Kyoto', 35.6812, 139.7671, 'Tokyo Station, Japan', 5, '08:30', 140, 'Nozomi Shinkansen, ca. 2h15. Fensterplatz fuer Fuji-Blick!', null],
    [t1, 'Hotel Granvia Kyoto', 34.9856, 135.7580, 'Kyoto Station, Kyoto, Japan', 1, '14:00', 60, 'Direkt am Bahnhof. Perfekte Lage fuer Tagesausfluege.', null],
    [t1, 'Fushimi Inari Taisha', 34.9671, 135.7727, 'Fushimi, Kyoto, Japan', 3, '07:00', 150, '10.000 rote Torii-Tore. Frueh morgens starten fuer leere Wege!', null],
    [t1, 'Kinkaku-ji (Goldener Pavillon)', 35.0394, 135.7292, 'Kita, Kyoto, Japan', 3, '10:00', 60, 'Der goldene Tempel am See. Ikonisches Fotomotiv.', null],
    [t1, 'Arashiyama Bambushain', 35.0095, 135.6673, 'Arashiyama, Kyoto, Japan', 9, '09:00', 90, 'Magischer Bambuswald. Am besten morgens vor den Massen.', null],
    [t1, 'Nishiki Market', 35.0050, 135.7647, 'Nakagyo, Kyoto, Japan', 2, '12:00', 90, 'Kyotos Kuechengasse. Matcha-Eis und frische Mochi probieren!', null],
    [t1, 'Gion Viertel', 35.0037, 135.7755, 'Gion, Kyoto, Japan', 3, '17:00', 120, 'Historisches Geisha-Viertel. Abends beste Chance auf Maiko-Sichtung.', null],
  ];

  const t1pIds = t1places.map(p => Number(insertPlace.run(...p).lastInsertRowid));

  // Assign places to days
  // Day 1: Hotel Check-in, Shibuya
  insertAssignment.run(t1days[0], t1pIds[0], 0);
  insertAssignment.run(t1days[0], t1pIds[2], 1);
  // Day 2: Tsukiji, Senso-ji, Akihabara
  insertAssignment.run(t1days[1], t1pIds[3], 0);
  insertAssignment.run(t1days[1], t1pIds[1], 1);
  insertAssignment.run(t1days[1], t1pIds[5], 2);
  // Day 3: Meiji-Schrein, free afternoon
  insertAssignment.run(t1days[2], t1pIds[4], 0);
  // Day 4: Shinkansen to Kyoto, Hotel
  insertAssignment.run(t1days[3], t1pIds[6], 0);
  insertAssignment.run(t1days[3], t1pIds[7], 1);
  // Day 5: Fushimi Inari, Nishiki Market
  insertAssignment.run(t1days[4], t1pIds[8], 0);
  insertAssignment.run(t1days[4], t1pIds[11], 1);
  // Day 6: Kinkaku-ji, Arashiyama
  insertAssignment.run(t1days[5], t1pIds[9], 0);
  insertAssignment.run(t1days[5], t1pIds[10], 1);
  // Day 7: Gion
  insertAssignment.run(t1days[6], t1pIds[12], 0);

  // Packing
  const t1packing = [
    ['Reisepass', 1, 'Dokumente', 0], ['Japan Rail Pass', 1, 'Dokumente', 1],
    ['Adapter Typ A/B', 0, 'Elektronik', 2], ['Kamera + Ladegeraet', 0, 'Elektronik', 3],
    ['Bequeme Laufschuhe', 0, 'Kleidung', 4], ['Regenjacke', 0, 'Kleidung', 5],
    ['Sonnencreme', 0, 'Hygiene', 6], ['Reiseapotheke', 0, 'Hygiene', 7],
    ['Pocket WiFi Bestaetigung', 1, 'Elektronik', 8], ['Yen Bargeld', 0, 'Dokumente', 9],
  ];
  t1packing.forEach(p => insertPacking.run(t1, ...p));

  // Budget
  insertBudget.run(t1, 'Unterkunft', 'Hotel Shinjuku (3 Naechte)', 450, 2, 'Doppelzimmer');
  insertBudget.run(t1, 'Unterkunft', 'Hotel Granvia Kyoto (4 Naechte)', 680, 2, 'Superior Room');
  insertBudget.run(t1, 'Transport', 'Fluege FRA-NRT', 1200, 2, 'Lufthansa Direktflug');
  insertBudget.run(t1, 'Transport', 'Japan Rail Pass (7 Tage)', 380, 2, 'Ordinaer');
  insertBudget.run(t1, 'Essen', 'Tagesbudget Essen', 350, 2, 'Ca. 50 EUR/Tag');
  insertBudget.run(t1, 'Aktivitaeten', 'Tempel-Eintritte & Erlebnisse', 120, 2, null);

  // Reservations
  insertReservation.run(t1, t1days[0], 'Hotel Shinjuku Check-in', '15:00', 'SG-2026-78432', 'confirmed', 'hotel', 'Shinjuku, Tokyo');
  insertReservation.run(t1, t1days[3], 'Shinkansen Tokyo → Kyoto', '08:30', 'JR-NOZOMI-445', 'confirmed', 'transport', 'Tokyo Station');

  // Share with demo user
  insertMember.run(t1, demoId, adminId);

  // ─── Trip 2: Barcelona Citytrip ───
  const trip2 = insertTrip.run(adminId, 'Barcelona Citytrip', 'Gaudi, Tapas und Meerblick — ein langes Wochenende in Kataloniens Hauptstadt.', '2026-05-21', '2026-05-24', 'EUR');
  const t2 = Number(trip2.lastInsertRowid);

  const t2days = [];
  for (let i = 0; i < 4; i++) {
    const d = insertDay.run(t2, i + 1, `2026-05-${21 + i}`);
    t2days.push(Number(d.lastInsertRowid));
  }

  const t2places = [
    [t2, 'Hotel W Barcelona', 41.3686, 2.1920, 'Barceloneta, Barcelona, Spain', 1, '14:00', 60, 'Direkt am Strand. Rooftop-Bar mit Panorama!', null],
    [t2, 'Sagrada Familia', 41.4036, 2.1744, 'Eixample, Barcelona, Spain', 3, '10:00', 120, 'Gaudis Meisterwerk. Tickets unbedingt vorher online buchen!', null],
    [t2, 'Park Gueell', 41.4145, 2.1527, 'Gracia, Barcelona, Spain', 3, '09:00', 90, 'Mosaik-Terrasse mit Stadtblick. Frueh buchen fuer Monumental Zone.', null],
    [t2, 'La Boqueria', 41.3816, 2.1717, 'La Rambla, Barcelona, Spain', 2, '12:00', 75, 'Beruehmter Markt an der Rambla. Frischer Saft und Jamon Iberico!', null],
    [t2, 'Barceloneta Beach', 41.3784, 2.1925, 'Barceloneta, Barcelona, Spain', 8, '16:00', 120, 'Stadtstrand zum Entspannen nach dem Sightseeing.', null],
    [t2, 'Barri Gotic', 41.3834, 2.1762, 'Ciutat Vella, Barcelona, Spain', 3, '15:00', 90, 'Mittelalterliche Gassen. Kathedrale und Placa Reial entdecken.', null],
    [t2, 'Casa Batllo', 41.3916, 2.1650, 'Passeig de Gracia, Barcelona, Spain', 3, '11:00', 75, 'Gaudis Drachen-Haus. Die Fassade allein ist schon ein Erlebnis.', null],
    [t2, 'El Born & Tapas', 41.3856, 2.1825, 'El Born, Barcelona, Spain', 7, '20:00', 120, 'Trendviertel mit den besten Tapas-Bars. Cal Pep oder El Xampanyet!', null],
  ];

  const t2pIds = t2places.map(p => Number(insertPlace.run(...p).lastInsertRowid));

  // Day 1: Arrival, Beach, El Born
  insertAssignment.run(t2days[0], t2pIds[0], 0);
  insertAssignment.run(t2days[0], t2pIds[4], 1);
  insertAssignment.run(t2days[0], t2pIds[7], 2);
  // Day 2: Sagrada Familia, Casa Batllo, La Boqueria
  insertAssignment.run(t2days[1], t2pIds[1], 0);
  insertAssignment.run(t2days[1], t2pIds[6], 1);
  insertAssignment.run(t2days[1], t2pIds[3], 2);
  // Day 3: Park Gueell, Barri Gotic
  insertAssignment.run(t2days[2], t2pIds[2], 0);
  insertAssignment.run(t2days[2], t2pIds[5], 1);
  // Day 4: Free morning, departure
  insertAssignment.run(t2days[3], t2pIds[4], 0);

  // Packing
  ['Reisepass', 'Sonnencreme SPF50', 'Badehose/Bikini', 'Sonnenbrille', 'Bequeme Sandalen', 'Strandtuch'].forEach((name, i) => {
    insertPacking.run(t2, name, 0, i < 1 ? 'Dokumente' : 'Sommer', i);
  });

  // Budget
  insertBudget.run(t2, 'Unterkunft', 'Hotel W Barcelona (3 Naechte)', 780, 2, 'Sea View Room');
  insertBudget.run(t2, 'Transport', 'Fluege BER-BCN', 180, 2, 'Eurowings');
  insertBudget.run(t2, 'Essen', 'Restaurants & Tapas', 300, 2, 'Ca. 75 EUR/Tag');
  insertBudget.run(t2, 'Aktivitaeten', 'Sagrada Familia + Park Gueell + Casa Batllo', 95, 2, 'Online-Tickets');

  insertReservation.run(t2, t2days[1], 'Sagrada Familia Eintritt', '10:00', 'SF-2026-11234', 'confirmed', 'activity', 'Eixample, Barcelona');

  insertMember.run(t2, demoId, adminId);

  // ─── Trip 3: Wochenende in Wien ───
  const trip3 = insertTrip.run(adminId, 'Wochenende in Wien', 'Kaffeehaus-Kultur, imperiale Pracht und Sachertorte.', '2026-06-12', '2026-06-14', 'EUR');
  const t3 = Number(trip3.lastInsertRowid);

  const t3days = [];
  for (let i = 0; i < 3; i++) {
    const d = insertDay.run(t3, i + 1, `2026-06-${12 + i}`);
    t3days.push(Number(d.lastInsertRowid));
  }

  const t3places = [
    [t3, 'Hotel Sacher Wien', 48.2038, 16.3699, 'Philharmonikerstrasse 4, Wien, Austria', 1, '15:00', 45, 'Das legendaere Hotel. Sachertorte im Cafe muss sein!', null],
    [t3, 'Stephansdom', 48.2082, 16.3738, 'Stephansplatz, Wien, Austria', 3, '10:00', 60, 'Wahrzeichen Wiens. Turmbesteigung fuer 360-Grad-Blick.', null],
    [t3, 'Schloss Schoenbrunn', 48.1845, 16.3122, 'Schoenbrunn, Wien, Austria', 3, '09:30', 150, 'Imperiale Pracht. Grand Tour Ticket fuer alle 40 Raeume.', null],
    [t3, 'Naschmarkt', 48.1986, 16.3633, 'Wienzeile, Wien, Austria', 2, '12:00', 75, 'Wiens groesster Markt. Orientalische Gewuerze bis Wiener Schnitzel.', null],
    [t3, 'Cafe Central', 48.2107, 16.3654, 'Herrengasse 14, Wien, Austria', 7, '15:00', 60, 'Wo einst Trotzki Schach spielte. Melange und Apfelstrudel!', null],
    [t3, 'Prater & Riesenrad', 48.2166, 16.3964, 'Prater, Wien, Austria', 6, '17:00', 90, 'Riesenrad bei Sonnenuntergang. Blick ueber die ganze Stadt.', null],
  ];

  const t3pIds = t3places.map(p => Number(insertPlace.run(...p).lastInsertRowid));

  // Day 1: Arrival, Stephansdom, Cafe Central
  insertAssignment.run(t3days[0], t3pIds[0], 0);
  insertAssignment.run(t3days[0], t3pIds[1], 1);
  insertAssignment.run(t3days[0], t3pIds[4], 2);
  // Day 2: Schoenbrunn, Naschmarkt, Prater
  insertAssignment.run(t3days[1], t3pIds[2], 0);
  insertAssignment.run(t3days[1], t3pIds[3], 1);
  insertAssignment.run(t3days[1], t3pIds[5], 2);
  // Day 3: Free morning
  insertAssignment.run(t3days[2], t3pIds[4], 0);

  // Packing
  ['Personalausweis', 'Regenschirm', 'Bequeme Schuhe', 'Kamera'].forEach((name, i) => {
    insertPacking.run(t3, name, 0, i < 1 ? 'Dokumente' : 'Sonstiges', i);
  });

  // Budget
  insertBudget.run(t3, 'Unterkunft', 'Hotel Sacher (2 Naechte)', 520, 2, 'Classic Doppelzimmer');
  insertBudget.run(t3, 'Transport', 'Zug MUC-VIE', 60, 2, 'OeBB Sparschiene');
  insertBudget.run(t3, 'Essen', 'Restaurants & Cafes', 200, 2, null);

  insertMember.run(t3, demoId, adminId);

  console.log('[Demo] 3 example trips seeded and shared with demo user');
}

module.exports = { seedDemoData };
