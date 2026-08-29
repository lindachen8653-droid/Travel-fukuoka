PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  flight_summary TEXT DEFAULT '',
  hotel_summary TEXT DEFAULT '',
  invite_code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS trip_members (
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, user_id),
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_members_user ON trip_members(user_id);

CREATE TABLE IF NOT EXISTS itinerary (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  is_all_day INTEGER NOT NULL DEFAULT 0,
  owner TEXT NOT NULL DEFAULT 'shared',
  category TEXT NOT NULL DEFAULT 'other',
  icon TEXT NOT NULL DEFAULT '📌',
  title TEXT NOT NULL,
  location TEXT DEFAULT '',
  maps_url TEXT DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  photo_caption TEXT DEFAULT '',
  remind INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_itinerary_trip_date ON itinerary(trip_id, date, start_time);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  itinerary_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  caption TEXT DEFAULT '',
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (itinerary_id) REFERENCES itinerary(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_photos_item ON photos(itinerary_id);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  itinerary_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  sent_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (itinerary_id) REFERENCES itinerary(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(sent_at, scheduled_at);

CREATE TABLE IF NOT EXISTS shopping (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  store TEXT DEFAULT '',
  location TEXT DEFAULT '',
  estimated_price REAL DEFAULT 0,
  actual_price REAL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'JPY',
  quantity INTEGER NOT NULL DEFAULT 1,
  owner TEXT NOT NULL DEFAULT 'shared',
  purchased INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_shopping_trip ON shopping(trip_id, purchased, owner);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY',
  twd_amount REAL NOT NULL DEFAULT 0,
  paid_by TEXT NOT NULL,
  is_shared INTEGER NOT NULL DEFAULT 1,
  note TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id, date);

CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  airline TEXT DEFAULT '',
  flight_no TEXT DEFAULT '',
  departure_airport TEXT DEFAULT '',
  arrival_airport TEXT DEFAULT '',
  departure_at TEXT DEFAULT '',
  arrival_at TEXT DEFAULT '',
  terminal TEXT DEFAULT '',
  seat TEXT DEFAULT '',
  booking_code TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS stays (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  hotel_name TEXT NOT NULL,
  address TEXT DEFAULT '',
  check_in TEXT DEFAULT '',
  check_out TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  platform TEXT DEFAULT '',
  booking_no TEXT DEFAULT '',
  maps_url TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'memo',
  date TEXT,
  title TEXT DEFAULT '',
  content TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  owner TEXT NOT NULL DEFAULT 'shared',
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  subscription_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id, enabled);
