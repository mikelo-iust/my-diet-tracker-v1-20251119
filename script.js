// App prototype script: profile, entries, calendar, chatbot paste/upload, BMR/TDEE, weekly adjustment.

// --- Storage keys
const LS = {
  PROFILE: 'dt_profile_v1',
  FOOD: 'dt_food_v1',
  WORKOUT: 'dt_workout_v1',
  META: 'dt_meta_v1' // for last adjustment time etc
};

// --- Helpers
const $ = id => document.getElementById(id);
const fmt2 = v => (Math.round(v * 100) / 100).toFixed(2);

// --- App state
let profile = {};
let foodEntries = {};   // keyed by date ISO (YYYY-MM-DD) => array
let workoutEntries = {}; // keyed by date
let meta = { lastWeeklyAdjustmentISO: null };

// --- Init
document.addEventListener('DOMContentLoaded', () => {
  loadAll();
  wireProfile();
  wireEntries();
  wireChat();
  renderAll();
  scheduleWeeklyAdjustment();
  requestNotificationPermissionIfNeeded();
  // Clipboard paste anywhere -> chat image
  window.addEventListener('paste', handlePasteEvent);
});

/* ---------- Persistence ---------- */
function loadAll(){
  try{
    profile = JSON.parse(localStorage.getItem(LS.PROFILE)) || defaultProfile();
    foodEntries = JSON.parse(localStorage.getItem(LS.FOOD)) || {};
    workoutEntries = JSON.parse(localStorage.getItem(LS.WORKOUT)) || {};
    meta = JSON.parse(localStorage.getItem(LS.META)) || meta;
  }catch(e){
    console.error('Load error', e);
    profile = defaultProfile();
    foodEntries = {};
    workoutEntries = {};
    meta = {};
  }
}

function saveAll(){
  localStorage.setItem(LS.PROFILE, JSON.stringify(profile));
  localStorage.setItem(LS.FOOD, JSON.stringify(foodEntries));
  localStorage.setItem(LS.WORKOUT, JSON.stringify(workoutEntries));
  localStorage.setItem(LS.META, JSON.stringify(meta));
}

/* ---------- Default profile ---------- */
function defaultProfile(){
  return {
    sex: 'male',
    age: 30,
    height: 175,
    currentWeight: 75,
    targetWeight: 70,
    activity: 1.375,
    deficitPercent: 20,
    targetBMI: null,
    dailyTarget: null,
    lastAdjustmentISO: null
  };
}

/* ---------- UI wiring ---------- */
function wireProfile(){
  // populate inputs
  $('sex').value = profile.sex;
  $('age').value = profile.age;
  $('height').value = profile.height;
  $('current-weight').value = profile.currentWeight;
  $('target-weight').value = profile.targetWeight;
  $('activity').value = profile.activity;
  $('deficit').value = profile.deficitPercent;
  $('target-bmi').value = profile.targetBMI || '';

  // live compute current BMI and stats when relevant inputs change
  ['age','height','current-weight','sex','activity','deficit'].forEach(id => {
    $(id).addEventListener('change', () => {
      profile[id === 'current-weight' ? 'currentWeight' : id] = getInputValueForProfile(id);
      computeProfileStats();
      saveAll();
      renderAll();
    });
  });

  $('save-profile').addEventListener('click', () => {
    // transfer values
    profile.sex = $('sex').value;
    profile.age = Number($('age').value) || profile.age;
    profile.height = Number($('height').value) || profile.height;
    profile.currentWeight = Number($('current-weight').value) || profile.currentWeight;
    profile.targetWeight = Number($('target-weight').value) || profile.targetWeight;
    profile.activity = Number($('activity').value) || profile.activity;
    profile.deficitPercent = Number($('deficit').value) || profile.deficitPercent;
    profile.targetBMI = $('target-bmi').value ? Number($('target-bmi').value) : profile.targetBMI;
    computeProfileStats(true);
    saveAll();
    renderAll();
    showModal('Profile saved', 'Your profile and daily target have been saved and recalculated.');
  });
}

