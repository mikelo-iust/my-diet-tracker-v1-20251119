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
  wireDisplayEdits();        // allow clicking visible boxes to edit
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
  // populate inputs (if they exist)
  if ($('sex')) $('sex').value = profile.sex;
  if ($('age')) $('age').value = profile.age;
  if ($('height')) $('height').value = profile.height;
  if ($('current-weight')) $('current-weight').value = profile.currentWeight;
  if ($('target-weight')) $('target-weight').value = profile.targetWeight;
  if ($('activity')) $('activity').value = profile.activity;
  if ($('deficit')) $('deficit').value = profile.deficitPercent;
  if ($('target-bmi')) $('target-bmi').value = profile.targetBMI || '';

  // live compute current BMI and stats when relevant inputs change
  ['age','height','current-weight','sex','activity','deficit','target-weight','target-bmi'].forEach(id => {
    const el = $(id);
    if(!el) return;
    el.addEventListener('change', () => {
      // map input id to profile key
      if(id === 'current-weight') profile.currentWeight = Number(el.value) || profile.currentWeight;
      else if(id === 'target-weight') profile.targetWeight = Number(el.value) || profile.targetWeight;
      else if(id === 'target-bmi') profile.targetBMI = el.value ? Number(el.value) : profile.targetBMI;
      else if(id === 'height') profile.height = Number(el.value) || profile.height;
      else if(id === 'age') profile.age = Number(el.value) || profile.age;
      else if(id === 'deficit') profile.deficitPercent = Number(el.value) || profile.deficitPercent;
      else if(id === 'activity') profile.activity = Number(el.value) || profile.activity;
      else if(id === 'sex') profile.sex = el.value;

      computeProfileStats();
      saveAll();
      renderAll();
    });
  });

  const saveBtn = $('save-profile');
  if (saveBtn) saveBtn.addEventListener('click', () => {
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
  if(forceDailyTargetRecalc || !profile.dailyTarget){
    profile.dailyTarget = dailyTarget;
  } else {
    profile.dailyTarget = dailyTarget;
  }
  // BMI
  const hM = height / 100.0;
  profile.currentBMI = hM > 0 ? Number((weight / (hM*hM)).toFixed(2)) : null;

  // If targetWeight exists and height exists, compute target BMI if not set explicitly
  if (profile.targetWeight && profile.height) {
    profile.targetBMI = Number((profile.targetWeight / (hM*hM)).toFixed(2));
  }

  // Update UI fields (hidden inputs)
  if ($('bmr')) $('bmr').textContent = profile.bmr;
  if ($('tdee')) $('tdee').textContent = profile.tdee;
  if ($('daily-target')) $('daily-target').textContent = profile.dailyTarget;
  if ($('current-bmi')) $('current-bmi').value = profile.currentBMI !== null ? fmt2(profile.currentBMI) : '—';
  if ($('target-bmi')) $('target-bmi').value = profile.targetBMI !== null ? profile.targetBMI : '';

  // Update visible weight display boxes (if present)
  updateDisplayedWeights();

  // compute today's remaining (target minus consumed + burned)
  computeDailyRemainingFor(dateKey(new Date()));
}

/* Update visible weight/goal boxes in the dashboard */
function updateDisplayedWeights(){
  if($('display-current-weight')) $('display-current-weight').textContent = `${profile.currentWeight} kg`;
  if($('display-target-weight')) $('display-target-weight').textContent = `${profile.targetWeight} kg`;
  if($('display-height')) $('display-height').textContent = `${profile.height} cm`;
  if($('display-current-bmi')) $('display-current-bmi').textContent = profile.currentBMI !== null ? fmt2(profile.currentBMI) : '—';
  if($('display-target-bmi')) $('display-target-bmi').textContent = profile.targetBMI !== null ? fmt2(profile.targetBMI) : (profile.targetBMI ? profile.targetBMI : '—');
  if($('display-to-lose')) {
    const toLose = profile.currentWeight - profile.targetWeight;
    $('display-to-lose').textContent = `${toLose > 0 ? fmt2(toLose) : 0} kg`;
  }
}

/* ---------- New: click-to-edit on visible boxes ---------- */
function wireDisplayEdits(){
  // Map visible element IDs to profile input keys
  const map = [
    {el: 'display-current-weight', key: 'currentWeight', suffix: 'kg'},
    {el: 'display-target-weight', key: 'targetWeight', suffix: 'kg'},
    {el: 'display-height', key: 'height', suffix: 'cm'},
    {el: 'display-target-bmi', key: 'targetBMI', suffix: ''},
  ];
  map.forEach(item => {
    const el = $(item.el);
    if(!el) return;
    el.style.cursor = 'pointer';
    el.title = 'Click to edit';
    el.addEventListener('click', () => {
      // show prompt (simple inline editor). You can replace with a modal later.
      const existing = profile[item.key] !== null && profile[item.key] !== undefined ? String(profile[item.key]) : el.textContent.replace(/[^\d.]/g,'');
      const raw = prompt(`Enter new ${item.key.replace(/([A-Z])/g,' $1')}`, existing);
      if(raw === null) return; // cancelled
      const n = Number(raw);
      if(isNaN(n)){
        alert('Please enter a valid number');
        return;
      }
      profile[item.key] = n;
      // Keep the hidden inputs in sync if present
      const inputId = inputIdForProfileKey(item.key);
      if(inputId && $(inputId)) $(inputId).value = n;
      // Recompute everything and persist
      computeProfileStats();
      saveAll();
      renderAll();
    });
  });

  // Also allow editing the deficit via the hidden input, but make sure it's reflected
  const deficitEl = $('deficit');
  if(deficitEl){
    deficitEl.addEventListener('change', () => {
      profile.deficitPercent = Number(deficitEl.value) || profile.deficitPercent;
      computeProfileStats();
      saveAll();
      renderAll();
    });
  }
}

function inputIdForProfileKey(key){
  return {
    currentWeight: 'current-weight',
    targetWeight: 'target-weight',
    height: 'height',
    targetBMI: 'target-bmi'
  }[key];
}

/* ---------- Entries (add/delete/render) ---------- */
function wireEntries(){
  if($('food-form')) $('food-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('food-name').value.trim();
    const cal = Number($('food-calories').value) || 0;
    if(!name) return;
    addFoodForDate(dateKey(new Date()), { name, calories: cal, ts: Date.now() });
    $('food-name').value = '';
    $('food-calories').value = '';
  });

  if($('workout-form')) $('workout-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('workout-name').value.trim();
    const cal = Number($('workout-calories').value) || 0;
    if(!name) return;
    addWorkoutForDate(dateKey(new Date()), { name, calories: cal, ts: Date.now() });
    $('workout-name').value = '';
    $('workout-calories').value = '';
  });

  if($('reset-btn')) $('reset-btn').addEventListener('click', () => {
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
  if($('toggle-calendar')) $('toggle-calendar').addEventListener('click', toggleCalendarView);
  if($('prev-day')) $('prev-day').addEventListener('click', () => shiftCalendar(-1));
  if($('next-day')) $('next-day').addEventListener('click', () => shiftCalendar(1));

  // attach button for photo input
  if($('attach-btn')) $('attach-btn').addEventListener('click', () => $('photo-input').click());
  if($('photo-input')) $('photo-input').addEventListener('change', async (e) => {
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
  if($('today-label')) $('today-label').textContent = today.toLocaleDateString();
}

function renderFoodListFor(dateISO){
  const list = $('food-list');
  if(!list) return;
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
  if($('total-consumed')) $('total-consumed').textContent = total;
}

function renderWorkoutListFor(dateISO){
  const list = $('workout-list');
  if(!list) return;
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
  if($('total-burned')) $('total-burned').textContent = total;
}

function updateSummaryFor(date){
  // use the displayed totals
  const consumed = Number($('total-consumed') ? $('total-consumed').textContent : 0) || 0;
  const burned = Number($('total-burned') ? $('total-burned').textContent : 0) || 0;
  if($('net-calories')) $('net-calories').textContent = consumed - burned;
  // daily remaining: profile.dailyTarget - consumed + burned
  const remaining = (profile.dailyTarget || 0) - consumed + burned;
  if($('daily-remaining')) $('daily-remaining').textContent = remaining;
  if($('daily-target')) $('daily-target').textContent = profile.dailyTarget || '—';
}

/* ---------- Calendar behavior ---------- */
function toggleCalendarView(){
  const expanded = document.body.classList.toggle('calendar-expanded');
  if(expanded){
    showPastDaysList(7);
    if($('toggle-calendar')) $('toggle-calendar').textContent = 'Close • Today • ' + new Date().toLocaleDateString();
  } else {
    if($('toggle-calendar')) $('toggle-calendar').textContent = 'Today • ' + new Date().toLocaleDateString();
    renderFoodListFor(dateKey(new Date()));
    renderWorkoutListFor(dateKey(new Date()));
  }
}

function showPastDaysList(days){
  calendarOffsetDays = 0;
  renderFoodListFor(dateKey(offsetDate(new Date(), calendarOffsetDays)));
  renderWorkoutListFor(dateKey(offsetDate(new Date(), calendarOffsetDays)));
}

function shiftCalendar(delta){
  calendarOffsetDays += delta;
  const d = offsetDate(new Date(), calendarOffsetDays);
  const label = d.toLocaleDateString();
  if($('toggle-calendar')) $('toggle-calendar').textContent = `${label}`;
  renderFoodListFor(dateKey(d));
  renderWorkoutListFor(dateKey(d));
}

/* ---------- Chat & clipboard image handling ---------- */
function wireChat(){
  if($('send-msg')) $('send-msg').addEventListener('click', sendChatMessage);
  if($('chat-input')) $('chat-input').addEventListener('keydown', e => {
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
  addChatMessage('user', 'Image attached');
  const imgURL = URL.createObjectURL(file);
  addChatImage(imgURL, 'user');
  addChatMessage('bot', 'Analyzing image (stub)...');
  addChatImage(imgURL, 'bot');

  try{
    const res = await analyzePhoto(file);
    addChatMessage('bot', res.message || 'No analysis result');
    if(res.items && res.items.length){
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
  if($('messages')){
    $('messages').appendChild(div);
    $('messages').scrollTop = $('messages').scrollHeight;
  }
}

function addChatImage(src, who){
  const div = document.createElement('div');
  div.className = 'msg ' + (who === 'user' ? 'user' : 'bot');
  const img = document.createElement('img');
  img.src = src;
  img.style.maxWidth = '200px';
  img.style.display = 'block';
  img.style.marginTop = '6px';
  if($('messages')){
    $('messages').appendChild(div);
    div.appendChild(img);
    $('messages').scrollTop = $('messages').scrollHeight;
  }
}

function sendChatMessage(){
  const v = $('chat-input') ? $('chat-input').value.trim() : '';
  if(!v) return;
  addChatMessage('user', v);
  if($('chat-input')) $('chat-input').value = '';
  setTimeout(() => addChatMessage('bot', "Assistant: (stub) I can analyze pasted images. Try pasting an image or say 'analyze photo'."), 400);
}

/* ---------- Photo analysis stub (replace with server-side inference) ---------- */
async function analyzePhoto(file){
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
  const now = new Date();
  const nextSunday = nextWeekdayAtHour(0, 23);
  const ms = nextSunday.getTime() - now.getTime();
  if(ms <= 0){
    tryWeeklyAdjustment();
    setTimeout(scheduleWeeklyAdjustment, 1000 * 60 * 60 * 24 * 7);
  } else {
    setTimeout(() => {
      tryWeeklyAdjustment();
      scheduleWeeklyAdjustment();
    }, ms);
  }
}

function nextWeekdayAtHour(weekday, hour){
  const now = new Date();
  const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  let delta = (7 + weekday - cur.getDay()) % 7;
  if(delta === 0 && now > cur) delta = 7;
  const next = offsetDate(cur, delta);
  return next;
}

function tryWeeklyAdjustment(){
  const nextWeekMonday = offsetDate(nextWeekdayAtHour(0,23), 1);
  const mondayISO = dateKey(nextWeekMonday);
  if(meta.lastWeeklyAdjustmentISO === mondayISO){
    console.log('Weekly adjustment already applied for week starting', mondayISO);
    return;
  }
  applyWeeklyAdjustmentForWeekStarting(mondayISO);
  meta.lastWeeklyAdjustmentISO = mondayISO;
  saveAll();
  const message = `Weekly calorie allocation updated for week starting ${mondayISO}. Daily target: ${profile.dailyTarget} kcal/day`;
  pushNotification('Calorie targets updated', message);
  showModal('Weekly Adjustment', message);
}

function applyWeeklyAdjustmentForWeekStarting(weekISO){
  computeProfileStats(true);
  profile.lastAdjustmentISO = new Date().toISOString();
  saveAll();
}

/* ---------- Notifications ---------- */
function pushNotification(title, body){
  if("Notification" in window && Notification.permission === "granted"){ 
    new Notification(title, { body });
  } else {
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
  if($('modal-title')) $('modal-title').textContent = title;
  if($('modal-message')) $('modal-message').textContent = message;
  if($('notification-modal')) $('notification-modal').classList.remove('hidden');
  if($('modal-ok')) $('modal-ok').onclick = () => $('notification-modal').classList.add('hidden');
}

/* ---------- Utilities ---------- */
function offsetDate(d, days){
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function escapeHtml(text){
  return String(text).replace(/[&<>\\\"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[s]));
}

/* ---------- KPI helpers (new) ---------- */
function sumCaloriesFromLocalStorage(key){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return 0;
    const obj = JSON.parse(raw);
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
  if($('kpi-consumed')) $('kpi-consumed').textContent = consumed;
  if($('kpi-burned')) $('kpi-burned').textContent = burned;
  const remaining = (profile.dailyTarget || 0) - consumed + burned;
  const remEl = $('kpi-remaining');
  if(remEl) remEl.textContent = remaining;
}

const _origSaveAll = saveAll;
saveAll = function(){ _origSaveAll(); updateKPIs(); };

if(document.readyState === 'complete' || document.readyState === 'interactive'){
  setTimeout(updateKPIs, 50);
} else {
  document.addEventListener('DOMContentLoaded', () => setTimeout(updateKPIs, 50));
}