const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
});

const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const enc = new TextEncoder();

function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function hashPassword(password, saltB64) {
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}

async function currentUser(req, env) {
  const token = parseCookies(req).our_trip_session;
  if (!token) return null;
  return env.DB.prepare(`SELECT u.id,u.email,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?`).bind(token, nowIso()).first();
}

async function requireUser(req, env) {
  const user = await currentUser(req, env);
  if (!user) throw new Response(JSON.stringify({ error: '請先登入' }), { status: 401, headers: { 'content-type': 'application/json' } });
  return user;
}

async function requireMember(env, tripId, userId) {
  const member = await env.DB.prepare(`SELECT 1 ok FROM trip_members WHERE trip_id=? AND user_id=?`).bind(tripId, userId).first();
  if (!member) throw new Response(JSON.stringify({ error: '沒有此旅程的存取權限' }), { status: 403, headers: { 'content-type': 'application/json' } });
}

async function bodyJson(req) {
  try { return await req.json(); } catch { return {}; }
}

function clean(obj, fields) {
  const out = {};
  for (const f of fields) if (Object.prototype.hasOwnProperty.call(obj, f)) out[f] = obj[f];
  return out;
}

const RESOURCES = {
  itinerary: ['date','start_time','end_time','is_all_day','owner','category','icon','title','location','maps_url','address','notes','photo_caption','remind'],
  shopping: ['product_name','store','location','estimated_price','actual_price','currency','quantity','owner','purchased'],
  expenses: ['date','category','amount','currency','twd_amount','paid_by','is_shared','note'],
  flights: ['airline','flight_no','departure_airport','arrival_airport','departure_at','arrival_at','terminal','seat','booking_code','notes'],
  stays: ['hotel_name','address','check_in','check_out','phone','platform','booking_no','maps_url','notes'],
  notes: ['kind','date','title','content'],
  todos: ['title','done','owner']
};

function eventLabel(resource, action) {
  const names = { itinerary:'旅遊行程', shopping:'購物項目', expenses:'旅費', flights:'航班資料', stays:'住宿資料', notes:'旅遊筆記', todos:'待辦事項' };
  const acts = { create:'新增了', update:'修改了', delete:'刪除了' };
  return `${acts[action] || ''}${names[resource] || '資料'}`;
}

async function broadcast(env, tripId, payload) {
  try {
    const id = env.TRIP_ROOM.idFromName(tripId);
    await env.TRIP_ROOM.get(id).fetch('https://room/broadcast', { method:'POST', body:JSON.stringify(payload) });
  } catch (e) { console.log('broadcast failed', e); }
}