function getInputValueForProfile(id){
  const el = $(id);
  if(!el) return null;
  if(id === 'current-weight') return Number(el.value) || profile.currentWeight;
  if(id === 'age' || id === 'height') return Number(el.value) || profile[id];
  if(id === 'deficit') return Number(el.value) || profile.deficitPercent;
  return el.value;
}

/* ---------- Profile computations ---------- */
function computeProfileStats(forceDailyTargetRecalc = false){
  // BMR Mifflin-St Jeor
  const weight = Number(profile.currentWeight);
  const height = Number(profile.height);
  const age = Number(profile.age);
  const s = profile.sex === 'female' ? -161 : 5;
  const bmr = Math.round(10 * weight + 6.25 * height - 5 * age + s);
  const tdee = Math.round(bmr * Number(profile.activity || 1.2));
  const deficit = (Number(profile.deficitPercent) || 0) / 100;
  const dailyTarget = Math.round(tdee * (1 - deficit));

  profile.bmr = bmr;
  profile.tdee = tdee;
  // If dailyTarget hasn't been set or forced, update
  if(forceDailyTargetRecalc || !profile.dailyTarget){
    profile.dailyTarget = dailyTarget;
  } else {
    // If we want to auto-update dailyTarget every time profile changes, uncomment:
    profile.dailyTarget = dailyTarget;
  }
  // BMI
  const hM = height / 100.0;
  profile.currentBMI = hM > 0 ? Number((weight / (hM*hM)).toFixed(2)) : null;
  // Update UI fields
  $('bmr').textContent = profile.bmr;
  $('tdee').textContent = profile.tdee;
  $('daily-target').textContent = profile.dailyTarget;
  $('current-bmi').value = profile.currentBMI !== null ? fmt2(profile.currentBMI) : '—';

  // compute today's remaining (target minus consumed + burned)
  computeDailyRemainingFor(dateKey(new Date()));
}

/* ---------- Entries (add/delete/render) ---------- */
function wireEntries(){
  $('food-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('food-name').value.trim();
    const cal = Number($('food-calories').value) || 0;
    if(!name) return;
    addFoodForDate(dateKey(new Date()), { name, calories: cal, ts: Date.now() });
    $('food-name').value = '';
    $('food-calories').value = '';
  });

  $('workout-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('workout-name').value.trim();
    const cal = Number($('workout-calories').value) || 0;
    if(!name) return;
    addWorkoutForDate(dateKey(new Date()), { name, calories: cal, ts: Date.now() });
    $('workout-name').value = '';
    $('workout-calories').value = '';
  });

  $('reset-btn').addEventListener('click', () => {
    if(confirm('Reset all entries and profile?')) {
      localStorage.clear();
      profile = defaultProfile();
      foodEntries = {};
      workoutEntries = {};
      meta = { lastWeeklyAdjustmentISO: null };
      saveAll();
      renderAll();
      showModal('Reset', 'Everything has been reset locally.');
    }
  });

  // calendar controls
  $('toggle-calendar').addEventListener('click', toggleCalendarView);
  $('prev-day').addEventListener('click', () => shiftCalendar(-1));
  $('next-day').addEventListener('click', () => shiftCalendar(1));

  // attach button for photo input
  $('attach-btn').addEventListener('click', () => $('photo-input').click());
  $('photo-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if(file) {
      await handleChatImage(file);
      e.target.value = '';
    }
  });

  // delegated delete
  document.body.addEventListener('click', e => {
    if(e.target.matches('.entry-del')){
      const { type, date, idx } = e.target.dataset;
      if(confirm('Delete this entry?')) {
        deleteEntry(type, date, Number(idx));
        saveAll();
        renderAll();
      }
    }
  });
}

/* Add / delete helpers */
function addFoodForDate(dateISO, item){
  foodEntries[dateISO] = foodEntries[dateISO] || [];
  foodEntries[dateISO].unshift(item);
  saveAll();
  renderAll();
}

