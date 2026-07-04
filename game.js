// game.js — full file with no_tent image support, shop button hidden during day and shown after day ends (DAY_LENGTH = 140)
// Save as UTF-8 (no BOM)

(function(){
  // ----- Configuration -----
  var DAY_LENGTH = 60; // seconds for testing: day length
  var TOTAL_DAYS = 5;
  var CANVAS_WIDTH = 900;
  var CANVAS_HEIGHT = 600;
  var BACKPACK_MAX = 50;

  // Probability that an event occurs after shop-close (0..1)
  var EVENT_CHANCE = 0.7;

  var assets = {
    background: 'assets/background.png',
    player: 'assets/player.png',
    oracleTent: 'assets/oracle_tent.webp',
    normalTent: 'assets/normal_tent.webp',
    oracleInside: 'assets/oracle_inside.webp',
    normalInside: 'assets/normal_tent_inside.webp',
    noTent: 'assets/no tent.png' // <-- added no_tent asset
  };

  // ----- Game state -----
  var money = 0;
  var health = 100;
  var day = 1;
  var timer = DAY_LENGTH;
  var backpack = [];
  var activeMultipliers = { river: 0, tree: 0 };
  var plantingUnlocked = false;
  var hasSeed = false;
  var tents = [];
  var mosquitoSprays = 0;
  var acOwned = 0;
  var usbChargers = 0;
  var icePacks = 0;
  var plantedTrees = [];
  var inTent = null;
  var insideTimer = 0;
  var gameOver = false;

  // River cleaning state
  var cleaningRiver = false;
  var cleaningEndTs = 0;
  var riverParticles = [];

  // Planting state
  var plantingInProgress = false;
  var plantingEndTs = 0;
  var plantingStartTs = 0;

  // Shop / event flags
  var shopOpenedThisDay = false;
  var eventTriggeredThisDay = false;

  // Modal lock (blocks movement/actions while true)
  var modalOpen = false;
  var shopLocked = false;

  // Prevent scheduling endNight multiple times
  var nightEnding = false;

  // Canvas & UI references
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;

  var ui = {
    day: document.getElementById('day'),
    timer: document.getElementById('timer'),
    money: document.getElementById('money'),
    health: document.getElementById('health'),
    invList: document.getElementById('invList'),
    invCount: document.getElementById('invCount'),
    notifications: document.getElementById('notifications'),
    shopOverlay: document.getElementById('shopOverlay'),
    shopButton: document.getElementById('shopButton'),
    openShop: document.getElementById('openShop'),
    closeShop: document.getElementById('closeShop'),
    shopButtons: document.querySelectorAll('[data-buy]'),
    plantModal: document.getElementById('plantModal'),
    unlockPlantBtn: document.getElementById('unlockPlant'),
    closePlantBtn: document.getElementById('closePlant'),
    tentCount: document.getElementById('tentCount'),
    tentInside: document.getElementById('tentInside'),
    insideImg: document.getElementById('insideImg'),
    insideText: document.getElementById('insideText'),
    endOverlay: document.getElementById('endOverlay'),
    endTitle: document.getElementById('endTitle'),
    endScore: document.getElementById('endScore'),
    restartBtn: document.getElementById('restart'),
    touchPickup: document.getElementById('touchPickup'),
    touchInteract: document.getElementById('touchInteract'),
    touchEnter: document.getElementById('touchEnter'),
    touchShop: document.getElementById('touchShop'),
    shopNotice: document.getElementById('shopNotice') // optional element that holds "You can buy items in the shop! SHOP"
  };

// remove the shop control button shown with the other controls (keeps G/E/H)
if (ui.touchShop && ui.touchShop.parentNode) {
  ui.touchShop.parentNode.removeChild(ui.touchShop);
  ui.touchShop = null;
}

// also remove the external #shopButton if present (optional)
// keeps shop logic (shopOverlay, timer) intact
if (ui.shopButton && ui.shopButton.parentNode) {
  ui.shopButton.parentNode.removeChild(ui.shopButton);
  ui.shopButton = null;
}

  // Player
  var player = { x: CANVAS_WIDTH/2, y: CANVAS_HEIGHT/2, speed: 160, w: 48, h: 72 };

  // Regions
  var riverArea = { x: 80, y: 60, w: 160, h: 420 };
  var plantingArea = { x: CANVAS_WIDTH - 140, y: CANVAS_HEIGHT - 160, w: 120, h: 120 };
  var campArea = { x: CANVAS_WIDTH/2 - 120, y: 20, w: 240, h: 120 };

  // cleaningArea bottom-left by default
  var cleaningArea = { x: 20, y: CANVAS_HEIGHT - 160, w: 220, h: 140 };

  var butterflies = [];
  var items = [];

  var keys = {};
  window.addEventListener('keydown', function(e){ if (e.key) keys[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', function(e){ if (e.key) keys[e.key.toLowerCase()] = false; });

  // Helpers
  function rand(min, max){ return Math.random() * (max - min) + min; }
  function randInt(min, max){ return Math.floor(rand(min, max + 1)); }
  function now(){ return Date.now(); }

  function addNotification(text, timeout){
    timeout = timeout || 3500;
    var div = document.createElement('div');
    div.textContent = text;
    if (ui.notifications) ui.notifications.appendChild(div);
    setTimeout(function(){ try{ div.remove(); }catch(e){} }, timeout);
  }

  // Image loader
  var imageCache = {};
  function loadImage(src){
    return new Promise(function(res){
      if (!src) return res(null);
      if (imageCache[src]) return res(imageCache[src]);
      var img = new Image();
      img.src = src;
      img.onload = function(){ imageCache[src] = img; res(img); };
      img.onerror = function(){ console.warn('Image failed', src); res(null); };
    });
  }

  // Init butterflies
  for (var i=0;i<12;i++){
    butterflies.push({ x: rand(100, CANVAS_WIDTH-100), y: rand(80, CANVAS_HEIGHT-80), vx: rand(-20,20), vy: rand(-10,10), size: rand(6,12), color: '#ffd400' });
  }

  // Spawn items
  function spawnItem(){
    var types = ['wood','coin','food','trash','seed'];
    var type = types[randInt(0, types.length-1)];
    var x = rand(40, CANVAS_WIDTH - 40);
    var y = rand(120, CANVAS_HEIGHT - 40);
    var id = Math.random().toString(36).slice(2);
    var amount = 1;
    if (type === 'coin') amount = randInt(1,15);
    items.push({ id: type + '_' + id, type: type, x: x, y: y, spawnedAt: now(), amount: amount });
  }
  var spawnTimerId = null;
  function startSpawning(){ spawnItem(); spawnTimerId = setInterval(spawnItem, randInt(2000,3000)); }
  function stopSpawning(){ if (spawnTimerId) clearInterval(spawnTimerId); spawnTimerId = null; }

  // Inventory UI: Backpack: /50 (user requested remove current count)
  function updateInventoryUI(){
    if (!ui.invList) return;
    ui.invList.innerHTML = '';
    var counts = {};
    backpack.forEach(function(it){ counts[it.type] = (counts[it.type]||0)+1; });
    for (var t in counts){
      var li = document.createElement('li');
      li.textContent = t + ' x' + counts[t];
      ui.invList.appendChild(li);
    }
    if (ui.invCount) ui.invCount.textContent = 'Backpack: /' + BACKPACK_MAX;
    if (ui.money) ui.money.textContent = Math.floor(money);
    if (ui.health) ui.health.textContent = Math.max(0,Math.floor(health));
    if (ui.day) ui.day.textContent = day;
    if (ui.tentCount) ui.tentCount.textContent = tents.length;
  }

  // Emoji map
  var EMOJI = { wood:'\uD83E\uDEB5', coin:'\uD83D\uDCB0', food:'\uD83C\uDF72', trash:'\u267B', seed:'\uD83C\uDF31', tree:'\uD83C\uDF33', broom:'\uD83E\uDDF9' };

  // Core actions
  function tryPickup(){
    if (modalOpen || cleaningRiver || plantingInProgress){ addNotification('Busy or modal open'); return; }
    var reach = 36;
    var found = null;
    for (var i=0;i<items.length;i++){
      var it = items[i];
      var d = Math.hypot(player.x - it.x, player.y - it.y);
      if (d < reach){ found = it; break; }
    }
    if (!found){ addNotification('No item nearby to pick up'); return; }
    if (backpack.length >= BACKPACK_MAX){ addNotification('Backpack full'); return; }

    backpack.push({ type: found.type, amount: found.amount });
    updateInventoryUI();

    var value = 0;
    if (found.type === 'wood') value = 2;
    if (found.type === 'coin') value = found.amount;
    if (found.type === 'food') value = 5;
    if (found.type === 'trash') value = 0;
    if (found.type === 'seed'){ hasSeed = true; if (ui.plantModal) ui.plantModal.classList.remove('hidden'); }

    var nowTs = now();
    if (activeMultipliers.river > nowTs) value *= 2;
    if (activeMultipliers.tree > nowTs) value *= 2;

    if (found.type === 'trash'){ money = Math.max(0, money * 0.9); addNotification('Picked up TRASH! Money -10%'); }
    else { money += value; addNotification('Picked up ' + found.type + ' ' + (EMOJI[found.type]||'') + ' (+$' + Math.floor(value) + ')'); }

    items = items.filter(function(it){ return it.id !== found.id; });
    updateInventoryUI();
  }

  // Start cleaning
  function startCleaning(){
    if (modalOpen || cleaningRiver) return;
    cleaningRiver = true;
    cleaningEndTs = now() + 30000;
    activeMultipliers.river = now() + 30000;
    riverParticles = [];
    for (var i=0;i<12;i++){
      riverParticles.push({ x: rand(cleaningArea.x + 10, cleaningArea.x + cleaningArea.w - 10), y: rand(cleaningArea.y + 10, cleaningArea.y + cleaningArea.h - 10), vx: rand(-20,20), vy: rand(-10,10), life: rand(1500,4000), born: now(), char: '[P]' });
    }
    addNotification('You started cleaning the river — frozen for 30s (x2 money for 30s)');
  }

  function tryCleanRiver(){
    var inCleaning = (player.x > cleaningArea.x && player.x < cleaningArea.x + cleaningArea.w && player.y > cleaningArea.y && player.y < cleaningArea.y + cleaningArea.h);
    if (!inCleaning){ addNotification('Not near river cleaning area'); return; }
    startCleaning();
  }

  // Planting unlock / actions
  if (ui.unlockPlantBtn) ui.unlockPlantBtn.addEventListener('click', function(){ plantingUnlocked = true; if (ui.plantModal) ui.plantModal.classList.add('hidden'); addNotification('Plant action unlocked. Go to the planting area and press E to plant.'); });
  if (ui.closePlantBtn) ui.closePlantBtn.addEventListener('click', function(){ if (ui.plantModal) ui.plantModal.classList.add('hidden'); });

  function tryPlantTree(){
    if (modalOpen || cleaningRiver) { addNotification('Busy or modal open'); return; }
    if (!plantingUnlocked){ addNotification('You must unlock planting by picking a seed'); return; }
    if (!hasSeed && !backpack.find(function(i){ return i.type === 'seed'; })){ addNotification('You have no seed in backpack'); return; }
    var d = Math.hypot(player.x - (plantingArea.x+plantingArea.w/2), player.y - (plantingArea.y+plantingArea.h/2));
    if (d > 80){ addNotification('Go to the planting area to plant'); return; }
    if (plantingInProgress){ addNotification('Already planting'); return; }
    var idx = backpack.findIndex(function(i){ return i.type === 'seed'; });
    if (idx !== -1) backpack.splice(idx,1);
    hasSeed = false;
    plantingInProgress = true;
    plantingStartTs = now();
    plantingEndTs = now() + 45000;
    addNotification('Planting tree... (45s) — you are frozen while planting');
  }

  // Shop wiring and helpers
  if (ui.openShop) ui.openShop.addEventListener('click', function(){ if (ui.shopOverlay) ui.shopOverlay.classList.remove('hidden'); modalOpen = true; wireShopButtons(); ensureDontBuyButton(); });
  if (ui.closeShop) ui.closeShop.addEventListener('click', function(){
    if (shopLocked) {
      postShopClose(false);
    } else {
      if (ui.shopOverlay) ui.shopOverlay.classList.add('hidden');
      modalOpen = false;
    }
  });

  function ensureDontBuyButton(){
    if (!ui.shopOverlay) return null;
    var card = ui.shopOverlay.querySelector('.card') || ui.shopOverlay;
    if (!card) card = ui.shopOverlay;
    var btn = card.querySelector('#dontBuyBtn');
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = 'dontBuyBtn';
    btn.textContent = "I don't want to buy anything";
    btn.style.marginTop = '12px';
    btn.style.background = '#6b7280';
    btn.style.color = '#fff';
    btn.addEventListener('click', function(){
      postShopClose(false); // false = did not buy
    });
    card.appendChild(btn);
    return btn;
  }

  // new: decide event occurrence while resting (after shop close)
  function maybeTriggerEventAfterShop(){
    if (eventTriggeredThisDay) return;
    eventTriggeredThisDay = true;

    // roll for event
    if (Math.random() < EVENT_CHANCE){
      var ev = Math.random() < 0.5 ? 'heat' : 'mosquito';
      if (ev === 'heat'){
        addNotification('☀️ Heat Wave spotted!', 3500);
        var hasOracle = tents.some(function(t){ return t.type === 'oracle'; });
        var hasNormal = tents.some(function(t){ return t.type === 'normal'; });
        if (hasOracle){
          addNotification('🛡️ Heat Wave has been prevented.', 3500);
        } else if (hasNormal && acOwned > 0){
          health = Math.max(0, health - 5);
          addNotification('Normal Tent + AC — ❤️ -5 Health', 3500);
        } else if (hasNormal){
          health = Math.max(0, health - 10);
          addNotification('Normal Tent — ❤️ -10 Health', 3500);
        } else {
          health = Math.max(0, health - 20);
          addNotification('No tent — ❤️ -20 Health', 3500);
        }
        updateInventoryUI();
      } else {
        addNotification('🦟 Mosquito swarm spotted!', 3500);
        var hasOracle = tents.some(function(t){ return t.type === 'oracle'; });
        var hasNormal = tents.some(function(t){ return t.type === 'normal'; });
        if (hasOracle){
          addNotification('🛡️ Mosquito swarm has been prevented.', 3500);
        } else if (mosquitoSprays > 0){
          mosquitoSprays = Math.max(0, mosquitoSprays - 1);
          addNotification('Mosquito Spray used — 🛡️ Mosquito swarm has been prevented.', 3500);
        } else if (hasNormal){
          health = Math.max(0, health - 10);
          addNotification('Normal Tent — ❤️ -10 Health', 3500);
        } else {
          health = Math.max(0, health - 20);
          addNotification('No tent — ❤️ -20 Health', 3500);
        }
        updateInventoryUI();
      }
    } else {
      addNotification("You're safe today.", 3500);
    }
  }

  // helper: show the "no tent" rest screen and start the night overlay
  function showNoTentRest(){
    inTent = { type: 'no_tent' };
    nightEnding = false; // reset scheduling flag for this night
    insideTimer = Date.now() + 10000;
    if (ui.tentInside) ui.tentInside.classList.remove('hidden');
    if (ui.insideImg && assets.noTent) {
      ui.insideImg.src = assets.noTent;
      ui.insideImg.style.display = ''; // ensure shown
    }
    if (ui.insideText) ui.insideText.textContent = 'You chose to rest without a tent...';
  }

  // post shop close: spawn to camp, start night, trigger event
  function postShopClose(didBuy){
    if (ui.shopOverlay) ui.shopOverlay.classList.add('hidden');
    if (ui.shopButton) ui.shopButton.classList.add('hidden'); // hide until next day
    if (ui.shopNotice) ui.shopNotice.classList.add('hidden');
    modalOpen = false;
    shopLocked = false;

    // teleport player to camp center
    player.x = Math.round(campArea.x + campArea.w/2);
    player.y = Math.round(campArea.y + campArea.h/2);

    // begin night: show tentInside overlay
    // if player didn't buy anything, show the "no tent" image; behave like entering a tent
    if (didBuy === false) {
      showNoTentRest();
    } else {
      // normal camp spawn
      inTent = { type: 'camp_spawn' };
      nightEnding = false;
      insideTimer = Date.now() + 10000;
      if (ui.tentInside) ui.tentInside.classList.remove('hidden');
      if (ui.insideText) ui.insideText.textContent = 'Night begins...';
      // optional: set insideImg to default if desired
      if (ui.insideImg && assets.normalInside) {
        ui.insideImg.src = assets.normalInside;
      }
    }

    // trigger event chance while resting after a short delay
    setTimeout(function(){
      maybeTriggerEventAfterShop();
    }, 700);
  }

  // Attach buy handlers to existing buy buttons and ensure dontBuy button
  function wireShopButtons(){
    var buttons = document.querySelectorAll('[data-buy]');
    for (var i=0;i<buttons.length;i++){
      (function(b){
        var key = b.getAttribute('data-buy');
        if (b._buyHandler) b.removeEventListener('click', b._buyHandler);
        b._buyHandler = function(){ handleBuy(key); };
        b.addEventListener('click', b._buyHandler);
      })(buttons[i]);
    }
    ensureDontBuyButton();
  }

  function handleBuy(which){
    var costs = { normal_tent:50, oracle_tent:180, ac:40, usb:25, spray:15, ice:10 };
    var cost = costs[which];
    if (money < cost){ addNotification('Not enough money'); return; }
    money -= cost;
    if (which === 'normal_tent' || which === 'oracle_tent'){
      var tx = campArea.x + rand(10, campArea.w - 80);
      var ty = campArea.y + rand(10, campArea.h - 80);
      tents.push({ x: tx, y: ty, type: which === 'oracle_tent' ? 'oracle' : 'normal', id: Math.random().toString(36).slice(2) });
      addNotification('Tent purchased and placed at camp');
    } else if (which === 'ac'){ acOwned++; addNotification('Air Conditioner bought'); }
    else if (which === 'usb'){ usbChargers++; addNotification('USB Charger bought'); }
    else if (which === 'spray'){ mosquitoSprays++; addNotification('Mosquito Spray bought'); }
    else if (which === 'ice'){ icePacks++; health = Math.min(100, health + 10); addNotification('Ice Pack used (+10 health)'); }
    updateInventoryUI();

    // close shop and proceed night
    postShopClose(true);
  }

  // Enter tent (manual)
  function tryEnterTent(){
    if (modalOpen || cleaningRiver || plantingInProgress){ addNotification('Busy or modal open'); return; }
    var found = null;
    for (var i=0;i<tents.length;i++){
      var t = tents[i];
      var d = Math.hypot(player.x - t.x, player.y - t.y);
      if (d < 56){ found = t; break; }
    }
    if (!found){ addNotification('No tent nearby'); return; }
    inTent = found;
    nightEnding = false; // reset scheduling flag for this night
    insideTimer = Date.now() + 30000;
    if (ui.tentInside) ui.tentInside.classList.remove('hidden');
    if (ui.insideText) ui.insideText.textContent = 'Resting...';
    if (ui.insideImg) ui.insideImg.src = (found.type === 'oracle') ? assets.oracleInside : assets.normalInside;
    addNotification('Entered tent. Night begins...');
  }

  // End of night: increment day, check completion
  function endNight(){
    nightEnding = false; // allow scheduling again next day
    if (ui.tentInside) ui.tentInside.classList.add('hidden');
    inTent = null;
    addNotification('END OF THE NIGHT — You respawn to forest start.');
    player.x = CANVAS_WIDTH/2;
    player.y = CANVAS_HEIGHT/2;

    // Increase day count after a full night
    day++;

    // Reset flags for next day
    shopOpenedThisDay = false;
    eventTriggeredThisDay = false;

    // Hide shop UI for the next day
    if (ui.shopButton) ui.shopButton.classList.add('hidden');
    if (ui.shopNotice) ui.shopNotice.classList.add('hidden');

    updateInventoryUI();

    // If we've finished all days, complete the game
    if (day > TOTAL_DAYS){
      setTimeout(function(){ finishGame(); }, 800);
      return;
    }

    // otherwise continue with next day
    timer = DAY_LENGTH;
    startSpawning();
  }

  // Finish game safely
  function finishGame(){
    if (gameOver) return;
    stopSpawning();
    gameOver = true;
    if (ui.endOverlay) ui.endOverlay.classList.remove('hidden');
    if (ui.endTitle) ui.endTitle.textContent = 'Game Complete!';
    var score = Math.floor(money + health * 5);
    if (ui.endScore) ui.endScore.innerHTML = '<p>Money: $' + Math.floor(money) + '</p><p>Health: ' + Math.max(0,Math.floor(health)) + '</p><h3>Final Score: ' + score + '</h3>';
  }

  // Planting tick
  function tickPlanting(){
    var nowTs = now();
    if (plantingInProgress && nowTs >= plantingEndTs){
      plantingInProgress = false;
      activeMultipliers.tree = now() + 45000;
      addNotification('Tree planted! x2 item value for 45s.');
      plantedTrees.push({ x: plantingArea.x + rand(10, plantingArea.w-10), y: plantingArea.y + rand(10, plantingArea.h-10) });
    }
  }

  // Main loop
  var lastTs = 0;
  function update(dt){
    if (gameOver) return;

    // decrement timer but never negative (only when not in tent)
    if (!inTent){ timer = Math.max(0, timer - dt); }

    // If modalOpen (locked shop), block movement and actions
    if (!modalOpen){
      if (!cleaningRiver && !plantingInProgress && !inTent){
        var dx = 0, dy = 0;
        if (keys['arrowleft'] || keys['a']) dx -= 1;
        if (keys['arrowright'] || keys['d']) dx += 1;
        if (keys['arrowup'] || keys['w']) dy -= 1;
        if (keys['arrowdown'] || keys['s']) dy += 1;
        if (dx !== 0 || dy !== 0){
          var dist = player.speed * dt;
          var len = Math.hypot(dx,dy) || 1;
          player.x += (dx/len) * dist;
          player.y += (dy/len) * dist;
          player.x = Math.max(16, Math.min(CANVAS_WIDTH-16, player.x));
          player.y = Math.max(16, Math.min(CANVAS_HEIGHT-16, player.y));
        }
      }

      // Actions: G/E/H
      if (keys['g']){ keys['g'] = false; if (!cleaningRiver && !plantingInProgress) tryPickup(); else addNotification('Busy (cleaning or planting)'); }
      if (keys['e']){
        keys['e'] = false;
        if (cleaningRiver || plantingInProgress){ addNotification('Busy (cleaning or planting)'); }
        else {
          var dPlant = Math.hypot(player.x - (plantingArea.x+plantingArea.w/2), player.y - (plantingArea.y+plantingArea.h/2));
          if (dPlant < 80 && plantingUnlocked && (backpack.find(function(i){return i.type==='seed'}) || hasSeed)) {
            tryPlantTree();
          } else {
            var inCleaningNow = (player.x > cleaningArea.x && player.x < cleaningArea.x + cleaningArea.w && player.y > cleaningArea.y && player.y < cleaningArea.y + cleaningArea.h);
            if (inCleaningNow) {
              tryCleanRiver();
            } else {
              addNotification('No interactable nearby');
            }
          }
        }
      }
      if (keys['h']){ keys['h'] = false; if (!cleaningRiver && !plantingInProgress) tryEnterTent(); else addNotification('Busy (cleaning or planting)'); }
    }

    // Timer end handling: show (locked) shop modal only once per day
    if (!inTent && timer <= 0 && !shopOpenedThisDay){
      timer = 0;
      shopOpenedThisDay = true;
      modalOpen = true;
      shopLocked = true;
      if (ui.shopOverlay) ui.shopOverlay.classList.remove('hidden');
      if (ui.shopButton) ui.shopButton.classList.remove('hidden'); // show shop button now that day ended
      if (ui.shopNotice) ui.shopNotice.classList.remove('hidden');
      stopSpawning();
      addNotification("Time's up! Please buy items in the shop");
      wireShopButtons();
      ensureDontBuyButton();
      // event will occur after player closes modal via postShopClose()
    }

    // Cleaning state update
    if (cleaningRiver){
      player.x = Math.max(cleaningArea.x + 16, Math.min(cleaningArea.x + cleaningArea.w - 16, player.x));
      player.y = Math.max(cleaningArea.y + 16, Math.min(cleaningArea.y + cleaningArea.h - 16, player.y));
      riverParticles.forEach(function(p){ p.x += p.vx * dt; p.y += p.vy * dt; p.y -= 6 * dt; });
      if (Math.random() < 0.06) riverParticles.push({ x: rand(cleaningArea.x+10, cleaningArea.x+cleaningArea.w-10), y: cleaningArea.y+cleaningArea.h-10, vx: rand(-10,10), vy: rand(-8,-2), life: rand(1500,4000), born: now(), char: '[P]' });
      riverParticles = riverParticles.filter(function(p){ return now() - p.born < p.life; });
      if (now() >= cleaningEndTs){ cleaningRiver = false; riverParticles = []; addNotification('Finished cleaning the river.'); }
    }

    // Planting freeze behavior
    if (plantingInProgress){
      var centerX = plantingArea.x + plantingArea.w/2, centerY = plantingArea.y + plantingArea.h/2;
      var d2 = Math.hypot(player.x - centerX, player.y - centerY);
      if (d2 > 120){ player.x += (centerX - player.x) * 0.06; player.y += (centerY - player.y) * 0.06; }
      else { player.x = Math.max(plantingArea.x + 12, Math.min(plantingArea.x + plantingArea.w - 12, player.x)); player.y = Math.max(plantingArea.y + 12, Math.min(plantingArea.y + plantingArea.h - 12, player.y)); }
    }

    tickPlanting();

    // Night/tent handling - schedule endNight only once using nightEnding flag
    if (inTent){
      if (Date.now() >= insideTimer){
        if (!nightEnding){
          nightEnding = true; // prevent re-scheduling
          if (ui.insideText) ui.insideText.textContent = 'End of night...';
          setTimeout(function(){ endNight(); }, 600);
        }
      } else {
        var remaining = Math.ceil((insideTimer - Date.now())/1000);
        if (ui.insideText) ui.insideText.textContent = 'Resting... ' + remaining + 's';
      }
    }
  }

  // Drawing (kept)
  function drawMap(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    var bg = imageCache[assets.background];
    if (bg) ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
    else { var g = ctx.createLinearGradient(0,0,0,canvas.height); g.addColorStop(0,'#cce6b3'); g.addColorStop(1,'#79b25a'); ctx.fillStyle=g; ctx.fillRect(0,0,canvas.width,canvas.height); }

    ctx.font = '14px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='rgba(0,0,0,0.6)';
    function drawLabelBox(x,y,text){ var padX=8,padY=4; ctx.font='14px sans-serif'; var w=ctx.measureText(text).width+padX*2; var h=18+padY*2; ctx.fillStyle='rgba(0,0,0,0.45)'; ctx.fillRect(x-w/2,y-h/2,w,h); ctx.fillStyle='#fff'; ctx.fillText(text,x,y); }
    drawLabelBox(cleaningArea.x + cleaningArea.w/2, cleaningArea.y + 12, 'RIVER');
    drawLabelBox(plantingArea.x + plantingArea.w/2, plantingArea.y + 12, 'PLANTING AREA');
    drawLabelBox(campArea.x + campArea.w/2, campArea.y + 12, 'CAMP');

    butterflies.forEach(function(b){ b.x += b.vx*0.016; b.y += b.vy*0.016; if (b.x<0) b.x=canvas.width; if (b.x>canvas.width) b.x=0; if (b.y<0) b.y=0; if (b.y>canvas.height) b.y=canvas.height; ctx.fillStyle=b.color; ctx.beginPath(); ctx.ellipse(b.x,b.y,b.size,b.size*0.6,0,0,Math.PI*2); ctx.fill(); });

    ctx.font='26px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    items.forEach(function(it){ var emoji=EMOJI[it.type]||'?'; ctx.fillText(emoji,it.x,it.y); if (it.type==='coin'){ ctx.font='12px sans-serif'; ctx.fillStyle='#000'; ctx.fillText('$'+it.amount,it.x,it.y+22); ctx.font='26px serif'; ctx.fillStyle='#000'; } });

    tents.forEach(function(t){ var img = imageCache[(t.type==='oracle')?assets.oracleTent:assets.normalTent]; if (img) ctx.drawImage(img,t.x-32,t.y-32,64,64); else { ctx.fillStyle=(t.type==='oracle')? '#fff' : '#dcdcdc'; ctx.fillRect(t.x-32,t.y-32,64,48); } });

    ctx.font='22px serif'; plantedTrees.forEach(function(t){ ctx.fillText(EMOJI.tree,t.x,t.y); });

    if (cleaningRiver){ ctx.font='20px serif'; riverParticles.forEach(function(p){ ctx.fillText(p.char,p.x,p.y); }); ctx.font='28px serif'; ctx.fillText(EMOJI.broom, player.x+14, player.y-10); ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(cleaningArea.x+8, cleaningArea.y+8, cleaningArea.w-16, 28); ctx.fillStyle='#fff'; ctx.font='14px sans-serif'; var remaining=Math.ceil((cleaningEndTs-now())/1000); ctx.fillText('Cleaning river... '+remaining+'s', cleaningArea.x + cleaningArea.w/2, cleaningArea.y + 22); }

    if (plantingInProgress){ ctx.font='28px serif'; ctx.fillText(EMOJI.seed, player.x-14, player.y-8); ctx.fillText(EMOJI.broom, player.x+18, player.y-8); var nowTs=now(); var total=plantingEndTs-plantingStartTs; var rem=Math.max(0,plantingEndTs-nowTs); var pct=Math.max(0,Math.min(1,(total-rem)/total)); var barW=plantingArea.w-16; var bx=plantingArea.x+8; var by=plantingArea.y-20; ctx.fillStyle='#000000aa'; ctx.fillRect(bx-2,by-2,barW+4,18); ctx.fillStyle='#6ee36e'; ctx.fillRect(bx,by,barW*pct,14); ctx.strokeStyle='#274c27'; ctx.strokeRect(bx,by,barW,14); ctx.fillStyle='#fff'; ctx.font='12px sans-serif'; ctx.fillText('Planting... '+Math.ceil(rem/1000)+'s', plantingArea.x+plantingArea.w/2, by+12); }

    var pimg = imageCache[assets.player];
    if (pimg) ctx.drawImage(pimg, player.x-24, player.y-36, 48,72); else { ctx.fillStyle='#2a7'; ctx.fillRect(player.x-12, player.y-24, 24,48); }

    var nowTs2 = Date.now();
    ctx.fillStyle = '#000000aa'; ctx.fillRect(10, CANVAS_HEIGHT-40, 320, 30);
    ctx.fillStyle = '#fff'; ctx.font = '14px Arial';
    ctx.fillText('River: ' + (activeMultipliers.river > nowTs2 ? Math.ceil((activeMultipliers.river-nowTs2)/1000) + 's' : ''), 18, CANVAS_HEIGHT-20);
    ctx.fillText('Tree buff: ' + (activeMultipliers.tree > nowTs2 ? Math.ceil((activeMultipliers.tree-nowTs2)/1000) + 's' : ''), 160, CANVAS_HEIGHT-20);
  }

  // start/loop/init
  function loop(ts){ var dt = (ts - lastTs)/1000; lastTs = ts; update(dt); drawMap(); if (ui.timer) ui.timer.textContent = formatTime(timer); requestAnimationFrame(loop); }

  async function init(){
    // preload images
    await Promise.all(Object.keys(assets).map(function(k){ return loadImage(assets[k]); }));
    updateInventoryUI();

    // add a small fixed text in the bottom-right corner
    (function(){
      var brText = "RULES: Collect items, build tents, survive nights. Time's up → shop opens; buy or rest. Score = Money + Health * 5"; // <-- chỉnh nội dung ở đây
      var br = document.createElement('div');
      br.id = 'bottomRightText';
      br.textContent = brText;
      Object.assign(br.style, {
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        background: 'rgba(0,0,0,0.7)',
        color: '#fff',
        padding: '8px 10px',
        borderRadius: '8px',
        fontSize: '13px',
        lineHeight: '1.2',
        zIndex: 2000,
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
      });
      document.body.appendChild(br);

      // optional: hide on small screens
      function updateBRVisibility(){
        if (window.innerWidth < 480) br.style.display = 'none';
        else br.style.display = '';
      }
      window.addEventListener('resize', updateBRVisibility);
      updateBRVisibility();
    })();

    startSpawning();
    lastTs = performance.now();
    requestAnimationFrame(loop);
    addNotification('Game started.');
  }

  // UI wiring for touch & shop (some already wired above)
  if (ui.touchPickup) ui.touchPickup.addEventListener('click', function(){ tryPickup(); });
  if (ui.touchInteract) ui.touchInteract.addEventListener('click', function(){ if (modalOpen) return; var dPlant = Math.hypot(player.x - (plantingArea.x+plantingArea.w/2), player.y - (plantingArea.y+plantingArea.h/2)); if (dPlant < 80 && plantingUnlocked && (backpack.find(function(i){return i.type==='seed'}) || hasSeed)) tryPlantTree(); else { var inCleaningNow = (player.x > cleaningArea.x && player.x < cleaningArea.x + cleaningArea.w && player.y > cleaningArea.y && player.y < cleaningArea.y + cleaningArea.h); if (inCleaningNow) tryCleanRiver(); else addNotification('No interactable nearby'); } });
  if (ui.touchEnter) ui.touchEnter.addEventListener('click', function(){ tryEnterTent(); });
  if (ui.touchShop) ui.touchShop.addEventListener('click', function(){ if (ui.shopOverlay) ui.shopOverlay.classList.remove('hidden'); modalOpen = true; wireShopButtons(); ensureDontBuyButton(); });
  if (ui.restartBtn) ui.restartBtn.addEventListener('click', function(){ location.reload(); });

  // hide shop notice initially
  if (ui.shopNotice) ui.shopNotice.classList.add('hidden');

  // debug key to force time up
  window.addEventListener('keydown', function(e){ if (e.key === 'T'){ timer = 0; } });

  // cleanup old items periodically
  setInterval(function(){ var cutoff = now() - 1000*60*10; items = items.filter(function(it){ return it.spawnedAt > cutoff; }); }, 60000);

  // start after load
  window.addEventListener('load', function(){ init(); });

  // expose debug helpers
  window.__game = { state: function(){ return { money:money, health:health, day:day, backpack:backpack, tents:tents, items:items, cleaningRiver:cleaningRiver, plantingInProgress: plantingInProgress }; }, pickup: tryPickup, plant: tryPlantTree, enterTent: tryEnterTent };

  // ensure shop buttons wiring if DOM changes
  new MutationObserver(function(){ wireShopButtons(); }).observe(document.body, { childList: true, subtree: true });

  // small utility
  function formatTime(s){ var mm=Math.floor(s/60).toString(); if (mm.length<2) mm='0'+mm; var ss=Math.floor(s%60).toString(); if (ss.length<2) ss='0'+ss; return mm+':'+ss; }

})();