function fromB64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function toB64Url(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function vapidAuthorization(endpoint, env) {
  const publicKey = fromB64Url(env.VAPID_PUBLIC_KEY);
  const privateKey = fromB64Url(env.VAPID_PRIVATE_KEY);
  if (publicKey.length !== 65 || publicKey[0] !== 4 || privateKey.length !== 32) throw new Error('Invalid VAPID key');
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', x: toB64Url(publicKey.slice(1, 33)), y: toB64Url(publicKey.slice(33)),
    d: toB64Url(privateKey), ext: true
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = toB64Url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = toB64Url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: env.VAPID_SUBJECT || 'mailto:admin@example.com'
  })));
  const unsigned = `${header}.${claims}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${toB64Url(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}

async function sendPushToUser(env, userId, payload) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  const { results } = await env.DB.prepare(`SELECT id,subscription_json FROM push_subscriptions WHERE user_id=? AND enabled=1`).bind(userId).all();
  for (const row of results || []) {
    try {
      const subscription = JSON.parse(row.subscription_json);
      const response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: { Authorization: await vapidAuthorization(subscription.endpoint, env), TTL: '60' }
      });
      if (!response.ok) throw Object.assign(new Error(`Push service returned ${response.status}`), { status: response.status });
    } catch (e) {
      const status = e?.statusCode || e?.status;
      if (status === 404 || status === 410) await env.DB.prepare(`DELETE FROM push_subscriptions WHERE id=?`).bind(row.id).run();
      else console.log('push failed', status, e?.message);
    }
  }
}

async function notifyOtherMembers(env, tripId, actorId, title, body, url = '/') {
  const { results } = await env.DB.prepare(`SELECT user_id FROM trip_members WHERE trip_id=? AND user_id<>?`).bind(tripId, actorId).all();
  await Promise.all((results || []).map(m => sendPushToUser(env, m.user_id, { title, body, url })));
}

async function syncReminders(env, tripId, itineraryId, userId, reminders = []) {
  await env.DB.prepare(`DELETE FROM reminders WHERE itinerary_id=?`).bind(itineraryId).run();
  const unique = [...new Set(reminders.filter(Boolean))].slice(0, 3);
  for (const scheduledAt of unique) {
    await env.DB.prepare(`INSERT INTO reminders(id,trip_id,itinerary_id,kind,scheduled_at,created_by) VALUES(?,?,?,?,?,?)`)
      .bind(uid(), tripId, itineraryId, 'custom_or_relative', scheduledAt, userId).run();
  }
}

async function listTrips(env, userId) {
  return (await env.DB.prepare(`SELECT t.*,m.role FROM trips t JOIN trip_members m ON m.trip_id=t.id WHERE m.user_id=? ORDER BY t.start_date`).bind(userId).all()).results || [];
}

async function api(req, env, ctx) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === '/api/auth/register' && req.method === 'POST') {
    const b = await bodyJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const displayName = ['🎀 鈴','🐍 綺'].includes(b.display_name) ? b.display_name : '🎀 鈴';
    if (!email.includes('@') || password.length < 8) return json({ error:'Email 格式錯誤，密碼至少 8 碼' }, 400);
    if (await env.DB.prepare(`SELECT 1 FROM users WHERE email=?`).bind(email).first()) return json({ error:'此 Email 已註冊' }, 409);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltB64 = b64(salt);
    const id = uid();
    const hash = await hashPassword(password, saltB64);
    await env.DB.prepare(`INSERT INTO users(id,email,display_name,password_hash,salt) VALUES(?,?,?,?,?)`).bind(id,email,displayName,hash,saltB64).run();
    const token = b64(crypto.getRandomValues(new Uint8Array(32)));
    const expires = new Date(Date.now()+1000*60*60*24*30).toISOString();
    await env.DB.prepare(`INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)`).bind(token,id,expires).run();
    return json({ ok:true, user:{ id,email,display_name:displayName } }, 201, { 'set-cookie':`our_trip_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` });
  }

  if (path === '/api/auth/login' && req.method === 'POST') {
    const b = await bodyJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const row = await env.DB.prepare(`SELECT * FROM users WHERE email=?`).bind(email).first();
    if (!row || (await hashPassword(String(b.password || ''), row.salt)) !== row.password_hash) return json({ error:'Email 或密碼錯誤' }, 401);
    const token = b64(crypto.getRandomValues(new Uint8Array(32)));
    const expires = new Date(Date.now()+1000*60*60*24*30).toISOString();
    await env.DB.prepare(`INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)`).bind(token,row.id,expires).run();
    return json({ ok:true, user:{ id:row.id,email:row.email,display_name:row.display_name } }, 200, { 'set-cookie':`our_trip_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` });
  }

  if (path === '/api/auth/logout' && req.method === 'POST') {
    const token = parseCookies(req).our_trip_session;
    if (token) await env.DB.prepare(`DELETE FROM sessions WHERE token=?`).bind(token).run();
    return json({ ok:true }, 200, { 'set-cookie':'our_trip_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
  }

  if (path === '/api/me' && req.method === 'GET') {
    const user = await currentUser(req, env);
    if (!user) return json({ user:null, trips:[] });
    return json({ user, trips:await listTrips(env,user.id), vapidPublicKey:env.VAPID_PUBLIC_KEY || '' });
  }

  const user = await requireUser(req, env);

  if (path === '/api/trips' && req.method === 'POST') {
    const b = await bodyJson(req);
    const tripId = uid();
    const code = inviteCode();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO trips(id,name,country,city,start_date,end_date,timezone,flight_summary,hotel_summary,invite_code,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(
        tripId, b.name || '✈️ 福岡 5天4夜', b.country || '日本', b.city || '福岡', b.start_date || '2026-10-04', b.end_date || '2026-10-08', b.timezone || 'Asia/Tokyo', b.flight_summary || '', b.hotel_summary || '', code, user.id
      ),
      env.DB.prepare(`INSERT INTO trip_members(trip_id,user_id,role) VALUES(?,?,?)`).bind(tripId,user.id,'owner')
    ]);
    return json({ ok:true, trip_id:tripId, invite_code:code }, 201);
  }

  if (path === '/api/trips/join' && req.method === 'POST') {
    const b = await bodyJson(req);
    const trip = await env.DB.prepare(`SELECT id FROM trips WHERE invite_code=?`).bind(String(b.invite_code || '').trim().toUpperCase()).first();
    if (!trip) return json({ error:'找不到此邀請碼' },404);
    await env.DB.prepare(`INSERT OR IGNORE INTO trip_members(trip_id,user_id,role) VALUES(?,?,?)`).bind(trip.id,user.id,'member').run();
    return json({ ok:true, trip_id:trip.id });
  }

  if (path === '/api/trip' && req.method === 'GET') {
    const tripId = url.searchParams.get('trip_id');
    await requireMember(env,tripId,user.id);
    const trip = await env.DB.prepare(`SELECT * FROM trips WHERE id=?`).bind(tripId).first();
    const members = (await env.DB.prepare(`SELECT u.id,u.display_name FROM trip_members m JOIN users u ON u.id=m.user_id WHERE m.trip_id=?`).bind(tripId).all()).results || [];
    return json({ trip,members });
  }

  if (path === '/api/push/subscribe' && req.method === 'POST') {
    const b = await bodyJson(req);
    const sub = b.subscription;
    if (!sub?.endpoint) return json({ error:'無效的 Push subscription' },400);
    await env.DB.prepare(`INSERT INTO push_subscriptions(id,user_id,endpoint,subscription_json,enabled,updated_at) VALUES(?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json,enabled=1,updated_at=CURRENT_TIMESTAMP`)
      .bind(uid(),user.id,sub.endpoint,JSON.stringify(sub)).run();
    return json({ ok:true });
  }

  if (path === '/api/push/unsubscribe' && req.method === 'POST') {
    const b = await bodyJson(req);
    if (b.endpoint) await env.DB.prepare(`UPDATE push_subscriptions SET enabled=0,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND endpoint=?`).bind(user.id,b.endpoint).run();
    return json({ ok:true });
  }

  if (path === '/api/ws' && req.method === 'GET') {
    const tripId = url.searchParams.get('trip_id');
    await requireMember(env,tripId,user.id);
    const id = env.TRIP_ROOM.idFromName(tripId);
    return env.TRIP_ROOM.get(id).fetch(new Request(req.url,{ headers:req.headers }));
  }

  if (path === '/api/photos' && req.method === 'POST') {
    const form = await req.formData();
    const tripId = String(form.get('trip_id') || '');
    const itineraryId = String(form.get('itinerary_id') || '');
    await requireMember(env,tripId,user.id);
    const item = await env.DB.prepare(`SELECT id FROM itinerary WHERE id=? AND trip_id=?`).bind(itineraryId,tripId).first();
    if (!item) return json({ error:'找不到行程' },404);
    const file = form.get('file');
    if (!(file instanceof File)) return json({ error:'請選擇照片' },400);
    if (!String(file.type).startsWith('image/')) return json({ error:'只接受圖片' },400);
    if (file.size > 1_500_000) return json({ error:'照片壓縮後需小於 1.5 MB' },413);
    const photoId = uid();
    const key = `d1:${tripId}:${itineraryId}:${photoId}`;
    const data = await file.arrayBuffer();
    await env.DB.prepare(`INSERT INTO photos(id,trip_id,itinerary_id,r2_key,content_type,data,caption,uploaded_by) VALUES(?,?,?,?,?,?,?,?)`).bind(photoId,tripId,itineraryId,key,file.type,data,String(form.get('caption') || ''),user.id).run();
    await broadcast(env,tripId,{ type:'photo:create',itinerary_id:itineraryId });
    return json({ ok:true,id:photoId,url:`/api/photos/${photoId}` },201);
  }

  const photoMatch = path.match(/^\/api\/photos\/([^/]+)$/);
  if (photoMatch && req.method === 'GET') {
    const p = await env.DB.prepare(`SELECT * FROM photos WHERE id=?`).bind(photoMatch[1]).first();
    if (!p) return new Response('Not found',{status:404});
    await requireMember(env,p.trip_id,user.id);
    if (!p.data) return new Response('Not found',{status:404});
    return new Response(p.data,{ headers:{ 'content-type':p.content_type, 'cache-control':'private, max-age=3600' } });
  }
  if (photoMatch && req.method === 'DELETE') {
    const p = await env.DB.prepare(`SELECT * FROM photos WHERE id=?`).bind(photoMatch[1]).first();
    if (!p) return json({ok:true});
    await requireMember(env,p.trip_id,user.id);
    await env.DB.prepare(`DELETE FROM photos WHERE id=?`).bind(p.id).run();
    await broadcast(env,p.trip_id,{ type:'photo:delete',itinerary_id:p.itinerary_id });
    return json({ok:true});
  }

  const resourceMatch = path.match(/^\/api\/(itinerary|shopping|expenses|flights|stays|notes|todos)(?:\/([^/]+))?$/);
  if (resourceMatch) {
    const resource = resourceMatch[1];
    const recordId = resourceMatch[2];
    const fields = RESOURCES[resource];
    if (req.method === 'GET' && !recordId) {
      const tripId = url.searchParams.get('trip_id');
      await requireMember(env,tripId,user.id);
      let sql = `SELECT * FROM ${resource} WHERE trip_id=?`;
      if (resource === 'itinerary') sql += ` ORDER BY date,start_time,title`;
      else if (resource === 'expenses') sql += ` ORDER BY date,id`;
      else sql += ` ORDER BY updated_at DESC`;
      const rows = (await env.DB.prepare(sql).bind(tripId).all()).results || [];
      if (resource === 'itinerary') {
        for (const r of rows) {
          r.photos = (await env.DB.prepare(`SELECT id,caption FROM photos WHERE itinerary_id=? ORDER BY created_at`).bind(r.id).all()).results || [];
          r.reminders = (await env.DB.prepare(`SELECT id,scheduled_at FROM reminders WHERE itinerary_id=? ORDER BY scheduled_at`).bind(r.id).all()).results || [];
        }
      }
      return json(rows);
    }
    if (req.method === 'POST' && !recordId) {
      const b = await bodyJson(req);
      const tripId = b.trip_id;
      await requireMember(env,tripId,user.id);
      const data = clean(b,fields);
      const id = uid();
      const cols = ['id','trip_id',...Object.keys(data),'created_by'];
      const vals = [id,tripId,...Object.values(data),user.id];
      if (resource === 'itinerary') { cols.push('updated_by'); vals.push(user.id); }
      const placeholders = cols.map(()=>'?').join(',');
      await env.DB.prepare(`INSERT INTO ${resource}(${cols.join(',')}) VALUES(${placeholders})`).bind(...vals).run();
      if (resource === 'itinerary') await syncReminders(env,tripId,id,user.id,b.reminders || []);
      await broadcast(env,tripId,{ type:`${resource}:create`,id });
      const title = `${user.display_name}${eventLabel(resource,'create')}`;
      const body = resource === 'itinerary' ? `${data.date || ''} ${data.start_time || ''} ${data.title || ''}`.trim() : (data.title || data.product_name || data.hotel_name || '內容已更新');
      ctx.waitUntil(notifyOtherMembers(env,tripId,user.id,title,body,'/'));
      return json({ok:true,id},201);
    }
    if (recordId && (req.method === 'PATCH' || req.method === 'DELETE')) {
      const row = await env.DB.prepare(`SELECT * FROM ${resource} WHERE id=?`).bind(recordId).first();
      if (!row) return json({error:'找不到資料'},404);
      await requireMember(env,row.trip_id,user.id);
      if (req.method === 'DELETE') {
        if (resource === 'itinerary') {
          await env.DB.prepare(`DELETE FROM photos WHERE itinerary_id=?`).bind(recordId).run();
        }
        await env.DB.prepare(`DELETE FROM ${resource} WHERE id=?`).bind(recordId).run();
        await broadcast(env,row.trip_id,{type:`${resource}:delete`,id:recordId});
        ctx.waitUntil(notifyOtherMembers(env,row.trip_id,user.id,`${user.display_name}${eventLabel(resource,'delete')}`,row.title || row.product_name || row.hotel_name || '內容已刪除','/'));
        return json({ok:true});
      }
      const b = await bodyJson(req);
      const data = clean(b,fields);
      const sets = Object.keys(data).map(k=>`${k}=?`);
      const vals = Object.values(data);
      sets.push('updated_at=CURRENT_TIMESTAMP');
      if (resource === 'itinerary') { sets.push('updated_by=?'); vals.push(user.id); }
      if (sets.length) await env.DB.prepare(`UPDATE ${resource} SET ${sets.join(',')} WHERE id=?`).bind(...vals,recordId).run();
      if (resource === 'itinerary' && Array.isArray(b.reminders)) await syncReminders(env,row.trip_id,recordId,user.id,b.reminders);
      await broadcast(env,row.trip_id,{type:`${resource}:update`,id:recordId});
      const body = resource === 'itinerary' ? `${data.date || row.date} ${data.start_time || row.start_time || ''} ${data.title || row.title}`.trim() : (data.title || data.product_name || row.title || row.product_name || '內容已更新');
      ctx.waitUntil(notifyOtherMembers(env,row.trip_id,user.id,`${user.display_name}${eventLabel(resource,'update')}`,body,'/'));
      return json({ok:true});
    }
  }

  return json({error:'API not found'},404);
}

async function scheduled(env) {
  const due = (await env.DB.prepare(`SELECT r.id,r.itinerary_id,r.trip_id,i.date,i.start_time,i.title FROM reminders r JOIN itinerary i ON i.id=r.itinerary_id WHERE r.sent_at IS NULL AND r.scheduled_at<=? ORDER BY r.scheduled_at LIMIT 100`).bind(nowIso()).all()).results || [];
  for (const r of due) {
    const members = (await env.DB.prepare(`SELECT user_id FROM trip_members WHERE trip_id=?`).bind(r.trip_id).all()).results || [];
    const body = `${r.date} ${r.start_time || ''} ${r.title}`.trim();
    await Promise.all(members.map(m=>sendPushToUser(env,m.user_id,{title:'Our Trip 行程提醒',body,url:'/'})));
    await env.DB.prepare(`UPDATE reminders SET sent_at=? WHERE id=?`).bind(nowIso(),r.id).run();
  }
}

export class TripRoom {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/broadcast' && req.method === 'POST') {
      const text = await req.text();
      for (const ws of this.state.getWebSockets()) { try { ws.send(text); } catch {} }
      return new Response('ok');
    }
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket',{status:426});
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({type:'connected'}));
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws, message) { if (message === 'ping') ws.send('pong'); }
}

export default {
  async fetch(req, env, ctx) {
    try {
      const url = new URL(req.url);
      if (url.pathname.startsWith('/api/')) return await api(req,env,ctx);
      return env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof Response) return e;
      console.error(e);
      return json({error:'伺服器錯誤'},500);
    }
  },
  async scheduled(controller, env, ctx) { ctx.waitUntil(scheduled(env)); }
};