function addWorkoutForDate(dateISO, item){
  workoutEntries[dateISO] = workoutEntries[dateISO] || [];
  workoutEntries[dateISO].unshift(item);
  saveAll();
  renderAll();
}

function deleteEntry(type, dateISO, idx){
  const target = type === 'food' ? foodEntries : workoutEntries;
  if(!target[dateISO]) return;
  target[dateISO].splice(idx,1);
  if(target[dateISO].length === 0) delete target[dateISO];
  saveAll();
}

/* ---------- Rendering ---------- */
let calendarOffsetDays = 0; // 0 = today
function dateKey(d){
  const iso = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0,10);
  return iso;
}

function renderAll(){
  computeProfileStats();
  renderCalendarHeader();
  renderFoodListFor(dateKey(offsetDate(new Date(), calendarOffsetDays)));
  renderWorkoutListFor(dateKey(offsetDate(new Date(), calendarOffsetDays)));
  updateSummaryFor(dateKey(new Date()));
  updateKPIs();
}

function renderCalendarHeader(){
  const today = new Date();
  $('today-label').textContent = today.toLocaleDateString();
}

function renderFoodListFor(dateISO){
  const list = $('food-list');
  list.innerHTML = '';
  const arr = foodEntries[dateISO] || [];
  let total = 0;
  arr.forEach((f, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(f.name)} <span class="meta">(${new Date(f.ts).toLocaleTimeString()})</span></span>
      <span>${f.calories} kcal <button class="entry-del" data-type="food" data-date="${dateISO}" data-idx="${idx}">✕</button></span>`;
    list.appendChild(li);
    total += Number(f.calories) || 0;
  });
  $('total-consumed').textContent = total;
}

function renderWorkoutListFor(dateISO){
  const list = $('workout-list');
  list.innerHTML = '';
  const arr = workoutEntries[dateISO] || [];
  let total = 0;
  arr.forEach((w, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(w.name)} <span class="meta">(${new Date(w.ts).toLocaleTimeString()})</span></span>
      <span>${w.calories} kcal <button class="entry-del" data-type="workout" data-date="${dateISO}" data-idx="${idx}">✕</button></span>`;
    list.appendChild(li);
    total += Number(w.calories) || 0;
  });
  $('total-burned').textContent = total;
}

function updateSummaryFor(date){
  // use the displayed totals
  const consumed = Number($('total-consumed').textContent) || 0;
  const burned = Number($('total-burned').textContent) || 0;
  $('net-calories').textContent = consumed - burned;
  // daily remaining: profile.dailyTarget - consumed + burned
  const remaining = (profile.dailyTarget || 0) - consumed + burned;
  $('daily-remaining').textContent = remaining;
  $('daily-target').textContent = profile.dailyTarget || '—';
}

/* ---------- Calendar behavior ---------- */
function toggleCalendarView(){
  // simple expand/collapse: show previous 7 days when expanded
  const expanded = document.body.classList.toggle('calendar-expanded');
  if(expanded){
    showPastDaysList(7);
    $('toggle-calendar').textContent = 'Close • Today • ' + new Date().toLocaleDateString();
  } else {
    $('toggle-calendar').textContent = 'Today • ' + new Date().toLocaleDateString();
    // hide list -> re-render only current
    renderFoodListFor(dateKey(new Date()));
    renderWorkoutListFor(dateKey(new Date()));
  }
}

function showPastDaysList(days){
  // render small quick list (simple)
  const main = document.querySelector('.calendar-block');
  // For prototype, we'll just ensure the food/workout lists show the selected offset day
  // Create a small day selector UI under the header
  calendarOffsetDays = 0;
  renderFoodListFor(dateKey(offsetDate(new Date(), calendarOffsetDays)));
  renderWorkoutListFor(dateKey(offsetDate(new Date(), calendarOffsetDays)));
}

function shiftCalendar(delta){
  calendarOffsetDays += delta;
  const d = offsetDate(new Date(), calendarOffsetDays);
  const label = d.toLocaleDateString();
  $('toggle-calendar').textContent = `${label}`;
  renderFoodListFor(dateKey(d));
  renderWorkoutListFor(dateKey(d));
}

/* ---------- Chat & clipboard image handling ---------- */
function wireChat(){
  $('send-msg').addEventListener('click', sendChatMessage);
  $('chat-input').addEventListener('keydown', e => {
    if(e.key === 'Enter') sendChatMessage();
  });
}

function handlePasteEvent(e){
  const items = e.clipboardData && e.clipboardData.items;
  if(!items) return;
  for(const it of items){
    if(it.type.indexOf('image') !== -1){
      const file = it.getAsFile();
      if(file) {
        handleChatImage(file);
        e.preventDefault();
      }
    }
  }
}

async function handleChatImage(file){
  // create a chat message with image preview
  addChatMessage('user', 'Image attached');
  const imgURL = URL.createObjectURL(file);
  addChatImage(imgURL, 'user');
  addChatMessage('bot', 'Analyzing image (stub)...');
  addChatImage(imgURL, 'bot'); // echo back in bot message for placeholder

  // call analyzePhoto (stub) - replace with real API call later
  try{
    const res = await analyzePhoto(file);
    addChatMessage('bot', res.message || 'No analysis result');
    if(res.items && res.items.length){
      // propose to add recognized items to today's food list
      res.items.forEach(it => {
        const btn = document.createElement('button');
        btn.textContent = `Add ${it.name} (${it.cal} kcal)`;
        btn.addEventListener('click', () => addFoodForDate(dateKey(new Date()), { name: it.name, calories: it.cal, ts: Date.now() }));
        const container = document.createElement('div');
        container.appendChild(btn);
        const messages = $('messages');
        messages.appendChild(container);
        messages.scrollTop = messages.scrollHeight;
      });
    }
  }catch(err){
    addChatMessage('bot', 'Analysis failed (see console).');
    console.error(err);
  }
}

function addChatMessage(who, text){
  const div = document.createElement('div');
  div.className = 'msg ' + (who === 'user' ? 'user' : 'bot');
  div.textContent = text;
  $('messages').appendChild(div);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function addChatImage(src, who){
  const div = document.createElement('div');
  div.className = 'msg ' + (who === 'user' ? 'user' : 'bot');
  const img = document.createElement('img');
  img.src = src;
  img.style.maxWidth = '200px';
  img.style.display = 'block';
  img.style.marginTop = '6px';
  div.appendChild(img);
  $('messages').appendChild(div);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function sendChatMessage(){
  const v = $('chat-input').value.trim();
  if(!v) return;
  addChatMessage('user', v);
  $('chat-input').value = '';
  // bot echo (placeholder)
  setTimeout(() => addChatMessage('bot', "Assistant: (stub) I can analyze pasted images. Try pasting an image or say 'analyze photo'."), 400);
}

/* ---------- Photo analysis stub (replace with server-side inference) ---------- */
async function analyzePhoto(file){
  // Placeholder: return mock recognized items after short delay
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({
        success: true,
        message: 'Mock analysis: detected 2 items',
        items: [
          { name: 'Chicken breast', cal: 220 },
          { name: 'Brown rice', cal: 180 }
        ]
      });
    }, 800);
  });
}

/* ---------- Weekly adjustment scheduling ---------- */
function scheduleWeeklyAdjustment(){
  // Calculate milliseconds until next Sunday 23:00 local time
  const now = new Date();
  const nextSunday = nextWeekdayAtHour(0, 23); // Sunday (0) at 23:00
  const ms = nextSunday.getTime() - now.getTime();
  // If already past and within a second, run now
  if(ms <= 0){
    tryWeeklyAdjustment();
    // schedule for next week
    setTimeout(scheduleWeeklyAdjustment, 1000 * 60 * 60 * 24 * 7);
  } else {
    setTimeout(() => {
      tryWeeklyAdjustment();
      scheduleWeeklyAdjustment(); // schedule next week's
    }, ms);
  }
}

function nextWeekdayAtHour(weekday, hour){
  // weekday: 0=Sunday .. 6=Saturday. Return next occurrence of weekday at given hour
  const now = new Date();
  const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  let delta = (7 + weekday - cur.getDay()) % 7;
  if(delta === 0 && now > cur) delta = 7; // if same day but past hour -> next week
  const next = offsetDate(cur, delta);
  return next;
}

function tryWeeklyAdjustment(){
  // Will run if we haven't done the adjustment for the upcoming week yet.
  // We'll mark adjustment by storing ISO date of the Monday that follows this Sunday.
  const nextWeekMonday = offsetDate(nextWeekdayAtHour(0,23), 1); // Sunday23 +1 day = Monday
  const mondayISO = dateKey(nextWeekMonday);
  if(meta.lastWeeklyAdjustmentISO === mondayISO){
    console.log('Weekly adjustment already applied for week starting', mondayISO);
    return;
  }
  // Apply adjustment
  applyWeeklyAdjustmentForWeekStarting(mondayISO);
  meta.lastWeeklyAdjustmentISO = mondayISO;
  saveAll();
  const message = `Weekly calorie allocation updated for week starting ${mondayISO}. Daily target: ${profile.dailyTarget} kcal/day`;
  pushNotification('Calorie targets updated', message);
  showModal('Weekly Adjustment', message);
}

function applyWeeklyAdjustmentForWeekStarting(weekISO){
  // according to user's profile, recalc BMR/TDEE/dailyTarget and set profile.dailyTarget accordingly
  computeProfileStats(true);
  // You might consider adjusting based on last week's actual activity (advanced)—for prototype we use profile.activity and deficit
  // Save lastAdjustment time
  profile.lastAdjustmentISO = new Date().toISOString();
  saveAll();
}

/* ---------- Notifications ---------- */
function pushNotification(title, body){
  if("Notification" in window && Notification.permission === "granted"){ 
    new Notification(title, { body });
  } else {
    // fallback in-app modal
    showModal(title, body);
  }
}

function requestNotificationPermissionIfNeeded(){
  if("Notification" in window && Notification.permission === "default"){ 
    Notification.requestPermission().then(permission => {
      if(permission === 'granted'){
        console.log('Notifications granted');
      }
    });
  }
}

/* ---------- Modal ---------- */
function showModal(title, message){
  $('modal-title').textContent = title;
  $('modal-message').textContent = message;
  $('notification-modal').classList.remove('hidden');
  $('modal-ok').onclick = () => $('notification-modal').classList.add('hidden');
}

/* ---------- Utilities ---------- */
function offsetDate(d, days){
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function escapeHtml(text){
  return String(text).replace(/[&<>\"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

/* ---------- KPI helpers (new) ---------- */
function sumCaloriesFromLocalStorage(key){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return 0;
    const obj = JSON.parse(raw);
    // obj is expected to be date-keyed map -> arrays
    let total = 0;
    if(typeof obj === 'object'){
      Object.values(obj).forEach(arr => {
        if(Array.isArray(arr)) arr.forEach(item => total += Number(item.calories) || 0);
      });
    }
    return total;
  }catch(e){ return 0; }
}

function updateKPIs(){
  const consumed = sumCaloriesFromLocalStorage(LS.FOOD);
  const burned = sumCaloriesFromLocalStorage(LS.WORKOUT);
  $('kpi-consumed').textContent = consumed;
  $('kpi-burned').textContent = burned;
  const remaining = (profile.dailyTarget || 0) - consumed + burned;
  const remEl = $('kpi-remaining');
  if(remEl) remEl.textContent = remaining;
}

// Ensure KPIs refresh when data changes: hook saveAll
const _origSaveAll = saveAll;
saveAll = function(){ _origSaveAll(); updateKPIs(); };

// Also update on load
if(document.readyState === 'complete' || document.readyState === 'interactive'){
  setTimeout(updateKPIs, 50);
} else {
  document.addEventListener('DOMContentLoaded', () => setTimeout(updateKPIs, 50));
}